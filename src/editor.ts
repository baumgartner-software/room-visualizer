import { Color, Group, Mesh, MeshBasicMaterial, Plane, Quaternion, Ray, Raycaster, SphereGeometry, Vector3 } from 'three'
import type { ElementsLayer } from './elements'
import type { RoomView } from './room'
import { MIN_ELEMENT_SIZE, snap, type Store } from './store'
import type { Axis, PlacedElement } from './types'

interface HandleInfo {
  axis: Axis
  sign: 1 | -1
}

const AXIS_COLORS: Record<Axis, number> = { x: 0xe3453c, y: 0x3fb950, z: 0x3b82f6 }
const HOVER_COLOR = new Color(0xffd23f)
const HANDLE_GEOMETRY = new SphereGeometry(1, 20, 14)

interface HandleDrag {
  kind: 'handle'
  handle: Mesh
  info: HandleInfo
  axisDir: Vector3
  lineOrigin: Vector3
  t0: number
  size0: PlacedElement['size']
  pos0: PlacedElement['position']
}

interface MoveDrag {
  kind: 'move'
  plane: Plane
  startHit: Vector3
  pos0: PlacedElement['position']
}

export type HoverKind = 'handle' | 'element' | 'paint' | null

/**
 * Auswahl-, Verschiebe- und Größenänderungslogik. Arbeitet ausschließlich mit
 * Weltstrahlen (`Ray`), sodass Maus, Touch und XR-Controller identisch
 * behandelt werden. Die Griffkugeln (`handles`) liegen im Weltkoordinatensystem
 * und sollten direkt der Szene hinzugefügt werden.
 */
export class Editor {
  readonly handles = new Group()
  selectedId: string | null = null
  editMode = true
  /** Ist eine Farbe gewählt, färbt ein Klick das getroffene Objekt ein. */
  paintColor: string | null = null
  onSelectionChange?: (id: string | null) => void
  onPaintModeChange?: (color: string | null) => void

