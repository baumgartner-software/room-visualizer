import {
  BoxGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  EdgesGeometry,
  Group,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  Plane,
  Quaternion,
  Ray,
  Raycaster,
  SphereGeometry,
  Vector3,
} from 'three'
import type { ElementsLayer } from './elements'
import type { RoomView } from './room'
import { MIN_ELEMENT_SIZE, snap, type Store } from './store'
import type { Axis, PlacedElement } from './types'

/**
 * Werkzeuge der Anwendung. Das gewählte Werkzeug entscheidet, was ein Klick
 * bzw. der Controller-Trigger auslöst und wofür die Sticks in XR zuständig sind.
 */
export type Tool = 'view' | 'edit' | 'paint'

export const TOOL_LABELS: Record<Tool, string> = {
  view: 'Ansicht',
  edit: 'Bearbeiten',
  paint: 'Farbe',
}

type HandleKind = 'resize' | 'move-axis' | 'move-free'

interface HandleInfo {
  kind: HandleKind
  axis: Axis
  sign: 1 | -1
}

const AXIS_COLORS: Record<Axis, number> = { x: 0xe3453c, y: 0x3fb950, z: 0x3b82f6 }
const HOVER_COLOR = new Color(0xffd23f)
const HANDLE_GEOMETRY = new SphereGeometry(1, 20, 14)
const SHAFT_GEOMETRY = new CylinderGeometry(1, 1, 1, 12)
const HEAD_GEOMETRY = new ConeGeometry(1, 1, 14)
const PAD_GEOMETRY = new BoxGeometry(1, 1, 1)
const OUTLINE_GEOMETRY = new EdgesGeometry(new BoxGeometry(1, 1, 1))

interface AxisDrag {
  kind: 'resize' | 'move-axis'
  info: HandleInfo
  axisDir: Vector3
  lineOrigin: Vector3
  t0: number
  size0: PlacedElement['size']
  pos0: PlacedElement['position']
}

interface PlaneDrag {
  kind: 'move'
  plane: Plane
  startHit: Vector3
  pos0: PlacedElement['position']
}

export type HoverKind = 'handle' | 'element' | 'paint' | null

/**
 * Auswahl, Verschieben, Größenänderung und Einfärben. Arbeitet ausschließlich
 * mit Weltstrahlen (`Ray`), sodass Maus, Touch und XR-Controller identisch
 * behandelt werden.
 *
 * Griffe am ausgewählten Element:
 *   Kugeln  – Größe der jeweiligen Seite ziehen
 *   Pfeile  – entlang genau einer Achse verschieben
 *   Platte  – frei in der Ebene verschieben (wie das Ziehen am Körper)
 */
export class Editor {
  readonly handles = new Group()
  /** Rahmen um das Objekt, auf das gerade gezeigt wird. */
  readonly hoverOutline: LineSegments
  selectedId: string | null = null
  editMode = true
  tool: Tool = 'edit'
  paintColor = '#c9a063'
  onSelectionChange?: (id: string | null) => void
  onToolChange?: (tool: Tool) => void

  private drag: AxisDrag | PlaneDrag | null = null
  private hovered: Mesh | null = null
  private readonly raycaster = new Raycaster()
  private handleRadius = 0.03
  private hiddenAxes = new Set<Axis>()

  constructor(
    private readonly store: Store,
    private readonly layer: ElementsLayer,
    private readonly roomView: RoomView,
  ) {
    this.handles.name = 'handles'
    this.handles.visible = false
    this.buildHandles()

    this.hoverOutline = new LineSegments(
      OUTLINE_GEOMETRY,
      new LineBasicMaterial({ color: HOVER_COLOR, transparent: true, opacity: 0.95, depthTest: false }),
    )
    this.hoverOutline.name = 'hover-outline'
    this.hoverOutline.renderOrder = 1001
    this.hoverOutline.visible = false
    this.hoverOutline.raycast = () => undefined
  }

  get isDragging(): boolean {
    return this.drag !== null
  }

  get selected(): PlacedElement | undefined {
    return this.store.getElement(this.selectedId)
  }

  setTool(tool: Tool): void {
    if (tool === this.tool) return
    this.tool = tool
    if (tool !== 'edit') this.select(null)
    this.updateHandles()
    this.setHover(null)
    this.onToolChange?.(tool)
  }

  setPaintColor(color: string): void {
    this.paintColor = color
  }

  select(id: string | null): void {
    if (id && !this.store.getElement(id)) id = null
    const changed = id !== this.selectedId
    this.selectedId = id
    this.layer.setSelected(id)
    this.updateHandles()
    if (changed) this.onSelectionChange?.(id)
  }

  setEditMode(on: boolean): void {
    this.editMode = on
    this.updateHandles()
  }

