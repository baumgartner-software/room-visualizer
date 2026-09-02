import {
  BufferGeometry,
  CanvasTexture,
  Float32BufferAttribute,
  Group,
  Line,
  LineBasicMaterial,
  Sprite,
  SpriteMaterial,
  SRGBColorSpace,
  Vector3,
} from 'three'

interface Entry {
  line: Line
  label: Sprite
}

const LINE_COLOR = 0xffd23f
const PREVIEW_COLOR = 0x8fd0ff

/**
 * Messwerkzeug: zwei Punkte antippen, dazwischen erscheinen eine Linie und der
 * Abstand in Zentimetern. Die Messungen gehören nicht zum Projektzustand – sie
 * sind eine Arbeitshilfe und verschwinden mit dem Zurücksetzen.
 */
export class MeasureLayer {
  readonly group = new Group()
  private readonly entries: Entry[] = []
  private readonly preview: Entry
  private start: Vector3 | null = null

  constructor() {
    this.group.name = 'measurements'
    this.preview = makeEntry(PREVIEW_COLOR)
    this.preview.line.visible = false
    this.preview.label.visible = false
    this.group.add(this.preview.line, this.preview.label)
  }

  get hasStart(): boolean {
    return this.start !== null
  }

  get count(): number {
    return this.entries.length
  }

  /** Erster oder zweiter Punkt – je nachdem, was gerade offen ist. */
  addPoint(point: Vector3): void {
    if (!this.start) {
      this.start = point.clone()
      return
    }
    const entry = makeEntry(LINE_COLOR)
    setEntry(entry, this.start, point)
    this.group.add(entry.line, entry.label)
    this.entries.push(entry)
    this.start = null
    this.updatePreview(null)
  }

  /** Live-Linie zum Punkt unter dem Zeiger, solange eine Messung offen ist. */
  updatePreview(point: Vector3 | null): void {
    const active = !!this.start && !!point
    this.preview.line.visible = active
    this.preview.label.visible = active
    if (active) setEntry(this.preview, this.start!, point!)
  }

  /** Nimmt die letzte Messung zurück bzw. bricht eine offene ab. */
  undo(): void {
    if (this.start) {
      this.start = null
      this.updatePreview(null)
      return
    }
    const entry = this.entries.pop()
    if (!entry) return
    this.group.remove(entry.line, entry.label)
    disposeEntry(entry)
  }

  clear(): void {
    for (const entry of this.entries) {
      this.group.remove(entry.line, entry.label)
      disposeEntry(entry)
    }
    this.entries.length = 0
    this.start = null
    this.updatePreview(null)
  }
}

function makeEntry(color: number): Entry {
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new Float32BufferAttribute([0, 0, 0, 0, 0, 0], 3))
  const line = new Line(geometry, new LineBasicMaterial({ color, depthTest: false, transparent: true }))
  line.renderOrder = 1200
  line.raycast = () => undefined

  const label = new Sprite(new SpriteMaterial({ depthTest: false, transparent: true }))
  label.scale.set(0.26, 0.1, 1)
  label.renderOrder = 1201
  return { line, label }
}

function setEntry(entry: Entry, a: Vector3, b: Vector3): void {
  const position = entry.line.geometry.getAttribute('position')
  position.setXYZ(0, a.x, a.y, a.z)
  position.setXYZ(1, b.x, b.y, b.z)
  position.needsUpdate = true
  entry.line.geometry.computeBoundingSphere()

  entry.label.position.copy(a).add(b).multiplyScalar(0.5)
  const material = entry.label.material as SpriteMaterial
  material.map?.dispose()
  material.map = makeLabelTexture(`${Math.round(a.distanceTo(b) * 100)} cm`)
  material.needsUpdate = true
}

function disposeEntry(entry: Entry): void {
  entry.line.geometry.dispose()
  ;(entry.label.material as SpriteMaterial).map?.dispose()
}

function makeLabelTexture(text: string): CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = 256
  canvas.height = 96
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = 'rgba(17, 24, 35, 0.92)'
  ctx.beginPath()
  ctx.roundRect(4, 4, canvas.width - 8, canvas.height - 8, 18)
  ctx.fill()
  ctx.strokeStyle = '#ffd23f'
  ctx.lineWidth = 3
  ctx.stroke()
  ctx.fillStyle = '#ffffff'
  ctx.font = "700 40px system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif"
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(text, canvas.width / 2, canvas.height / 2 + 2)
  const texture = new CanvasTexture(canvas)
  texture.colorSpace = SRGBColorSpace
  return texture
}
