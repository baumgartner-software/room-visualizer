import { Camera, OrthographicCamera, PerspectiveCamera, Vector3 } from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { bounds } from './geometry'
import type { Bounds, RoomSpec } from './types'

export type ViewMode = 'perspective' | 'isometric' | 'top'

export const VIEW_LABELS: Record<ViewMode, string> = {
  perspective: '3D',
  isometric: 'Isometrisch',
  top: '2D (Grundriss)',
}

/**
 * Verwaltet die Nicht-XR-Kameras: perspektivische 3D-Ansicht, isometrische
 * Ansicht und 2D-Draufsicht. Der Raum ist um den Ursprung zentriert, das
 * Orbit-Ziel liegt daher bei (0, h/2, 0).
 */
export class Views {
  mode: ViewMode = 'perspective'
  readonly perspective: PerspectiveCamera
  readonly ortho: OrthographicCamera
  controls: OrbitControls
  camera: Camera
  private aspect = 1
  private b: Bounds

  constructor(
    private domElement: HTMLElement,
    private room: RoomSpec,
  ) {
    this.b = bounds(room)
    this.perspective = new PerspectiveCamera(60, 1, 0.05, 200)
    this.ortho = new OrthographicCamera(-1, 1, 1, -1, -100, 200)
    this.camera = this.perspective
    this.controls = new OrbitControls(this.perspective, domElement)
    this.resize(domElement.clientWidth || 1, domElement.clientHeight || 1)
    this.setMode('perspective', room)
  }

  get isOrtho(): boolean {
    return this.camera === this.ortho
  }

  resize(width: number, height: number): void {
    this.aspect = width / Math.max(height, 1)
    this.perspective.aspect = this.aspect
    this.perspective.updateProjectionMatrix()
    this.updateOrthoFrustum()
  }

  setRoom(room: RoomSpec): void {
    this.room = room
    this.b = bounds(room)
    this.updateOrthoFrustum()
    this.controls.target.copy(this.target())
    this.controls.update()
  }

  setMode(mode: ViewMode, room: RoomSpec = this.room): void {
    this.mode = mode
    this.room = room
    this.b = bounds(room)
    const target = this.target()
    const size = Math.max(this.b.width, this.b.depth, room.height)
    this.controls.dispose()

    if (mode === 'perspective') {
      this.camera = this.perspective
      this.perspective.up.set(0, 1, 0)
      this.perspective.position.set(size * 0.3, room.height * 1.2, this.b.depth / 2 + size * 0.95)
      this.controls = new OrbitControls(this.perspective, this.domElement)
      this.controls.enableRotate = true
    } else if (mode === 'isometric') {
      this.camera = this.ortho
      this.ortho.up.set(0, 1, 0)
      this.ortho.position.copy(target).add(new Vector3(1, 1, 1).normalize().multiplyScalar(size * 4))
      this.ortho.zoom = 1
      this.controls = new OrbitControls(this.ortho, this.domElement)
      this.controls.enableRotate = true
    } else {
      this.camera = this.ortho
      this.ortho.up.set(0, 0, -1)
      this.ortho.position.set(target.x, size * 4, target.z)
      this.ortho.zoom = 1
      this.controls = new OrbitControls(this.ortho, this.domElement)
      this.controls.enableRotate = false
      this.controls.screenSpacePanning = true
    }
    this.updateOrthoFrustum()
    this.controls.target.copy(target)
    this.controls.enableDamping = false
    this.controls.mouseButtons.LEFT = this.controls.enableRotate ? 0 : 2 // 0 = ROTATE, 2 = PAN
    this.controls.update()
  }

  /** Freie Kameraposition, z. B. für den automatischen Screenshot. */
  focus(position: Vector3, target: Vector3): void {
    this.mode = 'perspective'
    this.camera = this.perspective
    this.perspective.up.set(0, 1, 0)
    this.perspective.position.copy(position)
    this.controls.dispose()
    this.controls = new OrbitControls(this.perspective, this.domElement)
    this.controls.enableDamping = false
    this.controls.target.copy(target)
    this.controls.update()
  }

  update(): void {
    this.controls.update()
  }

  /** Skalierungsfaktor für Griffe, damit sie in jeder Ansicht greifbar bleiben. */
  handleRadius(worldPoint: Vector3): number {
    if (this.isOrtho) {
      return clampNum((0.04 * Math.max(this.b.width, this.b.depth, this.room.height)) / 4 / this.ortho.zoom, 0.02, 0.25)
    }
    const dist = this.perspective.position.distanceTo(worldPoint)
    return clampNum(dist * 0.012, 0.015, 0.15)
  }

  private target(): Vector3 {
    return new Vector3(0, this.mode === 'top' ? 0 : this.room.height / 2, 0)
  }

  private updateOrthoFrustum(): void {
    const half = Math.max(this.b.width, this.b.depth, this.room.height) * 0.62
    this.ortho.left = -half * this.aspect
    this.ortho.right = half * this.aspect
    this.ortho.top = half
    this.ortho.bottom = -half
    this.ortho.updateProjectionMatrix()
  }
}

function clampNum(v: number, min: number, max: number): number {
  return Math.min(Math.max(v, min), max)
}
