// Dead CSS: rules whose every selector names a class that appears nowhere in the app's source (src, electron, index.html)
// nor in the editor libraries that add classes at run time (TipTap/ProseMirror). Such a rule can never match.
// A class that might be built at run time ('st-' + state, `cs-${x}`) is kept when its prefix is written as a string.
// Usage: node tools/audit/prune-dead-css.mjs          → report only
//        node tools/audit/prune-dead-css.mjs --write  → remove the dead selectors/rules in place
import fs from 'node:fs'
import path from 'node:path'
import postcss from 'postcss'
const root = path.resolve(import.meta.dirname, '../..')
const walk = (d, ok) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(path.join(d, e.name), ok) : ok(e.name) ? [path.join(d, e.name)] : [])
const code = [...walk(path.join(root, 'src'), (n) => /\.(tsx?|mjs|js)$/.test(n)), ...walk(path.join(root, 'electron'), (n) => /\.(c?js|mjs)$/.test(n)), path.join(root, 'index.html')]
  .map((f) => fs.readFileSync(f, 'utf8')).join('\n')
const libDirs = ['@tiptap', 'prosemirror-view', 'prosemirror-tables', 'prosemirror-gapcursor', 'prosemirror-dropcursor'].map((d) => path.join(root, 'node_modules', d)).filter((d) => fs.existsSync(d))
const lib = libDirs.flatMap((d) => walk(d, (n) => /\.(js|mjs|cjs)$/.test(n) && !/\.d\./.test(n))).map((f) => fs.readFileSync(f, 'utf8')).join('\n')
const used = new Map()
const isUsed = (c) => {
  if (used.has(c)) return used.get(c)
  let ok = code.includes(c) || lib.includes(c)
  if (!ok && c.includes('-')) {
    const pre = c.slice(0, c.lastIndexOf('-') + 1)
    ok = ["'" + pre, '"' + pre, '`' + pre, ' ' + pre + "'", ' ' + pre + '`'].some((p) => code.includes(p))
  }
  used.set(c, ok)
  return ok
}
const classesOf = (sel) => [...sel.replace(/\[[^\]]*\]/g, '').replace(/url\([^)]*\)/g, '').matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)].map((m) => m[1])
const write = process.argv.includes('--write')
const files = walk(path.join(root, 'src'), (n) => n.endsWith('.css')).filter((f) => !f.includes('site-preview'))
let totalBefore = 0, totalAfter = 0
for (const f of files) {
  const src = fs.readFileSync(f, 'utf8')
  const ast = postcss.parse(src)
  let removedSel = 0, removedRules = 0
  ast.walkRules((rule) => {
    if (rule.parent?.type === 'atrule' && /keyframes/i.test(rule.parent.name)) return
    const sels = rule.selectors
    const live = sels.filter((s) => classesOf(s).every(isUsed))
    if (live.length === sels.length) return
    removedSel += sels.length - live.length
    if (!live.length) { rule.remove(); removedRules++ } else rule.selectors = live
  })
  // at-rules (media/container/supports) left empty
  ast.walkAtRules((a) => { if (/^(media|container|supports|layer)$/i.test(a.name) && a.nodes && !a.nodes.length) a.remove() })
  const out = ast.toString()
  totalBefore += src.length; totalAfter += out.length
  if (removedSel) console.log(path.relative(root, f).padEnd(40), `${removedRules} rules, ${removedSel} selectors, ${(src.length - out.length).toLocaleString()} bytes`)
  if (write && out !== src) fs.writeFileSync(f, out)
}
console.log(`total ${(totalBefore - totalAfter).toLocaleString()} of ${totalBefore.toLocaleString()} bytes${write ? ' removed' : ' removable'}`)
