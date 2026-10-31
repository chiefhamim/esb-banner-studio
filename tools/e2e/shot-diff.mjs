// Pixel diffs for before/after screenshot pairs made by tools/e2e/overnight-shots.mjs.
//
//   node tools/e2e/shot-diff.mjs <dir> [--before before] [--after after] [--threshold 0.1]
//
// For every `<name>--<before>.png` in <dir> with a matching `<name>--<after>.png`, writes `<name>--diff.png`
// and prints the mismatch as a percentage of pixels. A pair whose images differ in size is an error (the
// directive requires identical viewport and state); a before without an after is reported as missing.
// Exits non-zero on any error or missing pair, so it can gate a step. The table is also written to
// `<dir>/diff-table.md` for the ledger.
import fs from 'node:fs'
import path from 'node:path'
import { PNG } from 'pngjs'
import pixelmatch from 'pixelmatch'

const argv = process.argv.slice(2)
const dir = argv.find((a) => !a.startsWith('--'))
const opt = (k, d) => { const i = argv.indexOf('--' + k); return i >= 0 ? argv[i + 1] : d }
if (!dir) { console.error('usage: node tools/e2e/shot-diff.mjs <dir> [--before before] [--after after] [--threshold 0.1]'); process.exit(2) }
const BEFORE = opt('before', 'before'), AFTER = opt('after', 'after'), threshold = Number(opt('threshold', '0.1'))

const files = fs.readdirSync(dir)
const befores = files.filter((f) => f.endsWith(`--${BEFORE}.png`))
const rows = []
let bad = 0
for (const bf of befores) {
  const name = bf.slice(0, -(`--${BEFORE}.png`.length))
  const af = `${name}--${AFTER}.png`
  if (!files.includes(af)) { rows.push([name, '—', 'MISSING after']); bad++; continue }
  const a = PNG.sync.read(fs.readFileSync(path.join(dir, bf)))
  const b = PNG.sync.read(fs.readFileSync(path.join(dir, af)))
  if (a.width !== b.width || a.height !== b.height) { rows.push([name, `${a.width}×${a.height} vs ${b.width}×${b.height}`, 'SIZE MISMATCH']); bad++; continue }
  const diff = new PNG({ width: a.width, height: a.height })
  const n = pixelmatch(a.data, b.data, diff.data, a.width, a.height, { threshold })
  fs.writeFileSync(path.join(dir, `${name}--diff.png`), PNG.sync.write(diff))
  const pct = (n / (a.width * a.height)) * 100
  rows.push([name, `${a.width}×${a.height}`, `${pct.toFixed(3)} % (${n} px)`])
}
const table = ['| pair | size | mismatch |', '|---|---|---|', ...rows.map((r) => `| ${r.join(' | ')} |`)].join('\n')
fs.writeFileSync(path.join(dir, 'diff-table.md'), `# Screenshot diffs — ${path.basename(dir)}\n\n${table}\n`)
console.log(table)
if (!befores.length) { console.log(`no *--${BEFORE}.png in ${dir}`); process.exit(1) }
console.log(bad ? `SOME FAILED (${bad})` : 'ALL PASS')
process.exit(bad ? 1 : 0)
