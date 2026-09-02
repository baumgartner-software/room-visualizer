import type { OpeningSpec, PlacedElement, ProjectState, RoomSpec, Vec2, WallSpec } from './types'

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
 *   Nordwand 681 (76,5 Wand · 209 Fenster · 91 Wand · 209 Fenster · 95 Wand)
 *   Ostwand  682 (Fenster 108, 89 vor der Südecke)
 *   Küche    409 (Westwand) · 244 (Südwand)
 *   Flur     152 breit · 273 lang, nach Süden offen (führt weiter zum Büro)
 *   Südwand des Wohnbereichs 285 · Wandscheibe am Flur 43,5 diagonal
 * Angenommen (nicht bemaßt): Raumhöhe 250, Wandstärken, Fenster­brüstung 95.
 */
const cm = (v: number): number => v / 100
const p = (x: number, z: number): Vec2 => ({ x: cm(x), z: cm(z) })

const ROOM_HEIGHT = 250
const EXTERIOR_WALL = 24
const INTERIOR_WALL = 12
/** Brüstungshöhe: knapp über der Arbeitsplatte (91), damit beides zusammenpasst. */
const SILL = 95
const WINDOW_TOP = 220

const window = (start: number, width: number): OpeningSpec => ({
  start: cm(start),
  width: cm(width),
  sill: cm(SILL),
  top: cm(WINDOW_TOP),
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
    openings: [window(76.5, 209), window(376.5, 209)],
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
}

/**
 * Küche nach dem Referenzbild: L aus Westzeile und Nordzeile unter dem Fenster,
 * Hochschrankblock an der Flurwand und eine freistehende Kochinsel.
 */
const KITCHEN: Item[] = [
  // --- Westzeile: Unterschränke ---
  ...[30, 90, 150, 210].map((z, i) => ({
    defId: i === 1 ? 'drawer-60' : 'base-60',
    name: i === 1 ? 'Schubladenschrank 60' : 'Unterschrank 60',
    at: [30, 0, z] as [number, number, number],
    size: [BASE_D, BASE_H, 60] as [number, number, number],
    color: KITCHEN_COLORS.front,
  })),
  {
    defId: 'base-60',
    name: 'Unterschrank 49 (Passstück)',
    at: [30, 0, 264.5],
    size: [BASE_D, BASE_H, 49],
    color: KITCHEN_COLORS.front,
  },
  {
    defId: 'worktop',
    name: 'Arbeitsplatte West',
    at: [WORKTOP_D / 2, BASE_H, 144.5],
    size: [WORKTOP_D, WORKTOP_T, 289],
    color: KITCHEN_COLORS.oak,
  },
  {
    defId: 'splashback',
    name: 'Rückwand West',
    at: [1, BASE_H + WORKTOP_T, 144.5],
    size: [2, WALL_UNIT_Y - BASE_H - WORKTOP_T, 289],
    color: KITCHEN_COLORS.splashback,
  },
  // --- Westzeile: Hängeschränke (über der Spüle bleibt es offen) ---
  ...[
    { z: 30, w: 60 },
    { z: 90, w: 60 },
    { z: 210, w: 60 },
    { z: 264.5, w: 49 },
  ].map(({ z, w }) => ({
    defId: 'wall-60',
    name: `Hängeschrank ${w}`,
    at: [WALL_UNIT_D / 2, WALL_UNIT_Y, z] as [number, number, number],
    size: [WALL_UNIT_D, WALL_UNIT_H, w] as [number, number, number],
    color: KITCHEN_COLORS.front,
  })),
  // --- Hochschrankblock an der Flurwand ---
  {
    defId: 'oven-60',
    name: 'Herdumbauschrank 60',
    at: [TALL_D / 2, 0, 319],
    size: [TALL_D, TALL_H, 60],
    color: KITCHEN_COLORS.front,
  },
  {
    defId: 'fridge-60',
    name: 'Kühlschrank 60',
    at: [TALL_D / 2, 0, 379],
    size: [TALL_D, TALL_H, 60],
    color: KITCHEN_COLORS.front,
  },
  ...[319, 379].map((z) => ({
    defId: 'top-60',
    name: 'Aufsatzschrank 60',
    at: [TALL_D / 2, TALL_H, z] as [number, number, number],
    size: [TALL_D, TOP_UNIT_H, 60] as [number, number, number],
    color: KITCHEN_COLORS.front,
  })),
  {
    defId: 'oven',
    name: 'Backofen',
    at: [TALL_D, 85, 319],
    size: [4, 60, 56],
    color: KITCHEN_COLORS.black,
  },
  // --- Nordzeile unter dem Fenster, mit Spüle ---
  ...[92, 152, 212].map((x, i) => ({
    defId: i === 1 ? 'sink-60' : 'base-60',
    name: i === 1 ? 'Spülenschrank 60' : 'Unterschrank 60',
    at: [x, 0, 30] as [number, number, number],
    size: [60, BASE_H, BASE_D] as [number, number, number],
    color: KITCHEN_COLORS.front,
  })),
  {
    defId: 'worktop',
    name: 'Arbeitsplatte Nord',
    at: [152, BASE_H, WORKTOP_D / 2],
    size: [180, WORKTOP_T, WORKTOP_D],
    color: KITCHEN_COLORS.oak,
  },
  {
    defId: 'sink-basin',
    name: 'Spülbecken',
    at: [152, BASE_H + 0.5, 30],
    size: [50, WORKTOP_T, 40],
    color: KITCHEN_COLORS.sink,
  },
  // --- Kochinsel ---
  {
    defId: 'island',
    name: 'Kochinsel',
    at: [225, 0, 260],
    size: [90, BASE_H, 180],
    color: KITCHEN_COLORS.front,
  },
  {
    defId: 'island-top',
    name: 'Inselplatte',
    at: [225, BASE_H, 260],
    size: [100, WORKTOP_T, 190],
    color: KITCHEN_COLORS.oak,
  },
  {
    defId: 'hob',
    name: 'Kochfeld',
    at: [225, BASE_H + 2, 240],
    size: [52, WORKTOP_T, 80],
    color: KITCHEN_COLORS.black,
  },
  {
    defId: 'hood',
    name: 'Dunstabzugshaube',
    at: [225, 155, 240],
    size: [50, 35, 100],
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
