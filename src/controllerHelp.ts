/**
 * Steuerungs-Legende mit einer schematischen Abbildung der Quest-3-Controller.
 *
 * Dieselbe SVG-Grafik wird zweimal verwendet: direkt im HTML-Panel und – über
 * eine Canvas-Textur – als Tafel im Blickfeld während der XR-Sitzung. Deshalb
 * bringt das SVG seinen eigenen Hintergrund und feste Farben mit.
 */

export interface ControlHint {
  key: string
  action: string
}

export const EDIT_CONTROLS: ControlHint[] = [
  { key: 'L-Stick ↑ ↓', action: 'Höhe des Elements' },
  { key: 'L-Stick ← →', action: 'Um 90° drehen' },
  { key: 'R-Stick ↑ ↓', action: 'Vor / zurück schieben' },
  { key: 'R-Stick ← →', action: 'Links / rechts schieben' },
  { key: 'A / X', action: 'Duplizieren' },
  { key: 'B / Y', action: 'Löschen' },
]

export const MOVE_CONTROLS: ControlHint[] = [
  { key: 'L-Stick', action: 'Gehen und seitlich treten' },
  { key: 'R-Stick ← →', action: 'Um 45° umsehen' },
  { key: 'Trigger', action: 'Anmalen (Werkzeug Farbe)' },
]

export const ALWAYS_CONTROLS: ControlHint[] = [
  { key: 'Trigger', action: 'Auswählen und ziehen' },
  { key: 'Griff', action: 'Menü vor dich holen' },
]

export const DESKTOP_CONTROLS: ControlHint[] = [
  { key: 'Klick', action: 'Element auswählen' },
  { key: 'Ziehen', action: 'Element verschieben' },
  { key: 'Kugeln', action: 'Größe ändern' },
  { key: 'Pfeile', action: 'Entlang einer Achse schieben' },
  { key: 'Rechte Taste', action: 'Ansicht schwenken' },
  { key: 'V · P', action: 'Ansicht · Farbe' },
  { key: 'R · Entf', action: 'Drehen · löschen' },
]

const BG = '#111823'
const CARD = '#1b2534'
const LINE = '#8ba3bd'
const TEXT = '#e8edf3'
const MUTED = '#9fb3c8'
const ACCENT = '#3b82f6'

const WIDTH = 1000
const HEIGHT = 520

/** Ein schematischer Controller; `labels` bestimmt, welche Teile beschriftet werden. */
function controller(x: number, y: number, hand: string, labels: 'left' | 'right'): string {
  const left = `
      <g stroke="${MUTED}" stroke-width="1.2" fill="none">
        <path d="M50 56 L20 42"/>
        <path d="M40 118 L14 118"/>
      </g>
      <g font-size="13" fill="${MUTED}" font-weight="600">
        <text x="18" y="36" text-anchor="end">Stick</text>
        <text x="12" y="122" text-anchor="end">Trigger</text>
      </g>`
  const right = `
      <g stroke="${MUTED}" stroke-width="1.2" fill="none">
        <path d="M120 40 L134 20"/>
        <path d="M150 158 L172 178"/>
      </g>
      <g font-size="13" fill="${MUTED}" font-weight="600">
        <text x="138" y="16">A/X · B/Y</text>
        <text x="176" y="184">Griff</text>
      </g>`
  return `
    <g transform="translate(${x}, ${y})">
      <text x="95" y="-14" text-anchor="middle" font-size="13" font-weight="700" fill="${TEXT}">${hand}</text>
      <path d="M62 78 L128 78 L136 150 Q140 196 118 214 L92 214 Q68 196 66 150 Z"
            fill="${CARD}" stroke="${LINE}" stroke-width="2.5" stroke-linejoin="round"/>
      <ellipse cx="95" cy="62" rx="56" ry="34" fill="${CARD}" stroke="${LINE}" stroke-width="2.5"/>
      <circle cx="66" cy="56" r="16" fill="${BG}" stroke="${ACCENT}" stroke-width="2.5"/>
      <circle cx="66" cy="56" r="7" fill="${ACCENT}"/>
      <circle cx="115" cy="48" r="11" fill="${BG}" stroke="${LINE}" stroke-width="2"/>
      <text x="115" y="53" text-anchor="middle" font-size="12" font-weight="700" fill="${TEXT}">A</text>
      <circle cx="126" cy="76" r="11" fill="${BG}" stroke="${LINE}" stroke-width="2"/>
      <text x="126" y="81" text-anchor="middle" font-size="12" font-weight="700" fill="${TEXT}">B</text>
      <path d="M60 96 Q42 104 44 126 Q46 142 62 140" fill="none" stroke="${ACCENT}" stroke-width="4"
            stroke-linecap="round"/>
      <path d="M136 132 Q152 140 150 162 Q148 176 134 176" fill="none" stroke="${ACCENT}" stroke-width="4"
            stroke-linecap="round"/>
      ${labels === 'left' ? left : right}
    </g>`
}

function section(title: string, entries: ControlHint[], x: number, y: number): string {
  const rows = entries
    .map((entry, i) => {
      const rowY = y + 26 + i * 34
      return `
      <g transform="translate(${x}, ${rowY})">
        <rect x="0" y="-16" rx="6" width="118" height="26" fill="${CARD}" stroke="${LINE}" stroke-width="1.2"/>
        <text x="59" y="2" text-anchor="middle" font-size="13" font-weight="700" fill="${TEXT}">${entry.key}</text>
        <text x="132" y="2" font-size="14" fill="${MUTED}">${entry.action}</text>
      </g>`
    })
    .join('')
  return `
    <text x="${x}" y="${y}" font-size="12" font-weight="700" letter-spacing="0.08em"
          fill="${ACCENT}">${title.toUpperCase()}</text>
    ${rows}`
}

/** Vollständige Legende als SVG-Markup. */
export function controllerHelpSvg(title = 'Steuerung in VR / AR'): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${WIDTH} ${HEIGHT}" width="${WIDTH}" height="${HEIGHT}"
      font-family="system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif">
    <rect width="${WIDTH}" height="${HEIGHT}" rx="20" fill="${BG}"/>
    <text x="28" y="34" font-size="16" font-weight="700" fill="${TEXT}">${title}</text>
    ${controller(44, 100, 'Links', 'left')}
    ${controller(250, 100, 'Rechts', 'right')}
    ${section('Werkzeug Bearbeiten', EDIT_CONTROLS, 500, 78)}
    ${section('Werkzeug Ansicht &amp; Farbe', MOVE_CONTROLS, 500, 306)}
    ${section('Immer', ALWAYS_CONTROLS, 500, 442)}
  </svg>`
}

export function controllerHelpDataUrl(): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(controllerHelpSvg())}`
}

export const HELP_ASPECT = WIDTH / HEIGHT
