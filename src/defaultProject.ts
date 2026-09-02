import type { FrontDir, OpeningSpec, PlacedElement, ProjectState, RoomSpec, Vec2, WallSpec } from './types'

/**
 * Grundriss und Küchen-Einrichtung als Startzustand der Anwendung.
 *
 * Der Grundriss ist die Handskizze (HAKA-Bauplan) aus dem Repository: ein
 * L-förmiger Wohnbereich (Küche / Esszimmer / Wohnen) mit abgetrenntem Flur.
 * Alle Maße hier in **Zentimetern**, `cm()` rechnet in Meter um.
 *
 * Ursprung (0/0) ist die nordwestliche Innenecke; x zeigt nach Osten,
 * z nach Süden.
 *
 * Aus der Skizze übernommen:
 *   Nordwand 681 (76,5 Wand · 209 Glastür · 91 Wand · 209 Glastür · 95 Wand)
 *   Ostwand  682 (Fenster 108, 89 vor der Südecke)
 *   Küche    409 (Westwand) · 244 (Südwand)
 *   Flur     152 breit · 273 lang, nach Süden offen (führt weiter zum Büro)
 *   Südwand des Wohnbereichs 285 · Wandscheibe am Flur 43,5 diagonal
 * Angenommen (nicht bemaßt): Raumhöhe 250, Wandstärken, Fenster­brüstung 95,
 * Oberkante der Terrassentüren 220.
 */
const cm = (v: number): number => v / 100
const p = (x: number, z: number): Vec2 => ({ x: cm(x), z: cm(z) })

const ROOM_HEIGHT = 250
const EXTERIOR_WALL = 24
const INTERIOR_WALL = 12
/** Brüstungshöhe des Fensters in der Ostwand. */
const SILL = 95
const WINDOW_TOP = 220
/** Oberkante der bodentiefen Terrassentüren. */
const DOOR_TOP = 220

const window = (start: number, width: number): OpeningSpec => ({
  start: cm(start),
  width: cm(width),
  sill: cm(SILL),
  top: cm(WINDOW_TOP),
  kind: 'window',
})

/** Bodentiefe Glastür zur Terrasse. */
const terraceDoor = (start: number, width: number): OpeningSpec => ({
  start: cm(start),
  width: cm(width),
  sill: 0,
  top: cm(DOOR_TOP),
  kind: 'door',
})

/** Nordostecke des Flurs, an der die 43,5 cm lange Wandscheibe schräg ausläuft. */
const CHAMFER = 43.5 / Math.SQRT2

const OUTLINE: Vec2[] = [
  p(0, 0), // Nordwest (Küche)
  p(681, 0), // Nordost
  p(681, 682), // Südost (Wohnen)
  p(244, 682), // Südwest, Flur-Ende
  p(244, 409), // Innenecke Küche/Flur
  p(0, 409), // Küche Südwest
]

const WALLS: WallSpec[] = [
  {
    a: p(0, 0),
    b: p(681, 0),
    thickness: cm(EXTERIOR_WALL),
    exterior: true,
    // Die beiden 209er Öffnungen sind Glastüren zur Terrasse, keine Fenster.
    openings: [terraceDoor(76.5, 209), terraceDoor(376.5, 209)],
  },
  {
    a: p(681, 0),
    b: p(681, 682),
    thickness: cm(EXTERIOR_WALL),
    exterior: true,
    openings: [window(682 - 89 - 108, 108)],
  },
  // Südwand des Wohnbereichs (285); der Flur daneben bleibt nach Süden offen.
  { a: p(681, 682), b: p(396, 682), thickness: cm(EXTERIOR_WALL), exterior: true },
  { a: p(244, 682), b: p(244, 409), thickness: cm(EXTERIOR_WALL), exterior: true },
  { a: p(244, 409), b: p(0, 409), thickness: cm(EXTERIOR_WALL), exterior: true },
  { a: p(0, 409), b: p(0, 0), thickness: cm(EXTERIOR_WALL), exterior: true },
  // Innenwand Flur / Wohnen mit schräg auslaufender Wandscheibe.
  { a: p(396, 682), b: p(396, 409), thickness: cm(INTERIOR_WALL) },
  { a: p(396, 409), b: p(396 - CHAMFER, 409 - CHAMFER), thickness: cm(INTERIOR_WALL) },
]

