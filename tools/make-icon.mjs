// Draw the app icon (green tile + "ESB" in Inter ExtraBold) with the real browser canvas, write PNG + ICO.
import { chromium } from 'playwright-core'
import fs from 'node:fs'
import path from 'node:path'
const root = path.resolve(import.meta.dirname, '..')
const font = fs.readFileSync(path.join(root, 'src/assets/fonts/Inter-800.woff2')).toString('base64')
const b = await chromium.launch({ channel: 'msedge', headless: true })
const p = await b.newPage()
await p.setContent('<canvas id=c width=256 height=256></canvas>')
const dataUrl = await p.evaluate(async (f) => {
  const face = new FontFace('InterX', `url(data:font/woff2;base64,${f})`, { weight: '800' })
  await face.load(); document.fonts.add(face)
  const c = document.getElementById('c'), x = c.getContext('2d')
  const g = x.createLinearGradient(0, 0, 256, 256); g.addColorStop(0, '#22a455'); g.addColorStop(1, '#0f6b3a')
  x.fillStyle = g; x.beginPath(); x.roundRect(8, 8, 240, 240, 52); x.fill()
  x.fillStyle = '#ec8e3c'; x.beginPath(); x.roundRect(8, 196, 240, 12, 0); x.fill()
  x.fillStyle = '#e52d2d'; x.fillRect(8, 184, 240, 12)
  x.fillStyle = '#fff'; x.font = '800 104px InterX'; x.textAlign = 'center'; x.textBaseline = 'alphabetic'
  x.fillText('ESB', 128, 150)
  return c.toDataURL('image/png')
}, font)
await b.close()
const png = Buffer.from(dataUrl.split(',')[1], 'base64')
fs.writeFileSync(path.join(root, 'build/icon.png'), png)
// ICO with one embedded 256x256 PNG
const hdr = Buffer.alloc(22); hdr.writeUInt16LE(0, 0); hdr.writeUInt16LE(1, 2); hdr.writeUInt16LE(1, 4)
hdr[6] = 0; hdr[7] = 0; hdr[8] = 0; hdr[9] = 0; hdr.writeUInt16LE(1, 10); hdr.writeUInt16LE(32, 12); hdr.writeUInt32LE(png.length, 14); hdr.writeUInt32LE(22, 18)
fs.writeFileSync(path.join(root, 'build/icon.ico'), Buffer.concat([hdr, png]))
console.log('icon written', png.length, 'bytes')
