import fs from 'fs'; import { PNG } from 'pngjs'
const ids = ['02','03','04','05','06','07','08','09','10']
const out = new PNG({ width: 960, height: 1200 })
ids.forEach((id, i) => {
  const g = PNG.sync.read(fs.readFileSync(`tools/golden/web-${id}.png`))
  const ox = (i % 3) * 320, oy = Math.floor(i / 3) * 400
  for (let y = 0; y < 400; y++) for (let x = 0; x < 320; x++) {
    const s = ((200 + y * 2) * g.width + 1280 + x * 2) * 4, d = ((oy + y) * 960 + ox + x) * 4
    for (let k = 0; k < 4; k++) out.data[d + k] = g.data[s + k]
  }
})
fs.writeFileSync('tools/out/panels.png', PNG.sync.write(out))
