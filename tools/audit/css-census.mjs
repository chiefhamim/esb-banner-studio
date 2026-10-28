// Design-token census for the Quiet Studio stylesheet layer (pure Node, no browser).
// Reports duplicate token definitions across files, undefined var() names, off-scale
// radii / font sizes / weights, colour literal counts and z-index spread.
// Usage: node tools/audit/css-census.mjs [--strict]   (--strict exits 1 on (a) or (b) findings)
import fs from 'node:fs'
import path from 'node:path'

const root = path.resolve(import.meta.dirname, '../..')
const FILES = ['src/styles/tokens.css', 'src/styles/base.css', 'src/styles/primitives.css', 'src/App.css']
const strict = process.argv.includes('--strict')

const RADII = new Set(['0', '0px', '4px', '8px', '12px', '16px', '9999px', '50%', 'inherit'])
const FONT_SIZES = new Set([11, 12, 13, 15, 18, 24])
const FS_EXCLUDE = /\.(fb|esb-site|site-mock|gsr|canvas|stage|banner)/
const FW_EXCLUDE = /banner|canvas|stage|fb-|esb-site/

// --- tiny CSS walker: yields { selector, scope, decls: [{prop, value, line}] } per rule ---
function parse(text, file) {
  // strip comments but keep newlines so reported line numbers stay accurate
  text = text.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
  const rules = []
  let i = 0, line = 1
  const mediaStack = [] // true when inside prefers-color-scheme media
  let selStart = 0, buf = ''
  const lineAt = (idx) => { let n = 1; for (let k = 0; k < idx; k++) if (text.charCodeAt(k) === 10) n++; return n }
  while (i < text.length) {
    const ch = text[i]
    if (ch === '/' && text[i + 1] === '*') { const e = text.indexOf('*/', i + 2); i = e < 0 ? text.length : e + 2; continue }
    if (ch === '{') {
      const selector = buf.trim(); buf = ''
      if (selector.startsWith('@')) {
        if (/^@(media|supports|layer|container)/.test(selector)) { mediaStack.push(/prefers-color-scheme/.test(selector)); i++; continue }
        // @font-face / @keyframes etc: skip the whole block
        let depth = 1, j = i + 1
        while (j < text.length && depth) { if (text[j] === '{') depth++; else if (text[j] === '}') depth--; j++ }
        i = j; continue
      }
      // declaration block (no nesting assumed)
      const end = text.indexOf('}', i)
      const body = text.slice(i + 1, end < 0 ? text.length : end)
      const bodyStart = i + 1
      const decls = []
      let off = 0
      for (const raw of body.split(';')) {
        const seg = raw
        const idx = seg.indexOf(':')
        if (idx > 0) {
          const prop = seg.slice(0, idx).trim(), value = seg.slice(idx + 1).trim()
          if (prop) decls.push({ prop, value, line: lineAt(bodyStart + off + seg.search(/\S|$/)) })
        }
        off += raw.length + 1
      }
      const inDarkMedia = mediaStack.some(Boolean)
      const scope = inDarkMedia || /data-theme|\.dark\b/.test(selector) ? 'dark' : 'light'
      rules.push({ file, selector, scope, decls, line: lineAt(selStart) })
      i = end < 0 ? text.length : end + 1
      selStart = i
      continue
    }
    if (ch === '}') { mediaStack.pop(); i++; selStart = i; buf = ''; continue }
    if (!buf.trim()) selStart = i
    buf += ch; i++
  }
  return rules
}

const all = []
for (const f of FILES) {
  const p = path.join(root, f)
  if (!fs.existsSync(p)) { console.log(`(missing) ${f}`); continue }
  all.push(...parse(fs.readFileSync(p, 'utf8'), f))
}

// (a) duplicate custom-property definitions across files, same scope
const defs = new Map() // name -> [{file,line,scope}]
// Component-scoped overrides (e.g. `.app { --sel: … }`) are legitimate; only root-level definitions compete.
const isRootScoped = (selector) => /^(:root|html|body)\b/.test(selector.trim())
for (const r of all) for (const d of r.decls) if (d.prop.startsWith('--') && isRootScoped(r.selector)) {
  if (!defs.has(d.prop)) defs.set(d.prop, [])
  defs.get(d.prop).push({ file: r.file, line: d.line, scope: r.scope })
}
const dupes = []
for (const [name, list] of defs) {
  for (const scope of ['light', 'dark']) {
    const files = new Set(list.filter((x) => x.scope === scope).map((x) => x.file))
    if (files.size > 1) dupes.push({ name, scope, where: list.filter((x) => x.scope === scope).map((x) => `${x.file}:${x.line}`) })
  }
}

