import {
  BufferGeometry,
  CanvasTexture,
  DoubleSide,
  Quaternion,
  RingGeometry,
  Color,
  Float32BufferAttribute,
  Group,
  Line,
  LineBasicMaterial,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  Plane,
  PlaneGeometry,
  Ray,
  Raycaster,
  Scene,
  SRGBColorSpace,
  Vector3,
  WebGLRenderer,
} from 'three'
import { XRControllerModelFactory } from 'three/addons/webxr/XRControllerModelFactory.js'
import { HELP_ASPECT, renderHelpCanvas } from './controllerHelp'
import { TOOL_LABELS, type Editor, type EditPhase, type Tool } from './editor'
import type { RoomView } from './room'
import type { Store } from './store'
import type { ElementDef } from './types'
import { PALETTE } from './ui'

export interface XRMenuButton {
  id: string
  label: string
  /** Hintergrundfarbe – für die Farbpalette. */
  background?: string
  /** Knöpfe einer Gruppe schließen sich gegenseitig aus (z. B. die Farben). */
  group?: string
  action: () => void
}

export type XRMenuRow = { kind: 'title'; text: string } | { kind: 'buttons'; buttons: XRMenuButton[] }

export interface XRMenuPage {
  id: string
  label: string
  rows: XRMenuRow[]
}

const BTN_W = 0.13
const BTN_H = 0.026
const TITLE_H = 0.022
const GAP = 0.005
const PANEL_W = BTN_W * 2 + GAP * 3
/** Sichtbarer Ausschnitt des Menü-Inhalts – alles darüber hinaus wird gescrollt. */
const VIEW_H = 0.2
/** Griffleiste unter dem Menü, direkt über dem linken Controller. */
const HANDLE_W = PANEL_W + GAP * 2
const HANDLE_H = 0.036

/**
 * Schriftgrößen in Metern statt in Pixeln: So ist die Schrift überall gleich
 * groß, egal wie breit eine Fläche ist, und die Textur bekommt genau die
 * Auflösung, die die Fläche in der Szene braucht.
 */
const FONT_BTN = 0.008
const FONT_TITLE = 0.0068
const FONT_HUD = 0.0112

const BUTTON_BG = '#2b3a4d'
const TAB_BG = '#1d2836'
const TAB_ACTIVE_BG = '#3b82f6'
const CLOSE_BG = '#5a2a2a'
const HOVER = '#ffd23f'

/** Anker der Hand-Oberfläche über dem linken Controller. */
const HAND_ANCHOR_Y = 0.02
const HAND_ANCHOR_Z = 0.02
const HAND_TILT = -Math.PI / 4
/** Metern Inhalt pro Sekunde bei vollem Stick-Ausschlag. */
const MENU_SCROLL_SPEED = 0.45

/**
 * 3D-Menü für VR/AR: Buttons als Planes mit Canvas-Texturen, aufgeteilt in
 * Seiten (Raum · Elemente · Farbe · Auswahl). Das Menü hängt am linken
 * Controller – es lässt sich also mit der Hand aus dem Blickfeld drehen – und
 * sein Inhalt läuft in einem festen Ausschnitt, in dem gescrollt wird.
 */
export class XRMenu {
  readonly group = new Group()
  /** Verschiebbarer Inhalt; die Reiterzeile darüber bleibt stehen. */
  private readonly content = new Group()
  private readonly panel: Mesh
  private readonly buttons = new Map<string, Mesh>()
  private readonly labels = new Map<string, string>()
  private readonly pageGroups = new Map<string, Group>()
  /** Gesamthöhe einer Seite – daraus ergibt sich, wie weit gescrollt wird. */
  private readonly pageHeights = new Map<string, number>()
  private readonly tabs = new Map<string, Mesh>()
  private readonly closeButton: Mesh
  private readonly groups = new Map<string, string[]>()
  private readonly scrollTrack: Mesh
  private readonly scrollThumb: Mesh
  /** Ausschnitt in Weltkoordinaten – wird pro Bild aus der Handlage berechnet. */
  private readonly clipTop = new Plane()
  private readonly clipBottom = new Plane()
  private readonly localClipTop: Plane
  private readonly localClipBottom: Plane
  private readonly viewTop: number
  private readonly viewBottom: number
  private hovered: Mesh | null = null
  private activePage: string
  private scroll = 0

  constructor(pages: XRMenuPage[], onClose: () => void) {
    this.group.name = 'xr-menu'
    this.group.visible = false
    this.activePage = pages[0]?.id ?? ''

    // Ein Platz mehr in der Reiterzeile: ganz rechts schließt das Menü.
    const slots = pages.length + 1
    const tabW = (PANEL_W - GAP * (slots - 1)) / slots
    const panelH = TITLE_H + GAP * 3 + VIEW_H
    // Alles wird vom Anker am Controller nach oben aufgebaut.
    const bottomY = HANDLE_H / 2 + GAP
    const topY = bottomY + panelH
    this.viewTop = topY - TITLE_H - GAP * 2
    this.viewBottom = this.viewTop - VIEW_H
    this.localClipTop = new Plane(new Vector3(0, -1, 0), this.viewTop)
    this.localClipBottom = new Plane(new Vector3(0, 1, 0), -this.viewBottom)

    this.panel = new Mesh(
      new PlaneGeometry(PANEL_W + GAP * 2, panelH + GAP * 2),
      new MeshBasicMaterial({ color: new Color('#0f141b'), transparent: true, opacity: 0.96, depthTest: false }),
    )
    this.panel.position.set(0, bottomY + panelH / 2, -0.002)
    this.panel.name = 'menu-panel'
    this.group.add(this.panel, this.content)

    pages.forEach((page, i) => {
      const tab = makeLabelPlane(page.label, tabW, TITLE_H, TAB_BG, FONT_TITLE, { fg: '#dbe6f2' })
      tab.position.set(-PANEL_W / 2 + tabW / 2 + i * (tabW + GAP), topY - TITLE_H / 2, 0.001)
      tab.userData.button = { id: `tab-${page.id}`, label: page.label, action: () => this.showPage(page.id) }
      this.tabs.set(page.id, tab)
      this.buttons.set(`tab-${page.id}`, tab)
      this.labels.set(`tab-${page.id}`, page.label)
      this.group.add(tab)

      const pageGroup = new Group()
      pageGroup.name = `page-${page.id}`
      // Der Inhalt beginnt bei y = 0 und wächst nach unten; die Gruppe darüber
      // verschiebt ihn beim Scrollen.
      let y = 0
      for (const row of page.rows) {
        if (row.kind === 'title') {
          const mesh = makeLabelPlane(row.text, PANEL_W, TITLE_H, '#1a212c', FONT_TITLE, { fg: '#9fb3c8' })
          mesh.position.set(0, y - TITLE_H / 2, 0.001)
          pageGroup.add(mesh)
          y -= TITLE_H + GAP
        } else {
          row.buttons.forEach((btn, col) => {
            const bg = btn.background ?? BUTTON_BG
            const mesh = makeLabelPlane(btn.label, BTN_W, BTN_H, bg, FONT_BTN)
            mesh.userData.button = btn
            mesh.position.set(col === 0 ? -(BTN_W + GAP) / 2 : (BTN_W + GAP) / 2, y - BTN_H / 2, 0.001)
            this.buttons.set(btn.id, mesh)
            this.labels.set(btn.id, btn.label)
            if (btn.group) {
              const ids = this.groups.get(btn.group) ?? []
              ids.push(btn.id)
              this.groups.set(btn.group, ids)
            }
            pageGroup.add(mesh)
          })
          y -= BTN_H + GAP
        }
      }
      this.pageHeights.set(page.id, -y)
      this.pageGroups.set(page.id, pageGroup)
      this.content.add(pageGroup)
    })

    this.closeButton = makeLabelPlane('✕', tabW, TITLE_H, CLOSE_BG, FONT_TITLE)
    this.closeButton.position.set(-PANEL_W / 2 + tabW / 2 + pages.length * (tabW + GAP), topY - TITLE_H / 2, 0.001)
    this.closeButton.userData.button = {
      id: 'menu-close',
      label: 'Schließen',
      action: onClose,
    } satisfies XRMenuButton
    this.group.add(this.closeButton)

    // Schmaler Balken rechts: zeigt, wie viel Inhalt noch kommt.
    const barX = PANEL_W / 2 + GAP * 0.6
    this.scrollTrack = new Mesh(
      new PlaneGeometry(0.004, VIEW_H),
      new MeshBasicMaterial({ color: new Color('#1c2634'), transparent: true, opacity: 0.9, depthTest: false }),
    )
    this.scrollTrack.position.set(barX, this.viewTop - VIEW_H / 2, 0.001)
    this.scrollTrack.raycast = () => undefined
    this.scrollThumb = new Mesh(
      new PlaneGeometry(0.004, 1),
      new MeshBasicMaterial({ color: new Color('#5c7d9e'), transparent: true, depthTest: false }),
    )
    this.scrollThumb.raycast = () => undefined
    this.group.add(this.scrollTrack, this.scrollThumb)

    // Das Menü liegt immer vor der Szene, nie halb in einer Wand. Die Rückwand
    // bekommt eine eigene Reihenfolge, damit sie die Knöpfe nie überdeckt.
    this.group.traverse((object) => {
      object.renderOrder = object.name === 'menu-panel' ? 898 : 901
      const material = (object as Mesh).material as MeshBasicMaterial | undefined
      if (material && 'depthTest' in material) material.depthTest = false
    })

    // Nur der scrollende Inhalt wird am Ausschnitt beschnitten – Reiter,
    // Rückwand und Balken bleiben immer ganz sichtbar.
    this.content.traverse((object) => {
      const material = (object as Mesh).material as MeshBasicMaterial | undefined
      if (material) material.clippingPlanes = [this.clipTop, this.clipBottom]
    })

    this.showPage(this.activePage)
  }

