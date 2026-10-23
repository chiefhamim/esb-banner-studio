import { renderToCanvas } from './core/render'
import type { Assets } from './core/render'
import { buildScene, dateParts } from './core/templates'
import { FORMATS, getCategory, getFormat } from './core/tokens'
import type { Doc, FormatId } from './core/types'
import { serializeProject } from './project'
import { imageAssets } from './store'

export type ExportType = 'png' | 'jpeg' | 'webp'

export interface ExportSettings {
  formats: FormatId[]
  /** resolution multipliers of the template size (1 = native) */
  scales: number[]
  type: ExportType
  /** 0.5 – 1, used by JPG and WebP */
  quality: number
  /** tokens: {cat} {category} {date} {format} {ratio} {w} {h} {scale} {headline} */
  pattern: string
  zip: boolean
  /** desktop app: also write an editable .esb project next to the images */
  saveProject: boolean
  /** folder remembered for the desktop app (null = ask) */
  dir: string | null
  openAfter: boolean
}

export const DEFAULT_SETTINGS: ExportSettings = {
  formats: ['fb45', 'web'], scales: [1], type: 'png', quality: 0.92,
  pattern: 'ESB_{cat}-{category}_{date}_{format}{scale}', zip: false, saveProject: true, dir: null, openAfter: true,
}

export const PRESETS: { id: string; label: string; hint: string; settings: Partial<ExportSettings> }[] = [
  { id: 'bundle', label: 'Newsroom Bundle (FB + Web)', hint: 'Facebook 4:5 + Web Hero 16:9 · 1× PNG', settings: { type: 'png', scales: [1], formats: ['fb45', 'web'], zip: false } },
  { id: 'whatsapp', label: 'WhatsApp / Messenger', hint: 'JPG · 1× · small files', settings: { type: 'jpeg', quality: 0.85, scales: [1], zip: false } },
  { id: 'post', label: 'Publish (exact)', hint: 'PNG · 1× · native size', settings: { type: 'png', scales: [1], zip: false } },
  { id: 'retina', label: 'Retina set', hint: 'PNG · 1× + 2×', settings: { type: 'png', scales: [1, 2], zip: false } },
  { id: 'print', label: 'Print / large', hint: 'PNG · 3× + 4×', settings: { type: 'png', scales: [3, 4], zip: false } },
  { id: 'web', label: 'Web optimised', hint: 'WebP · 1× + 2×', settings: { type: 'webp', quality: 0.9, scales: [1, 2], zip: false } },
  { id: 'all', label: 'Everything (ZIP)', hint: '4:5 + 1:1 + Web + YouTube · 1× 2× 3×', settings: { type: 'png', scales: [1, 2, 3], formats: ['fb45', 'sq', 'web', 'yt'], zip: true } },
]

export const SCALE_CHOICES = [0.5, 1, 1.5, 2, 3, 4]
export const MAX_PIXELS = 110e6

const KEY = 'esb-banner-studio/export/v2'
export function loadSettings(): ExportSettings {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) }
  } catch { /* fall through */ }
  return { ...DEFAULT_SETTINGS }
}
export function saveSettings(s: ExportSettings) { try { localStorage.setItem(KEY, JSON.stringify(s)) } catch { /* ignore */ } }

export const allAssets = (base: Assets): Assets => ({ ...base, ...imageAssets })
export const ext = (t: ExportType) => (t === 'jpeg' ? 'jpg' : t)
const mime = (t: ExportType) => (t === 'jpeg' ? 'image/jpeg' : t === 'webp' ? 'image/webp' : 'image/png')
export const scaleLabel = (s: number) => (Number.isInteger(s) ? `${s}×` : `${s}×`)
export const dims = (f: FormatId, scale: number) => ({ w: Math.round(FORMATS[f].w * scale), h: Math.round(FORMATS[f].h * scale) })
export const tooBig = (f: FormatId, scale: number) => { const d = dims(f, scale); return d.w * d.h > MAX_PIXELS }

const slug = (s: string) => s.toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

export function fileNameFor(doc: Doc, format: FormatId, scale: number, s: Pick<ExportSettings, 'pattern' | 'type'>): string {
  const cat = getCategory(doc.content.categoryId)
  const d = dims(format, scale)
  const map: Record<string, string> = {
    cat: cat.id, category: slug(cat.name), date: doc.content.date, format: getFormat(format).short, ratio: getFormat(format).ratio.replace(':', 'x'),
    w: String(d.w), h: String(d.h), scale: scale === 1 ? '' : `@${String(scale).replace('.', '_')}x`,
    headline: slug(doc.content.headline).slice(0, 40),
  }
  const base = (s.pattern || DEFAULT_SETTINGS.pattern).replace(/\{(\w+)\}/g, (_, k) => map[k] ?? '').replace(/[<>:"/\\|?*]+/g, '').trim() || 'ESB-banner'
  return `${base}.${ext(s.type)}`
}

export function zipNameFor(doc: Doc): string {
  const cat = getCategory(doc.content.categoryId)
  return `ESB_${cat.id}-${slug(cat.name)}_${doc.content.date}.zip`
}

export function emptySlots(doc: Doc, format: FormatId): number {
  return doc.photos.slots[format].filter((s) => !s.src || !imageAssets[s.src]).length
}

export async function renderBanner(doc: Doc, format: FormatId, base: Assets, scale: number, type: ExportType, quality: number): Promise<Blob> {
  const scene = buildScene(format, doc)
  const canvas = renderToCanvas(scene, allAssets(base), scale)
  const blob: Blob = await new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('The browser could not encode this image'))), mime(type), type === 'png' ? undefined : quality),
  )
  canvas.width = canvas.height = 0 // release the big bitmap right away
  return blob
}

