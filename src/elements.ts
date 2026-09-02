import {
  BoxGeometry,
  Color,
  CylinderGeometry,
  EdgesGeometry,
  Group,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshStandardMaterial,
  Object3D,
} from 'three'
import { getDef } from './catalog'
import type { ElementDef, FrontDir, PlacedElement, Size } from './types'

const SELECTED_EMISSIVE = new Color('#2f74c0')
const BLACK = new Color(0x000000)

/** Einheitswürfel, Ursprung unten-mittig (wie PlacedElement.position). */
const UNIT_BOX = new BoxGeometry(1, 1, 1).translate(0, 0.5, 0)
const UNIT_EDGES = new EdgesGeometry(UNIT_BOX)
const CENTERED_BOX = new BoxGeometry(1, 1, 1)
const UNIT_CYLINDER = new CylinderGeometry(1, 1, 1, 18)
const EDGE_MATERIAL = new LineBasicMaterial({ color: 0x333333, transparent: true, opacity: 0.5 })
const HANDLE_MATERIAL = new MeshStandardMaterial({ color: new Color('#26282d'), roughness: 0.4, metalness: 0.6 })

/** Rahmenbreite und Tiefe der aufgesetzten Landhaus-Rahmen. */
const RAIL = 0.07
const RELIEF = 0.012
const GAP = 0.008

interface ElementParts {
  mesh: Mesh
  body: MeshStandardMaterial
  detail: MeshStandardMaterial
  /** Gruppe mit umgekehrter Skalierung, damit Details in Metern gebaut werden. */
  deco: Group
  edges: LineSegments
  signature: string
}

export class ElementsLayer {
  readonly group = new Group()
  private parts = new Map<string, ElementParts>()
  private selectedIds: string[] = []

  constructor() {
    this.group.name = 'elements'
  }

  get pickables(): Mesh[] {
    return [...this.parts.values()].map((p) => p.mesh)
  }

  getMesh(id: string | null | undefined): Mesh | undefined {
    return id ? this.parts.get(id)?.mesh : undefined
  }

  /** Bringt die Meshes mit dem Zustand des Stores in Einklang. */
  sync(elements: PlacedElement[]): void {
    const seen = new Set<string>()
    for (const el of elements) {
      seen.add(el.id)
      let part = this.parts.get(el.id)
      if (!part) {
        part = this.createParts(el)
        this.parts.set(el.id, part)
        this.group.add(part.mesh)
      }
      this.applyState(part, el)
    }
    for (const [id, part] of this.parts) {
      if (!seen.has(id)) {
        this.group.remove(part.mesh)
        part.body.dispose()
        part.detail.dispose()
        this.parts.delete(id)
      }
    }
    this.setSelected(this.selectedIds)
  }

  setSelected(ids: string[]): void {
    this.selectedIds = ids
    const selected = new Set(ids)
    for (const [meshId, part] of this.parts) {
      const emissive = selected.has(meshId) ? SELECTED_EMISSIVE : BLACK
      part.body.emissive.copy(emissive)
      part.detail.emissive.copy(emissive)
      part.body.emissiveIntensity = 0.35
      part.detail.emissiveIntensity = 0.35
    }
  }

  private createParts(el: PlacedElement): ElementParts {
    const body = new MeshStandardMaterial({ color: new Color(el.color), roughness: 0.7, metalness: 0.05 })
    const detail = new MeshStandardMaterial({ color: new Color(el.color), roughness: 0.65, metalness: 0.05 })
    const mesh = new Mesh(UNIT_BOX, body)
    mesh.userData.elementId = el.id

    const edges = new LineSegments(UNIT_EDGES, EDGE_MATERIAL)
    edges.name = 'edges'
    edges.raycast = () => undefined // Kanten nicht anklickbar
    const deco = new Group()
    deco.name = 'deco'
    deco.raycast = () => undefined
    mesh.add(edges, deco)
    return { mesh, body, detail, deco, edges, signature: '' }
  }

  private applyState(part: ElementParts, el: PlacedElement): void {
    const { mesh, body, detail } = part
    mesh.position.set(el.position.x, el.position.y, el.position.z)
    mesh.scale.set(el.size.w, el.size.h, el.size.d)
    mesh.rotation.set(el.rotationX ?? 0, el.rotationY, el.rotationZ ?? 0)
    mesh.name = el.name
    if (`#${body.color.getHexString()}` !== el.color.toLowerCase()) {
      body.color.set(el.color)
      detail.color.set(el.color)
    }

    const def = getDef(el.defId)
    const signature = [el.defId, el.front ?? '-', el.mirrored ? 'm' : '-', el.size.w, el.size.h, el.size.d].join('|')
    if (signature !== part.signature) {
      part.signature = signature
      this.buildDetails(part, el, def)
    }
  }

  /** Baut Fronten bzw. Sonderformen neu auf (nur bei Größen-/Typwechsel). */
  private buildDetails(part: ElementParts, el: PlacedElement, def: ElementDef | undefined): void {
    const { deco, mesh, body, detail } = part
    for (const child of [...deco.children]) deco.remove(child)
    // Gegenskalierung: Kinder rechnen dadurch in echten Metern.
    deco.scale.set(1 / el.size.w, 1 / el.size.h, 1 / el.size.d)

    const isFaucet = def?.shape === 'faucet'
    body.visible = !isFaucet
    part.edges.visible = !isFaucet

    if (isFaucet) {
      for (const o of buildFaucet(el.size, detail)) deco.add(o)
      return
    }
    if (!el.front || !def?.frontPanels) return
    for (const o of buildFront(
      el.size,
      el.front,
      def.frontPanels,
      def.handle ?? 'vertical',
      detail,
      !!el.mirrored,
    )) {
      deco.add(o)
    }
    mesh.updateMatrixWorld()
  }
}

