import './style.css'
import { Color, DirectionalLight, Group, HemisphereLight, Ray, Raycaster, Scene, Vector2, Vector3, WebGLRenderer } from 'three'
import { CATALOG } from './catalog'
import { defaultProject } from './defaultProject'
import { Editor } from './editor'
import { ElementsLayer } from './elements'
import { bounds } from './geometry'
import { RoomView } from './room'
import { Environment } from './environment'
import { decodeState, encodeState, shareUrl, tokenFromLocation } from './share'
import { Store } from './store'
import type { ElementDef, RoomSpec } from './types'
import { setupUI } from './ui'
import { Views, type ViewMode } from './views'
import { XRManager } from './xr'

const params = new URLSearchParams(location.search)
/** `?ui=0` blendet die Oberfläche aus (für Screenshots und Präsentation). */
const showUI = params.get('ui') !== '0'
/** `?reset=1` ignoriert den gespeicherten Stand und startet mit der Standardküche. */
const forceDefault = params.get('reset') === '1'

const canvas = document.getElementById('scene') as HTMLCanvasElement

// --- Renderer & Szene --------------------------------------------------------
const renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true })
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
renderer.setSize(window.innerWidth, window.innerHeight)

const scene = new Scene()
const BACKGROUND = new Color('#dbe3ea')
scene.background = BACKGROUND

// Rasen und Himmelskuppel rund um das Haus.
const environment = new Environment()
scene.add(environment.group)

scene.add(new HemisphereLight(0xffffff, 0xb9b0a2, 1.25))
const sun = new DirectionalLight(0xffffff, 1.5)
sun.position.set(4, 7, 3)
scene.add(sun)
const fill = new DirectionalLight(0xffffff, 0.45)
fill.position.set(-5, 4, -4)
scene.add(fill)

// --- Zustand & Raum ----------------------------------------------------------
/** `#s=…` in der Adresse hat Vorrang vor dem lokal gespeicherten Stand. */
const initialToken = tokenFromLocation()
let loadingSharedState = initialToken !== null
const store = new Store(forceDefault ? defaultProject() : undefined)
const roomGroup = new Group()
roomGroup.name = 'room'
scene.add(roomGroup)

const roomView = new RoomView(store.room)
roomGroup.add(roomView.group)

const layer = new ElementsLayer()
roomGroup.add(layer.group)

const editor = new Editor(store, layer, roomView)
scene.add(editor.handles, editor.hoverOutline)

const views = new Views(canvas, store.room)

/**
 * Spieler-Rig: Kamera und XR-Controller hängen darin, sodass sich der Nutzer in
 * der Szene bewegen kann, ohne die Welt zu verschieben.
 */
const player = new Group()
player.name = 'player'
player.add(views.perspective)
scene.add(player)

/** Der Raum wird um den Ursprung zentriert – in XR steht man dann mittendrin. */
function layoutRoom(room: RoomSpec): void {
  const b = bounds(room)
  roomGroup.position.set(-b.centerX, 0, -b.centerZ)
  roomView.update(room)
}

/** Rechnet Grundriss-Koordinaten (Meter) in Weltkoordinaten um. */
function roomToWorld(x: number, y: number, z: number): Vector3 {
  return new Vector3(x, y, z).add(roomGroup.position)
}

// --- Teilbare URL ------------------------------------------------------------
const shareListeners = new Set<(url: string) => void>()
let shareTimer: number | undefined
let lastShareUrl = ''

/**
 * Schreibt den kompletten Zustand als komprimiertes Fragment in die Adresse.
 * Entprellt, damit das Ziehen eines Elements nicht bei jedem Frame kodiert.
 */
function scheduleShareUpdate(): void {
  window.clearTimeout(shareTimer)
  shareTimer = window.setTimeout(async () => {
    const url = shareUrl(await encodeState(store.state))
    if (url === lastShareUrl) return
    lastShareUrl = url
    history.replaceState(null, '', url)
    for (const listener of shareListeners) listener(url)
  }, 200)
}

if (initialToken) {
  void decodeState(initialToken)
    .then((state) => {
      if (state) store.replace(state)
      else console.warn('Der Link enthielt keinen lesbaren Zustand.')
    })
    .finally(() => {
      loadingSharedState = false
    })
}

// Wird ein anderer Link in dieselbe Seite eingefügt, direkt übernehmen.
window.addEventListener('hashchange', () => {
  const token = tokenFromLocation()
  if (!token || shareUrl(token) === lastShareUrl) return
  void decodeState(token).then((state) => {
    if (state) {
      editor.select(null)
      store.replace(state)
    }
  })
})

let lastRoom: RoomSpec | null = null
store.subscribe((state) => {
  if (state.room !== lastRoom) {
    layoutRoom(state.room)
    if (lastRoom) views.setRoom(state.room)
    lastRoom = state.room
  }
  layer.sync(state.elements)
  editor.updateHandles()
  scheduleShareUpdate()
})

function placeElement(def: ElementDef, worldPoint?: Vector3): void {
  const local = worldPoint ? roomGroup.worldToLocal(worldPoint.clone()) : undefined
  const el = store.addFromDef(def, local ? { x: local.x, z: local.z } : undefined)
  editor.select(el.id)
}

// --- XR ----------------------------------------------------------------------
const xr = new XRManager({
  renderer,
  scene,
  editor,
  store,
  roomView,
  player,
  catalog: CATALOG,
  placeElement,
  onSessionChange: (presenting) => {
    const passthrough = presenting && isTransparentSession()
    scene.background = passthrough ? null : BACKGROUND
    environment.setVisible(!passthrough)
    views.controls.enabled = !presenting
  },
})

