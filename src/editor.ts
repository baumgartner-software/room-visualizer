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
import type { Axis, PlacedElement, Size, Vec3 } from './types'

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

/**
 * Zwei Schritte innerhalb des Werkzeugs „Bearbeiten“:
 *   'select'    Objekte anklicken und zur Auswahl hinzufügen – nichts bewegt sich
 *   'transform' Griffe erscheinen; nur noch die Griffe reagieren, der Strahl
 *               geht durch alle anderen Objekte hindurch
 */
export type EditPhase = 'select' | 'transform'

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

interface Box {
  min: Vector3
  max: Vector3
}

interface AxisDrag {
  kind: 'resize' | 'move-axis'
  info: HandleInfo
  axisDir: Vector3
  lineOrigin: Vector3
  t0: number
  size0: Size
  starts: Map<string, Vec3>
}

interface PlaneDrag {
  kind: 'move'
  plane: Plane
  startHit: Vector3
  starts: Map<string, Vec3>
}

export type HoverKind = 'handle' | 'element' | 'paint' | null

/**
 * Auswahl, Verschieben, Größenänderung und Einfärben. Arbeitet ausschließlich
 * mit Weltstrahlen (`Ray`), sodass Maus, Touch und XR-Controller identisch
 * behandelt werden.
 *
 * Objekte lassen sich bewusst nicht direkt anfassen und wegziehen – erst
 * auswählen, dann über die Griffe bewegen:
 *   Kugeln  – Größe der jeweiligen Seite (nur bei genau einem Objekt)
 *   Pfeile  – entlang genau einer Achse verschieben
 *   Platte  – frei in der Ebene verschieben
 */
export class Editor {
  readonly handles = new Group()
  /** Rahmen um das Objekt, auf das gerade gezeigt wird. */
  readonly hoverOutline: LineSegments
  selectedIds: string[] = []
  tool: Tool = 'edit'
  editPhase: EditPhase = 'select'
  paintColor = '#c9a063'

  private readonly toolListeners = new Set<(tool: Tool) => void>()
  private readonly colorListeners = new Set<(color: string) => void>()
  private readonly selectionListeners = new Set<(ids: string[], phase: EditPhase) => void>()
  private drag: AxisDrag | PlaneDrag | null = null
  private hovered: Object3D | null = null
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

  /** Zuletzt angeklicktes Objekt – das Panel zeigt dessen Werte. */
  get selectedId(): string | null {
    return this.selectedIds.at(-1) ?? null
  }

  get selected(): PlacedElement | undefined {
    return this.store.getElement(this.selectedId)
  }

  addToolListener(listener: (tool: Tool) => void): void {
    this.toolListeners.add(listener)
  }

  addPaintColorListener(listener: (color: string) => void): void {
    this.colorListeners.add(listener)
  }

  addSelectionListener(listener: (ids: string[], phase: EditPhase) => void): void {
    this.selectionListeners.add(listener)
  }

  setTool(tool: Tool): void {
    if (tool === this.tool) return
    this.tool = tool
    if (tool !== 'edit') this.clearSelection()
    this.updateHandles()
    this.setHover(null)
    for (const listener of this.toolListeners) listener(tool)
  }

  setPaintColor(color: string): void {
    if (color === this.paintColor) return
    this.paintColor = color
    for (const listener of this.colorListeners) listener(color)
  }

  setEditPhase(phase: EditPhase): void {
    if (phase === this.editPhase) return
    // Ohne Auswahl gibt es nichts zu bearbeiten.
    this.editPhase = phase === 'transform' && this.selectedIds.length === 0 ? 'select' : phase
    this.updateHandles()
    this.emitSelection()
  }

  /** Ersetzt die Auswahl (null leert sie). */
  select(id: string | null): void {
    this.selectedIds = id && this.store.getElement(id) ? [id] : []
    this.afterSelectionChange()
  }

  /** Fügt hinzu bzw. entfernt – für Mehrfachauswahl. */
  toggleSelection(id: string): void {
    if (!this.store.getElement(id)) return
    const index = this.selectedIds.indexOf(id)
    if (index >= 0) this.selectedIds.splice(index, 1)
    else this.selectedIds.push(id)
    this.afterSelectionChange()
  }

