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

export interface XRMenuButton {
  id: string
  label: string
  action: () => void
}

export type XRMenuRow = { kind: 'title'; text: string } | { kind: 'buttons'; buttons: XRMenuButton[] }

const BTN_W = 0.13
const BTN_H = 0.032
const GAP = 0.006
const PANEL_W = BTN_W * 2 + GAP * 3

/**
 * Einfaches 3D-Menü für VR/AR: Buttons als Planes mit Canvas-Texturen.
 * Wird mit der Griff-Taste (squeeze) vor den Nutzer geholt.
 */
export class XRMenu {
  readonly group = new Group()
  private readonly buttons = new Map<string, Mesh>()
  private readonly labels = new Map<string, string>()
  private hovered: Mesh | null = null

  constructor(rows: XRMenuRow[]) {
    this.group.name = 'xr-menu'
    this.group.visible = false

    let y = 0
    const items: { mesh: Mesh; y: number }[] = []
    for (const row of rows) {
      if (row.kind === 'title') {
        const mesh = makeLabelPlane(row.text, PANEL_W - GAP * 2, BTN_H * 0.8, '#1a212c', '#9fb3c8', 36)
        mesh.position.x = 0
        items.push({ mesh, y })
        y -= BTN_H * 0.8 + GAP
      } else {
        row.buttons.forEach((btn, i) => {
          const mesh = makeLabelPlane(btn.label, BTN_W, BTN_H, '#2b3a4d', '#ffffff', 40)
          mesh.userData.button = btn
          mesh.position.x = i === 0 ? -(BTN_W / 2 + GAP / 2) : BTN_W / 2 + GAP / 2
          this.buttons.set(btn.id, mesh)
          this.labels.set(btn.id, btn.label)
          items.push({ mesh, y })
        })
        y -= BTN_H + GAP
      }
    }
    const panelH = -y + GAP * 2
    const panel = new Mesh(
      new PlaneGeometry(PANEL_W + GAP * 2, panelH),
      new MeshBasicMaterial({ color: new Color('#0f141b'), transparent: true, opacity: 0.85 }),
    )
    panel.position.z = -0.002
    this.group.add(panel)
    for (const { mesh, y: rowY } of items) {
      mesh.position.y = panelH / 2 - GAP - BTN_H / 2 + rowY
      mesh.position.z = 0.001
      this.group.add(mesh)
    }
  }

  get interactive(): Mesh[] {
    return [...this.buttons.values()]
  }

  setLabel(id: string, label: string): void {
    const mesh = this.buttons.get(id)
    if (!mesh || this.labels.get(id) === label) return
    this.labels.set(id, label)
    const mat = mesh.material as MeshBasicMaterial
    mat.map?.dispose()
    mat.map = makeTextTexture(label, '#2b3a4d', '#ffffff', 40)
    mat.needsUpdate = true
  }

  placeInFrontOf(cameraWorldPos: Vector3, cameraForward: Vector3): void {
    const forward = cameraForward.clone()
    forward.y = 0
    if (forward.lengthSq() < 1e-6) forward.set(0, 0, -1)
    forward.normalize()
    this.group.position.copy(cameraWorldPos).addScaledVector(forward, 0.65)
    this.group.position.y = cameraWorldPos.y - 0.2
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

function makeLabelPlane(text: string, w: number, h: number, bg: string, fg: string, fontPx: number): Mesh {
  const mat = new MeshBasicMaterial({ map: makeTextTexture(text, bg, fg, fontPx), transparent: true })
  return new Mesh(new PlaneGeometry(w, h), mat)
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
  ctx.font = `600 ${fontPx}px system-ui, -apple-system, Segoe UI, Roboto, sans-serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  let size = fontPx
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
  roomGroup: Group
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

    let menuHover: Mesh | null = null
    for (const controller of this.controllers) {
      if (!controller.visible) continue
      const ray = this.rayFrom(controller, this.tmpRay)
      this.raycaster.ray.copy(ray)
      let length = 3
      const menuHit = this.menu.group.visible ? this.raycaster.intersectObjects(this.menu.interactive, false)[0] : undefined
      if (menuHit) {
        menuHover = menuHit.object as Mesh
        length = menuHit.distance
      } else if (controller !== this.activeController) {
        this.o.editor.hover(ray)
        const hit = this.raycaster.intersectObjects([...this.o.editor.handles.children, this.o.roomView.floor], true)[0]
        if (hit) length = hit.distance
      }
      const line = controller.getObjectByName('ray') as Line | undefined
      if (line) line.scale.z = length
    }
    this.menu.setHover(menuHover)
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

  private buildMenu(): XRMenuRow[] {
    const { store, editor, catalog } = this.o
    const roomStep = 0.1
    const rows: XRMenuRow[] = [
      { kind: 'title', text: 'Raum (Griff-Taste: Menü holen)' },
      {
        kind: 'buttons',
        buttons: [
          { id: 'w-', label: 'Breite −10 cm', action: () => store.setRoom({ width: store.room.width - roomStep }) },
          { id: 'w+', label: 'Breite +10 cm', action: () => store.setRoom({ width: store.room.width + roomStep }) },
        ],
      },
      {
        kind: 'buttons',
        buttons: [
          { id: 'd-', label: 'Länge −10 cm', action: () => store.setRoom({ depth: store.room.depth - roomStep }) },
          { id: 'd+', label: 'Länge +10 cm', action: () => store.setRoom({ depth: store.room.depth + roomStep }) },
        ],
      },
      {
        kind: 'buttons',
        buttons: [
          { id: 'h-', label: 'Höhe −10 cm', action: () => store.setRoom({ height: store.room.height - roomStep }) },
          { id: 'h+', label: 'Höhe +10 cm', action: () => store.setRoom({ height: store.room.height + roomStep }) },
        ],
      },
      { kind: 'title', text: 'Elemente platzieren' },
    ]
    for (let i = 0; i < catalog.length; i += 2) {
      const pair = catalog.slice(i, i + 2)
      rows.push({
        kind: 'buttons',
        buttons: pair.map((def) => ({
          id: `add-${def.id}`,
          label: `+ ${def.name}`,
          action: () => this.o.placeElement(def, this.pointInFront()),
        })),
      })
    }
    rows.push(
      { kind: 'title', text: 'Auswahl' },
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
          { id: 'rotate', label: 'Drehen 90°', action: () => editor.selectedId && store.rotateElement(editor.selectedId) },
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
          { id: 'delete', label: 'Löschen', action: () => editor.selectedId && store.removeElement(editor.selectedId) },
          { id: 'deselect', label: 'Abwählen', action: () => editor.select(null) },
        ],
      },
      {
        kind: 'buttons',
        buttons: [
          { id: 'hide', label: 'Menü ausblenden', action: () => this.menu.hide() },
          { id: 'exit', label: 'XR beenden', action: () => void this.o.renderer.xr.getSession()?.end() },
        ],
      },
    )
    return rows
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
