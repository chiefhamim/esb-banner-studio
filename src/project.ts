// Project files (.esb): the whole banner (all formats, layers, guides, photos) in one JSON file.
import { loadImage } from './core/assets'
import { getCategory } from './core/tokens'
import type { Doc, FormatId } from './core/types'
import { imageAssets, normalizeDoc, useStore } from './store'
import type { ImageItem } from './store'

const MAGIC = 'esb-banner-studio'
const RECENT_KEY = 'esb-banner-studio/recent-projects'

export interface ProjectFileV1 {
  app: typeof MAGIC
  version: 1
  savedAt: string
  format: FormatId
  doc: Doc
  images: { id: string; name: string; dataUrl: string }[]
}

export interface ProjectFileV2 {
  app: typeof MAGIC
  version: 2
  savedAt: string
  title?: string
  format: FormatId
  doc: Doc
  images: { id: string; name: string; dataUrl: string }[]
  graphics: {
    format: FormatId
    doc: Doc
  }
}

export type ProjectFile = ProjectFileV1 | ProjectFileV2

export interface RecentProject { name: string; path: string; /** When it was last opened or saved here (ms); older entries have none. */ at?: number }
export const readRecent = (): RecentProject[] => { try { return JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]') } catch { return [] } }
/** Take one project off the list (the file itself is left alone). */
export const removeRecent = (path: string) => { try { localStorage.setItem(RECENT_KEY, JSON.stringify(readRecent().filter((x) => x.path !== path))) } catch { /* ignore */ } }
const pushRecent = (r: RecentProject) => { try { localStorage.setItem(RECENT_KEY, JSON.stringify([{ ...r, at: r.at ?? Date.now() }, ...readRecent().filter((x) => x.path !== r.path)].slice(0, 6))) } catch { /* ignore */ } }

const toDataUrl = (blob: Blob): Promise<string> => new Promise((res, rej) => { const f = new FileReader(); f.onload = () => res(String(f.result)); f.onerror = () => rej(f.error); f.readAsDataURL(blob) })

export function suggestedName(): string {
  const st = useStore.getState()
  const cat = getCategory(st.doc.content.categoryId)
  return `ESB ${cat.id}-${cat.name.replace(/[^a-z0-9]+/gi, ' ').trim().split(' ')[0].toLowerCase()} ${st.doc.content.date}`
}

export async function serializeProject(): Promise<string> {
  const st = useStore.getState()
  const used = new Set<string>()
  for (const slots of Object.values(st.doc.photos.slots)) for (const sl of slots) if (sl.src) used.add(sl.src)
  for (const list of Object.values(st.doc.extras)) for (const e of list) if (e.kind === 'image') used.add(e.src)
  const images: ProjectFile['images'] = []
  for (const im of st.images) {
    if (!used.has(im.id)) continue
    images.push({ id: im.id, name: im.name, dataUrl: await toDataUrl(await (await fetch(im.url)).blob()) })
  }
  const file: ProjectFileV2 = {
    app: MAGIC,
    version: 2,
    savedAt: new Date().toISOString(),
    title: st.projectName ?? suggestedName(),
    format: st.format,
    doc: st.doc,
    images,
    graphics: {
      format: st.format,
      doc: st.doc,
    },
  }
  return JSON.stringify(file)
}

export async function applyProject(text: string, name: string | null, path: string | null): Promise<void> {
  const file = JSON.parse(text) as any
  if (file?.app !== MAGIC) throw new Error('This is not an ESB AI Studio project file.')
  const rawDoc = file.graphics?.doc || file.doc
  if (!rawDoc?.photos) throw new Error('This is not an ESB AI Studio project file.')
  const activeFormat = (file.graphics?.format || file.format || 'fb45') as FormatId

  // replace the photo library with the photos stored in the file
  const items: ImageItem[] = []
  for (const im of file.images ?? []) {
    const blob = await (await fetch(im.dataUrl)).blob()
    const url = URL.createObjectURL(blob)
    const img = await loadImage(url)
    imageAssets[im.id] = img
    items.push({ id: im.id, name: im.name, url, w: img.naturalWidth, h: img.naturalHeight })
  }
  for (const old of useStore.getState().images) if (!items.some((i) => i.id === old.id)) { URL.revokeObjectURL(old.url); delete imageAssets[old.id] }
  const doc = normalizeDoc(rawDoc, true)
  useStore.setState({ images: items, format: activeFormat })
  useStore.getState().loadDoc(doc, { name, path })
  if (path && name) pushRecent({ name, path })
}

const baseName = (p: string) => p.replace(/^.*[\\/]/, '').replace(/\.esb$/i, '')

/** Save (or Save As). Returns true when a file was written. */
export async function saveProject(saveAs = false): Promise<boolean> {
  const st = useStore.getState()
  const text = await serializeProject()
  const name = (saveAs ? null : st.projectName) ?? suggestedName()
  if (window.esb?.saveProject) {
    const path = await window.esb.saveProject(name + '.esb', text, saveAs ? null : st.projectPath)
    if (!path) return false
    st.markSaved(baseName(path), path)
    pushRecent({ name: baseName(path), path })
    st.setNotice('Saved project · ' + baseName(path))
    return true
  }
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }))
  const a = document.createElement('a')
  a.href = url; a.download = name + '.esb'
  document.body.appendChild(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 8000)
  st.markSaved(name, null)
  st.setNotice('Project downloaded · ' + name + '.esb')
  return true
}

export async function openProject(): Promise<void> {
  const st = useStore.getState()
  try {
    if (window.esb?.openProject) {
      const r = await window.esb.openProject()
      if (!r) return
      await applyProject(r.text, baseName(r.path), r.path)
      st.setNotice('Opened ' + baseName(r.path))
      return
    }
    const input = document.createElement('input')
    input.type = 'file'; input.accept = '.esb,application/json'
    await new Promise<void>((resolve) => {
      input.onchange = async () => {
        const f = input.files?.[0]
        if (f) { try { await applyProject(await f.text(), f.name.replace(/\.esb$/i, ''), null); st.setNotice('Opened ' + f.name) } catch (e) { st.setNotice(e instanceof Error ? e.message : String(e)) } }
        resolve()
      }
      input.click()
    })
  } catch (e) {
    st.setNotice(e instanceof Error ? e.message : String(e))
  }
}

export async function openRecent(r: RecentProject): Promise<void> {
  const st = useStore.getState()
  try {
    const text = await window.esb?.readProject?.(r.path)
    if (!text) throw new Error('That project file could not be found any more.')
    await applyProject(text, r.name, r.path)
    st.setNotice('Opened ' + r.name)
  } catch (e) {
    st.setNotice(e instanceof Error ? e.message : String(e))
  }
}