  clearSelection(): void {
    if (this.selectedIds.length === 0 && this.editPhase === 'select') return
    this.selectedIds = []
    this.editPhase = 'select'
    this.afterSelectionChange()
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
    const known = this.selectedIds.filter((id) => this.layer.getMesh(id))
    if (known.length !== this.selectedIds.length) {
      this.selectedIds = known
      if (known.length === 0) this.editPhase = 'select'
      this.emitSelection()
    }
    if (this.tool !== 'edit' || this.editPhase !== 'transform' || known.length === 0) {
      this.handles.visible = false
      return
    }

    const single = known.length === 1 ? this.layer.getMesh(known[0]) : undefined
    const box = single ? null : this.selectionBox()
    if (!single && !box) {
      this.handles.visible = false
      return
    }
    single?.updateWorldMatrix(true, false)
    this.handles.visible = true

    const r = this.handleRadius
    const quaternion = single ? single.getWorldQuaternion(new Quaternion()) : new Quaternion()

    for (const object of this.handles.children) {
      const info = object.userData.handle as HandleInfo
      // Größe lässt sich nur für ein einzelnes Objekt sinnvoll ziehen.
      object.visible = !this.hiddenAxes.has(info.axis) && (info.kind !== 'resize' || !!single)
      if (!object.visible) continue

      if (info.kind === 'move-free') {
        const top = single ? single.localToWorld(new Vector3(0, 1, 0)) : new Vector3(center(box!).x, box!.max.y, center(box!).z)
        object.position.copy(top).addScaledVector(new Vector3(0, 1, 0), r * 6)
        object.scale.set(r * 2.6, r * 0.5, r * 2.6)
        continue
      }

      const faceCenter = single ? single.localToWorld(faceLocal(info)) : boxFaceCenter(box!, info)
      const dir = axisVector(info).applyQuaternion(quaternion).normalize()

      if (info.kind === 'resize') {
        object.position.copy(faceCenter)
        object.scale.setScalar(r)
        continue
      }
      const shaft = object.children[0]
      const head = object.children[1]
      object.position.copy(faceCenter).addScaledVector(dir, r * 2.2)
      object.quaternion.setFromUnitVectors(new Vector3(0, 1, 0), dir)
      shaft.scale.set(r * 0.28, r * 3.4, r * 0.28)
      shaft.position.set(0, r * 1.7, 0)
      head.scale.set(r * 0.85, r * 2, r * 0.85)
      head.position.set(0, r * 4.4, 0)
    }
  }

  /**
   * @param additive Auswahl erweitern statt ersetzen (Umschalttaste, XR-Trigger).
   * @returns true, wenn der Strahl etwas getroffen hat (Klick verbraucht).
   */
  pointerDown(ray: Ray, additive = false): boolean {
    if (this.tool === 'view') return false
    this.raycaster.ray.copy(ray)
    if (this.tool === 'paint') return this.paint()

    if (this.editPhase === 'transform') {
      // Nur die Griffe reagieren – der Strahl geht durch alles andere hindurch.
      const hit = this.raycaster.intersectObjects(this.activeHandles, true)[0]
      return hit ? this.startHandleDrag(hit.object) : false
    }

    const elHit = this.raycaster.intersectObjects(this.layer.pickables, false)[0]
    if (elHit) {
      const id = elHit.object.userData.elementId as string
      if (additive) this.toggleSelection(id)
      else this.select(id)
      return true
    }
    if (!additive) this.clearSelection()
    return false
  }

  pointerMove(ray: Ray): void {
    if (!this.drag) {
      this.hover(ray)
      return
    }
    if (this.drag.kind === 'move') this.moveOnPlane(ray, this.drag)
    else this.dragAlongAxis(ray, this.drag)
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

    if (this.editPhase === 'transform') {
      const hit = this.raycaster.intersectObjects(this.activeHandles, true)[0]
      this.setHover(hit ? hit.object : null)
      this.hoverOutline.visible = false
      return hit ? 'handle' : null
    }

    this.setHover(null)
    const elementHit = this.raycaster.intersectObjects(this.layer.pickables, false)[0]
    this.outline(elementHit?.object)
    return elementHit ? 'element' : null
  }

  /** Verschiebt die gesamte Auswahl in Weltkoordinaten. */
  nudgeSelected(delta: { x?: number; y?: number; z?: number }): void {
    for (const id of this.selectedIds) {
      const el = this.store.getElement(id)
      if (!el) continue
      this.store.updateElement(id, {
        position: {
          x: el.position.x + (delta.x ?? 0),
          y: el.position.y + (delta.y ?? 0),
          z: el.position.z + (delta.z ?? 0),
        },
      })
    }
  }

  /** Dreht alle ausgewählten Objekte. */
  rotateSelected(): void {
    for (const id of this.selectedIds) this.store.rotateElement(id)
  }

  private afterSelectionChange(): void {
    if (this.selectedIds.length === 0) this.editPhase = 'select'
    this.layer.setSelected(this.selectedIds)
    this.updateHandles()
    this.emitSelection()
  }

  private emitSelection(): void {
    for (const listener of this.selectionListeners) listener([...this.selectedIds], this.editPhase)
  }

  private get activeHandles(): Object3D[] {
    return this.handles.visible ? this.handles.children.filter((o) => o.visible) : []
  }

  private selectionBox(): Box | null {
    let box: Box | null = null
    for (const id of this.selectedIds) {
      const mesh = this.layer.getMesh(id)
      if (!mesh) continue
      const b = boxOf(mesh)
      if (!box) box = b
      else {
        box.min.min(b.min)
        box.max.max(b.max)
      }
    }
    return box
  }