export async function copyToClipboard(doc: Doc, format: FormatId, base: Assets): Promise<void> {
  const blob = await renderBanner(doc, format, base, 1, 'png', 1)
  await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
}

// ---------------------------------------------------------------- minimal ZIP (stored, no compression: images are already compressed)
const CRC_TABLE = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0 } return t })()
const crc32 = (d: Uint8Array) => { let c = 0xffffffff; for (let i = 0; i < d.length; i++) c = CRC_TABLE[(c ^ d[i]) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0 }

export function makeZip(files: { name: string; data: Uint8Array }[]): Uint8Array {
  const enc = new TextEncoder()
  const parts: Uint8Array[] = []
  const central: Uint8Array[] = []
  let offset = 0
  const now = new Date()
  const dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1)
  const dosDate = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate()
  for (const f of files) {
    const name = enc.encode(f.name)
    const crc = crc32(f.data)
    const lh = new DataView(new ArrayBuffer(30))
    lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true); lh.setUint16(8, 0, true)
    lh.setUint16(10, dosTime, true); lh.setUint16(12, dosDate, true); lh.setUint32(14, crc, true)
    lh.setUint32(18, f.data.length, true); lh.setUint32(22, f.data.length, true); lh.setUint16(26, name.length, true); lh.setUint16(28, 0, true)
    parts.push(new Uint8Array(lh.buffer), name, f.data)
    const ch = new DataView(new ArrayBuffer(46))
    ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(8, 0x0800, true); ch.setUint16(10, 0, true)
    ch.setUint16(12, dosTime, true); ch.setUint16(14, dosDate, true); ch.setUint32(16, crc, true)
    ch.setUint32(20, f.data.length, true); ch.setUint32(24, f.data.length, true); ch.setUint16(28, name.length, true)
    ch.setUint32(42, offset, true)
    central.push(new Uint8Array(ch.buffer), name)
    offset += 30 + name.length + f.data.length
  }
  const cdSize = central.reduce((a, b) => a + b.length, 0)
  const end = new DataView(new ArrayBuffer(22))
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true)
  end.setUint32(12, cdSize, true); end.setUint32(16, offset, true)
  const all = [...parts, ...central, new Uint8Array(end.buffer)]
  const out = new Uint8Array(all.reduce((a, b) => a + b.length, 0))
  let p = 0
  for (const a of all) { out.set(a, p); p += a.length }
  return out
}

// ---------------------------------------------------------------- run an export
export interface ExportJob { format: FormatId; scale: number; name: string; w: number; h: number }

export function planJobs(doc: Doc, s: ExportSettings): ExportJob[] {
  const jobs: ExportJob[] = []
  const names = new Set<string>()
  for (const f of s.formats) {
    for (const sc of [...s.scales].sort((a, b) => a - b)) {
      if (tooBig(f, sc)) continue
      let name = fileNameFor(doc, f, sc, s)
      // make sure two jobs can never overwrite each other (e.g. a pattern without {format})
      if (names.has(name)) { const i = name.lastIndexOf('.'); name = `${name.slice(0, i)}_${f}${sc === 1 ? '' : '_' + sc + 'x'}${name.slice(i)}` }
      names.add(name)
      jobs.push({ format: f, scale: sc, name, ...dims(f, sc) })
    }
  }
  return jobs
}

function browserDownload(name: string, blob: Blob) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = name
  document.body.appendChild(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 8000)
}

export interface ExportResult { saved: string[]; dir?: string; bytes: number; project?: string }

