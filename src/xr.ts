import {
  BufferGeometry,
  CanvasTexture,
  Quaternion,
  Color,
  Float32BufferAttribute,
  Group,
  Line,
  LineBasicMaterial,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
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
const BTN_H = 0.032
const TITLE_H = 0.026
const GAP = 0.006
const PANEL_W = BTN_W * 2 + GAP * 3
const BUTTON_BG = '#2b3a4d'
const TAB_BG = '#1d2836'
const TAB_ACTIVE_BG = '#3b82f6'

/**
 * 3D-Menü für VR/AR: Buttons als Planes mit Canvas-Texturen, aufgeteilt in
 * Seiten (Raum · Elemente · Farbe · Auswahl), damit das Panel greifbar bleibt.
 */
export class XRMenu {
  readonly group = new Group()
  private readonly buttons = new Map<string, Mesh>()
  private readonly labels = new Map<string, string>()
  private readonly pageGroups = new Map<string, Group>()
  private readonly tabs = new Map<string, Mesh>()
  private readonly closeButton: Mesh
  private readonly groups = new Map<string, string[]>()
  private hovered: Mesh | null = null
  private activePage: string

  constructor(pages: XRMenuPage[]) {
    this.group.name = 'xr-menu'
    this.group.visible = false
    this.activePage = pages[0]?.id ?? ''

    // Ein Platz mehr in der Reiterzeile: ganz rechts schließt das Menü.
    const slots = pages.length + 1
    const tabW = (PANEL_W - GAP * (slots - 1)) / slots
    const contentHeights = pages.map((page) => pageHeight(page))
    const panelH = TITLE_H + GAP * 3 + Math.max(...contentHeights, 0)

    const panel = new Mesh(
      new PlaneGeometry(PANEL_W + GAP * 2, panelH + GAP * 2),
      new MeshBasicMaterial({ color: new Color('#0f141b'), transparent: true, opacity: 0.9, depthTest: false }),
    )
    panel.position.z = -0.002
    this.group.add(panel)

    const topY = panelH / 2

    pages.forEach((page, i) => {
      const tab = makeLabelPlane(page.label, tabW, TITLE_H, TAB_BG, '#dbe6f2', 40)
      tab.position.set(-PANEL_W / 2 + tabW / 2 + i * (tabW + GAP), topY - TITLE_H / 2, 0.001)
      tab.userData.button = { id: `tab-${page.id}`, label: page.label, action: () => this.showPage(page.id) }
      this.tabs.set(page.id, tab)
      this.buttons.set(`tab-${page.id}`, tab)
      this.labels.set(`tab-${page.id}`, page.label)
      this.group.add(tab)

      const pageGroup = new Group()
      pageGroup.name = `page-${page.id}`
      let y = topY - TITLE_H - GAP * 2
      for (const row of page.rows) {
        if (row.kind === 'title') {
          const mesh = makeLabelPlane(row.text, PANEL_W, TITLE_H, '#1a212c', '#9fb3c8', 34)
          mesh.position.set(0, y - TITLE_H / 2, 0.001)
          pageGroup.add(mesh)
          y -= TITLE_H + GAP
        } else {
          row.buttons.forEach((btn, col) => {
            const bg = btn.background ?? BUTTON_BG
            const mesh = makeLabelPlane(btn.label, BTN_W, BTN_H, bg, textColorFor(bg), 40)
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
      this.pageGroups.set(page.id, pageGroup)
      this.group.add(pageGroup)
    })

    this.closeButton = makeLabelPlane('✕', tabW, TITLE_H, '#5a2a2a', '#ffffff', 40)
    this.closeButton.position.set(-PANEL_W / 2 + tabW / 2 + pages.length * (tabW + GAP), topY - TITLE_H / 2, 0.001)
    this.closeButton.userData.button = {
      id: 'menu-close',
      label: 'Schließen',
      action: () => this.hide(),
    } satisfies XRMenuButton
    this.group.add(this.closeButton)

    // Das Menü liegt immer vor der Szene, nie halb in einer Wand.
    this.group.traverse((object) => {
      object.renderOrder = 900
      const material = (object as Mesh).material as MeshBasicMaterial | undefined
      if (material && 'depthTest' in material) material.depthTest = false
    })

    this.showPage(this.activePage)
  }

  get interactive(): Mesh[] {
    const active = this.pageGroups.get(this.activePage)
    const rows = active ? (active.children.filter((c) => c.userData.button) as Mesh[]) : []
    return [...this.tabs.values(), this.closeButton, ...rows]
  }

  /** Markiert einen Knopf innerhalb seiner Gruppe (z. B. die gewählte Farbe). */
  setActiveInGroup(group: string, activeId: string | null): void {
    for (const id of this.groups.get(group) ?? []) {
      const mesh = this.buttons.get(id)
      if (!mesh) continue
      const button = mesh.userData.button as XRMenuButton
      setPlaneLabel(mesh, this.labels.get(id) ?? button.label, button.background ?? BUTTON_BG, 40, id === activeId)
    }
  }

  showPage(id: string): void {
    this.activePage = id
    for (const [pageId, group] of this.pageGroups) group.visible = pageId === id
    for (const [pageId, tab] of this.tabs) {
      setPlaneLabel(tab, this.labels.get(`tab-${pageId}`) ?? '', pageId === id ? TAB_ACTIVE_BG : TAB_BG, 40)
    }
  }

  setLabel(id: string, label: string): void {
    const mesh = this.buttons.get(id)
    if (!mesh || this.labels.get(id) === label) return
    this.labels.set(id, label)
    const bg = (mesh.userData.button as XRMenuButton | undefined)?.background ?? BUTTON_BG
    setPlaneLabel(mesh, label, bg, 40)
  }

  /**
   * Hält das Menü vor dem Nutzer. `snap` setzt es sofort (Griff-Taste), sonst
   * zieht es weich nach, damit es beim Gehen und Drehen nicht stehen bleibt.
   */
  follow(cameraWorldPos: Vector3, cameraForward: Vector3, snap: boolean): void {
    const forward = cameraForward.clone()
    forward.y = 0
    if (forward.lengthSq() < 1e-6) forward.set(0, 0, -1)
    forward.normalize()
    const target = cameraWorldPos.clone().addScaledVector(forward, 0.65)
    target.y = cameraWorldPos.y - 0.18
    if (snap) {
      this.group.position.copy(target)
      this.group.visible = true
    } else {
      this.group.position.lerp(target, 0.12)
    }
    this.group.lookAt(cameraWorldPos)
  }

  hide(): void {
    this.group.visible = false
  }

  hitTest(raycaster: Raycaster): Mesh | null {
    if (!this.group.visible) return null
    const hit = raycaster.intersectObjects(this.interactive, false)[0]
    return (hit?.object as Mesh | undefined) ?? null
  }

  setHover(mesh: Mesh | null): void {
    if (mesh === this.hovered) return
    if (this.hovered) (this.hovered.material as MeshBasicMaterial).color.set('#ffffff')
    if (mesh) (mesh.material as MeshBasicMaterial).color.set('#ffd23f')
    this.hovered = mesh
  }

  press(mesh: Mesh): void {
    const btn = mesh.userData.button as XRMenuButton | undefined
    btn?.action()
  }
}

function pageHeight(page: XRMenuPage): number {
  return page.rows.reduce((sum, row) => sum + (row.kind === 'title' ? TITLE_H : BTN_H) + GAP, 0)
}

function makeLabelPlane(
  text: string,
  w: number,
  h: number,
  bg: string,
  fg: string,
  fontPx: number,
  options: { depthTest?: boolean } = {},
): Mesh {
  const mat = new MeshBasicMaterial({
    map: makeTextTexture(text, bg, fg, fontPx),
    transparent: true,
    depthTest: options.depthTest ?? true,
  })
  return new Mesh(new PlaneGeometry(w, h), mat)
}

function setPlaneLabel(mesh: Mesh, text: string, bg: string, fontPx: number, active = false): void {
  const mat = mesh.material as MeshBasicMaterial
  mat.map?.dispose()
  mat.map = makeTextTexture(text, bg, textColorFor(bg), fontPx, active)
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

function makeTextTexture(text: string, bg: string, fg: string, fontPx: number, active = false): CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = 512
  canvas.height = 128
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = bg
  roundRect(ctx, 2, 2, canvas.width - 4, canvas.height - 4, 18)
  ctx.fill()
  if (active) {
    // Deutlicher Rahmen um die gerade gewählte Farbe.
    ctx.strokeStyle = '#ffd23f'
    ctx.lineWidth = 10
    roundRect(ctx, 7, 7, canvas.width - 14, canvas.height - 14, 15)
    ctx.stroke()
  }
  ctx.fillStyle = fg
  let size = fontPx
  ctx.font = `600 ${size}px system-ui, -apple-system, Segoe UI, Roboto, sans-serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  while (ctx.measureText(text).width > canvas.width - 40 && size > 18) {
    size -= 2
    ctx.font = `600 ${size}px system-ui, -apple-system, Segoe UI, Roboto, sans-serif`
  }
  ctx.fillText(text, canvas.width / 2, canvas.height / 2 + 2)
  const tex = new CanvasTexture(canvas)
  tex.colorSpace = SRGBColorSpace
  tex.anisotropy = 4
  return tex
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

    this.helpClose = makeLabelPlane('✕ Schließen', 0.15, 0.05, '#5a2a2a', '#ffffff', 40, { depthTest: false })
    this.helpClose.position.set(helpWidth / 2 - 0.075, helpHeight / 2 + 0.04, helpZ)
    this.helpClose.userData.button = { id: 'help-close', label: 'Schließen', action: actions.onCloseHelp }
    this.helpClose.visible = false

    this.menuButton = makeLabelPlane('☰ Menü', 0.1, 0.036, TAB_ACTIVE_BG, '#ffffff', 40, { depthTest: false })
    this.menuButton.position.set(0.145, -0.262, -0.72)
    this.menuButton.userData.button = { id: 'hud-menu', label: 'Menü', action: actions.onMenu }

    this.toolButton = makeLabelPlane('Bearbeiten', 0.13, 0.036, BUTTON_BG, '#ffffff', 40, { depthTest: false })
    this.toolButton.position.set(0.285, -0.262, -0.72)
    this.toolButton.userData.button = { id: 'hud-tool', label: 'Werkzeug', action: actions.onTool }

    this.phaseButton = makeLabelPlane('Griffe zeigen', 0.13, 0.036, BUTTON_BG, '#ffffff', 40, { depthTest: false })
    this.phaseButton.position.set(0.145, -0.306, -0.72)
    this.phaseButton.userData.button = { id: 'hud-phase', label: 'Griffe', action: actions.onPhase }

    this.clearButton = makeLabelPlane('✕ Auswahl', 0.13, 0.036, '#5a2a2a', '#ffffff', 40, { depthTest: false })
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
      40,
    )
    setPlaneLabel(this.clearButton, count > 0 ? `✕ Auswahl (${count})` : '✕ Auswahl', '#5a2a2a', 40)
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
    setPlaneLabel(this.toolButton, label, BUTTON_BG, 40)
  }

  setHover(mesh: Mesh | null): void {
    if (mesh === this.hovered) return
    if (this.hovered) (this.hovered.material as MeshBasicMaterial).color.set('#ffffff')
    if (mesh) (mesh.material as MeshBasicMaterial).color.set('#ffd23f')
    this.hovered = mesh
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
  private readonly hud: XRHud
  private readonly controllers: Group[] = []
  private activeController: Group | null = null
  private readonly raycaster = new Raycaster()
  private readonly tmpMatrix = new Matrix4()
  private readonly tmpRay = new Ray()
  private readonly headMatrix = new Matrix4()
  private readonly headPosition = new Vector3()
  private readonly headQuaternion = new Quaternion()
  private readonly headScale = new Vector3()
  private needsMenuPlacement = false
  private isAR = false
  /** Zeitstempel des letzten Frames – für gleichmäßige Bewegung. */
  private lastFrame = performance.now()

  constructor(private readonly o: XRManagerOptions) {
    o.renderer.xr.enabled = true
    o.renderer.xr.setReferenceSpaceType('local-floor')
    this.menu = new XRMenu(this.buildMenu())
    this.hud = new XRHud({
      onMenu: () => this.toggleMenu(),
      onTool: () => this.cycleTool(),
      onPhase: () => o.editor.setEditPhase(o.editor.editPhase === 'transform' ? 'select' : 'transform'),
      onClear: () => o.editor.clearSelection(),
      onCloseHelp: () => this.setHelpVisible(false),
    })
    o.scene.add(this.menu.group, this.hud.group)
    o.editor.addToolListener((tool) => this.hud.setToolLabel(TOOL_LABELS[tool]))
    o.editor.addSelectionListener((ids, phase) => this.hud.setSelection(ids.length, phase))
    // Auch eine im Browser-Panel gewählte Farbe wird im VR-Menü markiert.
    o.editor.addPaintColorListener((color) => this.menu.setActiveInGroup('color', `color-${color}`))
    this.menu.setActiveInGroup('color', `color-${o.editor.paintColor}`)
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
    this.o.editor.setHandleRadius(0.025)
    // Das Menü bleibt zu – es kommt über die Leiste oder die Griff-Taste.
    this.needsMenuPlacement = false
    this.menu.hide()
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
    this.hud.setVisible(false)
    this.menu.hide()
    this.o.player.position.set(0, 0, 0)
    this.o.player.quaternion.identity()
    this.activeController = null
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
        controller.userData.inputSource = (event as unknown as { data: XRInputSource }).data
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
    const hudHit = this.raycaster.intersectObjects(this.hud.interactive, false)[0]
    if (hudHit) {
      ;(hudHit.object.userData.button as XRMenuButton).action()
      return
    }
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

    // Das Menü folgt dem Kopf, damit es beim Gehen und Drehen nicht zurückbleibt.
    if (this.menu.group.visible || this.needsMenuPlacement) {
      const forward = new Vector3(0, 0, -1).applyQuaternion(camQuaternion)
      this.menu.follow(camPosition, forward, this.needsMenuPlacement)
      this.needsMenuPlacement = false
    }

    if (this.activeController) {
      this.o.editor.pointerMove(this.rayFrom(this.activeController, this.tmpRay))
    }
    this.readGamepads(camPosition, camQuaternion)

    let menuHover: Mesh | null = null
    for (const controller of this.controllers) {
      if (!controller.visible) continue
      const ray = this.rayFrom(controller, this.tmpRay)
      this.raycaster.ray.copy(ray)
      let length = 3
      const menuHit =
        this.raycaster.intersectObjects(this.hud.interactive, false)[0] ??
        (this.menu.group.visible ? this.raycaster.intersectObjects(this.menu.interactive, false)[0] : undefined)
      if (menuHit) {
        menuHover = menuHit.object as Mesh
        length = menuHit.distance
      } else if (controller !== this.activeController) {
        this.o.editor.hover(ray)
        const hit = this.raycaster.intersectObjects(
          [...this.o.editor.handles.children, ...this.o.roomView.paintables],
          true,
        )[0]
        if (hit) length = hit.distance
      }
      const line = controller.getObjectByName('ray') as Line | undefined
      if (line) line.scale.z = length
    }
    this.menu.setHover(menuHover)
    this.hud.setHover(menuHover)
  }

  private setTool(tool: Tool): void {
    this.o.editor.setTool(tool)
    this.hud.setToolLabel(TOOL_LABELS[tool])
  }

  /** Menü auf/zu – über die Leiste oder die Griff-Taste. */
  private toggleMenu(): void {
    if (this.menu.group.visible) this.menu.hide()
    else this.needsMenuPlacement = true
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
    const order: Tool[] = ['view', 'edit', 'paint']
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
   * Im Werkzeug „Bearbeiten“ bleibt man bewusst stehen, damit ein Stick nicht
   * gleichzeitig Möbel und Standort bewegt.
   */
  private readGamepads(camPosition: Vector3, camQuaternion: Quaternion): void {
    const { editor, store } = this.o
    const now = performance.now()
    const dt = Math.min(0.1, (now - this.lastFrame) / 1000)
    this.lastFrame = now
    const editing = editor.tool === 'edit'

    for (const controller of this.controllers) {
      const source = controller.userData.inputSource as XRInputSource | null
      const pad = source?.gamepad
      if (!pad) continue
      const isLeft = source?.handedness !== 'right'
      const state = (controller.userData.pad ??= { x: 0, a: false, b: false, stick: false }) as {
        x: number
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

      if (editing) {
        if (isLeft) {
          if (pushedX && dirX !== 0 && editor.selectedIds.length > 0) {
            // Nach links dreimal vorwärts drehen entspricht einer Drehung zurück.
            const turns = dirX > 0 ? 1 : 3
            for (let i = 0; i < turns; i++) editor.rotateSelected()
          }
          if (Math.abs(stickY) > 0.25 && editor.editPhase === 'transform') {
            editor.nudgeSelected({ y: -stickY * 0.35 * dt })
          }
        } else if (
          editor.editPhase === 'transform' &&
          (Math.abs(stickX) > 0.25 || Math.abs(stickY) > 0.25)
        ) {
          const forward = new Vector3(0, 0, -1).applyQuaternion(camQuaternion)
          forward.y = 0
          if (forward.lengthSq() > 1e-6) {
            forward.normalize()
            const side = new Vector3(-forward.z, 0, forward.x)
            const step = 0.5 * dt
            const move = forward
              .multiplyScalar(-stickY * step)
              .addScaledVector(side, stickX * step)
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

      // Stickdruck links öffnet und schließt das Menü.
      const stickPressed = pad.buttons[3]?.pressed ?? false
      if (stickPressed && !state.stick && isLeft) this.toggleMenu()
      state.stick = stickPressed

      const a = pad.buttons[4]?.pressed ?? false
      if (a && !state.a && editing) this.duplicateSelection()
      state.a = a

      const b = pad.buttons[5]?.pressed ?? false
      if (b && !state.b && editing) {
        for (const id of [...editor.selectedIds]) store.removeElement(id)
      }
      state.b = b
    }
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
          { kind: 'title', text: 'Raum (Griff-Taste holt das Menü)' },
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
              { id: 'paint-hide', label: 'Menü ausblenden', action: () => this.menu.hide() },
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
              { id: 'menu-hide', label: 'Menü schließen', action: () => this.menu.hide() },
            ],
          },
          {
            kind: 'buttons',
            buttons: [
              { id: 'hide', label: 'Menü ausblenden', action: () => this.menu.hide() },
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
