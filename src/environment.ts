import {
  BackSide,
  CanvasTexture,
  Color,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  SphereGeometry,
  SRGBColorSpace,
} from 'three'

/**
 * Umgebung außerhalb des Hauses: Rasenfläche und Himmelskuppel. Beides liegt
 * außerhalb der Raumgruppe, bleibt also stehen, wenn sich der Grundriss ändert.
 */
export class Environment {
  readonly group = new Group()
  private readonly ground: Mesh
  private readonly sky: Mesh

  constructor() {
    this.group.name = 'environment'

    this.ground = new Mesh(
      new PlaneGeometry(600, 600),
      new MeshStandardMaterial({ color: new Color('#6f9c53'), roughness: 1, map: lawnTexture() }),
    )
    this.ground.name = 'lawn'
    this.ground.rotation.x = -Math.PI / 2
    // Knapp unter dem Hausboden, damit nichts flimmert.
    this.ground.position.y = -0.03
    this.ground.raycast = () => undefined

    this.sky = new Mesh(
      new SphereGeometry(300, 32, 16),
      new MeshBasicMaterial({ map: skyTexture(), side: BackSide, depthWrite: false }),
    )
    this.sky.name = 'sky'
    this.sky.raycast = () => undefined

    this.group.add(this.sky, this.ground)
  }

  /** In AR/Passthrough gehören Rasen und Himmel nicht ins Bild. */
  setVisible(visible: boolean): void {
    this.group.visible = visible
  }
}

/** Verlauf von Horizontblau nach Himmelblau. */
function skyTexture(): CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = 4
  canvas.height = 256
  const ctx = canvas.getContext('2d')!
  const gradient = ctx.createLinearGradient(0, canvas.height, 0, 0)
  // v = 0.5 ist der Horizont der Kuppel.
  gradient.addColorStop(0, '#c3d6b2')
  gradient.addColorStop(0.49, '#e2eef8')
  gradient.addColorStop(0.53, '#a8cbe8')
  gradient.addColorStop(0.66, '#6ea3d6')
  gradient.addColorStop(1, '#2f66aa')
  ctx.fillStyle = gradient
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  const texture = new CanvasTexture(canvas)
  texture.colorSpace = SRGBColorSpace
  return texture
}

/** Grobe Grasstruktur, damit die Fläche nicht als Farbfleck wirkt. */
function lawnTexture(): CanvasTexture {
  const size = 128
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, size, size)
  for (let i = 0; i < 900; i++) {
    const shade = 210 + Math.floor(Math.random() * 45)
    ctx.fillStyle = `rgb(${shade}, ${shade}, ${shade})`
    ctx.fillRect(Math.random() * size, Math.random() * size, 2, 3)
  }
  const texture = new CanvasTexture(canvas)
  texture.colorSpace = SRGBColorSpace
  texture.wrapS = texture.wrapT = 1000 // RepeatWrapping
  texture.repeat.set(300, 300)
  return texture
}
