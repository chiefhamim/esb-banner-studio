// Reads the manifest of `AUDIT=1 AUDIT_ONLY=1 OUT=<dir> node tools/e2e/video-shots.mjs` and prints what it found per category,
// with the states each finding appears in. Exit 1 when a category has findings (contrast and unnamed controls always; small
// targets and missing focus rings are listed the same way).
//   node tools/audit/video-a11y-summary.mjs <dir>
import fs from 'node:fs'
import path from 'node:path'

const dir = process.argv[2]
if (!dir) { console.error('usage: node tools/audit/video-a11y-summary.mjs <manifest dir>'); process.exit(2) }
const shots = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8')).shots.filter((s) => s.audit)
const info = new Set(['below28'])
const cats = { contrast: (f) => `${f.el} “${f.text}” ${f.ratio}:1 (needs ${f.need})`, small: (f) => `${f.el} “${f.name}” ${f.w}×${f.h}`, below28: (f) => `${f.el} “${f.name}” ${f.w}×${f.h}`, noName: (f) => `${f.el} ${f.w}×${f.h}`, noFocus: (f) => String(f) }
let bad = 0
console.log(`${shots.length} states audited`)
for (const [cat, fmt] of Object.entries(cats)) {
  const map = new Map()
  for (const s of shots) for (const f of s.audit[cat] ?? []) { const k = fmt(f); (map.get(k) ?? map.set(k, new Set()).get(k)).add(`${s.state}@${s.theme}/${s.width}`) }
  console.log(`\n== ${cat}${info.has(cat) ? ' (information: under the studio’s 28 px, at or over WCAG 2.2’s 24 px)' : ''}: ${map.size} distinct finding${map.size === 1 ? '' : 's'}`)
  for (const [k, where] of [...map].sort((a, b) => b[1].size - a[1].size).slice(0, info.has(cat) ? 12 : 40)) console.log(`  ${k}   [${where.size}: ${[...where].slice(0, 3).join(', ')}${where.size > 3 ? ', …' : ''}]`)
  if (!info.has(cat)) bad += map.size
}
console.log(bad ? `\n${bad} distinct findings` : '\n0 findings')
process.exit(bad ? 1 : 0)