  /** Knöpfe der aktiven Seite, die gerade wirklich im Ausschnitt liegen. */
  get interactive(): Mesh[] {
    const active = this.pageGroups.get(this.activePage)
    const rows = active
      ? (active.children.filter((c) => c.userData.button && this.inView(c as Mesh)) as Mesh[])
      : []
    return [...this.tabs.values(), this.closeButton, ...rows]
  }

  /** Wie `interactive`, aber inklusive Rückwand: alles, was den Strahl abfängt. */
  get scrollTargets(): Mesh[] {
    return [this.panel, ...this.interactive]
  }

  private inView(mesh: Mesh): boolean {
    const y = this.content.position.y + mesh.position.y
    return y <= this.viewTop - BTN_H / 3 && y >= this.viewBottom + BTN_H / 3
  }

  /** Markiert einen Knopf innerhalb seiner Gruppe (z. B. die gewählte Farbe). */
  setActiveInGroup(group: string, activeId: string | null): void {
    for (const id of this.groups.get(group) ?? []) {
      const mesh = this.buttons.get(id)
      if (!mesh) continue
      const button = mesh.userData.button as XRMenuButton
      setPlaneLabel(mesh, this.labels.get(id) ?? button.label, button.background ?? BUTTON_BG, id === activeId)
    }
  }

  showPage(id: string): void {
    this.activePage = id
    this.scroll = 0
    for (const [pageId, group] of this.pageGroups) group.visible = pageId === id
    for (const [pageId, tab] of this.tabs) {
      setPlaneLabel(tab, this.labels.get(`tab-${pageId}`) ?? '', pageId === id ? TAB_ACTIVE_BG : TAB_BG)
    }
    this.applyScroll()
  }

  setLabel(id: string, label: string): void {
    const mesh = this.buttons.get(id)
    if (!mesh || this.labels.get(id) === label) return
    this.labels.set(id, label)
    const bg = (mesh.userData.button as XRMenuButton | undefined)?.background ?? BUTTON_BG
    setPlaneLabel(mesh, label, bg)
  }

  /** Scrollt den Inhalt um `delta` Meter (positiv = weiter nach unten lesen). */
  scrollBy(delta: number): void {
    this.scroll += delta
    this.applyScroll()
  }

  private applyScroll(): void {
    const height = this.pageHeights.get(this.activePage) ?? 0
    const max = Math.max(0, height - VIEW_H)
    this.scroll = Math.min(max, Math.max(0, this.scroll))
    this.content.position.y = this.viewTop + this.scroll

    const scrollable = max > 1e-4
    this.scrollTrack.visible = scrollable
    this.scrollThumb.visible = scrollable
    if (!scrollable) return
    const thumbH = Math.max(0.018, VIEW_H * (VIEW_H / height))
    const top = this.viewTop - (this.scroll / max) * (VIEW_H - thumbH)
    this.scrollThumb.scale.y = thumbH
    this.scrollThumb.position.set(this.scrollTrack.position.x, top - thumbH / 2, 0.0015)
  }

  show(): void {
    this.group.visible = true
  }

  hide(): void {
    this.group.visible = false
    this.setHover(null)
  }

  /**
   * Pro Bild aufrufen: Der Ausschnitt wird in Weltkoordinaten nachgeführt, weil
   * das Menü mit der Hand wandert und dreht.
   */
  update(): void {
    if (!this.group.visible) return
    this.group.updateWorldMatrix(true, false)
    this.clipTop.copy(this.localClipTop).applyMatrix4(this.group.matrixWorld)
    this.clipBottom.copy(this.localClipBottom).applyMatrix4(this.group.matrixWorld)
  }

  hitTest(raycaster: Raycaster): Mesh | null {
    if (!this.group.visible) return null
    const hit = raycaster.intersectObjects(this.scrollTargets, false)[0]
    return (hit?.object as Mesh | undefined) ?? null
  }

  setHover(mesh: Mesh | null): void {
    const next = mesh && this.interactive.includes(mesh) ? mesh : null
    if (next === this.hovered) return
    if (this.hovered) (this.hovered.material as MeshBasicMaterial).color.set('#ffffff')
    if (next) (next.material as MeshBasicMaterial).color.set(HOVER)
    this.hovered = next
  }

  press(mesh: Mesh): void {
    const btn = mesh.userData.button as XRMenuButton | undefined
    btn?.action()
  }
}

/**
 * Griffleiste am linken Controller. Sie bleibt sichtbar, wenn das Menü zu ist,
 * und verrät dann, was darin steckt.
 */
class XRMenuHandle {
  readonly group = new Group()
  private readonly mesh: Mesh
  private readonly pages: string
  private hovered: Mesh | null = null

  constructor(pageLabels: string[], onToggle: () => void) {
    this.group.name = 'xr-menu-handle'
    this.group.visible = false
    this.pages = pageLabels.join(' · ')
    this.mesh = makeLabelPlane('☰ Menü öffnen', HANDLE_W, HANDLE_H, TAB_ACTIVE_BG, FONT_BTN, {
      fg: '#ffffff',
      sub: this.pages,
      depthTest: false,
    })
    this.mesh.userData.button = { id: 'hand-menu', label: 'Menü', action: onToggle } satisfies XRMenuButton
    this.mesh.renderOrder = 1200
    this.group.add(this.mesh)
  }

  get interactive(): Mesh[] {
    return this.group.visible ? [this.mesh] : []
  }

  setVisible(visible: boolean): void {
    this.group.visible = visible
    if (!visible) this.setHover(null)
  }

  setOpen(open: boolean): void {
    setPlaneLabel(
      this.mesh,
      open ? '✕ Menü schließen' : '☰ Menü öffnen',
      open ? CLOSE_BG : TAB_ACTIVE_BG,
      false,
      open ? 'R-Stick ↑ ↓ scrollt · Hand dreht das Menü weg' : this.pages,
    )
  }

  setHover(mesh: Mesh | null): void {
    const next = mesh === this.mesh ? mesh : null
    if (next === this.hovered) return
    if (this.hovered) (this.hovered.material as MeshBasicMaterial).color.set('#ffffff')
    if (next) (next.material as MeshBasicMaterial).color.set(HOVER)
    this.hovered = next
  }
}

