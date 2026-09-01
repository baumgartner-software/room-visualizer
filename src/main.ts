import './style.css'
import { Color, DirectionalLight, Group, HemisphereLight, Ray, Raycaster, Scene, Vector2, Vector3, WebGLRenderer } from 'three'
import { CATALOG } from './catalog'
import { Editor } from './editor'
import { ElementsLayer } from './elements'
import { RoomView } from './room'
import { Store } from './store'
import type { ElementDef, RoomSpec } from './types'
import { setupUI } from './ui'
import { Views } from './views'
import { XRManager } from './xr'

const canvas = document.getElementById('scene') as HTMLCanvasElement

// --- Renderer & Szene --------------------------------------------------------
const renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true })
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
renderer.setSize(window.innerWidth, window.innerHeight)

const scene = new Scene()
const BACKGROUND = new Color('#1b1f27')
scene.background = BACKGROUND

scene.add(new HemisphereLight(0xffffff, 0x6b6257, 1.1))
const sun = new DirectionalLight(0xffffff, 1.4)
sun.position.set(3, 6, 2)
scene.add(sun)
const fill = new DirectionalLight(0xffffff, 0.4)
fill.position.set(-4, 3, -3)
scene.add(fill)

// --- Zustand & Raum ----------------------------------------------------------
const store = new Store()
const roomGroup = new Group()
roomGroup.name = 'room'
scene.add(roomGroup)

const roomView = new RoomView(store.room)
roomGroup.add(roomView.group)

const layer = new ElementsLayer()
roomGroup.add(layer.group)

const editor = new Editor(store, layer)
scene.add(editor.handles)

const views = new Views(canvas, store.room)

function layoutRoom(room: RoomSpec): void {
  // Raum um den Ursprung zentrieren – in XR steht der Nutzer damit in der Raummitte.
  roomGroup.position.set(-room.width / 2, 0, -room.depth / 2)
  roomView.update(room)
}

let lastRoom: RoomSpec | null = null
store.subscribe((state) => {
  const roomChanged =
    !lastRoom ||
    lastRoom.width !== state.room.width ||
    lastRoom.depth !== state.room.depth ||
    lastRoom.height !== state.room.height
  if (roomChanged) {
    layoutRoom(state.room)
    if (lastRoom) views.setRoom(state.room)
    lastRoom = { ...state.room }
  }
  layer.sync(state.elements)
  editor.updateHandles()
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
  roomGroup,
  catalog: CATALOG,
  placeElement,
  onSessionChange: (presenting) => {
    scene.background = presenting && roomView.floor.material && isTransparentSession() ? null : BACKGROUND
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
})
xr.createButtons(document.getElementById('xr-buttons')!)

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
    if (editor.pointerDown(rayFromEvent(e))) {
      views.controls.enabled = false
      canvas.setPointerCapture(e.pointerId)
    }
  },
  { capture: true },
)
canvas.addEventListener('pointermove', (e) => {
  if (xr.isPresenting) return
  editor.pointerMove(rayFromEvent(e))
  if (!editor.isDragging) {
    const kind = editor.hover(rayFromEvent(e))
    canvas.style.cursor = kind === 'handle' ? 'grab' : kind === 'element' ? 'pointer' : ''
  } else {
    canvas.style.cursor = 'grabbing'
  }
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
  if (!editor.selectedId) return
  if (e.key === 'Delete' || e.key === 'Backspace') store.removeElement(editor.selectedId)
  else if (e.key === 'r' || e.key === 'R') store.rotateElement(editor.selectedId)
  else if (e.key === 'Escape') editor.select(null)
  else if (e.key === 'e' || e.key === 'E') {
    editor.setEditMode(!editor.editMode)
    const box = document.getElementById('edit-mode') as HTMLInputElement | null
    if (box) box.checked = editor.editMode
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
renderer.setAnimationLoop(() => {
  if (xr.isPresenting) {
    xr.update()
  } else {
    views.update()
    const mesh = layer.getMesh(editor.selectedId)
    if (mesh && editor.handles.visible) {
      mesh.getWorldPosition(tmp)
      editor.setHandleRadius(views.handleRadius(tmp))
    }
  }
  renderer.render(scene, views.camera)
})
