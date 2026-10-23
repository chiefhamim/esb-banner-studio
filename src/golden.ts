import { loadBaseAssets, loadImage } from './core/assets'
import samplePhoto from './assets/images/sample-photo.jpg'
import { renderToCanvas } from './core/render'
import { buildScene, defaultDoc } from './core/templates'
import type { FormatId } from './core/types'

declare global { interface Window { __done?: boolean; __png?: string; __metrics?: unknown; __err?: string } }

async function main() {
  const q = new URLSearchParams(location.search)
  const fmt = (q.get('fmt') ?? 'social') as FormatId
  const cat = q.get('cat') ?? '01'
  const assets = await loadBaseAssets()
  assets.sample = await loadImage(samplePhoto)
  const doc = defaultDoc()
  doc.content = {
    categoryId: cat,
    date: q.get('date') ?? '2026-10-18',
    headline: q.get('headline') ?? "Review Meeting Held on Progress of Power Division's Development Projects",
    highlight: q.get('hl') ?? 'Development Projects',
    showLinkPill: true,
    highlightOnSocial: false,
    credit: q.get('credit') ?? '',
    creditPos: 'bl',
    creditSize: 24,
    creditColor: '#ffffff',
    creditFont: 'inter',
    creditChip: false,
    label: (q.get('label') ?? 'none') as 'none' | 'breaking' | 'featured' | 'trending' | 'custom',
    labelText: '',
    labelPos: 'tl',
    labelScale: 1,
    labelColor: '#dc2828',
    caption: null,
  }
  for (const f of Object.keys(doc.photos.slots) as FormatId[]) doc.photos.slots[f] = [{ src: 'sample', zoom: 1, panX: 0, panY: 0 }]
  const scene = buildScene(fmt, doc)
  const canvas = renderToCanvas(scene, assets)
  window.__metrics = scene.elements
    .filter((e) => e.kind === 'text')
    .map((e) => ({ id: e.id, x: +e.x.toFixed(2), y: +e.y.toFixed(2), w: +e.w.toFixed(2), h: +e.h.toFixed(2) }))
  window.__png = canvas.toDataURL('image/png')
  window.__done = true
}
main().catch((e) => { window.__err = String(e && e.stack ? e.stack : e); window.__done = true })
