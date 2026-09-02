import {
  BoxGeometry,
  CanvasTexture,
  Color,
  DoubleSide,
  Group,
  Mesh,
  MeshStandardMaterial,
  RepeatWrapping,
  Shape,
  ShapeGeometry,
  SRGBColorSpace,
  Vector3,
} from 'three'
import { centroid, outwardNormal, pointInPolygon } from './geometry'
import type { OpeningSpec, RoomSpec, WallSpec } from './types'

interface WallPiece {
  group: Group
  /** Nach außen zeigende Normale (für die Puppenhaus-Ansicht). */
  normal: Vector3
  center: Vector3
  exterior: boolean
}

/**
 * Raumdarstellung aus einem Grundriss-Polygon: Boden als Polygonfläche, Wände
 * als einzelne Quader mit ausgesparten Fenstern und Türen.
 *
 * Außenwände, die zwischen Kamera und Raum stehen, werden ausgeblendet
 * (Puppenhaus-Ansicht). In XR steht man im Raum, dort bleiben alle Wände
 * sichtbar – das ergibt sich automatisch aus derselben Regel.
 */
export class RoomView {
  readonly group = new Group()
  readonly floor: Mesh
  readonly ceiling: Mesh
  private wallGroup = new Group()
  private pieces: WallPiece[] = []
  private wallMeshes: Mesh[] = []
  private readonly wallMaterial = new MeshStandardMaterial({
    color: new Color('#efeae2'),
    side: DoubleSide,
    roughness: 0.95,
    transparent: true,
    opacity: 1,
  })
  private readonly floorMaterial: MeshStandardMaterial
  /**
   * Die Decke wird nur von unten gesehen; ohne Eigenleuchten bliebe sie im
   * Schatten der Lichter, die alle von oben kommen.
   */
  private readonly ceilingMaterial = new MeshStandardMaterial({
    color: new Color('#efeae2'),
    side: DoubleSide,
    roughness: 1,
    emissiveIntensity: 0.5,
  })
  private height = 2.5
  private outline: import('./types').Vec2[] = []
  private wallsVisible = true
  private floorVisible = true
  private readonly glassMaterial = new MeshStandardMaterial({
    color: new Color('#cfe0ea'),
    side: DoubleSide,
    transparent: true,
    opacity: 0.3,
    roughness: 0.05,
    metalness: 0.1,
  })
  private readonly frameMaterial = new MeshStandardMaterial({
    color: new Color('#f6f4f0'),
    roughness: 0.6,
  })

  constructor(spec: RoomSpec) {
    this.floorMaterial = new MeshStandardMaterial({
      color: new Color(spec.floorColor),
      map: makeGridTexture(),
      side: DoubleSide,
      roughness: 0.85,
      transparent: true,
      opacity: 1,
    })
    this.floor = new Mesh(new ShapeGeometry(new Shape()), this.floorMaterial)
    this.floor.name = 'room-floor'
    this.floor.rotation.x = -Math.PI / 2
    this.floor.userData.roomPart = 'floor'
    this.ceiling = new Mesh(new ShapeGeometry(new Shape()), this.ceilingMaterial)
    this.ceiling.name = 'room-ceiling'
    this.ceiling.rotation.x = -Math.PI / 2
    this.ceiling.userData.roomPart = 'wall'
    this.group.add(this.floor, this.ceiling, this.wallGroup)
    this.update(spec)
  }

  /** Boden und Wände – Ziele für das Farbwerkzeug. */
  get paintables(): Mesh[] {
    return [
      ...(this.floorVisible ? [this.floor] : []),
      ...(this.wallsVisible ? this.wallMeshes : []),
      ...(this.ceiling.visible ? [this.ceiling] : []),
    ]
  }

