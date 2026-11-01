// Side-by-side comparison of two runs of tools/e2e/video-shots.mjs.
//
//   BEFORE=<dir> AFTER=<dir> OUT=<dir> node tools/e2e/video-shots-compare.mjs  [THRESHOLD=0.1]
//
// For every PNG name in BEFORE or AFTER: a labelled "before | after" PNG (<name>), a pixel diff (<name minus
// .png>__diff.png, same pixelmatch settings as shot-diff.mjs) with the mismatch as a percentage of pixels when
// both sizes match, and an index.html gallery over all of them with diff.json. A name only in AFTER is "new",
// only in BEFORE is "removed"; a pair of different sizes is compared over the shared top-left area and flagged.
// The labelled pairs are composed with pngjs (no browser): a header strip with BEFORE / AFTER drawn in a tiny
// built-in pixel font, the gallery carries the full names.
import fs from 'node:fs'
import path from 'node:path'
import { PNG } from 'pngjs'
import pixelmatch from 'pixelmatch'

const { BEFORE, AFTER, OUT } = process.env
if (!BEFORE || !AFTER || !OUT) { console.error('usage: BEFORE=<dir> AFTER=<dir> OUT=<dir> node tools/e2e/video-shots-compare.mjs'); process.exit(2) }
const threshold = Number(process.env.THRESHOLD || '0.1')
fs.mkdirSync(OUT, { recursive: true })
const pngs = (d) => (fs.existsSync(d) ? fs.readdirSync(d).filter((f) => f.toLowerCase().endsWith('.png')) : [])
const before = new Set(pngs(BEFORE)), after = new Set(pngs(AFTER))
const names = [...new Set([...before, ...after])].sort()
const manifestOf = (d) => { try { return JSON.parse(fs.readFileSync(path.join(d, 'manifest.json'), 'utf8')).shots || [] } catch { return [] } }
const naAfter = new Map(manifestOf(AFTER).filter((m) => m.ok !== true).map((m) => [m.file, m]))
const naBefore = new Map(manifestOf(BEFORE).filter((m) => m.ok !== true).map((m) => [m.file, m]))

// 5×7 pixel font for the header labels
const FONT = {
  A: ['01110', '10001', '10001', '11111', '10001', '10001', '10001'], B: ['11110', '10001', '10001', '11110', '10001', '10001', '11110'],
  E: ['11111', '10000', '10000', '11110', '10000', '10000', '11111'], F: ['11111', '10000', '10000', '11110', '10000', '10000', '10000'],
  N: ['10001', '11001', '10101', '10011', '10001', '10001', '10001'], O: ['01110', '10001', '10001', '10001', '10001', '10001', '01110'],
  R: ['11110', '10001', '10001', '11110', '10100', '10010', '10001'], T: ['11111', '00100', '00100', '00100', '00100', '00100', '00100'],
  W: ['10001', '10001', '10001', '10101', '10101', '10101', '01010'], M: ['10001', '11011', '10101', '10101', '10001', '10001', '10001'],
  V: ['10001', '10001', '10001', '10001', '10001', '01010', '00100'], D: ['11110', '10001', '10001', '10001', '10001', '10001', '11110'],
  ' ': ['00000', '00000', '00000', '00000', '00000', '00000', '00000'], '-': ['00000', '00000', '00000', '11111', '00000', '00000', '00000'],
  '/': ['00001', '00010', '00010', '00100', '01000', '01000', '10000'],
}
function fill(img, x0, y0, w, h, [r, g, b]) {
  for (let y = Math.max(0, y0); y < Math.min(img.height, y0 + h); y++) for (let x = Math.max(0, x0); x < Math.min(img.width, x0 + w); x++) {
    const i = (y * img.width + x) * 4; img.data[i] = r; img.data[i + 1] = g; img.data[i + 2] = b; img.data[i + 3] = 255
  }
}
function text(img, str, x, y, scale, color) {
  for (const ch of str.toUpperCase()) {
    const g = FONT[ch] || FONT[' ']
    g.forEach((row, ry) => [...row].forEach((c, rx) => { if (c === '1') fill(img, x + rx * scale, y + ry * scale, scale, scale, color) }))
    x += 6 * scale
  }
}
function blit(dst, src, dx, dy) {
  for (let y = 0; y < src.height; y++) {
    const s = y * src.width * 4, d = ((dy + y) * dst.width + dx) * 4
    src.data.copy(dst.data, d, s, s + src.width * 4)
  }
}
const read = (f) => PNG.sync.read(fs.readFileSync(f))
const crop = (img, w, h) => { const o = new PNG({ width: w, height: h }); for (let y = 0; y < h; y++) img.data.copy(o.data, y * w * 4, y * img.width * 4, (y * img.width + w) * 4); return o }

