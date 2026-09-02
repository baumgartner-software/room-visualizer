/**
 * Steuerungs-Legende mit einer schematischen Abbildung des Quest-3-Controllers.
 *
 * Dieselbe SVG-Grafik wird zweimal verwendet: direkt im HTML-Panel und – über
 * eine Canvas-Textur – als Tafel im Blickfeld während der XR-Sitzung. Deshalb
 * bringt das SVG seinen eigenen Hintergrund und feste Farben mit.
 */

export interface ControlHint {
  /** Kürzel auf dem Controller. */
  key: string
  action: string
}

export const XR_CONTROLS: ControlHint[] = [
  { key: 'Trigger', action: 'Auswählen · ziehen · malen' },
  { key: 'Griff', action: 'Menü vor dich holen' },
  { key: 'Stick ← →', action: 'Element um 90° drehen' },
  { key: 'Stick ↑ ↓', action: 'Element höher / tiefer' },
  { key: 'A / X', action: 'Duplizieren' },
  { key: 'B / Y', action: 'Löschen' },
]

export const DESKTOP_CONTROLS: ControlHint[] = [
  { key: 'Klick', action: 'Element auswählen' },
  { key: 'Ziehen', action: 'Element verschieben' },
  { key: 'Kugeln', action: 'Größe ändern' },
  { key: 'Rechte Taste', action: 'Ansicht schwenken' },
  { key: 'R · Entf', action: 'Drehen · löschen' },
  { key: 'P · E', action: 'Pinsel · Griffe' },
]

const BG = '#111823'
const CARD = '#1b2534'
const LINE = '#8ba3bd'
const TEXT = '#e8edf3'
const MUTED = '#9fb3c8'
const ACCENT = '#3b82f6'

const WIDTH = 700
const HEIGHT = 300

/** Schematischer Quest-3-Controller mit beschrifteten Bedienelementen. */
function controllerDrawing(): string {
  return `
    <g transform="translate(84, 26)">
      <!-- Handgriff -->
      <path d="M62 78 L128 78 L136 150 Q140 196 118 214 L92 214 Q68 196 66 150 Z"
            fill="${CARD}" stroke="${LINE}" stroke-width="2.5" stroke-linejoin="round"/>
      <!-- Deckfläche mit Stick und Tasten -->
      <ellipse cx="95" cy="62" rx="56" ry="34" fill="${CARD}" stroke="${LINE}" stroke-width="2.5"/>
      <!-- Thumbstick -->
      <circle cx="66" cy="56" r="16" fill="${BG}" stroke="${ACCENT}" stroke-width="2.5"/>
      <circle cx="66" cy="56" r="7" fill="${ACCENT}"/>
      <!-- Tasten A/X und B/Y -->
      <circle cx="115" cy="48" r="11" fill="${BG}" stroke="${LINE}" stroke-width="2"/>
      <text x="115" y="53" text-anchor="middle" font-size="12" font-weight="700" fill="${TEXT}">A</text>
      <circle cx="126" cy="76" r="11" fill="${BG}" stroke="${LINE}" stroke-width="2"/>
      <text x="126" y="81" text-anchor="middle" font-size="12" font-weight="700" fill="${TEXT}">B</text>
      <!-- Zeigefinger-Trigger -->
      <path d="M60 96 Q42 104 44 126 Q46 142 62 140" fill="none" stroke="${ACCENT}" stroke-width="4"
            stroke-linecap="round"/>
      <!-- Griff-Taste -->
      <path d="M136 132 Q152 140 150 162 Q148 176 134 176" fill="none" stroke="${ACCENT}" stroke-width="4"
            stroke-linecap="round"/>

      <!-- Beschriftungen -->
      <g stroke="${MUTED}" stroke-width="1.2" fill="none">
        <path d="M50 56 L18 42"/>
        <path d="M40 118 L10 118"/>
        <path d="M152 150 L182 162"/>
        <path d="M115 37 L150 20"/>
      </g>
      <g font-size="12" fill="${MUTED}" font-weight="600">
        <text x="16" y="36" text-anchor="end">Stick</text>
        <text x="8" y="122" text-anchor="end">Trigger</text>
        <text x="186" y="166">Griff</text>
        <text x="154" y="18">A/X · B/Y</text>
      </g>
    </g>`
}

function legend(entries: ControlHint[], x: number): string {
  return entries
    .map((entry, i) => {
      const y = 46 + i * 38
      return `
      <g transform="translate(${x}, ${y})">
        <rect x="0" y="-16" rx="6" width="104" height="26" fill="${CARD}" stroke="${LINE}" stroke-width="1.2"/>
        <text x="52" y="2" text-anchor="middle" font-size="13" font-weight="700" fill="${TEXT}">${entry.key}</text>
        <text x="118" y="2" font-size="14" fill="${MUTED}">${entry.action}</text>
      </g>`
    })
    .join('')
}

/** Vollständige Legende als SVG-Markup. */
export function controllerHelpSvg(title = 'Steuerung in VR / AR'): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${WIDTH} ${HEIGHT}" width="${WIDTH}" height="${HEIGHT}"
      font-family="system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif">
    <rect width="${WIDTH}" height="${HEIGHT}" rx="18" fill="${BG}"/>
    <text x="24" y="26" font-size="14" font-weight="700" fill="${TEXT}">${title}</text>
    ${controllerDrawing()}
    ${legend(XR_CONTROLS, 306)}
  </svg>`
}

export function controllerHelpDataUrl(): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(controllerHelpSvg())}`
}

export const HELP_ASPECT = WIDTH / HEIGHT