  update(spec: RoomSpec): void {
    this.wallMaterial.color.set(spec.wallColor)
    this.ceilingMaterial.color.set(spec.wallColor)
    this.ceilingMaterial.emissive.set(spec.wallColor)
    this.floorMaterial.color.set(spec.floorColor)

    // Boden: Polygon in der xz-Ebene (Shape-y entspricht -z).
    const shape = new Shape(spec.outline.map((p) => ({ x: p.x, y: -p.z })) as never)
    this.floor.geometry.dispose()
    this.floor.geometry = new ShapeGeometry(shape)
    this.floor.position.y = 0
    this.ceiling.geometry.dispose()
    this.ceiling.geometry = new ShapeGeometry(shape)
    this.ceiling.position.y = spec.height
    this.height = spec.height
    this.outline = spec.outline

    for (const piece of this.pieces) {
      piece.group.traverse((o) => {
        if (o instanceof Mesh) o.geometry.dispose()
      })
      this.wallGroup.remove(piece.group)
    }
    this.pieces = []
    this.wallMeshes = []

    const center = centroid(spec.outline)
    for (const wall of spec.walls) {
      const piece = this.buildWall(wall, spec, center)
      if (piece) {
        this.pieces.push(piece)
        this.wallGroup.add(piece.group)
      }
    }
  }

  /**
   * Puppenhaus-Ansicht: steht die Kamera außerhalb des Raums, werden die Wände
   * zwischen Kamera und Raum ausgeblendet. Steht man im Raum (XR, Rundgang),
   * bleiben alle Wände stehen.
   */
  updateVisibility(cameraWorldPosition: Vector3): void {
    const local = this.group.worldToLocal(cameraWorldPosition.clone())
    const inside = local.y < this.height && pointInPolygon({ x: local.x, z: local.z }, this.outline)
    this.ceiling.visible = this.wallsVisible && local.y < this.height
    this.floor.visible = this.floorVisible
    for (const piece of this.pieces) {
      piece.group.visible =
        this.wallsVisible && (inside || local.clone().sub(piece.center).dot(piece.normal) <= 0)
    }
  }

  /** Wände (samt Decke) ein- oder ausblenden – in AR meist aus. */
  setWallsVisible(visible: boolean): void {
    this.wallsVisible = visible
  }

  setFloorVisible(visible: boolean): void {
    this.floorVisible = visible
    this.floor.visible = visible
  }

  get wallsShown(): boolean {
    return this.wallsVisible
  }

  get floorShown(): boolean {
    return this.floorVisible
  }

  /** Für AR/Passthrough: Wände und Boden halbtransparent darstellen. */
  setTransparent(transparent: boolean): void {
    this.wallMaterial.opacity = transparent ? 0.2 : 1
    this.floorMaterial.opacity = transparent ? 0.3 : 1
    this.ceilingMaterial.transparent = transparent
    this.ceilingMaterial.opacity = transparent ? 0.15 : 1
  }

  private buildOpening(
    o: OpeningSpec,
    wall: WallSpec,
    dir: { x: number; z: number },
    n: { x: number; z: number },
    offset: number,
    angle: number,
  ): Mesh[] {
    const at = (along: number, y: number): [number, number, number] => [
      wall.a.x + dir.x * along + n.x * offset,
      y,
      wall.a.z + dir.z * along + n.z * offset,
    ]
    const meshes: Mesh[] = []
    for (const part of openingParts(o)) {
      const mesh = new Mesh(
        new BoxGeometry(part.length, part.height, wall.thickness * part.depth),
        this.frameMaterial,
      )
      mesh.position.set(...at(part.along, part.y))
      mesh.rotation.y = angle
      meshes.push(mesh)
    }
    const glass = new Mesh(
      new BoxGeometry(o.width - 0.14, o.top - o.sill - 0.14, wall.thickness * 0.18),
      this.glassMaterial,
    )
    glass.position.set(...at(o.start + o.width / 2, (o.sill + o.top) / 2))
    glass.rotation.y = angle
    glass.raycast = () => undefined // Scheiben nicht anklickbar
    meshes.push(glass)
    return meshes
  }

