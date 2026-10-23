// Ink bounding boxes of dark text in a region, for golden vs mine.
import fs from 'node:fs'
import { PNG } from 'pngjs'
const [,, a, b, ...regs] = process.argv
const A = PNG.sync.read(fs.readFileSync(a)), B = PNG.sync.read(fs.readFileSync(b))
function bbox(P, [x, y, w, h], tgt, tol) {
  let x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1
  for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) {
    const k = (j * P.width + i) * 4
    const d = Math.abs(P.data[k] - tgt[0]) + Math.abs(P.data[k + 1] - tgt[1]) + Math.abs(P.data[k + 2] - tgt[2])
    if (d < tol) { if (i < x0) x0 = i; if (i > x1) x1 = i; if (j < y0) y0 = j; if (j > y1) y1 = j }
  }
  return [x0, y0, x1, y1]
}
for (const r of regs) {
  const [name, rx, ry, rw, rh, hex] = r.split(',')
  const t = [parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2, 4), 16), parseInt(hex.slice(4, 6), 16)]
  const g = bbox(A, [+rx, +ry, +rw, +rh], t, 90), m = bbox(B, [+rx, +ry, +rw, +rh], t, 90)
  console.log(name.padEnd(14), 'figma', g.join(','), '| mine', m.join(','), '| dx0', m[0] - g[0], 'dx1', m[2] - g[2], 'dy0', m[1] - g[1], 'dy1', m[3] - g[3])
}