interface FaceAxes {
  /** Position auf der Frontfläche → lokale Koordinaten. */
  place: (u: number, v: number, offset: number) => [number, number, number]
  /** Größe auf der Frontfläche → lokale Skalierung. */
  size: (uSize: number, vSize: number, depth: number) => [number, number, number]
  /** Breite der Frontfläche. */
  width: number
}

function faceAxes(size: Size, front: FrontDir): FaceAxes {
  const { w, h, d } = size
  void h
  switch (front) {
    case 'px':
      return {
        place: (u, v, o) => [w / 2 + o / 2, v, u],
        size: (us, vs, dep) => [dep, vs, us],
        width: d,
      }
    case 'nx':
      return {
        place: (u, v, o) => [-w / 2 - o / 2, v, u],
        size: (us, vs, dep) => [dep, vs, us],
        width: d,
      }
    case 'pz':
      return {
        place: (u, v, o) => [u, v, d / 2 + o / 2],
        size: (us, vs, dep) => [us, vs, dep],
        width: w,
      }
    default:
      return {
        place: (u, v, o) => [u, v, -d / 2 - o / 2],
        size: (us, vs, dep) => [us, vs, dep],
        width: w,
      }
  }
}

/**
 * Landhaus-Front: pro Tür bzw. Schublade ein aufgesetzter Rahmen, die Fläche
 * dazwischen wirkt dadurch eingelassen. Dazu ein Griff.
 */
function buildFront(
  size: Size,
  front: FrontDir,
  panels: [number, number],
  handle: 'vertical' | 'horizontal' | 'none',
  material: MeshStandardMaterial,
  mirrored: boolean,
): Object3D[] {
  const axes = faceAxes(size, front)
  const [cols, rows] = panels
  const usable = axes.width - 2 * GAP
  const usableH = size.h - 2 * GAP
  if (usable <= 0.05 || usableH <= 0.05) return []

  const cellW = (usable - GAP * (cols - 1)) / cols
  const cellH = (usableH - GAP * (rows - 1)) / rows
  const rail = Math.min(RAIL, cellW / 3.2, cellH / 3.2)
  if (rail <= 0.005) return []

  const out: Object3D[] = []
  const bar = (u: number, v: number, uSize: number, vSize: number, depth: number, mat: MeshStandardMaterial): void => {
    if (uSize <= 0 || vSize <= 0) return
    const box = new Mesh(CENTERED_BOX, mat)
    box.position.set(...axes.place(u, v, depth))
    box.scale.set(...axes.size(uSize, vSize, depth))
    out.push(box)
  }

  for (let c = 0; c < cols; c++) {
    for (let r = 0; r < rows; r++) {
      const uc = -usable / 2 + cellW / 2 + c * (cellW + GAP)
      const vc = size.h - GAP - cellH / 2 - r * (cellH + GAP)
      // Rahmen: oben, unten, links, rechts
      bar(uc, vc + cellH / 2 - rail / 2, cellW, rail, RELIEF, material)
      bar(uc, vc - cellH / 2 + rail / 2, cellW, rail, RELIEF, material)
      bar(uc - cellW / 2 + rail / 2, vc, rail, cellH - 2 * rail, RELIEF, material)
      bar(uc + cellW / 2 - rail / 2, vc, rail, cellH - 2 * rail, RELIEF, material)

      if (handle === 'horizontal') {
        bar(uc, vc, Math.min(0.28, cellW * 0.55), 0.016, RELIEF + 0.026, HANDLE_MATERIAL)
      } else if (handle === 'vertical') {
        // Gespiegelt sitzt der Griff auf der anderen Seite (Anschlag wechseln).
        const u = uc + (mirrored ? -1 : 1) * (cellW / 2 - rail - 0.025)
        bar(u, vc, 0.016, Math.min(0.2, cellH * 0.45), RELIEF + 0.026, HANDLE_MATERIAL)
      }
    }
  }
  return out
}

/** Armatur: Standrohr, waagerechter Auslauf in Richtung +X und kurzer Auslass. */
function buildFaucet(size: Size, material: MeshStandardMaterial): Object3D[] {
  const columnX = -size.w / 2 + 0.03
  const spoutY = size.h * 0.78
  const reach = size.w - 0.05
  const r = Math.min(0.022, size.d / 2)

  const column = new Mesh(UNIT_CYLINDER, material)
  column.scale.set(r, spoutY, r)
  column.position.set(columnX, spoutY / 2, 0)

  const spout = new Mesh(UNIT_CYLINDER, material)
  spout.scale.set(r * 0.8, reach, r * 0.8)
  spout.rotation.z = -Math.PI / 2
  spout.position.set(columnX + reach / 2, spoutY, 0)

  const outlet = new Mesh(UNIT_CYLINDER, material)
  outlet.scale.set(r * 0.7, 0.05, r * 0.7)
  outlet.position.set(columnX + reach, spoutY - 0.025, 0)

  const lever = new Mesh(CENTERED_BOX, material)
  lever.scale.set(0.09, 0.014, 0.014)
  lever.position.set(columnX + 0.05, spoutY * 0.55, 0)

  return [column, spout, outlet, lever]
}
