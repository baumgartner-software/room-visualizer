import { KITCHEN_COLORS } from './defaultProject'
import type { ElementDef } from './types'

/** Standardhöhe der Arbeitsfläche (Unterschrank inkl. Sockel). */
export const WORKTOP_HEIGHT = 0.87
export const WORKTOP_THICKNESS = 0.04

const { front, oak, black, sink, splashback } = KITCHEN_COLORS

/**
 * Küchen-Katalog im 60er-Raster. Tiefen nach üblichen Küchenmaßen
 * (Unterschrank 60, Hängeschrank 35, Hochschrank 65).
 */
export const CATALOG: ElementDef[] = [
  {
    id: 'base-60',
    name: 'Unterschrank 60',
    category: 'Küche',
    size: { w: 0.6, h: WORKTOP_HEIGHT, d: 0.6 },
    elevation: 0,
    color: front,
    description: '60 cm breit, Sockel inklusive',
  },
  {
    id: 'drawer-60',
    name: 'Schubladenschrank 60',
    category: 'Küche',
    size: { w: 0.6, h: WORKTOP_HEIGHT, d: 0.6 },
    elevation: 0,
    color: front,
  },
  {
    id: 'sink-60',
    name: 'Spülenschrank 60',
    category: 'Küche',
    size: { w: 0.6, h: WORKTOP_HEIGHT, d: 0.6 },
    elevation: 0,
    color: front,
  },
  {
    id: 'oven-60',
    name: 'Herdumbauschrank 60',
    category: 'Küche',
    size: { w: 0.65, h: 2.0, d: 0.6 },
    elevation: 0,
    color: front,
  },
  {
    id: 'wall-60',
    name: 'Hängeschrank 60',
    category: 'Küche',
    size: { w: 0.35, h: 0.72, d: 0.6 },
    elevation: 1.45,
    color: front,
  },
  {
    id: 'top-60',
    name: 'Aufsatzschrank 60',
    category: 'Küche',
    size: { w: 0.65, h: 0.4, d: 0.6 },
    elevation: 2.0,
    color: front,
  },
  {
    id: 'tall-60',
    name: 'Hochschrank 60',
    category: 'Küche',
    size: { w: 0.65, h: 2.0, d: 0.6 },
    elevation: 0,
    color: front,
  },
  {
    id: 'fridge-60',
    name: 'Kühlschrank 60',
    category: 'Küche',
    size: { w: 0.65, h: 2.0, d: 0.6 },
    elevation: 0,
    color: front,
  },
  {
    id: 'worktop',
    name: 'Arbeitsplatte',
    category: 'Küche',
    size: { w: 0.62, h: WORKTOP_THICKNESS, d: 1.8 },
    elevation: WORKTOP_HEIGHT,
    color: oak,
    description: 'Länge frei über die Griffe ziehen',
  },
  {
    id: 'island',
    name: 'Kochinsel',
    category: 'Küche',
    size: { w: 0.9, h: WORKTOP_HEIGHT, d: 1.8 },
    elevation: 0,
    color: front,
  },
  {
    id: 'island-top',
    name: 'Inselplatte',
    category: 'Küche',
    size: { w: 1.0, h: WORKTOP_THICKNESS, d: 1.9 },
    elevation: WORKTOP_HEIGHT,
    color: oak,
  },
  {
    id: 'hob',
    name: 'Kochfeld',
    category: 'Küche',
    size: { w: 0.52, h: WORKTOP_THICKNESS, d: 0.8 },
    elevation: WORKTOP_HEIGHT + 0.02,
    color: black,
  },
  {
    id: 'sink-basin',
    name: 'Spülbecken',
    category: 'Küche',
    size: { w: 0.5, h: WORKTOP_THICKNESS, d: 0.4 },
    elevation: WORKTOP_HEIGHT + 0.005,
    color: sink,
  },
  {
    id: 'oven',
    name: 'Backofen',
    category: 'Küche',
    size: { w: 0.04, h: 0.6, d: 0.56 },
    elevation: 0.85,
    color: black,
  },
  {
    id: 'hood',
    name: 'Dunstabzugshaube',
    category: 'Küche',
    size: { w: 0.5, h: 0.35, d: 1.0 },
    elevation: 1.55,
    color: black,
  },
  {
    id: 'splashback',
    name: 'Rückwand',
    category: 'Küche',
    size: { w: 0.02, h: 0.54, d: 2.0 },
    elevation: WORKTOP_HEIGHT + WORKTOP_THICKNESS,
    color: splashback,
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