const GAP = 16, HEAD = 40, SCALE = 4
const rows = []
for (const name of names) {
  const base = name.replace(/\.png$/i, '')
  const hasB = before.has(name), hasA = after.has(name)
  const status = hasB && hasA ? 'pair' : hasA ? 'new' : 'removed'
  const a = hasB ? read(path.join(BEFORE, name)) : null
  const b = hasA ? read(path.join(AFTER, name)) : null
  const W = (a ? a.width : 0) + (b ? b.width : 0) + (a && b ? GAP : 0)
  const H = HEAD + Math.max(a?.height || 0, b?.height || 0)
  const out = new PNG({ width: W, height: H })
  fill(out, 0, 0, W, H, [40, 40, 46])
  let x = 0
  if (a) { fill(out, x, 0, a.width, HEAD, [70, 70, 80]); text(out, 'BEFORE', x + 12, 6, SCALE, [235, 235, 240]); blit(out, a, x, HEAD); x += a.width + GAP }
  if (b) { fill(out, x, 0, b.width, HEAD, status === 'new' ? [20, 110, 60] : [40, 80, 150]); text(out, status === 'new' ? 'AFTER - NEW' : 'AFTER', x + 12, 6, SCALE, [255, 255, 255]); blit(out, b, x, HEAD) }
  fs.writeFileSync(path.join(OUT, name), PNG.sync.write(out))
  let pct = null, note = ''
  if (a && b) {
    const w = Math.min(a.width, b.width), h = Math.min(a.height, b.height)
    if (a.width !== b.width || a.height !== b.height) note = `size ${a.width}×${a.height} → ${b.width}×${b.height}`
    const ca = a.width === w && a.height === h ? a : crop(a, w, h), cb = b.width === w && b.height === h ? b : crop(b, w, h)
    const diff = new PNG({ width: w, height: h })
    const n = pixelmatch(ca.data, cb.data, diff.data, w, h, { threshold })
    fs.writeFileSync(path.join(OUT, `${base}__diff.png`), PNG.sync.write(diff))
    pct = (n / (w * h)) * 100
  }
  rows.push({ name, status, pct, note })
  console.log(`${status.padEnd(7)} ${pct == null ? '      ' : pct.toFixed(2).padStart(6) + '%'}  ${name}${note ? '  (' + note + ')' : ''}`)
}
// states the AFTER run marked n/a but BEFORE captured (and vice versa) are worth seeing in the gallery too
for (const [file, m] of naAfter) if (before.has(file) && !after.has(file)) { const r = rows.find((x) => x.name === file); if (r) r.note = `after: n/a (${m.note})` }
for (const [file, m] of naBefore) if (after.has(file) && !before.has(file)) { const r = rows.find((x) => x.name === file); if (r) r.note = `before: n/a (${m.note})` }

fs.writeFileSync(path.join(OUT, 'diff.json'), JSON.stringify({ before: path.resolve(BEFORE), after: path.resolve(AFTER), threshold, rows }, null, 2))
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])
const counts = { pair: rows.filter((r) => r.status === 'pair').length, new: rows.filter((r) => r.status === 'new').length, removed: rows.filter((r) => r.status === 'removed').length }
const html = `<!doctype html><meta charset="utf-8"><title>Video desk: before / after</title>
<style>body{font:14px/1.45 system-ui,sans-serif;margin:24px;background:#18181b;color:#e4e4e7}a{color:#93c5fd}
.f{margin:0 0 12px}.f button{margin-right:6px}figure{margin:0 0 40px}figcaption{margin:6px 0;display:flex;gap:12px;align-items:baseline}
.b{font-size:12px;padding:1px 8px;border-radius:9px;background:#3f3f46}.new{background:#166534}.removed{background:#7f1d1d}.hi{background:#9a3412}
img{max-width:100%;border:1px solid #3f3f46}</style>
<h1>Video desk — before / after</h1>
<p>Before: ${esc(path.resolve(BEFORE))}<br>After: ${esc(path.resolve(AFTER))}<br>${counts.pair} pairs · ${counts.new} new · ${counts.removed} removed · pixel threshold ${threshold}</p>
<div class="f"><input id="q" placeholder="filter (state, theme, width)" oninput="for(const f of document.querySelectorAll('figure'))f.hidden=!f.dataset.n.includes(this.value)"></div>
${rows.map((r) => `<figure data-n="${esc(r.name)}"><figcaption><b>${esc(r.name)}</b>
<span class="b ${r.status === 'pair' ? (r.pct > 1 ? 'hi' : '') : r.status}">${r.status === 'pair' ? r.pct.toFixed(2) + ' % changed' : r.status}</span>
${r.note ? `<span>${esc(r.note)}</span>` : ''}${r.status === 'pair' ? ` <a href="${esc(r.name.replace(/\.png$/i, ''))}__diff.png">diff</a>` : ''}</figcaption>
<a href="${esc(r.name)}"><img loading="lazy" src="${esc(r.name)}"></a></figure>`).join('\n')}`
fs.writeFileSync(path.join(OUT, 'index.html'), html)
console.log(`\n${counts.pair} pairs, ${counts.new} new, ${counts.removed} removed → ${path.join(path.resolve(OUT), 'index.html')}`)