export async function runExport(doc: Doc, base: Assets, s: ExportSettings, onProgress: (done: number, total: number, label: string) => void, signal?: { cancelled: boolean }): Promise<ExportResult> {
  const jobs = planJobs(doc, s)
  if (!jobs.length) throw new Error('Nothing to export: pick at least one banner and one size.')
  const native = window.esb?.saveImage
  let dir = s.dir ?? undefined
  const needFolder = !!native && (jobs.length > 1 || s.zip)
  if (needFolder && !dir) {
    const picked = await window.esb!.pickFolder?.()
    if (!picked) throw new Error('Export cancelled')
    dir = picked
  }
  const saved: string[] = []
  let bytes = 0
  const zipFiles: { name: string; data: Uint8Array }[] = []
  for (let i = 0; i < jobs.length; i++) {
    if (signal?.cancelled) throw new Error('Export cancelled')
    const j = jobs[i]
    onProgress(i, jobs.length + (s.zip ? 1 : 0), `${j.name}  ·  ${j.w}×${j.h}`)
    await new Promise((r) => setTimeout(r, 30)) // let the progress bar paint before the heavy render
    const blob = await renderBanner(doc, j.format, base, j.scale, s.type, s.quality)
    bytes += blob.size
    if (s.zip) { zipFiles.push({ name: j.name, data: new Uint8Array(await blob.arrayBuffer()) }); continue }
    if (native) {
      try {
        const p = await native(j.name, new Uint8Array(await blob.arrayBuffer()), dir)
        if (p) saved.push(p)
      } catch (err) {
        console.warn('Native export with saved dir failed, trying fallback:', err)
        if (window.esb?.pickFolder) {
          const picked = await window.esb.pickFolder()
          if (picked) {
            dir = picked
            s.dir = picked
            const p = await native(j.name, new Uint8Array(await blob.arrayBuffer()), dir)
            if (p) saved.push(p)
          } else {
            browserDownload(j.name, blob)
            saved.push(j.name)
          }
        } else {
          browserDownload(j.name, blob)
          saved.push(j.name)
        }
      }
    } else {
      browserDownload(j.name, blob)
      saved.push(j.name)
      await new Promise((r) => setTimeout(r, 250))
    }
  }
  if (s.zip) {
    onProgress(jobs.length, jobs.length + 1, 'Building ZIP…')
    const zip = makeZip(zipFiles)
    const name = zipNameFor(doc)
    if (native) {
      try {
        const p = await native(name, zip, dir)
        if (p) saved.push(p)
      } catch {
        browserDownload(name, new Blob([zip as BlobPart], { type: 'application/zip' }))
        saved.push(name)
      }
    } else {
      browserDownload(name, new Blob([zip as BlobPart], { type: 'application/zip' }))
      saved.push(name)
    }
  }
  onProgress(jobs.length + (s.zip ? 1 : 0), jobs.length + (s.zip ? 1 : 0), 'Done')
  // keep the banner editable: an .esb project beside the images (bonus; the images are already safe)
  let project: string | undefined
  if (native && window.esb?.saveProject && s.saveProject && saved[0]) {
    try {
      const folder = dir ?? saved[0].replace(/[\\/][^\\/]*$/, '')
      const name = zipNameFor(doc).replace(/\.zip$/, '.esb')
      project = (await window.esb.saveProject(name, await serializeProject(), folder + '\\' + name)) ?? undefined
    } catch { /* ignore */ }
  }
  return { saved, dir, bytes, project }
}

export const formatLabel = (f: FormatId) => `${getFormat(f).name} ${FORMATS[f].w}×${FORMATS[f].h}`
export const humanBytes = (n: number) => (n > 1e6 ? (n / 1e6).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1e3)) + ' KB')

// ---------------------------------------------------------------- preflight
export interface PreflightItem { level: 'warn' | 'info'; text: string }

/** Things worth a second look before a banner goes out. */
export function preflight(doc: Doc, formats: FormatId[]): PreflightItem[] {
  const out: PreflightItem[] = []
  const c = doc.content
  const len = c.headline.trim().length
  if (!len) out.push({ level: 'warn', text: 'The headline is empty.' })
  else if (len > 90) out.push({ level: 'warn', text: `The headline is ${len} characters — the guideline says to shorten it (90 maximum).` })
  if (c.highlight.trim() && !c.headline.toLowerCase().includes(c.highlight.trim().toLowerCase())) out.push({ level: 'info', text: 'The highlighted phrase is not in the headline, so nothing is highlighted.' })
  const t = new Date()
  const today = `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`
  if (c.date !== today) { const d = dateParts(c.date); out.push({ level: 'info', text: `The banner is dated ${d.num} ${d.monthYear.toLowerCase().replace(/^./, (x) => x.toUpperCase())}, not today.` }) }
  const empty = Math.max(0, ...formats.map((f) => emptySlots(doc, f)))
  if (empty) out.push({ level: 'warn', text: `${empty} photo slot${empty > 1 ? 's are' : ' is'} empty and will export as a placeholder.` })
  const outside = Math.max(0, ...formats.map((f) => buildScene(f, doc).elements.filter((e) => e.visible && (e.x + e.w <= 0 || e.y + e.h <= 0 || e.x >= FORMATS[f].w || e.y >= FORMATS[f].h)).length))
  if (outside) out.push({ level: 'warn', text: `${outside} layer${outside > 1 ? 's are' : ' is'} completely outside the banner and will not show.` })
  if (formats.includes('social')) out.push({ level: 'info', text: 'Facebook Classic (1598 × 1431) is not a native feed size — Facebook Feed 4:5 is the recommended one.' })
  return out
}