interface LabelStyle {
  w: number
  h: number
  fontM: number
  fg?: string
}

interface LabelOptions {
  fg?: string
  /** Zweite, kleinere Zeile – z. B. die Seiten des Menüs auf der Griffleiste. */
  sub?: string
  depthTest?: boolean
}

function makeLabelPlane(
  text: string,
  w: number,
  h: number,
  bg: string,
  fontM: number,
  options: LabelOptions = {},
): Mesh {
  const mat = new MeshBasicMaterial({
    map: makeTextTexture(text, w, h, bg, options.fg ?? textColorFor(bg), fontM, false, options.sub),
    transparent: true,
    depthTest: options.depthTest ?? true,
  })
  const mesh = new Mesh(new PlaneGeometry(w, h), mat)
  mesh.userData.label = { w, h, fontM, fg: options.fg } satisfies LabelStyle
  return mesh
}

function setPlaneLabel(mesh: Mesh, text: string, bg: string, active = false, sub?: string): void {
  const style = mesh.userData.label as LabelStyle
  const mat = mesh.material as MeshBasicMaterial
  mat.map?.dispose()
  mat.map = makeTextTexture(text, style.w, style.h, bg, style.fg ?? textColorFor(bg), style.fontM, active, sub)
  mat.needsUpdate = true
}

/** Schwarze oder weiße Schrift – je nachdem, was auf dem Hintergrund lesbar ist. */
function textColorFor(bg: string): string {
  const hex = bg.replace('#', '')
  if (hex.length !== 6) return '#ffffff'
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b
  return luminance > 0.55 ? '#14181f' : '#ffffff'
}

/**
 * Auflösung der Beschriftungen in Pixeln pro Meter. Die Textur bekommt damit
 * dasselbe Seitenverhältnis wie die Fläche – vorher wurde ein festes 512×128er
 * Canvas gedehnt, was die Schrift verzerrt und unscharf gemacht hat.
 */
const TEXT_PPM = 5120
const MAX_TEX = 2048

function makeTextTexture(
  text: string,
  w: number,
  h: number,
  bg: string,
  fg: string,
  fontM: number,
  active = false,
  sub?: string,
): CanvasTexture {
  const canvas = document.createElement('canvas')
  const ppm = Math.min(TEXT_PPM, MAX_TEX / Math.max(w, h))
  canvas.width = Math.max(8, Math.round(w * ppm))
  canvas.height = Math.max(8, Math.round(h * ppm))
  const ctx = canvas.getContext('2d')!

  const radius = Math.min(canvas.height * 0.28, canvas.width * 0.1)
  ctx.fillStyle = bg
  roundRect(ctx, 1, 1, canvas.width - 2, canvas.height - 2, radius)
  ctx.fill()
  if (active) {
    // Deutlicher Rahmen um die gerade gewählte Farbe.
    const line = Math.max(3, canvas.height * 0.07)
    ctx.strokeStyle = HOVER
    ctx.lineWidth = line
    roundRect(ctx, line, line, canvas.width - line * 2, canvas.height - line * 2, radius)
    ctx.stroke()
  }

  const maxWidth = canvas.width * 0.9
  const fontPx = fontM * ppm
  drawFitted(ctx, text, fontPx, maxWidth, canvas.width / 2, sub ? canvas.height * 0.37 : canvas.height / 2, fg, 600)
  if (sub) drawFitted(ctx, sub, fontPx * 0.78, maxWidth, canvas.width / 2, canvas.height * 0.72, '#cfe0f2', 500)

  const tex = new CanvasTexture(canvas)
  tex.colorSpace = SRGBColorSpace
  tex.anisotropy = 16
  return tex
}

