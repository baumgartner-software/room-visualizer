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
import { controllerHelpDataUrl, HELP_ASPECT } from './controllerHelp'
import { TOOL_LABELS, type Editor, type Tool } from './editor'
import type { RoomView } from './room'
import type { Store } from './store'
import type { ElementDef } from './types'
import { PALETTE } from './ui'

export interface XRMenuButton {
  id: string
  label: string
  /** Hintergrundfarbe – für die Farbpalette. */
  background?: string
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
  private hovered: Mesh | null = null
  private activePage: string

  constructor(pages: XRMenuPage[]) {
    this.group.name = 'xr-menu'
    this.group.visible = false
    this.activePage = pages[0]?.id ?? ''

    const tabW = (PANEL_W - GAP * (pages.length - 1)) / pages.length
    const contentHeights = pages.map((page) => pageHeight(page))
    const panelH = TITLE_H + GAP * 3 + Math.max(...contentHeights, 0)

    const panel = new Mesh(
      new PlaneGeometry(PANEL_W + GAP * 2, panelH + GAP * 2),
      new MeshBasicMaterial({ color: new Color('#0f141b'), transparent: true, opacity: 0.88 }),
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
            pageGroup.add(mesh)
          })
          y -= BTN_H + GAP
        }
      }
      this.pageGroups.set(page.id, pageGroup)
      this.group.add(pageGroup)
    })

    this.showPage(this.activePage)
  }

  get interactive(): Mesh[] {
    const active = this.pageGroups.get(this.activePage)
    const rows = active ? (active.children.filter((c) => c.userData.button) as Mesh[]) : []
    return [...this.tabs.values(), ...rows]
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

  placeInFrontOf(cameraWorldPos: Vector3, cameraForward: Vector3): void {
    const forward = cameraForward.clone()
    forward.y = 0
    if (forward.lengthSq() < 1e-6) forward.set(0, 0, -1)
    forward.normalize()
    this.group.position.copy(cameraWorldPos).addScaledVector(forward, 0.65)
    this.group.position.y = cameraWorldPos.y - 0.18
    this.group.lookAt(cameraWorldPos)
    this.group.visible = true
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

function makeLabelPlane(text: string, w: number, h: number, bg: string, fg: string, fontPx: number): Mesh {
  const mat = new MeshBasicMaterial({ map: makeTextTexture(text, bg, fg, fontPx), transparent: true })
  return new Mesh(new PlaneGeometry(w, h), mat)
}

function setPlaneLabel(mesh: Mesh, text: string, bg: string, fontPx: number): void {
  const mat = mesh.material as MeshBasicMaterial
  mat.map?.dispose()
  mat.map = makeTextTexture(text, bg, textColorFor(bg), fontPx)
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

function makeTextTexture(text: string, bg: string, fg: string, fontPx: number): CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = 512
  canvas.height = 128
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = bg
  roundRect(ctx, 2, 2, canvas.width - 4, canvas.height - 4, 18)
  ctx.fill()
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
  private readonly menuButton: Mesh
  private readonly toolButton: Mesh
  private readonly targetPosition = new Vector3()
  private readonly targetQuaternion = new Quaternion()
  private readonly offset = new Vector3(0, 0, -0.72)
  private placed = false
  private hovered: Mesh | null = null

  constructor(onMenu: () => void, onTool: () => void) {
    this.group.name = 'xr-hud'
    this.group.visible = false

    const helpWidth = 0.52
    this.help = new Mesh(
      new PlaneGeometry(helpWidth, helpWidth / HELP_ASPECT),
      new MeshBasicMaterial({ map: helpTexture(), transparent: true, depthTest: false }),
    )
    this.help.position.set(0.2, -0.09, 0)
    this.help.renderOrder = 998
    this.help.raycast = () => undefined
    this.help.visible = false

    this.menuButton = makeLabelPlane('☰ Menü', 0.1, 0.036, TAB_ACTIVE_BG, '#ffffff', 40)
    this.menuButton.position.set(0.145, -0.3, 0)
    this.menuButton.userData.button = { id: 'hud-menu', label: 'Menü', action: onMenu }

    this.toolButton = makeLabelPlane('Bearbeiten', 0.13, 0.036, BUTTON_BG, '#ffffff', 40)
    this.toolButton.position.set(0.27, -0.3, 0)
    this.toolButton.userData.button = { id: 'hud-tool', label: 'Werkzeug', action: onTool }

    for (const mesh of [this.menuButton, this.toolButton]) mesh.renderOrder = 999
    this.group.add(this.help, this.menuButton, this.toolButton)
  }

  get interactive(): Mesh[] {
    return this.group.visible ? [this.menuButton, this.toolButton] : []
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
    this.targetPosition.copy(this.offset).applyQuaternion(cameraQuaternion).add(cameraPosition)
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

/** Rastert die SVG-Legende in eine Textur. */
function helpTexture(): CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = 1600
  canvas.height = Math.round(1600 / HELP_ASPECT)
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#111823'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  const texture = new CanvasTexture(canvas)
  texture.colorSpace = SRGBColorSpace
  texture.anisotropy = 8
  const image = new Image()
  image.onload = () => {
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height)
    texture.needsUpdate = true
  }
  image.src = controllerHelpDataUrl()
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
  private needsMenuPlacement = false
  private isAR = false
  /** Zeitstempel des letzten Frames – für gleichmäßige Bewegung. */
  private lastFrame = performance.now()

  constructor(private readonly o: XRManagerOptions) {
    o.renderer.xr.enabled = true
    o.renderer.xr.setReferenceSpaceType('local-floor')
    this.menu = new XRMenu(this.buildMenu())
    this.hud = new XRHud(
      () => (this.needsMenuPlacement = true),
      () => this.cycleTool(),
    )
    o.scene.add(this.menu.group, this.hud.group)
    o.editor.onToolChange = (tool) => this.hud.setToolLabel(TOOL_LABELS[tool])
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
    this.needsMenuPlacement = true
    this.hud.setVisible(true)
    this.hud.setHelpVisible(false)
    this.hud.setToolLabel(TOOL_LABELS[this.o.editor.tool])
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
      controller.addEventListener('squeezestart', () => (this.needsMenuPlacement = true))
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
    if (this.activeController) return
    if (this.o.editor.pointerDown(ray)) this.activeController = controller
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
    const xrCamera = this.o.renderer.xr.getCamera()
    const camPosition = xrCamera.getWorldPosition(new Vector3())
    const camQuaternion = xrCamera.getWorldQuaternion(new Quaternion())
    this.hud.update(camPosition, camQuaternion)
    if (this.needsMenuPlacement) {
      const pos = xrCamera.getWorldPosition(new Vector3())
      const fwd = xrCamera.getWorldDirection(new Vector3())
      if (pos.lengthSq() > 0 || fwd.lengthSq() > 0) {
        this.menu.placeInFrontOf(pos, fwd)
        this.needsMenuPlacement = false
      }
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
    const side = new Vector3(dir.z, 0, -dir.x)
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
      const state = (controller.userData.pad ??= { x: 0, a: false, b: false }) as {
        x: number
        a: boolean
        b: boolean
      }

      // Achsen 2/3 sind der Stick; ältere Geräte melden ihn auf 0/1.
      const stickX = pad.axes[2] ?? pad.axes[0] ?? 0
      const stickY = pad.axes[3] ?? pad.axes[1] ?? 0
      const dirX = Math.abs(stickX) > 0.7 ? Math.sign(stickX) : 0
      const pushedX = dirX !== state.x
      state.x = dirX

      if (editing) {
        if (isLeft) {
          if (pushedX && dirX !== 0 && editor.selectedId) {
            // Nach links dreimal vorwärts drehen entspricht einer Drehung zurück.
            const turns = dirX > 0 ? 1 : 3
            for (let i = 0; i < turns; i++) store.rotateElement(editor.selectedId)
          }
          if (Math.abs(stickY) > 0.25) editor.nudgeSelected({ y: -stickY * 0.35 * dt })
        } else if (Math.abs(stickX) > 0.25 || Math.abs(stickY) > 0.25) {
          const forward = new Vector3(0, 0, -1).applyQuaternion(camQuaternion)
          forward.y = 0
          if (forward.lengthSq() > 1e-6) {
            forward.normalize()
            const side = new Vector3(forward.z, 0, -forward.x)
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
      } else if (pushedX && dirX !== 0) {
        this.turnPlayer(-dirX * (Math.PI / 4), camPosition)
      }

      const a = pad.buttons[4]?.pressed ?? false
      if (a && !state.a && editing && editor.selectedId) {
        const copy = store.duplicate(editor.selectedId)
        if (copy) editor.select(copy.id)
      }
      state.a = a

      const b = pad.buttons[5]?.pressed ?? false
      if (b && !state.b && editing && editor.selectedId) store.removeElement(editor.selectedId)
      state.b = b
    }
  }

  /** Bodenpunkt ca. 1 m vor dem Headset (Weltkoordinaten). */
  private pointInFront(distance = 1): Vector3 {
    const cam = this.o.renderer.xr.getCamera()
    const pos = cam.getWorldPosition(new Vector3())
    const fwd = cam.getWorldDirection(new Vector3())
    fwd.y = 0
    if (fwd.lengthSq() < 1e-6) fwd.set(0, 0, -1)
    fwd.normalize()
    return new Vector3(pos.x + fwd.x * distance, 0, pos.z + fwd.z * distance)
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
          action: () => {
            editor.setPaintColor(color)
            editor.setTool('paint')
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
              {
                id: 'help',
                label: 'Steuerung zeigen',
                action: () => {
                  const show = !this.hud.helpVisible
                  this.hud.setHelpVisible(show)
                  this.menu.setLabel('help', show ? 'Steuerung aus' : 'Steuerung zeigen')
                },
              },
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
                label: 'Griffe: an',
                action: () => {
                  editor.setEditMode(!editor.editMode)
                  this.menu.setLabel('edit', editor.editMode ? 'Griffe: an' : 'Griffe: aus')
                },
              },
              {
                id: 'rotate',
                label: 'Drehen 90°',
                action: () => editor.selectedId && store.rotateElement(editor.selectedId),
              },
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
                action: () => {
                  if (!editor.selectedId) return
                  const copy = store.duplicate(editor.selectedId)
                  if (copy) editor.select(copy.id)
                },
              },
              {
                id: 'delete',
                label: 'Löschen (B)',
                action: () => editor.selectedId && store.removeElement(editor.selectedId),
              },
            ],
          },
          {
            kind: 'buttons',
            buttons: [
              { id: 'deselect', label: 'Abwählen', action: () => editor.select(null) },
              {
                id: 'edit2',
                label: 'Griffe an/aus',
                action: () => {
                  editor.setEditMode(!editor.editMode)
                  this.menu.setLabel('edit', editor.editMode ? 'Griffe: an' : 'Griffe: aus')
                },
              },
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