  /** Griffe einzelner Achsen ausblenden (z. B. Y in der 2D-Draufsicht). */
  setHiddenAxes(axes: Axis[]): void {
    this.hiddenAxes = new Set(axes)
    this.updateHandles()
  }

  setHandleRadius(radius: number): void {
    this.handleRadius = radius
    this.updateHandles()
  }

  /** Nach jeder Zustandsänderung aufrufen. */
  updateHandles(): void {
    const mesh = this.layer.getMesh(this.selectedId)
    if (!mesh || !this.editMode || this.tool !== 'edit') {
      if (this.selectedId && !mesh) this.select(null)
      this.handles.visible = false
      return
    }
    mesh.updateWorldMatrix(true, false)
    this.handles.visible = true

    const el = this.selected
    const r = this.handleRadius
    const quaternion = mesh.getWorldQuaternion(new Quaternion())

    for (const object of this.handles.children) {
      const info = object.userData.handle as HandleInfo
      object.visible = !this.hiddenAxes.has(info.axis)
      if (!object.visible) continue

      if (info.kind === 'move-free') {
        const top = mesh.localToWorld(new Vector3(0, 1, 0))
        object.position.copy(top).addScaledVector(new Vector3(0, 1, 0), r * 6)
        object.scale.set(r * 2.6, r * 0.5, r * 2.6)
        continue
      }

      const faceCenter = mesh.localToWorld(faceLocal(info))
      const dir = axisVector(info).applyQuaternion(quaternion).normalize()

      if (info.kind === 'resize') {
        object.position.copy(faceCenter)
        object.scale.setScalar(r)
        continue
      }
      // Pfeil: Schaft ab der Fläche, Spitze am Ende.
      const shaft = object.children[0]
      const head = object.children[1]
      object.position.copy(faceCenter).addScaledVector(dir, r * 2.2)
      object.quaternion.setFromUnitVectors(new Vector3(0, 1, 0), dir)
      shaft.scale.set(r * 0.28, r * 3.4, r * 0.28)
      shaft.position.set(0, r * 1.7, 0)
      head.scale.set(r * 0.85, r * 2, r * 0.85)
      head.position.set(0, r * 4.4, 0)
      void el
    }
  }

  /** @returns true, wenn der Strahl etwas getroffen hat (Klick verbraucht). */
  pointerDown(ray: Ray): boolean {
    if (this.tool === 'view') return false
    if (this.tool === 'paint') return this.paint(ray)

    this.raycaster.ray.copy(ray)
    const mesh = this.layer.getMesh(this.selectedId)

    if (this.editMode && mesh && this.handles.visible) {
      const hit = this.raycaster.intersectObjects(this.activeHandles, true)[0]
      if (hit && this.startHandleDrag(hit.object, mesh)) return true
    }

    const elHit = this.raycaster.intersectObjects(this.layer.pickables, false)[0]
    if (elHit) {
      const id = elHit.object.userData.elementId as string
      this.select(id)
      const el = this.store.getElement(id)
      const target = this.layer.getMesh(id)
      if (el && target) {
        const bottomY = target.getWorldPosition(new Vector3()).y
        const plane = new Plane(new Vector3(0, 1, 0), -bottomY)
        const startHit = new Vector3()
        if (ray.intersectPlane(plane, startHit)) {
          this.drag = { kind: 'move', plane, startHit, pos0: { ...el.position } }
        }
      }
      return true
    }

    this.select(null)
    return false
  }

  pointerMove(ray: Ray): void {
    if (!this.drag) {
      this.hover(ray)
      return
    }
    const el = this.selected
    if (!el) {
      this.drag = null
      return
    }
    if (this.drag.kind === 'move') this.moveOnPlane(ray, this.drag, el)
    else this.dragAlongAxis(ray, this.drag, el)
  }

  pointerUp(): void {
    this.drag = null
  }

  /** Aktualisiert Hervorhebung und Rahmen und liefert, was unter dem Strahl liegt. */
  hover(ray: Ray | null): HoverKind {
    if (!ray || this.tool === 'view') {
      this.setHover(null)
      this.hoverOutline.visible = false
      return null
    }
    this.raycaster.ray.copy(ray)

    if (this.tool === 'paint') {
      this.setHover(null)
      const hit =
        this.raycaster.intersectObjects(this.layer.pickables, false)[0] ??
        this.raycaster.intersectObjects(this.roomView.paintables, false)[0]
      this.outline(hit?.object)
      return hit ? 'paint' : null
    }

    if (this.handles.visible) {
      const hit = this.raycaster.intersectObjects(this.activeHandles, true)[0]
      if (hit) {
        this.setHover(hit.object as Mesh)
        this.outline(undefined)
        return 'handle'
      }
    }
    this.setHover(null)
    const elementHit = this.raycaster.intersectObjects(this.layer.pickables, false)[0]
    this.outline(elementHit?.object)
    return elementHit ? 'element' : null
  }

