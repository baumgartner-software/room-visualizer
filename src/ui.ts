import { DESKTOP_CONTROLS, renderHelpCanvas } from './controllerHelp'
import { TOOL_LABELS, type Editor, type Tool } from './editor'
import { bounds } from './geometry'
import type { Store } from './store'
import type { ElementDef, PlacedElement, ProjectState } from './types'
import { VIEW_LABELS, type ViewMode } from './views'

export interface UIOptions {
  store: Store
  editor: Editor
  roomView: { setWallsVisible: (v: boolean) => void; setFloorVisible: (v: boolean) => void }
  measure: { undo: () => void; clear: () => void }
  catalog: ElementDef[]
  placeElement: (def: ElementDef) => void
  setView: (mode: ViewMode) => void
  /** Meldet die aktuelle Teilen-URL (in main.ts gebündelt und entprellt). */
  onShareUrl: (listener: (url: string) => void) => void
}

/** Farbpalette des Pinsel-Werkzeugs. */
export const PALETTE: { color: string; name: string }[] = [
  { color: '#ffffff', name: 'Weiß' },
  { color: '#f2efe8', name: 'Creme' },
  { color: '#ded7cc', name: 'Sand' },
  { color: '#b9b3a8', name: 'Graubeige' },
  { color: '#7d7f83', name: 'Grau' },
  { color: '#1e1f22', name: 'Schwarz' },
  { color: '#c9a063', name: 'Eiche' },
  { color: '#8a5a34', name: 'Nussbaum' },
  { color: '#d8bd99', name: 'Heller Holzboden' },
  { color: '#3f5d4a', name: 'Salbeigrün' },
  { color: '#2f4f6f', name: 'Petrolblau' },
  { color: '#7a2f2f', name: 'Bordeaux' },
]

const cm = (m: number): string => String(Math.round(m * 100))
const m = (cmValue: string | number): number => Number(cmValue) / 100

function $<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id)
  if (!el) throw new Error(`Element #${id} fehlt in index.html`)
  return el as T
}