function isTransparentSession(): boolean {
  const blend = renderer.xr.getSession()?.environmentBlendMode
  return blend !== undefined && blend !== 'opaque'
}

// --- UI ----------------------------------------------------------------------
setupUI({
  store,
  editor,
  catalog: CATALOG,
  placeElement: (def) => placeElement(def),
  setView: (mode) => {
    views.setMode(mode, store.room)
    editor.setHiddenAxes(mode === 'top' ? ['y'] : [])
  },
  onShareUrl: (listener) => shareListeners.add(listener),
})
xr.createButtons(document.getElementById('xr-buttons')!)
if (!showUI) document.body.classList.add('no-ui')

/** Blick in die Küche – derselbe Ausschnitt wie im README-Screenshot. */
function focusKitchen(): void {
  views.focus(roomToWorld(5.2, 1.75, 0.7), roomToWorld(0.9, 1.0, 2.5))
}

/** `?cam=px,py,pz,tx,ty,tz` (Grundriss-Meter) – zum Einrichten eigener Ansichten. */
const camParam = params.get('cam')?.split(',').map(Number)
const startView = params.get('view')
if (camParam?.length === 6 && camParam.every((n) => Number.isFinite(n))) {
  views.focus(roomToWorld(camParam[0], camParam[1], camParam[2]), roomToWorld(camParam[3], camParam[4], camParam[5]))
} else if (startView === 'kitchen') focusKitchen()
else if (startView === 'isometric' || startView === 'top') {
  views.setMode(startView as ViewMode, store.room)
  editor.setHiddenAxes(startView === 'top' ? ['y'] : [])
  for (const b of document.querySelectorAll<HTMLButtonElement>('button[data-view]')) {
    b.classList.toggle('active', b.dataset.view === startView)
  }
}

// --- Maus / Touch ------------------------------------------------------------
const raycaster = new Raycaster()
const pointer = new Vector2()

function rayFromEvent(e: PointerEvent): Ray {
  const rect = canvas.getBoundingClientRect()
  pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1
  pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1
  raycaster.setFromCamera(pointer, views.camera)
  return raycaster.ray.clone()
}

canvas.addEventListener(
  'pointerdown',
  (e) => {
    if (xr.isPresenting || e.button !== 0) return
    if (editor.pointerDown(rayFromEvent(e), e.shiftKey)) {
      views.controls.enabled = false
      canvas.setPointerCapture(e.pointerId)
    }
  },
  { capture: true },
)
canvas.addEventListener('pointermove', (e) => {
  if (xr.isPresenting) return
  editor.pointerMove(rayFromEvent(e))
  if (editor.isDragging) {
    canvas.style.cursor = 'grabbing'
    return
  }
  const kind = editor.hover(rayFromEvent(e))
  canvas.style.cursor =
    kind === 'paint' ? 'crosshair' : kind === 'handle' ? 'grab' : kind === 'element' ? 'pointer' : ''
})
const endPointer = (e: PointerEvent): void => {
  if (editor.isDragging) {
    editor.pointerUp()
    canvas.style.cursor = ''
  }
  if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId)
  if (!xr.isPresenting) views.controls.enabled = true
}
canvas.addEventListener('pointerup', endPointer)
canvas.addEventListener('pointercancel', endPointer)

// --- Tastatur ----------------------------------------------------------------
window.addEventListener('keydown', (e) => {
  const target = e.target as HTMLElement | null
  if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return
  if (e.key === 'p' || e.key === 'P') {
    editor.setTool(editor.tool === 'paint' ? 'edit' : 'paint')
    return
  }
  if (e.key === 'v' || e.key === 'V') {
    editor.setTool(editor.tool === 'view' ? 'edit' : 'view')
    return
  }
  if (e.key === 'Escape') {
    if (editor.tool !== 'edit') editor.setTool('edit')
    else editor.select(null)
    return
  }
  if (editor.selectedIds.length === 0) return
  if (e.key === 'Delete' || e.key === 'Backspace') {
    for (const id of [...editor.selectedIds]) store.removeElement(id)
  } else if (e.key === 'r' || e.key === 'R') editor.rotateSelected()
  else if (e.key === 'e' || e.key === 'E') {
    editor.setEditPhase(editor.editPhase === 'transform' ? 'select' : 'transform')
  }
})

// --- Resize & Render-Loop ----------------------------------------------------
function onResize(): void {
  renderer.setSize(window.innerWidth, window.innerHeight)
  views.resize(window.innerWidth, window.innerHeight)
}
window.addEventListener('resize', onResize)
onResize()

const tmp = new Vector3()
let frames = 0
renderer.setAnimationLoop(() => {
  if (xr.isPresenting) {
    xr.update()
    roomView.updateVisibility(renderer.xr.getCamera().getWorldPosition(tmp))
  } else {
    views.update()
    roomView.updateVisibility(views.camera.getWorldPosition(tmp))
    const mesh = layer.getMesh(editor.selectedId)
    if (mesh && editor.handles.visible) {
      mesh.getWorldPosition(tmp)
      editor.setHandleRadius(views.handleRadius(tmp))
    }
  }
  // In XR rendert three.js immer perspektivisch – die Kamera muss im Rig hängen.
  renderer.render(scene, xr.isPresenting ? views.perspective : views.camera)
  frames += 1
  if (frames >= 3 && !loadingSharedState) api.ready = true
})

/** Kleine Schnittstelle für den automatischen Screenshot (siehe scripts/screenshot.mjs). */
const api = {
  ready: false,
  store,
  editor,
  views,
  focusKitchen,
  setView: (mode: ViewMode) => views.setMode(mode, store.room),
}
;(window as unknown as { __roomVisualizer: typeof api }).__roomVisualizer = api