// (b) var() names used but never defined (in CSS). Names set only from JS/inline styles show here too.
const used = new Map()
for (const r of all) for (const d of r.decls) for (const m of d.value.matchAll(/var\(\s*(--[\w-]+)/g)) {
  if (!used.has(m[1])) used.set(m[1], [])
  used.get(m[1]).push(`${r.file}:${d.line}`)
}
const definedAnywhere = new Set()
for (const r of all) for (const d of r.decls) if (d.prop.startsWith('--')) definedAnywhere.add(d.prop)
const undefinedVars = [...used.keys()].filter((n) => !definedAnywhere.has(n)).sort()

// (c) off-scale radii
const offRadius = []
for (const r of all) for (const d of r.decls) if (/^border(-\w+)*-radius$/.test(d.prop)) {
  for (const tok of d.value.replace(/\/.*$/, '').split(/\s+/)) {
    if (!tok || tok.startsWith('var(') || tok.startsWith('calc(')) continue
    if (!RADII.has(tok)) { offRadius.push(`${r.file}:${d.line} ${r.selector.slice(0, 50)} → ${d.value}`); break }
  }
}

// (d) off-scale font sizes (px), excluding mock/canvas selectors
const offFont = []
for (const r of all) {
  if (FS_EXCLUDE.test(r.selector)) continue
  for (const d of r.decls) if (d.prop === 'font-size' || d.prop === 'font') {
    const m = d.value.match(/(\d+(?:\.\d+)?)px/)
    if (m && !FONT_SIZES.has(Number(m[1]))) offFont.push(`${r.file}:${d.line} ${r.selector.slice(0, 50)} → ${m[1]}px`)
  }
}

// (e) colour literals
const COLOR = /#[0-9a-f]{3,8}\b|\brgba?\(|\bhsla?\(/gi
const colourCount = {}
const appFamilies = { '.ed-': 0, '.vw-': 0, '.fb-': 0, other: 0 }
for (const r of all) {
  let n = 0
  for (const d of r.decls) { if (d.prop.startsWith('--') && r.file.endsWith('tokens.css')) continue; n += (d.value.match(COLOR) || []).length }
  colourCount[r.file] = (colourCount[r.file] || 0) + n
  if (r.file === 'src/App.css') {
    const fam = ['.ed-', '.vw-', '.fb-'].find((p) => r.selector.includes(p)) || 'other'
    appFamilies[fam] += n
  }
}

// (f) heavy weights outside banner/canvas/mock selectors
const heavy = []
for (const r of all) {
  if (FW_EXCLUDE.test(r.selector)) continue
  for (const d of r.decls) if (d.prop === 'font-weight' || d.prop === 'font') {
    const m = d.value.match(/\b([7-9]00)\b/)
    if (m) heavy.push(`${r.file}:${d.line} ${r.selector.slice(0, 50)} → ${m[1]}`)
  }
}

// (g) z-index spread
const z = new Map()
for (const r of all) for (const d of r.decls) if (d.prop === 'z-index' && /^-?\d+$/.test(d.value)) z.set(Number(d.value), (z.get(Number(d.value)) || 0) + 1)

// ---- report ----
const h = (t) => console.log(`\n== ${t} ==`)
h(`(a) custom properties defined in more than one file (same theme scope): ${dupes.length}`)
for (const x of dupes) console.log(`  ${x.name} [${x.scope}]  ${x.where.join('  ')}`)
h(`(b) var() names used but never defined in CSS: ${undefinedVars.length}`)
for (const n of undefinedVars) console.log(`  ${n}  (${used.get(n).length}× e.g. ${used.get(n)[0]})`)
h(`(c) off-scale border-radius: ${offRadius.length}`)
for (const x of offRadius) console.log('  ' + x)
h(`(d) off-scale font-size in UI chrome (px not in 11/12/13/15/18/24, mocks excluded): ${offFont.length}`)
for (const x of offFont) console.log('  ' + x)
h('(e) colour literals per file (tokens.css custom-property values excluded)')
for (const [f, n] of Object.entries(colourCount)) console.log(`  ${f}: ${n}`)
console.log(`  App.css by family: ${Object.entries(appFamilies).map(([k, v]) => `${k} ${v}`).join(', ')}`)
h(`(f) font-weight ≥ 700 in chrome: ${heavy.length}`)
for (const x of heavy) console.log('  ' + x)
h(`(g) distinct z-index values: ${z.size}`)
console.log('  ' + [...z.entries()].sort((a, b) => a[0] - b[0]).map(([v, n]) => `${v}(${n})`).join(' '))

if (strict && (dupes.length || undefinedVars.length)) { console.log('\nSTRICT: failing on (a)/(b) findings'); process.exit(1) }