/** Verdrahtet das HTML-Seitenpanel mit Store und Editor. */
export function setupUI(o: UIOptions): void {
  const { store, editor, catalog } = o

  const panel = $('panel')
  $('toggle-panel').addEventListener('click', () => panel.classList.toggle('collapsed'))

  // --- Steuerungs-Hilfe ------------------------------------------------------
  $('help-figure').replaceChildren(renderHelpCanvas(2))
  const desktopList = $('help-desktop')
  for (const hint of DESKTOP_CONTROLS) {
    const dt = document.createElement('dt')
    dt.textContent = hint.key
    const dd = document.createElement('dd')
    dd.textContent = hint.action
    desktopList.append(dt, dd)
  }
  const help = $('help')
  const helpToggle = $<HTMLButtonElement>('help-toggle')
  const setHelpOpen = (open: boolean): void => {
    help.classList.toggle('collapsed', !open)
    helpToggle.setAttribute('aria-expanded', String(open))
    try {
      localStorage.setItem('room-visualizer:help-open', open ? '1' : '0')
    } catch {
      /* Speicher nicht verfügbar – Zustand gilt nur für diese Sitzung */
    }
  }
  // Standardmäßig eingeklappt – die Karte holt man sich über den Knopf dazu.
  let helpOpen = false
  try {
    helpOpen = localStorage.getItem('room-visualizer:help-open') === '1'
  } catch {
    /* Standard: eingeklappt */
  }
  setHelpOpen(helpOpen)
  helpToggle.addEventListener('click', () => setHelpOpen(help.classList.contains('collapsed')))

  // --- Werkzeuge -------------------------------------------------------------
  const toolButtons = [...document.querySelectorAll<HTMLButtonElement>('button[data-tool]')]
  for (const btn of toolButtons) {
    btn.textContent = TOOL_LABELS[btn.dataset.tool as Tool]
    btn.addEventListener('click', () => editor.setTool(btn.dataset.tool as Tool))
  }
  const measureSection = $('measure-section')
  const renderTool = (tool: Tool): void => {
    for (const b of toolButtons) b.classList.toggle('active', b.dataset.tool === tool)
    document.body.classList.toggle('painting', tool === 'paint' || tool === 'measure')
    document.body.classList.toggle('viewing', tool === 'view')
    measureSection.hidden = tool !== 'measure'
  }
  editor.addToolListener(renderTool)
  renderTool(editor.tool)

  // --- Ansichten -------------------------------------------------------------
  const viewButtons = [...document.querySelectorAll<HTMLButtonElement>('button[data-view]')]
  for (const btn of viewButtons) {
    const mode = btn.dataset.view as ViewMode
    btn.textContent = VIEW_LABELS[mode]
    btn.addEventListener('click', () => {
      o.setView(mode)
      for (const b of viewButtons) b.classList.toggle('active', b === btn)
    })
  }

  // --- Raum ------------------------------------------------------------------
  const roomHeight = $<HTMLInputElement>('room-height')
  roomHeight.addEventListener('change', () => store.setRoomHeight(m(roomHeight.value)))
  $('room-plan').addEventListener('click', () => {
    if (confirm('Grundriss aus dem Bauplan laden? Platzierte Elemente bleiben erhalten.')) {
      const elements = store.state.elements
      store.reset()
      store.replace({ version: 2, room: store.room, elements })
    }
  })
  const showWalls = $<HTMLInputElement>('show-walls')
  const showFloor = $<HTMLInputElement>('show-floor')
  showWalls.addEventListener('change', () => o.roomView.setWallsVisible(showWalls.checked))
  showFloor.addEventListener('change', () => o.roomView.setFloorVisible(showFloor.checked))
  $('measure-undo').addEventListener('click', () => o.measure.undo())
  $('measure-clear').addEventListener('click', () => o.measure.clear())

  $('room-rect').addEventListener('click', () => {
    store.setRectangularRoom(m($<HTMLInputElement>('room-width').value), m($<HTMLInputElement>('room-depth').value))
  })

  // --- Farbpalette -----------------------------------------------------------
  const paletteEl = $('palette')
  const customColor = $<HTMLInputElement>('paint-color')
  const swatches = new Map<string, HTMLButtonElement>()
  for (const { color, name } of PALETTE) {
    const btn = document.createElement('button')
    btn.className = 'swatch-btn'
    btn.style.background = color
    btn.title = `${name} – als Pinselfarbe wählen`
    btn.setAttribute('aria-label', name)
    btn.addEventListener('click', () => pickColor(color))
    swatches.set(color, btn)
    paletteEl.appendChild(btn)
  }
  customColor.addEventListener('input', () => pickColor(customColor.value))

  /** Farbe wählen heißt gleichzeitig: auf das Werkzeug „Farbe“ wechseln. */
  function pickColor(color: string): void {
    editor.setPaintColor(color)
    editor.setTool('paint')
    markColor(color)
  }

  function markColor(color: string): void {
    customColor.value = color
    for (const [c, btn] of swatches) btn.classList.toggle('active', c === color)
  }
  editor.addPaintColorListener(markColor)
  markColor(editor.paintColor)

  // --- Katalog ---------------------------------------------------------------
  const catalogEl = $('catalog')
  for (const def of catalog) {
    const btn = document.createElement('button')
    btn.className = 'catalog-item'
    btn.innerHTML = `<span class="swatch" style="background:${def.color}"></span><span class="label"></span><span class="dims">${cm(def.size.w)}×${cm(def.size.h)}×${cm(def.size.d)}</span>`
    btn.querySelector('.label')!.textContent = def.name
    btn.title = def.description ?? `${def.name} platzieren`
    btn.addEventListener('click', () => o.placeElement(def))
    catalogEl.appendChild(btn)
  }

  // --- Auswahl ---------------------------------------------------------------
  const selEmpty = $('selection-empty')
  const selForm = $('selection-form')
  const sel = {
    name: $<HTMLInputElement>('sel-name'),
    w: $<HTMLInputElement>('sel-w'),
    h: $<HTMLInputElement>('sel-h'),
    d: $<HTMLInputElement>('sel-d'),
    x: $<HTMLInputElement>('sel-x'),
    y: $<HTMLInputElement>('sel-y'),
    z: $<HTMLInputElement>('sel-z'),
    color: $<HTMLInputElement>('sel-color'),
  }
  const applySelection = (): void => {
    const el = editor.selected
    if (!el) return
    store.updateElement(el.id, {
      name: sel.name.value || el.name,
      size: { w: m(sel.w.value), h: m(sel.h.value), d: m(sel.d.value) },
      position: { x: m(sel.x.value), y: m(sel.y.value), z: m(sel.z.value) },
      color: sel.color.value,
    })
  }
  for (const input of Object.values(sel)) input.addEventListener('change', applySelection)

  $('sel-rotate').addEventListener('click', () => editor.rotateSelected())
  $('sel-mirror').addEventListener('click', () => editor.mirrorSelected())
  $('sel-tilt-x').addEventListener('click', () => editor.tiltSelected('x'))
  $('sel-tilt-z').addEventListener('click', () => editor.tiltSelected('z'))
  $('sel-delete').addEventListener('click', () => {
    for (const id of [...editor.selectedIds]) store.removeElement(id)
  })
  $('sel-duplicate').addEventListener('click', () => {
    const copy = editor.selectedId ? store.duplicate(editor.selectedId) : undefined
    if (copy) editor.select(copy.id)
  })

  const phaseToggle = $<HTMLButtonElement>('phase-toggle')
  phaseToggle.addEventListener('click', () =>
    editor.setEditPhase(editor.editPhase === 'transform' ? 'select' : 'transform'),
  )
  $('sel-clear').addEventListener('click', () => editor.clearSelection())

  const renderSelection = (el: PlacedElement | undefined): void => {
    selEmpty.hidden = !!el
    selForm.hidden = !el
    if (!el) return
    const set = (input: HTMLInputElement, value: string): void => {
      if (document.activeElement !== input) input.value = value
    }
    set(sel.name, el.name)
    set(sel.w, cm(el.size.w))
    set(sel.h, cm(el.size.h))
    set(sel.d, cm(el.size.d))
    set(sel.x, cm(el.position.x))
    set(sel.y, cm(el.position.y))
    set(sel.z, cm(el.position.z))
    set(sel.color, el.color)
  }
  const selectionCount = $('selection-count')
  editor.addSelectionListener((ids, phase) => {
    renderSelection(store.getElement(ids.at(-1)))
    selectionCount.hidden = ids.length < 2
    selectionCount.textContent = `${ids.length} Objekte ausgewählt – Griffe bewegen alle gemeinsam`
    phaseToggle.textContent = phase === 'transform' ? 'Zurück zum Auswählen' : 'Griffe anzeigen'
    phaseToggle.classList.toggle('active', phase === 'transform')
    phaseToggle.disabled = ids.length === 0 && phase === 'select'
  })

  // --- Projekt ---------------------------------------------------------------
  $('export').addEventListener('click', () => {
    const blob = new Blob([store.toJSON()], { type: 'application/json' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = 'raum.json'
    a.click()
    URL.revokeObjectURL(a.href)
  })
  const importFile = $<HTMLInputElement>('import-file')
  $('import').addEventListener('click', () => importFile.click())
  importFile.addEventListener('change', async () => {
    const file = importFile.files?.[0]
    if (!file) return
    try {
      store.replace(JSON.parse(await file.text()) as ProjectState)
      editor.select(null)
    } catch (err) {
      alert(`Import fehlgeschlagen: ${(err as Error).message}`)
    }
    importFile.value = ''
  })
  $('clear').addEventListener('click', () => {
    if (confirm('Alle Elemente entfernen? Der Grundriss bleibt erhalten.')) {
      editor.select(null)
      store.clearElements()
    }
  })
  $('reset').addEventListener('click', () => {
    if (confirm('Grundriss und Küche auf den Auslieferungszustand zurücksetzen?')) {
      editor.select(null)
      store.reset()
    }
  })

  // --- Teilen ----------------------------------------------------------------
  const shareInput = $<HTMLInputElement>('share-url')
  const shareState = $<HTMLTextAreaElement>('share-state')
  const shareBox = $('share-state-box')
  $('share-toggle').addEventListener('click', () => {
    shareBox.hidden = !shareBox.hidden
    if (!shareBox.hidden) shareState.value = store.toJSON()
  })
  $('share-copy').addEventListener('click', async () => {
    const button = $<HTMLButtonElement>('share-copy')
    try {
      await navigator.clipboard.writeText(shareInput.value)
      button.textContent = 'Kopiert ✓'
    } catch {
      shareInput.select()
      button.textContent = 'Mit Strg+C kopieren'
    }
    setTimeout(() => (button.textContent = 'Link kopieren'), 2000)
  })
  $('share-apply').addEventListener('click', () => {
    try {
      store.replace(JSON.parse(shareState.value) as ProjectState)
      editor.select(null)
    } catch (err) {
      alert(`Zustand konnte nicht gelesen werden: ${(err as Error).message}`)
    }
  })

  // --- Store → UI ------------------------------------------------------------
  const roomInfo = $('room-info')
  o.onShareUrl((url) => {
    if (document.activeElement !== shareInput) shareInput.value = url
  })

  store.subscribe((state) => {
    if (!shareBox.hidden && document.activeElement !== shareState) shareState.value = store.toJSON()
    if (document.activeElement !== roomHeight) roomHeight.value = cm(state.room.height)
    const b = bounds(state.room)
    roomInfo.textContent = `${state.room.name} · ${cm(b.width)} × ${cm(b.depth)} cm`
    $('element-count').textContent = String(state.elements.length)
    renderSelection(editor.selected)
  })
}
