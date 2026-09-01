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

/** Raumdefinition: Breite (x), Tiefe/Länge (z), Höhe (y). */
export interface RoomSpec {
  width: number
  depth: number
  height: number
}

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
}

/**
 * Ein im Raum platziertes Element.
 * `position` ist der Mittelpunkt der Unterkante (x/z = Mitte, y = Unterkante)
 * in Raumkoordinaten (Ursprung = linke vordere Bodenecke).
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
}

export interface ProjectState {
  version: 1
  room: RoomSpec
  elements: PlacedElement[]
}

export type Axis = 'x' | 'y' | 'z'