  /** Verschiebt das ausgewählte Element in Weltkoordinaten. */
  nudgeSelected(delta: { x?: number; y?: number; z?: number }): void {
    const el = this.selected
    if (!el) return
    this.store.updateElement(el.id, {
      position: {
        x: el.position.x + (delta.x ?? 0),
        y: el.position.y + (delta.y ?? 0),
        z: el.position.z + (delta.z ?? 0),
      },
    })
  }

  private get activeHandles(): Object3D[] {
    return this.handles.children.filter((o) => o.visible)
  }

  private buildHandles(): void {
    const axes: Axis[] = ['x', 'y', 'z']
    for (const axis of axes) {
      for (const sign of [1, -1] as const) {
        const info: HandleInfo = { kind: 'resize', axis, sign }
        const sphere = new Mesh(HANDLE_GEOMETRY, gizmoMaterial(AXIS_COLORS[axis]))
        sphere.renderOrder = 1000
        sphere.userData.handle = info
        this.handles.add(sphere)

        const arrow = new Group()
        arrow.userData.handle = { kind: 'move-axis', axis, sign } satisfies HandleInfo
        const material = gizmoMaterial(AXIS_COLORS[axis])
        for (const geometry of [SHAFT_GEOMETRY, HEAD_GEOMETRY]) {
          const mesh = new Mesh(geometry, material)
          mesh.renderOrder = 1000
          mesh.userData.handle = arrow.userData.handle
          arrow.add(mesh)
        }
        this.handles.add(arrow)
      }
    }
    const pad = new Mesh(PAD_GEOMETRY, gizmoMaterial(0xf0f2f5))
    pad.renderOrder = 1000
    pad.userData.handle = { kind: 'move-free', axis: 'y', sign: 1 } satisfies HandleInfo
    this.handles.add(pad)
  }

  private outline(object: Object3D | undefined): void {
    if (!object) {
      this.hoverOutline.visible = false
      return
    }
    const box = boxOf(object)
    const size = box.max.clone().sub(box.min)
    const center = box.max.clone().add(box.min).multiplyScalar(0.5)
    this.hoverOutline.position.copy(center)
    this.hoverOutline.scale.set(size.x + 0.012, size.y + 0.012, size.z + 0.012)
    this.hoverOutline.visible = true
  }

  private setHover(next: Mesh | null): void {
    if (next === this.hovered) return
    if (this.hovered) applyGizmoColor(this.hovered, false)
    if (next) applyGizmoColor(next, true)
    this.hovered = next
  }

  /** Färbt das getroffene Objekt ein – Element, Wand oder Boden. */
  private paint(ray: Ray): boolean {
    const color = this.paintColor
    this.raycaster.ray.copy(ray)
    const elHit = this.raycaster.intersectObjects(this.layer.pickables, false)[0]
    if (elHit) {
      this.store.updateElement(elHit.object.userData.elementId as string, { color })
      return true
    }
    const roomHit = this.raycaster.intersectObjects(this.roomView.paintables, false)[0]
    if (roomHit) {
      const part = roomHit.object.userData.roomPart as 'floor' | 'wall' | undefined
      if (part === 'floor') this.store.setRoomColors({ floorColor: color })
      else if (part === 'wall') this.store.setRoomColors({ wallColor: color })
      return !!part
    }
    return false
  }

  /** @returns false, wenn der Griff aus dieser Blickrichtung nicht ziehbar ist. */
  private startHandleDrag(object: Object3D, mesh: Mesh): boolean {
    const el = this.selected
    if (!el) return false
    const info = object.userData.handle as HandleInfo | undefined
    if (!info) return false

    if (info.kind === 'move-free') {
      const bottomY = mesh.getWorldPosition(new Vector3()).y
      const plane = new Plane(new Vector3(0, 1, 0), -bottomY)
      const startHit = new Vector3()
      if (!this.raycaster.ray.intersectPlane(plane, startHit)) return false
      this.drag = { kind: 'move', plane, startHit, pos0: { ...el.position } }
      return true
    }

    const quaternion = mesh.getWorldQuaternion(new Quaternion())
    const axisDir = axisVector(info).applyQuaternion(quaternion).normalize()
    const lineOrigin = (object as Mesh).getWorldPosition(new Vector3())
    const t0 = closestParamOnLine(lineOrigin, axisDir, this.raycaster.ray)
    if (t0 === null) return false
    this.drag = {
      kind: info.kind,
      info,
      axisDir,
      lineOrigin,
      t0,
      size0: { ...el.size },
      pos0: { ...el.position },
    }
    applyGizmoColor(object, true)
    return true
  }