/** Schreibt mittig und verkleinert die Schrift nur, wenn es sonst nicht passt. */
function drawFitted(
  ctx: CanvasRenderingContext2D,
  text: string,
  fontPx: number,
  maxWidth: number,
  cx: number,
  cy: number,
  color: string,
  weight: number,
): void {
  const font = (size: number): string =>
    `${weight} ${size}px system-ui, -apple-system, Segoe UI, Roboto, sans-serif`
  let size = fontPx
  ctx.font = font(size)
  while (ctx.measureText(text).width > maxWidth && size > fontPx * 0.5) {
    size -= Math.max(1, fontPx * 0.04)
    ctx.font = font(size)
  }
  ctx.fillStyle = color
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(text, cx, cy, maxWidth)
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

/**
 * Kopfgebundene Anzeige: eine kleine Leiste unten rechts, die immer sichtbar
 * bleibt (Menü holen, Werkzeug wechseln), und darüber die ausklappbare
 * Steuerungs-Tafel. HTML ist in einer Immersive-Session nicht sichtbar,
 * deshalb liegen beide als Texturen in der Szene.
 */
class XRHud {
  readonly group = new Group()
  private readonly help: Mesh
  private readonly helpClose: Mesh
  private readonly menuButton: Mesh
  private readonly toolButton: Mesh
  private readonly phaseButton: Mesh
  private readonly clearButton: Mesh
  private readonly targetPosition = new Vector3()
  private readonly targetQuaternion = new Quaternion()
  private placed = false
  private hovered: Mesh | null = null

  constructor(actions: {
    onMenu: () => void
    onTool: () => void
    onPhase: () => void
    onClear: () => void
    onCloseHelp: () => void
  }) {
    this.group.name = 'xr-hud'
    this.group.visible = false

    // Die Tafel steht mittig im Blickfeld und weiter weg, damit sie hineinpasst.
    const helpWidth = 0.78
    const helpHeight = helpWidth / HELP_ASPECT
    const helpZ = -1.05
    this.help = new Mesh(
      new PlaneGeometry(helpWidth, helpHeight),
      new MeshBasicMaterial({ map: helpTexture(), transparent: true, depthTest: false }),
    )
    this.help.position.set(0, 0, helpZ)
    this.help.raycast = () => undefined
    this.help.visible = false

    this.helpClose = makeLabelPlane('✕ Schließen', 0.15, 0.05, CLOSE_BG, FONT_HUD, { depthTest: false })
    this.helpClose.position.set(helpWidth / 2 - 0.075, helpHeight / 2 + 0.04, helpZ)
    this.helpClose.userData.button = { id: 'help-close', label: 'Schließen', action: actions.onCloseHelp }
    this.helpClose.visible = false

    this.menuButton = makeLabelPlane('☰ Menü', 0.1, 0.036, TAB_ACTIVE_BG, FONT_HUD, { depthTest: false })
    this.menuButton.position.set(0.145, -0.262, -0.72)
    this.menuButton.userData.button = { id: 'hud-menu', label: 'Menü', action: actions.onMenu }

    this.toolButton = makeLabelPlane('Bearbeiten', 0.13, 0.036, BUTTON_BG, FONT_HUD, { depthTest: false })
    this.toolButton.position.set(0.285, -0.262, -0.72)
    this.toolButton.userData.button = { id: 'hud-tool', label: 'Werkzeug', action: actions.onTool }

    this.phaseButton = makeLabelPlane('Griffe zeigen', 0.13, 0.036, BUTTON_BG, FONT_HUD, { depthTest: false })
    this.phaseButton.position.set(0.145, -0.306, -0.72)
    this.phaseButton.userData.button = { id: 'hud-phase', label: 'Griffe', action: actions.onPhase }

    this.clearButton = makeLabelPlane('✕ Auswahl', 0.13, 0.036, CLOSE_BG, FONT_HUD, { depthTest: false })
    this.clearButton.position.set(0.285, -0.306, -0.72)
    this.clearButton.userData.button = { id: 'hud-clear', label: 'Auswahl aufheben', action: actions.onClear }

    // Die Leiste liegt über allem – auch über Menü und Tafel.
    this.help.renderOrder = 1500
    for (const mesh of [this.helpClose, this.menuButton, this.toolButton, this.phaseButton, this.clearButton]) {
      mesh.renderOrder = 2000
    }
    this.group.add(this.help, this.helpClose, this.menuButton, this.toolButton, this.phaseButton, this.clearButton)
  }

  get interactive(): Mesh[] {
    if (!this.group.visible) return []
    const bar = [this.menuButton, this.toolButton, this.phaseButton, this.clearButton]
    return this.help.visible ? [...bar, this.helpClose] : bar
  }

  /** Beschriftung der Auswahl-Knöpfe an Phase und Anzahl anpassen. */
  setSelection(count: number, phase: EditPhase): void {
    setPlaneLabel(
      this.phaseButton,
      phase === 'transform' ? '◀ Auswählen' : count > 0 ? `Griffe zeigen (${count})` : 'Griffe zeigen',
      count > 0 || phase === 'transform' ? TAB_ACTIVE_BG : BUTTON_BG,
    )
    setPlaneLabel(this.clearButton, count > 0 ? `✕ Auswahl (${count})` : '✕ Auswahl', CLOSE_BG)
  }

  get helpVisible(): boolean {
    return this.help.visible
  }

  setVisible(visible: boolean): void {
    this.group.visible = visible
    if (!visible) this.placed = false
  }

  setHelpVisible(visible: boolean): void {
    this.help.visible = visible
    this.helpClose.visible = visible
  }

  setToolLabel(label: string): void {
    setPlaneLabel(this.toolButton, label, BUTTON_BG)
  }

  setHover(mesh: Mesh | null): void {
    const next = mesh && this.interactive.includes(mesh) ? mesh : null
    if (next === this.hovered) return
    if (this.hovered) (this.hovered.material as MeshBasicMaterial).color.set('#ffffff')
    if (next) (next.material as MeshBasicMaterial).color.set(HOVER)
    this.hovered = next
  }

  /** Läuft dem Kopf weich hinterher, damit nichts am Blick klebt. */
  update(cameraPosition: Vector3, cameraQuaternion: Quaternion): void {
    if (!this.group.visible) return
    this.targetPosition.copy(cameraPosition)
    this.targetQuaternion.copy(cameraQuaternion)
    if (!this.placed) {
      this.group.position.copy(this.targetPosition)
      this.group.quaternion.copy(this.targetQuaternion)
      this.placed = true
      return
    }
    this.group.position.lerp(this.targetPosition, 0.18)
    this.group.quaternion.slerp(this.targetQuaternion, 0.18)
  }
}

/** Die Legende wird direkt gezeichnet – kein Umweg über ein zu ladendes Bild. */
function helpTexture(): CanvasTexture {
  const texture = new CanvasTexture(renderHelpCanvas(2))
  texture.colorSpace = SRGBColorSpace
  texture.anisotropy = 8
  return texture
}

/**
 * Farbpalette am linken Controller. Sie erscheint nur im Werkzeug „Farbe“ und
 * nur, solange das Menü zu ist – beide teilen sich denselben Platz über der
 * Hand. Mit dem rechten Controller hineinzeigen, mit dessen Stick blättern und
 * mit dem Trigger eine Farbe wählen.
 */
class XRPalette {
  readonly group = new Group()
  /** Höhe der Tafel – damit sie über der Griffleiste gestapelt werden kann. */
  readonly height: number
  private readonly slots: Mesh[] = []
  private readonly rows = 4
  private readonly columns = 2
  private offset = 0
  private hovered: Mesh | null = null
  private active = ''

  constructor() {
    this.group.name = 'xr-palette'
    this.group.visible = false

    const slotW = 0.062
    const slotH = 0.03
    const gap = 0.005
    const panelW = this.columns * slotW + (this.columns + 1) * gap
    const panelH = this.rows * (slotH + gap) + gap + 0.026
    this.height = panelH

    const panel = new Mesh(
      new PlaneGeometry(panelW, panelH),
      new MeshBasicMaterial({ color: new Color('#0f141b'), transparent: true, opacity: 0.95 }),
    )
    panel.position.z = -0.002
    panel.raycast = () => undefined
    this.group.add(panel)

    const title = makeLabelPlane('Farbe · R-Stick blättert', panelW - gap * 2, 0.018, '#1a212c', FONT_TITLE * 0.8, {
      fg: '#9fb3c8',
    })
    title.position.set(0, panelH / 2 - 0.014, 0)
    title.raycast = () => undefined
    this.group.add(title)

    for (let row = 0; row < this.rows; row++) {
      for (let column = 0; column < this.columns; column++) {
        const slot = makeLabelPlane('', slotW, slotH, BUTTON_BG, FONT_BTN)
        slot.position.set(
          -panelW / 2 + gap + slotW / 2 + column * (slotW + gap),
          panelH / 2 - 0.03 - slotH / 2 - row * (slotH + gap),
          0,
        )
        this.slots.push(slot)
        this.group.add(slot)
      }
    }
    this.refresh()
  }

  get visible(): boolean {
    return this.group.visible
  }

  get interactive(): Mesh[] {
    return this.group.visible ? this.slots.filter((s) => s.visible) : []
  }

  setVisible(visible: boolean): void {
    this.group.visible = visible
  }

  setActive(color: string): void {
    this.active = color
    this.refresh()
  }

  /** Blättert um ganze Reihen. */
  scroll(direction: number): void {
    const perRow = this.columns
    const max = Math.max(0, PALETTE.length - this.slots.length)
    this.offset = Math.min(max, Math.max(0, this.offset + direction * perRow))
    this.refresh()
  }

  setHover(mesh: Mesh | null): void {
    const next = mesh && this.slots.includes(mesh) ? mesh : null
    if (next === this.hovered) return
    if (this.hovered) (this.hovered.material as MeshBasicMaterial).color.set('#ffffff')
    if (next) (next.material as MeshBasicMaterial).color.set(HOVER)
    this.hovered = next
  }

  private refresh(): void {
    this.slots.forEach((slot, i) => {
      const entry = PALETTE[this.offset + i]
      slot.visible = !!entry
      if (!entry) return
      slot.userData.color = entry.color
      setPlaneLabel(slot, entry.name, entry.color, entry.color === this.active)
    })
  }
}

/**
 * Teleport im Werkzeug „Ansicht“: vom rechten Controller wird eine Wurfkurve
 * zum Boden gezeichnet, am Auftreffpunkt liegt ein leuchtender Ring. Die A-Taste
 * versetzt den Nutzer dorthin.
 */
class XRTeleport {
  readonly group = new Group()
  /** Zielpunkt am Boden, oder null wenn die Kurve nichts trifft. */
  target: Vector3 | null = null
  private readonly line: Line
  private readonly ring: Mesh
  private readonly points: number[] = []

  private static readonly SPEED = 6
  private static readonly GRAVITY = -9.81
  private static readonly STEPS = 48
  private static readonly STEP_TIME = 0.035

  constructor() {
    this.group.name = 'xr-teleport'
    this.group.visible = false

    const geometry = new BufferGeometry()
    geometry.setAttribute('position', new Float32BufferAttribute(new Float32Array(XRTeleport.STEPS * 3), 3))
    this.line = new Line(geometry, new LineBasicMaterial({ color: 0x8fd0ff, transparent: true, opacity: 0.9 }))
    this.line.raycast = () => undefined
    this.line.frustumCulled = false

    this.ring = new Mesh(
      new RingGeometry(0.16, 0.26, 40),
      new MeshBasicMaterial({ color: 0x8fd0ff, transparent: true, opacity: 0.75, side: DoubleSide }),
    )
    this.ring.rotation.x = -Math.PI / 2
    this.ring.raycast = () => undefined
    this.group.add(this.line, this.ring)
  }

  hide(): void {
    this.group.visible = false
    this.target = null
  }

  /** Wurfparabel ab dem Controller, bis sie den Boden schneidet. */
  update(origin: Vector3, direction: Vector3, floorY: number): void {
    this.points.length = 0
    const velocity = direction.clone().normalize().multiplyScalar(XRTeleport.SPEED)
    const point = origin.clone()
    let hit: Vector3 | null = null

    for (let i = 0; i < XRTeleport.STEPS; i++) {
      this.points.push(point.x, point.y, point.z)
      const t = XRTeleport.STEP_TIME
      const next = point.clone()
      next.addScaledVector(velocity, t)
      next.y += 0.5 * XRTeleport.GRAVITY * t * t
      velocity.y += XRTeleport.GRAVITY * t
      if (next.y <= floorY) {
        // Anteil bis zum Boden linear interpolieren.
        const f = (point.y - floorY) / Math.max(1e-6, point.y - next.y)
        hit = point.clone().lerp(next, f)
        hit.y = floorY
        this.points.push(hit.x, hit.y, hit.z)
        break
      }
      point.copy(next)
    }

    this.target = hit
    this.group.visible = !!hit
    if (!hit) return

    // Restliche Stützstellen auf den Auftreffpunkt legen, damit die Linie endet.
    const attribute = this.line.geometry.getAttribute('position')
    const used = this.points.length / 3
    for (let i = 0; i < XRTeleport.STEPS; i++) {
      const index = Math.min(i, used - 1) * 3
      attribute.setXYZ(i, this.points[index], this.points[index + 1], this.points[index + 2])
    }
    attribute.needsUpdate = true
    this.line.geometry.computeBoundingSphere()
    this.ring.position.copy(hit).setY(floorY + 0.01)
  }
}

export interface XRManagerOptions {
  renderer: WebGLRenderer
  scene: Scene
  editor: Editor
  store: Store
  roomView: RoomView
  /** Gruppe, in der Kamera und Controller hängen – wird zum Gehen verschoben. */
  player: Group
  catalog: ElementDef[]
  /** Platziert ein Element; `worldPoint` ist ein Punkt auf dem Boden in Weltkoordinaten. */
  placeElement: (def: ElementDef, worldPoint?: Vector3) => void
  onSessionChange?: (presenting: boolean) => void
}

/**
 * WebXR-Integration: Session-Start (VR/AR), Controller mit Strahl, In-XR-Menü
 * und Weiterleitung der Controller-Strahlen an den Editor.
 */
export class XRManager {
  readonly menu: XRMenu
  private readonly menuHandle: XRMenuHandle
  private readonly hud: XRHud
  private readonly palette = new XRPalette()
  private readonly teleport = new XRTeleport()
  /** Alles, was an der linken Hand hängt: Griffleiste, Menü und Farbpalette. */
  private readonly handMount = new Group()
  private handAttached = false
  private handPlaced = false
  /** Zeigt der rechte Controller gerade auf Palette bzw. Menü? */
  private overPalette = false
  private overMenu = false
  private readonly controllers: Group[] = []
  private activeController: Group | null = null
  private readonly raycaster = new Raycaster()
  private readonly tmpMatrix = new Matrix4()
  private readonly tmpRay = new Ray()
  private readonly headMatrix = new Matrix4()
  private readonly headPosition = new Vector3()
  private readonly headQuaternion = new Quaternion()
  private readonly headScale = new Vector3()
  private isAR = false
  /** Zeitstempel des letzten Frames – für gleichmäßige Bewegung. */
  private lastFrame = performance.now()

  constructor(private readonly o: XRManagerOptions) {
    o.renderer.xr.enabled = true
    o.renderer.xr.setReferenceSpaceType('local-floor')
    // Der Menü-Inhalt wird an seinem Ausschnitt beschnitten.
    o.renderer.localClippingEnabled = true

    const pages = this.buildMenu()
    this.menu = new XRMenu(pages, () => this.setMenuVisible(false))
    this.menuHandle = new XRMenuHandle(
      pages.map((page) => page.label),
      () => this.toggleMenu(),
    )
    this.hud = new XRHud({
      onMenu: () => this.toggleMenu(),
      onTool: () => this.cycleTool(),
      onPhase: () => o.editor.setEditPhase(o.editor.editPhase === 'transform' ? 'select' : 'transform'),
      onClear: () => o.editor.clearSelection(),
      onCloseHelp: () => this.setHelpVisible(false),
    })

    // Griffleiste am Anker, Menü und Palette gestapelt darüber – geneigt wie ein
    // Pult, damit man beim Blick auf die Hand von oben daraufschaut.
    this.handMount.name = 'xr-hand'
    this.handMount.position.set(0, HAND_ANCHOR_Y, HAND_ANCHOR_Z)
    this.handMount.rotation.x = HAND_TILT
    this.palette.group.position.set(0, HANDLE_H / 2 + GAP + this.palette.height / 2, 0)
    this.handMount.add(this.menu.group, this.menuHandle.group, this.palette.group)

    o.scene.add(this.handMount, this.hud.group, this.teleport.group)
    o.editor.addToolListener((tool) => {
      this.hud.setToolLabel(TOOL_LABELS[tool])
      this.palette.setVisible(tool === 'paint' && !this.menu.group.visible)
    })
    o.editor.addSelectionListener((ids, phase) => this.hud.setSelection(ids.length, phase))
    // Auch eine im Browser-Panel gewählte Farbe wird im VR-Menü markiert.
    o.editor.addPaintColorListener((color) => {
      this.menu.setActiveInGroup('color', `color-${color}`)
      this.palette.setActive(color)
    })
    this.menu.setActiveInGroup('color', `color-${o.editor.paintColor}`)
    this.palette.setActive(o.editor.paintColor)
    this.setupControllers()
  }

  get isPresenting(): boolean {
    return this.o.renderer.xr.isPresenting
  }

  /** Erstellt VR-/AR-Buttons (nur, wenn der Browser WebXR unterstützt). */
  createButtons(container: HTMLElement): void {
    const xr = navigator.xr
    if (!xr) {
      const note = document.createElement('span')
      note.className = 'muted'
      note.textContent = 'Kein WebXR'
      note.title = 'Dieser Browser unterstützt kein WebXR. Auf der Quest 3 den Meta-Browser verwenden.'
      container.appendChild(note)
      return
    }
    const modes: { mode: XRSessionMode; label: string }[] = [
      { mode: 'immersive-vr', label: 'VR starten' },
      { mode: 'immersive-ar', label: 'AR (Passthrough)' },
    ]
    for (const { mode, label } of modes) {
      xr.isSessionSupported(mode)
        .then((supported) => {
          if (!supported) return
          const btn = document.createElement('button')
          btn.textContent = label
          btn.className = 'xr'
          btn.addEventListener('click', () => this.toggleSession(mode, btn))
          container.appendChild(btn)
        })
        .catch(() => undefined)
    }
  }

  private async toggleSession(mode: XRSessionMode, btn: HTMLButtonElement): Promise<void> {
    const renderer = this.o.renderer
    const current = renderer.xr.getSession()
    if (current) {
      await current.end()
      return
    }
    try {
      const session = await navigator.xr!.requestSession(mode, {
        optionalFeatures: ['local-floor', 'bounded-floor', 'hand-tracking', 'layers'],
      })
      this.isAR = mode === 'immersive-ar'
      await renderer.xr.setSession(session)
      const original = btn.textContent
      btn.textContent = 'XR beenden'
      this.onSessionStart()
      session.addEventListener('end', () => {
        btn.textContent = original
        this.onSessionEnd()
      })
    } catch (err) {
      console.error('XR-Session konnte nicht gestartet werden', err)
      alert(`XR-Session konnte nicht gestartet werden: ${(err as Error).message ?? err}`)
    }
  }

  private onSessionStart(): void {
    const blend = this.o.renderer.xr.getSession()?.environmentBlendMode
    const transparent = this.isAR || (blend !== undefined && blend !== 'opaque')
    this.o.roomView.setTransparent(transparent)
    // In AR stören die Wände – dort zählen Möbel und Boden.
    if (transparent) {
      this.o.roomView.setWallsVisible(false)
      this.menu.setLabel('walls', 'Wände: aus')
    }
    this.o.editor.setHandleRadius(0.025)
    // Das Menü bleibt zu; die Griffleiste an der linken Hand holt es herbei.
    this.handPlaced = false
    this.menuHandle.setVisible(true)
    this.setMenuVisible(false)
    this.hud.setVisible(true)
    this.hud.setHelpVisible(false)
    this.hud.setToolLabel(TOOL_LABELS[this.o.editor.tool])
    this.hud.setSelection(this.o.editor.selectedIds.length, this.o.editor.editPhase)
    this.menu.setActiveInGroup('color', `color-${this.o.editor.paintColor}`)
    this.menu.setLabel('help', 'Steuerung zeigen')
    this.o.onSessionChange?.(true)
  }

  private onSessionEnd(): void {
    this.o.roomView.setTransparent(false)
    this.o.roomView.setWallsVisible(true)
    this.menu.setLabel('walls', 'Wände: an')
    this.hud.setVisible(false)
    this.menu.hide()
    this.menuHandle.setVisible(false)
    this.palette.setVisible(false)
    this.teleport.hide()
    this.o.player.position.set(0, 0, 0)
    this.o.player.quaternion.identity()
    this.activeController = null
    this.overMenu = false
    this.overPalette = false
    this.o.editor.pointerUp()
    this.o.onSessionChange?.(false)
  }

  private setupControllers(): void {
    const { renderer, player } = this.o
    const factory = new XRControllerModelFactory()
    for (let i = 0; i < 2; i++) {
      const controller = renderer.xr.getController(i)
      controller.name = `controller-${i}`
      controller.add(makeRayLine())
      controller.addEventListener('connected', (event) => {
        const source = (event as unknown as { data: XRInputSource }).data
        controller.userData.inputSource = source
        // Menü, Griffleiste und Palette sitzen an der linken Hand, gezielt wird
        // mit der rechten.
        if (source.handedness !== 'right') {
          controller.add(this.handMount)
          this.handAttached = true
        }
      })
      controller.addEventListener('disconnected', () => {
        controller.userData.inputSource = null
      })
      controller.addEventListener('selectstart', () => this.onSelectStart(controller))
      controller.addEventListener('selectend', () => this.onSelectEnd(controller))
      player.add(controller)
      this.controllers.push(controller)

      const grip = renderer.xr.getControllerGrip(i)
      grip.add(factory.createControllerModel(grip))
      player.add(grip)
    }
  }

  private rayFrom(controller: Group, target: Ray): Ray {
    this.tmpMatrix.identity().extractRotation(controller.matrixWorld)
    target.origin.setFromMatrixPosition(controller.matrixWorld)
    target.direction.set(0, 0, -1).applyMatrix4(this.tmpMatrix).normalize()
    return target
  }

  private onSelectStart(controller: Group): void {
    const ray = this.rayFrom(controller, this.tmpRay)
    this.raycaster.ray.copy(ray)
    const paletteHit = this.raycaster.intersectObjects(this.palette.interactive, false)[0]
    if (paletteHit) {
      const color = paletteHit.object.userData.color as string | undefined
      if (color) this.o.editor.setPaintColor(color)
      return
    }
    const uiHit = this.raycaster.intersectObjects(
      [...this.menuHandle.interactive, ...this.hud.interactive],
      false,
    )[0]
    if (uiHit) {
      ;(uiHit.object.userData.button as XRMenuButton).action()
      return
    }
    // Trifft der Strahl das Menü – auch nur dessen Rückwand –, bleibt die Szene
    // dahinter unangetastet.
    const menuHit = this.menu.hitTest(this.raycaster)
    if (menuHit) {
      this.menu.press(menuHit)
      return
    }
    // Solange die Steuerungs-Tafel offen ist, bleibt die Szene unangetastet.
    if (this.hud.helpVisible) return
    if (this.activeController) return
    // In XR sammelt jeder Trigger-Druck weitere Objekte in die Auswahl.
    if (this.o.editor.pointerDown(ray, true)) this.activeController = controller
  }

  private onSelectEnd(controller: Group): void {
    if (this.activeController === controller) {
      this.o.editor.pointerUp()
      this.activeController = null
    }
  }

  /** Pro Frame aufrufen (nur relevant, wenn eine XR-Session läuft). */
  update(): void {
    if (!this.isPresenting) return
    this.readHead()
    const camPosition = this.headPosition
    const camQuaternion = this.headQuaternion
    this.hud.update(camPosition, camQuaternion)

    // Ohne linken Controller (z. B. nur Handtracking) bleibt das Menü vor dem
    // Nutzer stehen, statt im Ursprung zu liegen.
    if (!this.handAttached) this.followHand(camPosition, camQuaternion)
    this.menu.update()

    if (this.activeController) {
      this.o.editor.pointerMove(this.rayFrom(this.activeController, this.tmpRay))
    }
    this.readGamepads(camPosition, camQuaternion)

    this.updateTeleport()

    let uiHover: Mesh | null = null
    let paletteHover: Mesh | null = null
    for (const controller of this.controllers) {
      if (!controller.visible) continue
      const ray = this.rayFrom(controller, this.tmpRay)
      this.raycaster.ray.copy(ray)
      let length = 3
      const paletteHit = this.raycaster.intersectObjects(this.palette.interactive, false)[0]
      if (paletteHit) {
        paletteHover = paletteHit.object as Mesh
        length = paletteHit.distance
      }
      const hit =
        paletteHit ??
        this.raycaster.intersectObjects([...this.menuHandle.interactive, ...this.hud.interactive], false)[0] ??
        (this.menu.group.visible
          ? this.raycaster.intersectObjects(this.menu.scrollTargets, false)[0]
          : undefined)
      if (hit) {
        uiHover = hit.object as Mesh
        length = hit.distance
      } else if (controller !== this.activeController) {
        this.o.editor.hover(ray)
        const sceneHit = this.raycaster.intersectObjects(
          [...this.o.editor.handles.children, ...this.o.roomView.paintables],
          true,
        )[0]
        if (sceneHit) length = sceneHit.distance
      }
      const line = controller.getObjectByName('ray') as Line | undefined
      if (line) line.scale.z = length
    }
    // Jede Fläche entscheidet selbst, ob der getroffene Knopf ihr gehört.
    const hover = paletteHover ? null : uiHover
    this.menu.setHover(hover)
    this.hud.setHover(hover)
    this.menuHandle.setHover(hover)
    this.palette.setHover(paletteHover)
  }

  /** Ersatzplatz vor dem Nutzer, wenn kein linker Controller verbunden ist. */
  private followHand(camPosition: Vector3, camQuaternion: Quaternion): void {
    const forward = new Vector3(0, 0, -1).applyQuaternion(camQuaternion)
    forward.y = 0
    if (forward.lengthSq() < 1e-6) forward.set(0, 0, -1)
    forward.normalize()
    const target = camPosition.clone().addScaledVector(forward, 0.7)
    target.y = camPosition.y - 0.32
    if (this.handPlaced) this.handMount.position.lerp(target, 0.15)
    else this.handMount.position.copy(target)
    this.handPlaced = true
    this.handMount.lookAt(camPosition)
  }

  private setTool(tool: Tool): void {
    this.o.editor.setTool(tool)
    this.hud.setToolLabel(TOOL_LABELS[tool])
  }

  /** Menü auf/zu – über die Griffleiste an der Hand, die Leiste oder den Stick. */
  private toggleMenu(): void {
    this.setMenuVisible(!this.menu.group.visible)
  }

  private setMenuVisible(visible: boolean): void {
    if (visible) this.menu.show()
    else this.menu.hide()
    this.menuHandle.setOpen(visible)
    // Menü und Palette teilen sich den Platz über der Hand.
    this.palette.setVisible(!visible && this.o.editor.tool === 'paint')
    if (!visible) this.overMenu = false
  }

  /** Kopiert die gesamte Auswahl und wählt die Kopien aus. */
  private duplicateSelection(): void {
    const { editor, store } = this.o
    const copies: string[] = []
    for (const id of [...editor.selectedIds]) {
      const copy = store.duplicate(id)
      if (copy) copies.push(copy.id)
    }
    if (copies.length === 0) return
    editor.clearSelection()
    for (const id of copies) editor.toggleSelection(id)
  }

  private setHelpVisible(visible: boolean): void {
    this.hud.setHelpVisible(visible)
    this.menu.setLabel('help', visible ? 'Steuerung aus' : 'Steuerung zeigen')
  }

  private cycleTool(): void {
    const order: Tool[] = ['view', 'edit', 'paint', 'measure']
    const next = order[(order.indexOf(this.o.editor.tool) + 1) % order.length]
    this.o.editor.setTool(next)
    this.hud.setToolLabel(TOOL_LABELS[next])
  }

  /** Gehen: Verschiebt das Spieler-Rig in Blickrichtung. */
  private movePlayer(forward: number, right: number, camQuaternion: Quaternion): void {
    const dir = new Vector3(0, 0, -1).applyQuaternion(camQuaternion)
    dir.y = 0
    if (dir.lengthSq() < 1e-6) return
    dir.normalize()
    // Rechts steht senkrecht auf der Blickrichtung: (x, z) → (−z, x).
    const side = new Vector3(-dir.z, 0, dir.x)
    this.o.player.position.addScaledVector(dir, forward).addScaledVector(side, right)
  }

  /** Umsehen: Dreht das Rig um die eigene Kopfposition, nicht um den Ursprung. */
  private turnPlayer(angle: number, camPosition: Vector3): void {
    const q = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), angle)
    const player = this.o.player
    player.position.sub(camPosition).applyQuaternion(q).add(camPosition)
    player.quaternion.premultiply(q)
  }

  /**
   * Controller-Sticks und -Tasten. Die Belegung hängt am Werkzeug:
   *
   *   Bearbeiten   L-Stick ↑↓ Höhe · L-Stick ←→ 90° drehen
   *                R-Stick schiebt das Element in der Ebene (aus deiner Sicht)
   *                A/X duplizieren · B/Y löschen
   *   Ansicht/Farbe  L-Stick gehen · R-Stick ←→ um 45° umsehen
   *
   * Zeigt der rechte Controller auf das Menü oder die Palette, gilt sein Stick
   * nur dort: er scrollt bzw. blättert und ändert weder Augenhöhe noch Auswahl.
   *
   * Im Werkzeug „Bearbeiten“ bleibt man bewusst stehen, damit ein Stick nicht
   * gleichzeitig Möbel und Standort bewegt.
   */
  private readGamepads(camPosition: Vector3, camQuaternion: Quaternion): void {
    const { editor, store } = this.o
    const now = performance.now()
    const dt = Math.min(0.1, (now - this.lastFrame) / 1000)
    this.lastFrame = now
    // Erst im Griff-Schritt steuern die Sticks Objekte; davor bewegen sie den
    // Nutzer genau wie im Werkzeug Ansicht.
    const editing = editor.tool === 'edit' && editor.editPhase === 'transform'
    const canEditSelection = editor.tool === 'edit'

    for (const controller of this.controllers) {
      const source = controller.userData.inputSource as XRInputSource | null
      const pad = source?.gamepad
      if (!pad) continue
      const isLeft = source?.handedness !== 'right'
      const state = (controller.userData.pad ??= { x: 0, y: 0, a: false, b: false, stick: false }) as {
        x: number
        y: number
        a: boolean
        b: boolean
        stick: boolean
      }

      // Achsen 2/3 sind der Stick; ältere Geräte melden ihn auf 0/1.
      const stickX = pad.axes[2] ?? pad.axes[0] ?? 0
      const stickY = pad.axes[3] ?? pad.axes[1] ?? 0
      const dirX = Math.abs(stickX) > 0.7 ? Math.sign(stickX) : 0
      const pushedX = dirX !== state.x
      state.x = dirX
      const dirY = Math.abs(stickY) > 0.7 ? Math.sign(stickY) : 0

      if (!isLeft) {
        this.overPalette = this.palette.visible && this.pointsAt(controller, this.palette.interactive)
        this.overMenu =
          !this.overPalette && this.menu.group.visible && this.pointsAt(controller, this.menu.scrollTargets)
      }

      if (!isLeft && (this.overPalette || this.overMenu)) {
        // Der Stick gehört jetzt der Oberfläche: kein Umsehen, keine Augenhöhe,
        // kein Verschieben der Auswahl.
        if (this.overPalette) {
          if (dirY !== 0 && dirY !== state.y) this.palette.scroll(dirY)
        } else if (Math.abs(stickY) > 0.15) {
          // Stick nach vorne blättert im Inhalt nach unten.
          this.menu.scrollBy(-stickY * MENU_SCROLL_SPEED * dt)
        }
      } else if (editing) {
        if (isLeft) {
          if (pushedX && dirX !== 0 && editor.selectedIds.length > 0) {
            // Nach links dreimal vorwärts drehen entspricht einer Drehung zurück.
            const turns = dirX > 0 ? 1 : 3
            for (let i = 0; i < turns; i++) editor.rotateSelected()
          }
          if (Math.abs(stickY) > 0.25) editor.nudgeSelected({ y: -stickY * 0.35 * dt })
        } else if (Math.abs(stickX) > 0.25 || Math.abs(stickY) > 0.25) {
          const forward = new Vector3(0, 0, -1).applyQuaternion(camQuaternion)
          forward.y = 0
          if (forward.lengthSq() > 1e-6) {
            forward.normalize()
            const side = new Vector3(-forward.z, 0, forward.x)
            const step = 0.5 * dt
            const move = forward.multiplyScalar(-stickY * step).addScaledVector(side, stickX * step)
            editor.nudgeSelected({ x: move.x, z: move.z })
          }
        }
      } else if (isLeft) {
        if (Math.abs(stickX) > 0.15 || Math.abs(stickY) > 0.15) {
          const speed = 1.6 * dt
          this.movePlayer(-stickY * speed, stickX * speed, camQuaternion)
        }
      } else {
        if (pushedX && dirX !== 0) this.turnPlayer(-dirX * (Math.PI / 4), camPosition)
        if (Math.abs(stickY) > 0.2) {
          const y = this.o.player.position.y - stickY * 1.2 * dt
          this.o.player.position.y = Math.min(8, Math.max(-1.2, y))
        }
      }
      state.y = dirY

      // Stickdruck links öffnet und schließt das Menü.
      const stickPressed = pad.buttons[3]?.pressed ?? false
      if (stickPressed && !state.stick && isLeft) this.toggleMenu()
      state.stick = stickPressed

      const a = pad.buttons[4]?.pressed ?? false
      if (a && !state.a) {
        if (editor.tool === 'view') this.teleportToTarget()
        else if (canEditSelection) this.duplicateSelection()
      }
      state.a = a

      const b = pad.buttons[5]?.pressed ?? false
      if (b && !state.b && canEditSelection) {
        for (const id of [...editor.selectedIds]) store.removeElement(id)
      }
      state.b = b
    }
  }

  /** Wurfkurve nur im Werkzeug „Ansicht“, gezeichnet vom rechten Controller. */
  private updateTeleport(): void {
    if (this.o.editor.tool !== 'view' || this.overMenu || this.overPalette) {
      this.teleport.hide()
      return
    }
    const controller = this.rightController
    if (!controller) {
      this.teleport.hide()
      return
    }
    const ray = this.rayFrom(controller, this.tmpRay)
    this.teleport.update(ray.origin.clone(), ray.direction.clone(), 0)
  }

  private get rightController(): Group | undefined {
    return this.controllers.find(
      (c) => (c.userData.inputSource as XRInputSource | null)?.handedness === 'right',
    )
  }

  /** Versetzt das Rig so, dass der Kopf über dem Zielpunkt steht. */
  private teleportToTarget(): void {
    const target = this.teleport.target
    if (!target) return
    this.readHead()
    this.o.player.position.x += target.x - this.headPosition.x
    this.o.player.position.z += target.z - this.headPosition.z
  }

  private pointsAt(controller: Group, objects: Mesh[]): boolean {
    if (objects.length === 0) return false
    this.raycaster.ray.copy(this.rayFrom(controller, this.tmpRay))
    return this.raycaster.intersectObjects(objects, false).length > 0
  }

  /**
   * Kopfposition und -drehung in Weltkoordinaten.
   *
   * `renderer.xr.getCamera()` liefert eine Kamera ohne Elternobjekt: three.js
   * verrechnet das Spieler-Rig erst beim Rendern, und `getWorldQuaternion()`
   * würde diese Matrix sofort wieder überschreiben. Deshalb wird die Kopfmatrix
   * hier selbst aus Rig und Kamera-Matrix gebildet.
   */
  private readHead(): void {
    const player = this.o.player
    player.updateMatrixWorld()
    this.headMatrix.multiplyMatrices(player.matrixWorld, this.o.renderer.xr.getCamera().matrix)
    this.headMatrix.decompose(this.headPosition, this.headQuaternion, this.headScale)
  }

  /** Bodenpunkt ca. 1 m vor dem Headset (Weltkoordinaten). */
  private pointInFront(distance = 1): Vector3 {
    this.readHead()
    const fwd = new Vector3(0, 0, -1).applyQuaternion(this.headQuaternion)
    fwd.y = 0
    if (fwd.lengthSq() < 1e-6) fwd.set(0, 0, -1)
    fwd.normalize()
    return new Vector3(this.headPosition.x + fwd.x * distance, 0, this.headPosition.z + fwd.z * distance)
  }

  private buildMenu(): XRMenuPage[] {
    const { store, editor, catalog } = this.o
    const o = this.o

    const elementRows: XRMenuRow[] = []
    for (let i = 0; i < catalog.length; i += 2) {
      elementRows.push({
        kind: 'buttons',
        buttons: catalog.slice(i, i + 2).map((def) => ({
          id: `add-${def.id}`,
          label: `+ ${def.name}`,
          action: () => this.o.placeElement(def, this.pointInFront()),
        })),
      })
    }

    const colorRows: XRMenuRow[] = []
    for (let i = 0; i < PALETTE.length; i += 2) {
      colorRows.push({
        kind: 'buttons',
        buttons: PALETTE.slice(i, i + 2).map(({ color, name }) => ({
          id: `color-${color}`,
          label: name,
          background: color,
          group: 'color',
          action: () => {
            editor.setPaintColor(color)
            editor.setTool('paint')
            this.menu.setActiveInGroup('color', `color-${color}`)
          },
        })),
      })
    }

    return [
      {
        id: 'room',
        label: 'Raum',
        rows: [
          { kind: 'title', text: 'Werkzeug' },
          {
            kind: 'buttons',
            buttons: [
              { id: 'tool-view', label: 'Ansicht (gehen)', action: () => this.setTool('view') },
              { id: 'tool-edit', label: 'Bearbeiten', action: () => this.setTool('edit') },
            ],
          },
          {
            kind: 'buttons',
            buttons: [
              { id: 'tool-paint', label: 'Farbe', action: () => this.setTool('paint') },
              { id: 'tool-measure', label: 'Messen', action: () => this.setTool('measure') },
            ],
          },
          { kind: 'title', text: 'Anzeigen' },
          {
            kind: 'buttons',
            buttons: [
              {
                id: 'walls',
                label: 'Wände: an',
                action: () => {
                  const show = !o.roomView.wallsShown
                  o.roomView.setWallsVisible(show)
                  this.menu.setLabel('walls', show ? 'Wände: an' : 'Wände: aus')
                },
              },
              {
                id: 'floor',
                label: 'Boden: an',
                action: () => {
                  const show = !o.roomView.floorShown
                  o.roomView.setFloorVisible(show)
                  this.menu.setLabel('floor', show ? 'Boden: an' : 'Boden: aus')
                },
              },
            ],
          },
          { kind: 'title', text: 'Raum · R-Stick ↑ ↓ scrollt hier' },
          {
            kind: 'buttons',
            buttons: [
              { id: 'h-', label: 'Höhe −10 cm', action: () => store.setRoomHeight(store.room.height - 0.1) },
              { id: 'h+', label: 'Höhe +10 cm', action: () => store.setRoomHeight(store.room.height + 0.1) },
            ],
          },
          {
            kind: 'buttons',
            buttons: [
              { id: 'plan', label: 'Grundriss laden', action: () => store.setRoom(store.state.room) },
              { id: 'rect', label: 'Rechteck 4×3 m', action: () => store.setRectangularRoom(4, 3) },
            ],
          },
          {
            kind: 'buttons',
            buttons: [
              { id: 'help', label: 'Steuerung zeigen', action: () => this.setHelpVisible(!this.hud.helpVisible) },
              { id: 'exit-room', label: 'XR beenden', action: () => void this.o.renderer.xr.getSession()?.end() },
            ],
          },
        ],
      },
      {
        id: 'items',
        label: 'Elemente',
        rows: [{ kind: 'title', text: 'Vor dir platzieren, dann mit dem Trigger ziehen' }, ...elementRows],
      },
      {
        id: 'paint',
        label: 'Farbe',
        rows: [
          { kind: 'title', text: 'Farbe wählen, dann Objekt antippen' },
          ...colorRows,
          {
            kind: 'buttons',
            buttons: [
              { id: 'paint-off', label: 'Zurück zu Bearbeiten', action: () => editor.setTool('edit') },
              { id: 'paint-hide', label: 'Menü ausblenden', action: () => this.setMenuVisible(false) },
            ],
          },
        ],
      },
      {
        id: 'selection',
        label: 'Auswahl',
        rows: [
          { kind: 'title', text: 'Stick: drehen · hoch/runter · A dupl. · B lösch.' },
          {
            kind: 'buttons',
            buttons: [
              {
                id: 'edit',
                label: 'Griffe zeigen',
                action: () => editor.setEditPhase(editor.editPhase === 'transform' ? 'select' : 'transform'),
              },
              { id: 'rotate', label: 'Drehen 90°', action: () => editor.rotateSelected() },
            ],
          },
          {
            kind: 'buttons',
            buttons: [
              { id: 'mirror', label: 'Spiegeln', action: () => editor.mirrorSelected() },
              { id: 'tilt', label: 'Kippen 90°', action: () => editor.tiltSelected('x') },
            ],
          },
          {
            kind: 'buttons',
            buttons: [
              { id: 'up', label: 'Höher +5 cm', action: () => editor.nudgeSelected({ y: 0.05 }) },
              { id: 'down', label: 'Tiefer −5 cm', action: () => editor.nudgeSelected({ y: -0.05 }) },
            ],
          },
          {
            kind: 'buttons',
            buttons: [
              {
                id: 'duplicate',
                label: 'Duplizieren (A)',
                action: () => this.duplicateSelection(),
              },
              {
                id: 'delete',
                label: 'Löschen (B)',
                action: () => {
                  for (const id of [...editor.selectedIds]) store.removeElement(id)
                },
              },
            ],
          },
          {
            kind: 'buttons',
            buttons: [
              { id: 'deselect', label: 'Auswahl aufheben', action: () => editor.clearSelection() },
              { id: 'menu-hide', label: 'Menü schließen', action: () => this.setMenuVisible(false) },
            ],
          },
          {
            kind: 'buttons',
            buttons: [
              { id: 'hide', label: 'Menü ausblenden', action: () => this.setMenuVisible(false) },
              { id: 'exit', label: 'XR beenden', action: () => void this.o.renderer.xr.getSession()?.end() },
            ],
          },
        ],
      },
    ]
  }
}

function makeRayLine(): Line {
  const geo = new BufferGeometry()
  geo.setAttribute('position', new Float32BufferAttribute([0, 0, 0, 0, 0, -1], 3))
  const line = new Line(geo, new LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.7 }))
  line.name = 'ray'
  line.scale.z = 3
  return line
}
