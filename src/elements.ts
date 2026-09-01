import {
  BoxGeometry,
  Color,
  EdgesGeometry,
  Group,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshStandardMaterial,
} from 'three'
import type { PlacedElement } from './types'

const SELECTED_EMISSIVE = new Color('#2f74c0')
const BLACK = new Color(0x000000)

/** Einheitswürfel, Ursprung unten-mittig (wie PlacedElement.position). */
const UNIT_BOX = new BoxGeometry(1, 1, 1).translate(0, 0.5, 0)
const UNIT_EDGES = new EdgesGeometry(UNIT_BOX)
const EDGE_MATERIAL = new LineBasicMaterial({ color: 0x333333, transparent: true, opacity: 0.6 })

export class ElementsLayer {
  readonly group = new Group()
  private meshes = new Map<string, Mesh>()
  private selectedId: string | null = null

  constructor() {
    this.group.name = 'elements'
  }

  get pickables(): Mesh[] {
    return [...this.meshes.values()]
  }

  getMesh(id: string | null | undefined): Mesh | undefined {
    return id ? this.meshes.get(id) : undefined
  }

  /** Bringt die Meshes mit dem Zustand des Stores in Einklang. */
  sync(elements: PlacedElement[]): void {
    const seen = new Set<string>()
    for (const el of elements) {
      seen.add(el.id)
      let mesh = this.meshes.get(el.id)
      if (!mesh) {
        mesh = this.createMesh(el)
        this.meshes.set(el.id, mesh)
        this.group.add(mesh)
      }
      this.applyState(mesh, el)
    }
    for (const [id, mesh] of this.meshes) {
      if (!seen.has(id)) {
        this.group.remove(mesh)
        ;(mesh.material as MeshStandardMaterial).dispose()
        this.meshes.delete(id)
      }
    }
    this.setSelected(this.selectedId)
  }

  setSelected(id: string | null): void {
    this.selectedId = id
    for (const [meshId, mesh] of this.meshes) {
      const mat = mesh.material as MeshStandardMaterial
      mat.emissive.copy(meshId === id ? SELECTED_EMISSIVE : BLACK)
      mat.emissiveIntensity = 0.35
    }
  }

  private createMesh(el: PlacedElement): Mesh {
    const material = new MeshStandardMaterial({ color: new Color(el.color), roughness: 0.7, metalness: 0.05 })
    const mesh = new Mesh(UNIT_BOX, material)
    mesh.name = el.name
    mesh.userData.elementId = el.id
    mesh.castShadow = false
    const edges = new LineSegments(UNIT_EDGES, EDGE_MATERIAL)
    edges.name = 'edges'
    edges.raycast = () => undefined // Kanten nicht anklickbar
    mesh.add(edges)
    return mesh
  }

  private applyState(mesh: Mesh, el: PlacedElement): void {
    mesh.position.set(el.position.x, el.position.y, el.position.z)
    mesh.scale.set(el.size.w, el.size.h, el.size.d)
    mesh.rotation.y = el.rotationY
    mesh.name = el.name
    const mat = mesh.material as MeshStandardMaterial
    if (`#${mat.color.getHexString()}` !== el.color.toLowerCase()) mat.color.set(el.color)
  }
}
