import type { Bounds, RoomSpec, Vec2, WallSpec } from './types'

export function bounds(room: RoomSpec): Bounds {
  const xs = room.outline.map((p) => p.x)
  const zs = room.outline.map((p) => p.z)
  const minX = Math.min(...xs)
  const maxX = Math.max(...xs)
  const minZ = Math.min(...zs)
  const maxZ = Math.max(...zs)
  return {
    minX,
    maxX,
    minZ,
    maxZ,
    width: maxX - minX,
    depth: maxZ - minZ,
    centerX: (minX + maxX) / 2,
    centerZ: (minZ + maxZ) / 2,
  }
}

/** Flächenschwerpunkt des Grundrisses (für die Richtung „nach außen“). */
export function centroid(outline: Vec2[]): Vec2 {
  let area = 0
  let cx = 0
  let cz = 0
  for (let i = 0; i < outline.length; i++) {
    const p = outline[i]
    const q = outline[(i + 1) % outline.length]
    const cross = p.x * q.z - q.x * p.z
    area += cross
    cx += (p.x + q.x) * cross
    cz += (p.z + q.z) * cross
  }
  area /= 2
  if (Math.abs(area) < 1e-9) {
    const b = bounds({ outline } as RoomSpec)
    return { x: b.centerX, z: b.centerZ }
  }
  return { x: cx / (6 * area), z: cz / (6 * area) }
}

/** Einheitsnormale einer Wand, die vom Rauminneren weg zeigt. */
export function outwardNormal(wall: WallSpec, center: Vec2): Vec2 {
  const dx = wall.b.x - wall.a.x
  const dz = wall.b.z - wall.a.z
  const len = Math.hypot(dx, dz) || 1
  // Senkrechte zur Wandrichtung in der xz-Ebene.
  const n = { x: -dz / len, z: dx / len }
  const mx = (wall.a.x + wall.b.x) / 2 - center.x
  const mz = (wall.a.z + wall.b.z) / 2 - center.z
  return n.x * mx + n.z * mz >= 0 ? n : { x: -n.x, z: -n.z }
}

export function pointInPolygon(p: Vec2, outline: Vec2[]): boolean {
  let inside = false
  for (let i = 0, j = outline.length - 1; i < outline.length; j = i++) {
    const a = outline[i]
    const b = outline[j]
    if (a.z > p.z !== b.z > p.z && p.x < ((b.x - a.x) * (p.z - a.z)) / (b.z - a.z) + a.x) {
      inside = !inside
    }
  }
  return inside
}

/** Rechteckiger Raum als Grundriss-Polygon (Fallback / einfacher Modus). */
export function rectangularRoom(width: number, depth: number, height: number, template: RoomSpec): RoomSpec {
  const outline: Vec2[] = [
    { x: 0, z: 0 },
    { x: width, z: 0 },
    { x: width, z: depth },
    { x: 0, z: depth },
  ]
  const walls: WallSpec[] = outline.map((a, i) => ({
    a,
    b: outline[(i + 1) % outline.length],
    thickness: 0.24,
    exterior: true,
  }))
  return { ...template, name: `Rechteck ${Math.round(width * 100)}×${Math.round(depth * 100)} cm`, height, outline, walls }
}
