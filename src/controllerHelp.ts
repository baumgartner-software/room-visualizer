/**
 * Steuerungs-Legende mit einer schematischen Abbildung der Quest-3-Controller.
 *
 * Gezeichnet wird direkt auf ein Canvas – dieselbe Zeichnung landet im
 * HTML-Panel und als Textur auf der Tafel in der XR-Sitzung. Der frühere Weg
 * über ein SVG-Bild blieb im Quest-Browser schwarz, weil das Bild dort nicht
 * zuverlässig geladen wurde.
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
  { key: 'R-Stick ↑ ↓', action: 'Augenhöhe ändern' },
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
const FONT = "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif"

export const HELP_WIDTH = 1000
export const HELP_HEIGHT = 540
export const HELP_ASPECT = HELP_WIDTH / HELP_HEIGHT

/** Zeichnet die komplette Legende in logischen Einheiten (HELP_WIDTH × HELP_HEIGHT). */
export function drawControllerHelp(ctx: CanvasRenderingContext2D, title = 'Steuerung in VR / AR'): void {
  ctx.save()
  ctx.clearRect(0, 0, HELP_WIDTH, HELP_HEIGHT)
  ctx.fillStyle = BG
  roundRect(ctx, 0, 0, HELP_WIDTH, HELP_HEIGHT, 20)
  ctx.fill()

  ctx.fillStyle = TEXT
  ctx.font = `700 17px ${FONT}`
  ctx.textAlign = 'left'
  ctx.textBaseline = 'alphabetic'
  ctx.fillText(title, 28, 36)

  controller(ctx, 44, 104, 'Links', 'left')
  controller(ctx, 250, 104, 'Rechts', 'right')

  section(ctx, 'Werkzeug Bearbeiten', EDIT_CONTROLS, 500, 78)
  section(ctx, 'Werkzeug Ansicht & Farbe', MOVE_CONTROLS, 500, 300)
  section(ctx, 'Immer', ALWAYS_CONTROLS, 500, 466)
  ctx.restore()
}

/** Fertiges Canvas in der gewünschten Auflösung. */
export function renderHelpCanvas(scale = 2): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(HELP_WIDTH * scale)
  canvas.height = Math.round(HELP_HEIGHT * scale)
  const ctx = canvas.getContext('2d')!
  ctx.scale(scale, scale)
  drawControllerHelp(ctx)
  return canvas
}

function controller(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  hand: string,
  labels: 'left' | 'right',
): void {
  ctx.save()
  ctx.translate(x, y)

  ctx.fillStyle = TEXT
  ctx.font = `700 14px ${FONT}`
  ctx.textAlign = 'center'
  ctx.fillText(hand, 95, -14)

  ctx.fillStyle = CARD
  ctx.strokeStyle = LINE
  ctx.lineWidth = 2.5
  ctx.lineJoin = 'round'

  // Handgriff
  ctx.beginPath()
  ctx.moveTo(62, 78)
  ctx.lineTo(128, 78)
  ctx.lineTo(136, 150)
  ctx.quadraticCurveTo(140, 196, 118, 214)
  ctx.lineTo(92, 214)
  ctx.quadraticCurveTo(68, 196, 66, 150)
  ctx.closePath()
  ctx.fill()
  ctx.stroke()

  // Deckfläche
  ctx.beginPath()
  ctx.ellipse(95, 62, 56, 34, 0, 0, Math.PI * 2)
  ctx.fill()
  ctx.stroke()

  // Thumbstick
  ctx.beginPath()
  ctx.arc(66, 56, 16, 0, Math.PI * 2)
  ctx.fillStyle = BG
  ctx.fill()
  ctx.strokeStyle = ACCENT
  ctx.stroke()
  ctx.beginPath()
  ctx.arc(66, 56, 7, 0, Math.PI * 2)
  ctx.fillStyle = ACCENT
  ctx.fill()

  // Tasten
  for (const [bx, by, label] of [
    [115, 48, 'A'],
    [126, 76, 'B'],
  ] as [number, number, string][]) {
    ctx.beginPath()
    ctx.arc(bx, by, 11, 0, Math.PI * 2)
    ctx.fillStyle = BG
    ctx.fill()
    ctx.strokeStyle = LINE
    ctx.lineWidth = 2
    ctx.stroke()
    ctx.fillStyle = TEXT
    ctx.font = `700 12px ${FONT}`
    ctx.textAlign = 'center'
    ctx.fillText(label, bx, by + 4)
  }

  // Zeigefinger-Trigger und Griff-Taste
  ctx.strokeStyle = ACCENT
  ctx.lineWidth = 4
  ctx.lineCap = 'round'
  ctx.beginPath()
  ctx.moveTo(60, 96)
  ctx.quadraticCurveTo(42, 104, 44, 126)
  ctx.quadraticCurveTo(46, 142, 62, 140)
  ctx.stroke()
  ctx.beginPath()
  ctx.moveTo(136, 132)
  ctx.quadraticCurveTo(152, 140, 150, 162)
  ctx.quadraticCurveTo(148, 176, 134, 176)
  ctx.stroke()
  ctx.lineCap = 'butt'

  // Beschriftungen
  ctx.strokeStyle = MUTED
  ctx.lineWidth = 1.2
  ctx.fillStyle = MUTED
  ctx.font = `600 13px ${FONT}`
  if (labels === 'left') {
    line(ctx, 50, 56, 20, 42)
    line(ctx, 40, 118, 14, 118)
    ctx.textAlign = 'right'
    ctx.fillText('Stick', 18, 36)
    ctx.fillText('Trigger', 12, 122)
  } else {
    line(ctx, 120, 40, 134, 20)
    line(ctx, 150, 158, 172, 178)
    ctx.textAlign = 'left'
    ctx.fillText('A/X · B/Y', 138, 16)
    ctx.fillText('Griff', 176, 184)
  }
  ctx.restore()
}

function section(
  ctx: CanvasRenderingContext2D,
  title: string,
  entries: ControlHint[],
  x: number,
  y: number,
): void {
  ctx.fillStyle = ACCENT
  ctx.font = `700 12px ${FONT}`
  ctx.textAlign = 'left'
  ctx.fillText(title.toUpperCase(), x, y)

  entries.forEach((entry, i) => {
    const rowY = y + 26 + i * 34
    ctx.fillStyle = CARD
    ctx.strokeStyle = LINE
    ctx.lineWidth = 1.2
    roundRect(ctx, x, rowY - 16, 118, 26, 6)
    ctx.fill()
    ctx.stroke()

    ctx.fillStyle = TEXT
    ctx.font = `700 13px ${FONT}`
    ctx.textAlign = 'center'
    ctx.fillText(entry.key, x + 59, rowY + 2)

    ctx.fillStyle = MUTED
    ctx.font = `14px ${FONT}`
    ctx.textAlign = 'left'
    ctx.fillText(entry.action, x + 132, rowY + 2)
  })
}

function line(ctx: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number): void {
  ctx.beginPath()
  ctx.moveTo(x1, y1)
  ctx.lineTo(x2, y2)
  ctx.stroke()
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}