export const DEFAULT_ROOM: RoomSpec = {
  name: 'Wohnbereich (Grundriss)',
  height: cm(ROOM_HEIGHT),
  outline: OUTLINE,
  walls: WALLS,
  wallColor: '#efeae2',
  floorColor: '#d8bd99',
}

// --- Farben der Küche (nach dem Referenz-Rendering) --------------------------
export const KITCHEN_COLORS = {
  front: '#f2efe8',
  oak: '#c9a063',
  black: '#1e1f22',
  sink: '#33363b',
  splashback: '#ded7cc',
}

// --- Standardmaße der Küche --------------------------------------------------
const BASE_H = 87
const WORKTOP_T = 4
const BASE_D = 60
const WORKTOP_D = 62
const WALL_UNIT_D = 35
const WALL_UNIT_H = 72
const WALL_UNIT_Y = 145
const TALL_H = 200
const TALL_D = 65
const TOP_UNIT_H = 40

interface Item {
  defId: string
  name: string
  /** Mittelpunkt der Unterkante in cm. */
  at: [number, number, number]
  /** Größe in cm: Breite (x), Höhe (y), Tiefe (z). */
  size: [number, number, number]
  color: string
  /** Richtung, in die die Front zeigt. */
  front?: FrontDir
}

/**
 * Küche nach dem Plan:
 *
 *   X x x x x x x     X/x  Unterschrank + Arbeitsplatte + Hängeschrank darüber
 *   H 0 0 0 0 0       H/h  Hochschrank
 *   H 0 0 K K 0       K    Kochinsel
 *   h 0 0 K K 0       0    frei
 *   0 0 0 0 0 0
 *
 * Die durchgehende Zeile liegt an der **Westwand** – das ist die einzige Wand
 * der Küche ohne Fenster und damit die einzige, an die Hängeschränke passen.
 * Der Hochschrankblock steht quer dazu an der **Südwand** (Wand zum Flur); an
 * der Nordwand wäre er nicht möglich, dort sitzt das 209 cm breite Fenster.
 * Die Insel steht frei im Raum, mit rund 105 cm Gang zur Zeile und zum Block.
 */
