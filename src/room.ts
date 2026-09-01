import {
  BackSide,
  BufferGeometry,
  BoxGeometry,
  Color,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshStandardMaterial,
  PlaneGeometry,
} from 'three'
import type { RoomSpec } from './types'

/**
 * Darstellung des Raumes. Die Wände sind ein von innen sichtbarer Quader
 * (BackSide), sodass man von außen (3D/Iso/2D) hineinschauen kann und in VR
 * von innen die Wände sieht. Koordinatenursprung = linke vordere Bodenecke.
 */
export class RoomView {
  readonly group = new Group()
  readonly floor: Mesh
  private shell: Mesh
  private grid: LineSegments
  private readonly shellMaterial = new MeshStandardMaterial({
    color: new Color('#ebe6dd'),
    side: BackSide,
    roughness: 0.95,
    transparent: true,
    opacity: 1,
  })
  private readonly floorMaterial = new MeshStandardMaterial({
    color: new Color('#c9c2b6'),
    side: DoubleSide,
    roughness: 0.9,
    transparent: true,
    opacity: 1,
  })
  private readonly gridMaterial = new LineBasicMaterial({ color: 0x8a8378, transparent: true, opacity: 0.45 })

  constructor(spec: RoomSpec) {
    this.shell = new Mesh(new BoxGeometry(1, 1, 1), this.shellMaterial)
    this.shell.name = 'room-shell'
    this.floor = new Mesh(new PlaneGeometry(1, 1), this.floorMaterial)
    this.floor.name = 'room-floor'
    this.floor.rotation.x = -Math.PI / 2
    this.floor.userData.isFloor = true
    this.grid = new LineSegments(new BufferGeometry(), this.gridMaterial)
    this.grid.name = 'room-grid'
    this.group.add(this.shell, this.floor, this.grid)
    this.update(spec)
  }

  update(spec: RoomSpec): void {
    const { width: w, depth: d, height: h } = spec
    this.shell.scale.set(w, h, d)
    this.shell.position.set(w / 2, h / 2, d / 2)
    this.floor.scale.set(w, d, 1)
    this.floor.position.set(w / 2, 0.002, d / 2)
    this.grid.geometry.dispose()
    this.grid.geometry = makeGridGeometry(w, d, 0.5)
    this.grid.position.y = 0.004
  }

  /** Für AR/Passthrough: Wände und Boden halbtransparent darstellen. */
  setTransparent(transparent: boolean): void {
    this.shellMaterial.opacity = transparent ? 0.25 : 1
    this.floorMaterial.opacity = transparent ? 0.35 : 1
  }
}

function makeGridGeometry(w: number, d: number, step: number): BufferGeometry {
  const verts: number[] = []
  for (let x = 0; x <= w + 1e-6; x += step) verts.push(x, 0, 0, x, 0, d)
  for (let z = 0; z <= d + 1e-6; z += step) verts.push(0, 0, z, w, 0, z)
  const geo = new BufferGeometry()
  geo.setAttribute('position', new Float32BufferAttribute(verts, 3))
  return geo
}
