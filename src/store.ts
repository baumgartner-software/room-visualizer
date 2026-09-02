import { Euler, Matrix4 } from 'three'
import { defaultProject } from './defaultProject'
import { bounds, rectangularRoom } from './geometry'
import type { ElementDef, PlacedElement, ProjectState, RoomSpec, Vec3 } from './types'

const STORAGE_KEY = 'room-visualizer:project:v2'

export const MIN_ROOM = 1
export const MAX_ROOM = 20
export const MIN_ELEMENT_SIZE = 0.02

type Listener = (state: ProjectState) => void

export function snap(value: number, step = 0.01): number {
  return Math.round(value / step) * step
}

export function clamp(v: number, min: number, max: number): number {
  return Math.min(Math.max(v, min), max)
}

const rotationMatrix = new Matrix4()
const rotationEuler = new Euler()

interface LocalAabb {
  min: Vec3
  max: Vec3
}

/**
 * Hüllbox des gedrehten Quaders, relativ zum Ursprung des Elements (Mitte der
 * Unterkante). Weil der Ursprung unten sitzt und nicht in der Mitte, ist die
 * Box nach dem Kippen nicht symmetrisch – deshalb min und max statt bloßer
 * Ausdehnung.
 */
export function localAabb(el: PlacedElement): LocalAabb {
  rotationEuler.set(el.rotationX ?? 0, el.rotationY, el.rotationZ ?? 0)
  const m = rotationMatrix.makeRotationFromEuler(rotationEuler).elements
  const { w, h, d } = el.size
  const min = { x: Infinity, y: Infinity, z: Infinity }
  const max = { x: -Infinity, y: -Infinity, z: -Infinity }
  for (const x of [-w / 2, w / 2]) {
    for (const y of [0, h]) {
      for (const z of [-d / 2, d / 2]) {
        const px = m[0] * x + m[4] * y + m[8] * z
        const py = m[1] * x + m[5] * y + m[9] * z
        const pz = m[2] * x + m[6] * y + m[10] * z
        min.x = Math.min(min.x, px)
        min.y = Math.min(min.y, py)
        min.z = Math.min(min.z, pz)
        max.x = Math.max(max.x, px)
        max.y = Math.max(max.y, py)
        max.z = Math.max(max.z, pz)
      }
    }
  }
  return { min, max }
}

/** Ausdehnung entlang der Raumachsen. */
export function worldExtents(el: PlacedElement): { w: number; h: number; d: number } {
  const { min, max } = localAabb(el)
  return { w: max.x - min.x, h: max.y - min.y, d: max.z - min.z }
}

/** Grundfläche in Raumachsen. */
export function footprint(el: PlacedElement): { w: number; d: number } {
  const { w, d } = worldExtents(el)
  return { w, d }
}

/**
 * Hält das Element im umschließenden Rechteck des Grundrisses. Gerechnet wird
 * mit der Hüllbox, damit auch gekippte Objekte weder im Boden noch in der Decke
 * stecken. Bei L-förmigen Räumen darf ein Element außerhalb der Bodenfläche
 * liegen – das ist bewusst so, damit sich nichts „von selbst“ verschiebt.
 */
export function clampToRoom(el: PlacedElement, room: RoomSpec): Vec3 {
  const b = bounds(room)
  const { min, max } = localAabb(el)
  const fit = (value: number, lo: number, hi: number, offsetMin: number, offsetMax: number): number => {
    const low = lo - offsetMin
    const high = hi - offsetMax
    return low > high ? (low + high) / 2 : clamp(value, low, high)
  }
  return {
    x: fit(el.position.x, b.minX, b.maxX, min.x, max.x),
    y: fit(el.position.y, 0, room.height, min.y, max.y),
    z: fit(el.position.z, b.minZ, b.maxZ, min.z, max.z),
  }
}

let idCounter = 0
export function newId(prefix = 'el'): string {
  idCounter += 1
  return `${prefix}-${Date.now().toString(36)}-${idCounter.toString(36)}`
}

export class Store {
  state: ProjectState
  private listeners = new Set<Listener>()

