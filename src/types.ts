/** Alle Maße in Metern. */
export interface Size {
  w: number
  h: number
  d: number
}

export interface Vec3 {
  x: number
  y: number
  z: number
}

/** Punkt im Grundriss: x nach Osten, z nach Süden. */
export interface Vec2 {
  x: number
  z: number
}

/** Fenster- oder Türöffnung entlang einer Wand. */
export interface OpeningSpec {
  /** Abstand vom Startpunkt (a) der Wand. */
  start: number
  width: number
  /** Unterkante über dem Boden (0 = bodentief). */
  sill: number
  /** Oberkante über dem Boden. */
  top: number
  /**
   * 'window' und 'door' bekommen Rahmen und Glasscheibe, 'passage' bleibt eine
   * leere Öffnung (z. B. der Durchgang zum Flur).
   */
  kind?: 'window' | 'door' | 'passage'
}

export interface WallSpec {
  a: Vec2
  b: Vec2
  thickness: number
  openings?: OpeningSpec[]
  /**
   * Außenwände liegen mit ihrer Innenkante auf dem Grundriss-Polygon und werden
   * ausgeblendet, wenn sie zwischen Kamera und Raum stehen (Puppenhaus-Ansicht).
   */
  exterior?: boolean
}

/**
 * Raum als Grundriss-Polygon statt einfacher Box – damit lassen sich auch
 * L-Formen und einzelne Innenwände abbilden.
 */
export interface RoomSpec {
  name: string
  height: number
  /** Innenkante des Grundrisses im Uhrzeigersinn (x nach Osten, z nach Süden). */
  outline: Vec2[]
  walls: WallSpec[]
  wallColor: string
  floorColor: string
}

/**
 * Richtung, in die die Front eines Möbels zeigt – als lokale Achse, dreht sich
 * also mit `rotationY` mit.
 */
export type FrontDir = 'px' | 'nx' | 'pz' | 'nz'

/** Ein Element aus dem Katalog (Vorlage). */
export interface ElementDef {
  id: string
  name: string
  category: string
  size: Size
  /** Standardhöhe der Unterkante über dem Boden. */
  elevation: number
  color: string
  description?: string
  /** Sonderform statt Quader. */
  shape?: 'box' | 'faucet'
  /** Blickrichtung der Front; ohne Angabe bleibt das Möbel ein glatter Quader. */
  front?: FrontDir
  /** Aufteilung der Front in Türen/Schubladen: [Spalten, Reihen]. */
  frontPanels?: [number, number]
  /** Griffform der Front. */
  handle?: 'vertical' | 'horizontal' | 'none'
}

/**
 * Ein im Raum platziertes Element.
 * `position` ist der Mittelpunkt der Unterkante (x/z = Mitte, y = Unterkante).
 */
export interface PlacedElement {
  id: string
  defId: string
  name: string
  position: Vec3
  size: Size
  /** Drehung um die Hochachse in Radiant (Vielfache von 90°). */
  rotationY: number
  color: string
  /** Richtung der Front (lokale Achse); ohne Angabe glatter Quader. */
  front?: FrontDir
}

export interface ProjectState {
  version: 2
  room: RoomSpec
  elements: PlacedElement[]
}

export interface Bounds {
  minX: number
  maxX: number
  minZ: number
  maxZ: number
  width: number
  depth: number
  centerX: number
  centerZ: number
}

export type Axis = 'x' | 'y' | 'z'