  private buildHandles(): void {
    const axes: Axis[] = ['x', 'y', 'z']
    for (const axis of axes) {
      for (const sign of [1, -1] as const) {
        const sphere = new Mesh(HANDLE_GEOMETRY, gizmoMaterial(AXIS_COLORS[axis]))
        sphere.renderOrder = 1000
        sphere.userData.handle = { kind: 'resize', axis, sign } satisfies HandleInfo
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
    this.hoverOutline.position.copy(center(box))
    this.hoverOutline.scale.set(size.x + 0.012, size.y + 0.012, size.z + 0.012)
    this.hoverOutline.visible = true
  }

  private setHover(next: Object3D | null): void {
    if (next === this.hovered) return
    if (this.hovered) applyGizmoColor(this.hovered, false)
    if (next) applyGizmoColor(next, true)
    this.hovered = next
  }

  /** Färbt das getroffene Objekt ein – Element, Wand oder Boden. */
  private paint(): boolean {
    const color = this.paintColor
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

  private startPositions(): Map<string, Vec3> {
    const starts = new Map<string, Vec3>()
    for (const id of this.selectedIds) {
      const el = this.store.getElement(id)
      if (el) starts.set(id, { ...el.position })
    }
    return starts
  }

  /** @returns false, wenn der Griff aus dieser Blickrichtung nicht ziehbar ist. */
  private startHandleDrag(object: Object3D): boolean {
    const info = object.userData.handle as HandleInfo | undefined
    if (!info || this.selectedIds.length === 0) return false
    const starts = this.startPositions()

    if (info.kind === 'move-free') {
      const box = this.selectionBox()
      if (!box) return false
      const plane = new Plane(new Vector3(0, 1, 0), -box.min.y)
      const startHit = new Vector3()
      if (!this.raycaster.ray.intersectPlane(plane, startHit)) return false
      this.drag = { kind: 'move', plane, startHit, starts }
      return true
    }

    const single = this.selectedIds.length === 1 ? this.layer.getMesh(this.selectedIds[0]) : undefined
    const quaternion = single ? single.getWorldQuaternion(new Quaternion()) : new Quaternion()
    const axisDir = axisVector(info).applyQuaternion(quaternion).normalize()
    const lineOrigin = (object as Mesh).getWorldPosition(new Vector3())
    const t0 = closestParamOnLine(lineOrigin, axisDir, this.raycaster.ray)
    if (t0 === null) return false
    const size0 = this.selected?.size ?? { w: 1, h: 1, d: 1 }
    this.drag = { kind: info.kind, info, axisDir, lineOrigin, t0, size0: { ...size0 }, starts }
    applyGizmoColor(object, true)
    return true
  }

  private dragAlongAxis(ray: Ray, drag: AxisDrag): void {
    const t = closestParamOnLine(drag.lineOrigin, drag.axisDir, ray)
    if (t === null) return
    const delta = snap(t - drag.t0)

    if (drag.kind === 'move-axis') {
      for (const [id, pos0] of drag.starts) {
        this.store.updateElement(id, {
          position: {
            x: pos0.x + drag.axisDir.x * delta,
            y: pos0.y + drag.axisDir.y * delta,
            z: pos0.z + drag.axisDir.z * delta,
          },
        })
      }
      return
    }

    // Größe ziehen gibt es nur bei genau einem ausgewählten Objekt.
    const id = this.selectedIds[0]
    const pos0 = drag.starts.get(id)
    if (!pos0) return
    const { axis, sign } = drag.info
    const sizeKey = axis === 'x' ? 'w' : axis === 'y' ? 'h' : 'd'
    let change = delta
    let newSize = drag.size0[sizeKey] + sign * change
    if (newSize < MIN_ELEMENT_SIZE) {
      newSize = MIN_ELEMENT_SIZE
      change = sign * (MIN_ELEMENT_SIZE - drag.size0[sizeKey])
    }
    const size = { ...drag.size0, [sizeKey]: newSize }
    const position = { ...pos0 }
    if (axis === 'y') {
      if (sign < 0) position.y = pos0.y + change
    } else {
      // Mittelpunkt wandert um die halbe Änderung in Richtung der gezogenen Fläche.
      position.x = pos0.x + drag.axisDir.x * (change / 2)
      position.z = pos0.z + drag.axisDir.z * (change / 2)
    }
    this.store.updateElement(id, { size, position })
  }

  private moveOnPlane(ray: Ray, drag: PlaneDrag): void {
    const hit = new Vector3()
    if (!ray.intersectPlane(drag.plane, hit)) return
    const dx = hit.x - drag.startHit.x
    const dz = hit.z - drag.startHit.z
    for (const [id, pos0] of drag.starts) {
      this.store.updateElement(id, { position: { x: pos0.x + dx, y: pos0.y, z: pos0.z + dz } })
    }
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

function boxFaceCenter(box: Box, info: HandleInfo): Vector3 {
  const c = center(box)
  const face = c.clone()
  face[info.axis] = info.sign > 0 ? box.max[info.axis] : box.min[info.axis]
  return face
}

function center(box: Box): Vector3 {
  return box.max.clone().add(box.min).multiplyScalar(0.5)
}

function boxOf(object: Object3D): Box {
  const box: Box = {
    min: new Vector3(Infinity, Infinity, Infinity),
    max: new Vector3(-Infinity, -Infinity, -Infinity),
  }
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
