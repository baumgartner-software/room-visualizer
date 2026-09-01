import type { ElementDef, PlacedElement, ProjectState, RoomSpec, Vec3 } from './types'

const STORAGE_KEY = 'room-visualizer:project:v1'

export const DEFAULT_ROOM: RoomSpec = { width: 4, depth: 3, height: 2.5 }
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

/** Grundfläche (w/d in Raumachsen) unter Berücksichtigung der 90°-Drehung. */
export function footprint(el: PlacedElement): { w: number; d: number } {
  const quarterTurns = Math.round(el.rotationY / (Math.PI / 2))
  const swapped = Math.abs(quarterTurns) % 2 === 1
  return swapped ? { w: el.size.d, d: el.size.w } : { w: el.size.w, d: el.size.d }
}

/** Hält das Element innerhalb des Raumes (Größe wird nicht verändert). */
export function clampToRoom(el: PlacedElement, room: RoomSpec): Vec3 {
  const fp = footprint(el)
  const hw = fp.w / 2
  const hd = fp.d / 2
  return {
    x: fp.w >= room.width ? room.width / 2 : clamp(el.position.x, hw, room.width - hw),
    y: el.size.h >= room.height ? 0 : clamp(el.position.y, 0, room.height - el.size.h),
    z: fp.d >= room.depth ? room.depth / 2 : clamp(el.position.z, hd, room.depth - hd),
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

  constructor() {
    this.state = load() ?? emptyProject()
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

  setRoom(patch: Partial<RoomSpec>): void {
    const room: RoomSpec = {
      width: clamp(snap(patch.width ?? this.state.room.width), MIN_ROOM, MAX_ROOM),
      depth: clamp(snap(patch.depth ?? this.state.room.depth), MIN_ROOM, MAX_ROOM),
      height: clamp(snap(patch.height ?? this.state.room.height), MIN_ROOM, MAX_ROOM),
    }
    this.state.room = room
    for (const el of this.state.elements) el.position = clampToRoom(el, room)
    this.emit()
  }

  getElement(id: string | null | undefined): PlacedElement | undefined {
    if (!id) return undefined
    return this.state.elements.find((e) => e.id === id)
  }

  addFromDef(def: ElementDef, position?: Partial<Vec3>): PlacedElement {
    const el: PlacedElement = {
      id: newId(def.id),
      defId: def.id,
      name: def.name,
      size: { ...def.size },
      position: {
        x: position?.x ?? this.state.room.width / 2,
        y: position?.y ?? def.elevation,
        z: position?.z ?? this.state.room.depth / 2,
      },
      rotationY: 0,
      color: def.color,
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
    if (patch.name !== undefined) el.name = patch.name
    if (patch.color !== undefined) el.color = patch.color
    el.position = clampToRoom(el, this.state.room)
    this.emit()
  }

  rotateElement(id: string): void {
    const el = this.getElement(id)
    if (!el) return
    const turns = Math.round(el.rotationY / (Math.PI / 2))
    this.updateElement(id, { rotationY: ((turns + 1) % 4) * (Math.PI / 2) })
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

  reset(): void {
    this.state = emptyProject()
    this.emit()
  }

  toJSON(): string {
    return JSON.stringify(this.state, null, 2)
  }
}

function emptyProject(): ProjectState {
  return { version: 1, room: { ...DEFAULT_ROOM }, elements: [] }
}

function normalize(raw: unknown): ProjectState {
  const obj = (raw ?? {}) as Partial<ProjectState>
  const room = { ...DEFAULT_ROOM, ...(obj.room ?? {}) }
  const elements = Array.isArray(obj.elements) ? obj.elements : []
  return {
    version: 1,
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
        color: e.color ?? '#9ecae1',
      })),
  }
}

function load(): ProjectState | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    return normalize(JSON.parse(raw))
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