  private dragAlongAxis(ray: Ray, drag: AxisDrag, el: PlacedElement): void {
    const t = closestParamOnLine(drag.lineOrigin, drag.axisDir, ray)
    if (t === null) return
    const delta = snap(t - drag.t0)

    if (drag.kind === 'move-axis') {
      // Der Pfeil zeigt nach außen; die Richtung im Raum steckt schon in axisDir.
      this.store.updateElement(el.id, {
        position: {
          x: drag.pos0.x + drag.axisDir.x * delta,
          y: drag.pos0.y + drag.axisDir.y * delta,
          z: drag.pos0.z + drag.axisDir.z * delta,
        },
      })
      return
    }

    const { axis, sign } = drag.info
    const sizeKey = axis === 'x' ? 'w' : axis === 'y' ? 'h' : 'd'
    let change = delta
    let newSize = drag.size0[sizeKey] + sign * change
    if (newSize < MIN_ELEMENT_SIZE) {
      newSize = MIN_ELEMENT_SIZE
      change = sign * (MIN_ELEMENT_SIZE - drag.size0[sizeKey])
    }
    const size = { ...drag.size0, [sizeKey]: newSize }
    const position = { ...drag.pos0 }
    if (axis === 'y') {
      if (sign < 0) position.y = drag.pos0.y + change
    } else {
      // Mittelpunkt wandert um die halbe Änderung in Richtung der gezogenen Fläche.
      position.x = drag.pos0.x + drag.axisDir.x * (change / 2)
      position.z = drag.pos0.z + drag.axisDir.z * (change / 2)
    }
    this.store.updateElement(el.id, { size, position })
  }

  private moveOnPlane(ray: Ray, drag: PlaneDrag, el: PlacedElement): void {
    const hit = new Vector3()
    if (!ray.intersectPlane(drag.plane, hit)) return
    // Die Raumgruppe ist nur verschoben, nicht rotiert – Welt-Deltas gelten auch lokal.
    this.store.updateElement(el.id, {
      position: {
        x: drag.pos0.x + (hit.x - drag.startHit.x),
        y: drag.pos0.y,
        z: drag.pos0.z + (hit.z - drag.startHit.z),
      },
    })
  }
}

function gizmoMaterial(color: number): MeshBasicMaterial {
  return new MeshBasicMaterial({ color, depthTest: false, transparent: true, opacity: 0.92 })
}

function applyGizmoColor(object: Object3D, hovered: boolean): void {
  const info = object.userData.handle as HandleInfo | undefined
  if (!info) return
  const base = info.kind === 'move-free' ? 0xf0f2f5 : AXIS_COLORS[info.axis]
  const target = (object as Mesh).material as MeshBasicMaterial | undefined
  if (target && 'color' in target) target.color.set(hovered ? HOVER_COLOR : new Color(base))
  for (const child of object.children) applyGizmoColor(child, hovered)
}

function axisVector(info: HandleInfo): Vector3 {
  const v = new Vector3()
  v[info.axis] = info.sign
  return v
}

/** Mittelpunkt der zugehörigen Fläche im Einheitswürfel (Ursprung unten-mittig). */
function faceLocal(info: HandleInfo): Vector3 {
  const local = new Vector3(0, 0.5, 0)
  local[info.axis] = info.axis === 'y' ? (info.sign > 0 ? 1 : 0) : info.sign * 0.5
  return local
}

function boxOf(object: Object3D): { min: Vector3; max: Vector3 } {
  const box = { min: new Vector3(Infinity, Infinity, Infinity), max: new Vector3(-Infinity, -Infinity, -Infinity) }
  const mesh = object as Mesh
  if (!mesh.geometry) return box
  mesh.geometry.computeBoundingBox()
  const bb = mesh.geometry.boundingBox
  if (!bb) return box
  mesh.updateWorldMatrix(true, false)
  for (const cx of [bb.min.x, bb.max.x]) {
    for (const cy of [bb.min.y, bb.max.y]) {
      for (const cz of [bb.min.z, bb.max.z]) {
        const p = new Vector3(cx, cy, cz).applyMatrix4(mesh.matrixWorld)
        box.min.min(p)
        box.max.max(p)
      }
    }
  }
  return box
}

/**
 * Parameter t des Punktes auf der Geraden (origin + t·dir), der dem Strahl am
 * nächsten liegt. Liefert null, wenn Gerade und Strahl (nahezu) parallel sind.
 */
function closestParamOnLine(origin: Vector3, dir: Vector3, ray: Ray): number | null {
  const a = dir
  const b = ray.direction
  const w0 = new Vector3().subVectors(origin, ray.origin)
  const c = a.dot(b)
  const denom = 1 - c * c
  if (denom < 1e-6) return null
  const d = a.dot(w0)
  const e = b.dot(w0)
  return (c * e - d) / denom
}
