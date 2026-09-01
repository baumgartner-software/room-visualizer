import type { ElementDef } from './types'

/** Standardhöhe der Arbeitsfläche (Unterschrank inkl. Sockel). */
export const WORKTOP_HEIGHT = 0.87
export const WORKTOP_THICKNESS = 0.04

/**
 * Küchen-Katalog. Alle Breiten im 60er-Raster, Tiefen nach üblichen
 * Küchennormen (Unterschrank 60 cm, Hängeschrank 35 cm).
 */
export const CATALOG: ElementDef[] = [
  {
    id: 'base-60',
    name: 'Unterschrank 60',
    category: 'Küche',
    size: { w: 0.6, h: WORKTOP_HEIGHT, d: 0.6 },
    elevation: 0,
    color: '#f4f4f1',
    description: '60 cm breit, Sockel inklusive',
  },
  {
    id: 'drawer-60',
    name: 'Schubladenschrank 60',
    category: 'Küche',
    size: { w: 0.6, h: WORKTOP_HEIGHT, d: 0.6 },
    elevation: 0,
    color: '#ebebe6',
  },
  {
    id: 'sink-60',
    name: 'Spülenschrank 60',
    category: 'Küche',
    size: { w: 0.6, h: WORKTOP_HEIGHT, d: 0.6 },
    elevation: 0,
    color: '#dfe7ee',
  },
  {
    id: 'oven-60',
    name: 'Herdumbauschrank 60',
    category: 'Küche',
    size: { w: 0.6, h: WORKTOP_HEIGHT, d: 0.6 },
    elevation: 0,
    color: '#c9c9c9',
  },
  {
    id: 'wall-60',
    name: 'Hängeschrank 60',
    category: 'Küche',
    size: { w: 0.6, h: 0.72, d: 0.35 },
    elevation: 1.45,
    color: '#f4f4f1',
  },
  {
    id: 'tall-60',
    name: 'Hochschrank 60',
    category: 'Küche',
    size: { w: 0.6, h: 2.0, d: 0.6 },
    elevation: 0,
    color: '#eeeee9',
  },
  {
    id: 'fridge-60',
    name: 'Kühlschrank 60',
    category: 'Küche',
    size: { w: 0.6, h: 1.8, d: 0.65 },
    elevation: 0,
    color: '#cfd7dd',
  },
  {
    id: 'worktop',
    name: 'Arbeitsplatte',
    category: 'Küche',
    size: { w: 1.8, h: WORKTOP_THICKNESS, d: 0.6 },
    elevation: WORKTOP_HEIGHT,
    color: '#8a6a4b',
    description: 'Länge frei über die Griffe ziehen',
  },
  {
    id: 'box',
    name: 'Freie Box',
    category: 'Allgemein',
    size: { w: 0.5, h: 0.5, d: 0.5 },
    elevation: 0,
    color: '#9ecae1',
  },
]

export function getDef(id: string): ElementDef | undefined {
  return CATALOG.find((d) => d.id === id)
}