  private readonly handleMeshes: Mesh[] = []
  private drag: HandleDrag | MoveDrag | null = null
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
    const axes: Axis[] = ['x', 'y', 'z']
    for (const axis of axes) {
      for (const sign of [1, -1] as const) {
        const mat = new MeshBasicMaterial({ color: AXIS_COLORS[axis], depthTest: false, transparent: true, opacity: 0.9 })
        const mesh = new Mesh(HANDLE_GEOMETRY, mat)
        mesh.renderOrder = 1000
        mesh.userData.handle = { axis, sign } satisfies HandleInfo
        this.handleMeshes.push(mesh)
        this.handles.add(mesh)
      }
    }
    this.raycaster.params.Line.threshold = 0
  }

  get isDragging(): boolean {
    return this.drag !== null
  }

  get selected(): PlacedElement | undefined {
    return this.store.getElement(this.selectedId)
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

  /** `null` beendet den Pinsel-Modus. */
  setPaintColor(color: string | null): void {
    this.paintColor = color
    this.onPaintModeChange?.(color)
  }

  /**
   * Färbt das getroffene Objekt ein – Element, Wand oder Boden.
   * @returns true, wenn etwas eingefärbt wurde.
   */
  private paint(ray: Ray): boolean {
    const color = this.paintColor
    if (!color) return false
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

  /** Griffe einzelner Achsen ausblenden (z. B. Y in der 2D-Draufsicht). */
  setHiddenAxes(axes: Axis[]): void {
    this.hiddenAxes = new Set(axes)
    this.updateHandles()
  }

  private get activeHandles(): Mesh[] {
    return this.handleMeshes.filter((h) => !this.hiddenAxes.has((h.userData.handle as HandleInfo).axis))
  }

  setHandleRadius(radius: number): void {
    this.handleRadius = radius
    for (const h of this.handleMeshes) h.scale.setScalar(radius)
  }

  /** Nach jeder Zustandsänderung aufrufen (Positionen der Griffe aktualisieren). */
  updateHandles(): void {
    const mesh = this.layer.getMesh(this.selectedId)
    if (!mesh || !this.editMode) {
      if (this.selectedId && !mesh) this.select(null)
      this.handles.visible = false
      return
    }
    mesh.updateWorldMatrix(true, false)
    this.handles.visible = true
    for (const h of this.handleMeshes) {
      const info = h.userData.handle as HandleInfo
      h.visible = !this.hiddenAxes.has(info.axis)
      const local = new Vector3(0, 0.5, 0)
      local[info.axis] = info.axis === 'y' ? (info.sign > 0 ? 1 : 0) : info.sign * 0.5
      h.position.copy(mesh.localToWorld(local))
      h.scale.setScalar(this.handleRadius)
    }
  }

  /** @returns true, wenn der Strahl einen Griff oder ein Element getroffen hat (Drag gestartet). */
  pointerDown(ray: Ray): boolean {
    if (this.paintColor) return this.paint(ray)
    this.raycaster.ray.copy(ray)
    const mesh = this.layer.getMesh(this.selectedId)

    if (this.editMode && mesh && this.handles.visible) {
      const hit = this.raycaster.intersectObjects(this.activeHandles, false)[0]
      if (hit && this.startHandleDrag(hit.object as Mesh, mesh)) return true
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
    if (this.drag.kind === 'handle') this.moveHandle(ray, this.drag, el)
    else this.moveElement(ray, this.drag, el)
  }

  pointerUp(): void {
    this.drag = null
  }

  /** Aktualisiert die Hervorhebung und liefert, was unter dem Strahl liegt. */
  hover(ray: Ray | null): HoverKind {
    let next: Mesh | null = null
    let kind: HoverKind = null
    if (ray && this.paintColor) {
      this.raycaster.ray.copy(ray)
      const hit =
        this.raycaster.intersectObjects(this.layer.pickables, false).length > 0 ||
        this.raycaster.intersectObjects(this.roomView.paintables, false).length > 0
      if (this.hovered) {
        this.applyHandleColor(this.hovered, false)
        this.hovered = null
      }
      return hit ? 'paint' : null
    }
    if (ray) {
      this.raycaster.ray.copy(ray)
      if (this.handles.visible) {
        const hit = this.raycaster.intersectObjects(this.activeHandles, false)[0]
        if (hit) {
          next = hit.object as Mesh
          kind = 'handle'
        }
      }
      if (!next && this.raycaster.intersectObjects(this.layer.pickables, false).length > 0) kind = 'element'
    }
    if (next !== this.hovered) {
      if (this.hovered) this.applyHandleColor(this.hovered, false)
      if (next) this.applyHandleColor(next, true)
      this.hovered = next
    }
    return kind
  }

  /** Verschiebt das ausgewählte Element in Weltkoordinaten (z. B. per XR-Menü). */
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

  private applyHandleColor(handle: Mesh, hovered: boolean): void {
    const info = handle.userData.handle as HandleInfo
    const mat = handle.material as MeshBasicMaterial
    mat.color.copy(hovered ? HOVER_COLOR : new Color(AXIS_COLORS[info.axis]))
  }

  /** @returns false, wenn der Griff aus dieser Blickrichtung nicht ziehbar ist. */
  private startHandleDrag(handle: Mesh, mesh: Mesh): boolean {
    const el = this.selected
    if (!el) return false
    const info = handle.userData.handle as HandleInfo
    const q = mesh.getWorldQuaternion(new Quaternion())
    const axisDir = new Vector3(0, 0, 0)
    axisDir[info.axis] = 1
    axisDir.applyQuaternion(q).normalize()
    const lineOrigin = handle.getWorldPosition(new Vector3())
    const t0 = closestParamOnLine(lineOrigin, axisDir, this.raycaster.ray)
    if (t0 === null) return false
    this.drag = {
      kind: 'handle',
      handle,
      info,
      axisDir,
      lineOrigin,
      t0,
      size0: { ...el.size },
      pos0: { ...el.position },
    }
    this.applyHandleColor(handle, true)
    return true
  }

  private moveHandle(ray: Ray, drag: HandleDrag, el: PlacedElement): void {
    const t = closestParamOnLine(drag.lineOrigin, drag.axisDir, ray)
    if (t === null) return
    const { axis, sign } = drag.info
    const sizeKey = axis === 'x' ? 'w' : axis === 'y' ? 'h' : 'd'
    let delta = snap(t - drag.t0)
    let newSize = drag.size0[sizeKey] + sign * delta
    if (newSize < MIN_ELEMENT_SIZE) {
      newSize = MIN_ELEMENT_SIZE
      delta = sign * (MIN_ELEMENT_SIZE - drag.size0[sizeKey])
    }
    const size = { ...drag.size0, [sizeKey]: newSize }
    const position = { ...drag.pos0 }
    if (axis === 'y') {
      if (sign < 0) position.y = drag.pos0.y + delta
    } else {
      // Mittelpunkt wandert um die halbe Änderung in Richtung der gezogenen Fläche.
      position.x = drag.pos0.x + drag.axisDir.x * (delta / 2)
      position.z = drag.pos0.z + drag.axisDir.z * (delta / 2)
    }
    this.store.updateElement(el.id, { size, position })
  }

  private moveElement(ray: Ray, drag: MoveDrag, el: PlacedElement): void {
    const hit = new Vector3()
    if (!ray.intersectPlane(drag.plane, hit)) return
    // Die Raumgruppe ist nur verschoben, nicht rotiert – Welt-Deltas gelten auch lokal.
    const dx = hit.x - drag.startHit.x
    const dz = hit.z - drag.startHit.z
    this.store.updateElement(el.id, {
      position: { x: drag.pos0.x + dx, y: drag.pos0.y, z: drag.pos0.z + dz },
    })
  }
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
