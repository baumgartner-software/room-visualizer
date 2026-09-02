import {
  BufferGeometry,
  CanvasTexture,
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
import type { Editor } from './editor'
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

export interface XRManagerOptions {
  renderer: WebGLRenderer
  scene: Scene
  editor: Editor
  store: Store
  roomView: RoomView
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
  private readonly controllers: Group[] = []
  private activeController: Group | null = null
  private readonly raycaster = new Raycaster()
  private readonly tmpMatrix = new Matrix4()
  private readonly tmpRay = new Ray()
  private needsMenuPlacement = false
  private isAR = false
  /** Zeitpunkt der nächsten erlaubten Stick-Wiederholung (Dauerdrücken). */
  private nextRepeat = 0

  constructor(private readonly o: XRManagerOptions) {
    o.renderer.xr.enabled = true
    o.renderer.xr.setReferenceSpaceType('local-floor')
    this.menu = new XRMenu(this.buildMenu())
    o.scene.add(this.menu.group)
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
    this.o.onSessionChange?.(true)
  }

  private onSessionEnd(): void {
    this.o.roomView.setTransparent(false)
    this.menu.hide()
    this.activeController = null
    this.o.editor.pointerUp()
    this.o.onSessionChange?.(false)
  }

  private setupControllers(): void {
    const { renderer, scene } = this.o
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
      scene.add(controller)
      this.controllers.push(controller)

      const grip = renderer.xr.getControllerGrip(i)
      grip.add(factory.createControllerModel(grip))
      scene.add(grip)
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
    this.readGamepads()

    let menuHover: Mesh | null = null
    for (const controller of this.controllers) {
      if (!controller.visible) continue
      const ray = this.rayFrom(controller, this.tmpRay)
      this.raycaster.ray.copy(ray)
      let length = 3
      const menuHit = this.menu.group.visible
        ? this.raycaster.intersectObjects(this.menu.interactive, false)[0]
        : undefined
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
  }

  /**
   * Controller-Tasten und Sticks: schnelles Bearbeiten ohne Umweg über das Menü.
   *   Stick links/rechts  drehen um 90°
   *   Stick hoch/runter   Element anheben/absenken
   *   A/X                 duplizieren
   *   B/Y                 löschen
   */
  private readGamepads(): void {
    const { editor, store } = this.o
    const now = performance.now()
    for (const controller of this.controllers) {
      const pad = (controller.userData.inputSource as XRInputSource | null)?.gamepad
      if (!pad) continue
      const state = (controller.userData.pad ??= { x: 0, a: false, b: false }) as {
        x: number
        a: boolean
        b: boolean
      }

      const stickX = pad.axes[2] ?? 0
      const stickY = pad.axes[3] ?? 0
      const dirX = Math.abs(stickX) > 0.7 ? Math.sign(stickX) : 0
      if (dirX !== state.x) {
        state.x = dirX
        if (dirX !== 0 && editor.selectedId) {
          // Nach links dreimal vorwärts drehen entspricht einer Drehung zurück.
          const turns = dirX > 0 ? 1 : 3
          for (let i = 0; i < turns; i++) store.rotateElement(editor.selectedId)
        }
      }

      if (Math.abs(stickY) > 0.6 && editor.selectedId && now >= this.nextRepeat) {
        editor.nudgeSelected({ y: stickY < 0 ? 0.02 : -0.02 })
        this.nextRepeat = now + 90
      }

      const a = pad.buttons[4]?.pressed ?? false
      if (a && !state.a && editor.selectedId) {
        const copy = store.duplicate(editor.selectedId)
        if (copy) editor.select(copy.id)
      }
      state.a = a

      const b = pad.buttons[5]?.pressed ?? false
      if (b && !state.b && editor.selectedId) store.removeElement(editor.selectedId)
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
            this.menu.setLabel('paint-off', 'Pinsel aus')
          },
        })),
      })
    }

    return [
      {
        id: 'room',
        label: 'Raum',
        rows: [
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
              { id: 'paint-off', label: 'Pinsel aus', action: () => editor.setPaintColor(null) },
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
