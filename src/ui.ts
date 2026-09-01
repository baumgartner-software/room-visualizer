import type { Editor } from './editor'
import type { Store } from './store'
import type { ElementDef, PlacedElement, ProjectState } from './types'
import { VIEW_LABELS, type ViewMode } from './views'

export interface UIOptions {
  store: Store
  editor: Editor
  catalog: ElementDef[]
  placeElement: (def: ElementDef) => void
  setView: (mode: ViewMode) => void
}

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

  // --- Panel ein-/ausblenden -------------------------------------------------
  const panel = $('panel')
  $('toggle-panel').addEventListener('click', () => panel.classList.toggle('collapsed'))

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
  const roomInputs = {
    width: $<HTMLInputElement>('room-width'),
    depth: $<HTMLInputElement>('room-depth'),
    height: $<HTMLInputElement>('room-height'),
  }
  for (const [key, input] of Object.entries(roomInputs)) {
    input.addEventListener('change', () => store.setRoom({ [key]: m(input.value) }))
  }

  // --- Katalog ---------------------------------------------------------------
  const catalogEl = $('catalog')
  for (const def of catalog) {
    const btn = document.createElement('button')
    btn.className = 'catalog-item'
    btn.innerHTML = `<span class="swatch" style="background:${def.color}"></span><span class="label">${def.name}</span><span class="dims">${cm(def.size.w)}×${cm(def.size.h)}×${cm(def.size.d)}</span>`
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

  $('sel-rotate').addEventListener('click', () => editor.selectedId && store.rotateElement(editor.selectedId))
  $('sel-delete').addEventListener('click', () => editor.selectedId && store.removeElement(editor.selectedId))
  $('sel-duplicate').addEventListener('click', () => {
    const el = editor.selected
    if (!el) return
    const copy = store.addFromDef(
      { id: el.defId, name: el.name, category: '', size: el.size, elevation: el.position.y, color: el.color },
      { x: el.position.x + el.size.w, z: el.position.z },
    )
    store.updateElement(copy.id, { rotationY: el.rotationY })
    editor.select(copy.id)
  })

  const editMode = $<HTMLInputElement>('edit-mode')
  editMode.checked = editor.editMode
  editMode.addEventListener('change', () => editor.setEditMode(editMode.checked))

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
  editor.onSelectionChange = (id) => renderSelection(store.getElement(id))

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
  $('reset').addEventListener('click', () => {
    if (confirm('Raum und alle Elemente zurücksetzen?')) {
      editor.select(null)
      store.reset()
    }
  })

  // --- Store → UI ------------------------------------------------------------
  store.subscribe((state) => {
    const active = document.activeElement
    if (active !== roomInputs.width) roomInputs.width.value = cm(state.room.width)
    if (active !== roomInputs.depth) roomInputs.depth.value = cm(state.room.depth)
    if (active !== roomInputs.height) roomInputs.height.value = cm(state.room.height)
    $('element-count').textContent = String(state.elements.length)
    renderSelection(editor.selected)
  })
}