const KITCHEN: Item[] = [
  // --- Westzeile: sieben Unterschränke (6 × 60 + 49 Passstück = 409) ---
  ...[
    { z: 30, w: 60, id: 'base-60', name: 'Unterschrank 60' },
    { z: 90, w: 60, id: 'drawer-60', name: 'Schubladenschrank 60' },
    { z: 150, w: 60, id: 'base-60', name: 'Unterschrank 60' },
    { z: 210, w: 60, id: 'sink-60', name: 'Spülenschrank 60' },
    { z: 270, w: 60, id: 'drawer-60', name: 'Schubladenschrank 60' },
    { z: 330, w: 60, id: 'base-60', name: 'Unterschrank 60' },
    { z: 384.5, w: 49, id: 'base-60', name: 'Unterschrank 49 (Passstück)' },
  ].map(({ z, w, id, name }) => ({
    defId: id,
    name,
    at: [BASE_D / 2, 0, z] as [number, number, number],
    size: [BASE_D, BASE_H, w] as [number, number, number],
    color: KITCHEN_COLORS.front,
    front: 'px' as FrontDir,
  })),
  {
    defId: 'worktop',
    name: 'Arbeitsplatte West',
    at: [WORKTOP_D / 2, BASE_H, 204.5],
    size: [WORKTOP_D, WORKTOP_T, 409],
    color: KITCHEN_COLORS.oak,
  },
  {
    defId: 'splashback',
    name: 'Rückwand West',
    at: [1, BASE_H + WORKTOP_T, 204.5],
    size: [2, WALL_UNIT_Y - BASE_H - WORKTOP_T, 409],
    color: KITCHEN_COLORS.splashback,
  },
  {
    defId: 'sink-basin',
    name: 'Spülbecken',
    at: [28, BASE_H + 0.5, 210],
    size: [40, WORKTOP_T, 50],
    color: KITCHEN_COLORS.sink,
  },
  {
    defId: 'faucet',
    name: 'Wasserhahn',
    at: [14, BASE_H + WORKTOP_T, 210],
    size: [22, 32, 6],
    color: KITCHEN_COLORS.black,
  },
  // --- Über jedem Unterschrank ein Hängeschrank ---
  ...[
    { z: 30, w: 60 },
    { z: 90, w: 60 },
    { z: 150, w: 60 },
    { z: 210, w: 60 },
    { z: 270, w: 60 },
    { z: 330, w: 60 },
    { z: 384.5, w: 49 },
  ].map(({ z, w }) => ({
    defId: 'wall-60',
    name: `Hängeschrank ${w}`,
    at: [WALL_UNIT_D / 2, WALL_UNIT_Y, z] as [number, number, number],
    size: [WALL_UNIT_D, WALL_UNIT_H, w] as [number, number, number],
    color: KITCHEN_COLORS.front,
    front: 'px' as FrontDir,
  })),
  // --- Hochschrankblock quer dazu an der Südwand ---
  ...[
    { x: 90, id: 'tall-60', name: 'Hochschrank 60' },
    { x: 150, id: 'oven-60', name: 'Herdumbauschrank 60' },
    { x: 210, id: 'fridge-60', name: 'Kühlschrank 60' },
  ].map(({ x, id, name }) => ({
    defId: id,
    name,
    at: [x, 0, 409 - TALL_D / 2] as [number, number, number],
    size: [60, TALL_H, TALL_D] as [number, number, number],
    color: KITCHEN_COLORS.front,
    front: 'nz' as FrontDir,
  })),
  ...[90, 150, 210].map((x) => ({
    defId: 'top-60',
    name: 'Aufsatzschrank 60',
    at: [x, TALL_H, 409 - TALL_D / 2] as [number, number, number],
    size: [60, TOP_UNIT_H, TALL_D] as [number, number, number],
    color: KITCHEN_COLORS.front,
    front: 'nz' as FrontDir,
  })),
  {
    // Backofen sitzt im mittleren Hochschrank.
    defId: 'oven',
    name: 'Backofen',
    at: [150, 85, 409 - TALL_D],
    size: [56, 60, 4],
    color: KITCHEN_COLORS.black,
  },
  // --- Kochinsel (2 × 2 Rasterfelder) ---
  {
    defId: 'island',
    name: 'Kochinsel',
    at: [230, 0, 170],
    size: [120, BASE_H, 120],
    color: KITCHEN_COLORS.front,
    front: 'px' as FrontDir,
  },
  {
    defId: 'island-top',
    name: 'Inselplatte',
    at: [230, BASE_H, 170],
    size: [130, WORKTOP_T, 130],
    color: KITCHEN_COLORS.oak,
  },
  {
    defId: 'hob',
    name: 'Kochfeld',
    at: [230, BASE_H + 2, 170],
    size: [52, WORKTOP_T, 80],
    color: KITCHEN_COLORS.black,
  },
  {
    defId: 'hood',
    name: 'Dunstabzugshaube',
    at: [230, 155, 170],
    size: [60, 35, 100],
    color: KITCHEN_COLORS.black,
  },
]

let counter = 0
function toElement(item: Item): PlacedElement {
  counter += 1
  return {
    id: `default-${counter}`,
    defId: item.defId,
    name: item.name,
    position: { x: cm(item.at[0]), y: cm(item.at[1]), z: cm(item.at[2]) },
    size: { w: cm(item.size[0]), h: cm(item.size[1]), d: cm(item.size[2]) },
    rotationY: 0,
    color: item.color,
    front: item.front,
  }
}

export function defaultProject(): ProjectState {
  counter = 0
  return {
    version: 2,
    room: structuredClone(DEFAULT_ROOM),
    elements: KITCHEN.map(toElement),
  }
}