  constructor(initial?: ProjectState) {
    this.state = initial ?? load() ?? defaultProject()
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener)
    listener(this.state)
    return () => this.listeners.delete(listener)
  }

  private emit(): void {
    save(this.state)
    for (const l of this.listeners) l(this.state)
  }

  get room(): RoomSpec {
    return this.state.room
  }

  setRoomHeight(height: number): void {
    this.state.room.height = clamp(snap(height), MIN_ROOM, MAX_ROOM)
    for (const el of this.state.elements) el.position = clampToRoom(el, this.state.room)
    this.emit()
  }

  setRoomColors(patch: { wallColor?: string; floorColor?: string }): void {
    if (patch.wallColor) this.state.room.wallColor = patch.wallColor
    if (patch.floorColor) this.state.room.floorColor = patch.floorColor
    this.emit()
  }

  /** Ersetzt den Grundriss durch ein einfaches Rechteck. */
  setRectangularRoom(width: number, depth: number): void {
    this.state.room = rectangularRoom(
      clamp(snap(width), MIN_ROOM, MAX_ROOM),
      clamp(snap(depth), MIN_ROOM, MAX_ROOM),
      this.state.room.height,
      this.state.room,
    )
    for (const el of this.state.elements) el.position = clampToRoom(el, this.state.room)
    this.emit()
  }

  setRoom(room: RoomSpec): void {
    this.state.room = room
    for (const el of this.state.elements) el.position = clampToRoom(el, room)
    this.emit()
  }

  getElement(id: string | null | undefined): PlacedElement | undefined {
    if (!id) return undefined
    return this.state.elements.find((e) => e.id === id)
  }

  addFromDef(def: ElementDef, position?: Partial<Vec3>): PlacedElement {
    const b = bounds(this.state.room)
    const el: PlacedElement = {
      id: newId(def.id),
      defId: def.id,
      name: def.name,
      size: { ...def.size },
      position: {
        x: position?.x ?? b.centerX,
        y: position?.y ?? def.elevation,
        z: position?.z ?? b.centerZ,
      },
      rotationY: 0,
      color: def.color,
      front: def.front,
    }
    el.position = clampToRoom(el, this.state.room)
    this.state.elements.push(el)
    this.emit()
    return el
  }

  updateElement(id: string, patch: Partial<Omit<PlacedElement, 'id'>>): void {
    const el = this.getElement(id)
    if (!el) return
    if (patch.size) {
      el.size = {
        w: Math.max(MIN_ELEMENT_SIZE, snap(patch.size.w)),
        h: Math.max(MIN_ELEMENT_SIZE, snap(patch.size.h)),
        d: Math.max(MIN_ELEMENT_SIZE, snap(patch.size.d)),
      }
    }
    if (patch.position) {
      el.position = { x: snap(patch.position.x), y: snap(patch.position.y), z: snap(patch.position.z) }
    }
    if (patch.rotationY !== undefined) el.rotationY = patch.rotationY
    if (patch.rotationX !== undefined) el.rotationX = patch.rotationX
    if (patch.rotationZ !== undefined) el.rotationZ = patch.rotationZ
    if (patch.mirrored !== undefined) el.mirrored = patch.mirrored
    if (patch.name !== undefined) el.name = patch.name
    if (patch.color !== undefined) el.color = patch.color
    if (patch.front !== undefined) el.front = patch.front
    el.position = clampToRoom(el, this.state.room)
    this.emit()
  }

  rotateElement(id: string): void {
    const el = this.getElement(id)
    if (!el) return
    const turns = Math.round(el.rotationY / (Math.PI / 2))
    this.updateElement(id, { rotationY: ((turns + 1) % 4) * (Math.PI / 2) })
  }

  /** Kopiert ein Element und versetzt es um seine eigene Breite. */
  duplicate(id: string): PlacedElement | undefined {
    const el = this.getElement(id)
    if (!el) return undefined
    const copy: PlacedElement = {
      ...el,
      id: newId(el.defId),
      size: { ...el.size },
      position: { ...el.position, x: el.position.x + footprint(el).w },
    }
    copy.position = clampToRoom(copy, this.state.room)
    this.state.elements.push(copy)
    this.emit()
    return copy
  }

  /** Kippt das Objekt um 90° um die Quer- (x) oder Längsachse (z). */
  tiltElement(id: string, axis: 'x' | 'z'): void {
    const el = this.getElement(id)
    if (!el) return
    const key = axis === 'x' ? 'rotationX' : 'rotationZ'
    const before = localAabb(el).min.y
    const turns = Math.round((el[key] ?? 0) / (Math.PI / 2))
    el[key] = ((turns + 1) % 4) * (Math.PI / 2)
    // Unterkante bleibt, wo sie war – sonst steckt das Objekt im Boden.
    el.position = { ...el.position, y: el.position.y + before - localAabb(el).min.y }
    el.position = clampToRoom(el, this.state.room)
    this.emit()
  }

  /** Spiegelt die Front – Griff und Anschlag wechseln die Seite. */
  mirrorElement(id: string): void {
    const el = this.getElement(id)
    if (!el) return
    el.mirrored = !el.mirrored
    this.emit()
  }

  removeElement(id: string): void {
    const idx = this.state.elements.findIndex((e) => e.id === id)
    if (idx < 0) return
    this.state.elements.splice(idx, 1)
    this.emit()
  }

  replace(state: ProjectState): void {
    this.state = normalize(state)
    this.emit()
  }

  /** Zurück auf Grundriss + Standard-Küche. */
  reset(): void {
    this.state = defaultProject()
    this.emit()
  }

  clearElements(): void {
    this.state.elements = []
    this.emit()
  }

  toJSON(): string {
    return JSON.stringify(this.state, null, 2)
  }
}

function normalize(raw: unknown): ProjectState {
  const obj = (raw ?? {}) as Partial<ProjectState>
  const fallback = defaultProject()
  const room = obj.room?.outline?.length ? { ...fallback.room, ...obj.room } : fallback.room
  const elements = Array.isArray(obj.elements) ? obj.elements : []
  return {
    version: 2,
    room,
    elements: elements
      .filter((e): e is PlacedElement => !!e && typeof e === 'object' && !!e.size && !!e.position)
      .map((e) => ({
        id: e.id ?? newId(),
        defId: e.defId ?? 'box',
        name: e.name ?? 'Element',
        size: { w: +e.size.w || 0.5, h: +e.size.h || 0.5, d: +e.size.d || 0.5 },
        position: { x: +e.position.x || 0, y: +e.position.y || 0, z: +e.position.z || 0 },
        rotationY: +e.rotationY || 0,
        rotationX: +(e.rotationX ?? 0) || 0,
        rotationZ: +(e.rotationZ ?? 0) || 0,
        color: e.color ?? '#9ecae1',
        front: e.front,
        mirrored: !!e.mirrored,
      })),
  }
}

function load(): ProjectState | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<ProjectState>
    if (parsed.version !== 2) return null
    return normalize(parsed)
  } catch {
    return null
  }
}

function save(state: ProjectState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  } catch {
    /* Speicher nicht verfügbar (z. B. privater Modus) – ignorieren */
  }
}