  private buildWall(wall: WallSpec, spec: RoomSpec, center: { x: number; z: number }): WallPiece | null {
    const dx = wall.b.x - wall.a.x
    const dz = wall.b.z - wall.a.z
    const length = Math.hypot(dx, dz)
    if (length < 1e-4) return null

    const dir = { x: dx / length, z: dz / length }
    const n = outwardNormal(wall, center)
    // Außenwände liegen mit der Innenkante auf dem Polygon, wachsen also nach außen.
    const offset = wall.exterior ? wall.thickness / 2 : 0
    const angle = Math.atan2(-dir.z, dir.x)

    const group = new Group()
    group.name = 'wall'
    for (const box of wallBoxes(length, spec.height, wall.openings ?? [])) {
      const geo = new BoxGeometry(box.length, box.height, wall.thickness)
      const mesh = new Mesh(geo, this.wallMaterial)
      mesh.userData.roomPart = 'wall'
      const along = box.start + box.length / 2
      mesh.position.set(
        wall.a.x + dir.x * along + n.x * offset,
        box.bottom + box.height / 2,
        wall.a.z + dir.z * along + n.z * offset,
      )
      mesh.rotation.y = angle
      group.add(mesh)
      this.wallMeshes.push(mesh)
    }

    for (const opening of wall.openings ?? []) {
      if (opening.kind === 'passage' || opening.kind === undefined) continue
      for (const piece of this.buildOpening(opening, wall, dir, n, offset, angle)) group.add(piece)
    }

    return {
      group,
      normal: new Vector3(n.x, 0, n.z),
      center: new Vector3(wall.a.x + dir.x * (length / 2), spec.height / 2, wall.a.z + dir.z * (length / 2)),
      exterior: !!wall.exterior,
    }
  }
}

/**
 * Rahmen und Glasscheibe einer Öffnung. Türen bekommen zusätzlich einen
 * Mittelpfosten, damit sie als zweiflügelige Terrassentür lesbar sind.
 */
function openingParts(o: OpeningSpec): { along: number; y: number; length: number; height: number; depth: number }[] {
  const FRAME = 0.07
  const h = o.top - o.sill
  const midY = o.sill + h / 2
  const parts = [
    { along: o.start + o.width / 2, y: o.top - FRAME / 2, length: o.width, height: FRAME, depth: 0.9 },
    { along: o.start + FRAME / 2, y: midY, length: FRAME, height: h, depth: 0.9 },
    { along: o.start + o.width - FRAME / 2, y: midY, length: FRAME, height: h, depth: 0.9 },
  ]
  if (o.sill > 0.01) {
    parts.push({ along: o.start + o.width / 2, y: o.sill + FRAME / 2, length: o.width, height: FRAME, depth: 1.1 })
  }
  if (o.kind === 'door') {
    parts.push({ along: o.start + o.width / 2, y: midY, length: FRAME * 0.8, height: h, depth: 0.9 })
  }
  return parts
}

interface WallBox {
  start: number
  length: number
  bottom: number
  height: number
}

/**
 * Zerlegt eine Wand in Quader: volle Stücke zwischen den Öffnungen, dazu
 * Brüstung und Sturz an jeder Öffnung.
 */
function wallBoxes(length: number, height: number, openings: OpeningSpec[]): WallBox[] {
  const boxes: WallBox[] = []
  const sorted = [...openings].sort((a, b) => a.start - b.start)
  let cursor = 0
  for (const o of sorted) {
    const start = Math.max(0, Math.min(o.start, length))
    const end = Math.max(start, Math.min(o.start + o.width, length))
    if (start > cursor + 1e-4) {
      boxes.push({ start: cursor, length: start - cursor, bottom: 0, height })
    }
    if (o.sill > 1e-4) boxes.push({ start, length: end - start, bottom: 0, height: o.sill })
    if (o.top < height - 1e-4) {
      boxes.push({ start, length: end - start, bottom: o.top, height: height - o.top })
    }
    cursor = Math.max(cursor, end)
  }
  if (cursor < length - 1e-4) boxes.push({ start: cursor, length: length - cursor, bottom: 0, height })
  return boxes.filter((b) => b.length > 1e-4 && b.height > 1e-4)
}

/** Dezentes 50-cm-Raster als Bodentextur (die UV entspricht den Metern). */
function makeGridTexture(): CanvasTexture {
  const size = 128
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, size, size)
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.09)'
  ctx.lineWidth = 2
  ctx.strokeRect(0, 0, size, size)
  const tex = new CanvasTexture(canvas)
  tex.colorSpace = SRGBColorSpace
  tex.wrapS = RepeatWrapping
  tex.wrapT = RepeatWrapping
  tex.repeat.set(2, 2) // eine Kachel = 50 cm
  tex.anisotropy = 4
  return tex
}
