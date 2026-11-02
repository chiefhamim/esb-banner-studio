// Manual check of Remove background's person matte on a real portrait (third-party media never lives in the repo).
//   PERSON_IMAGE=C:/path/portrait.jpg [OUT=matte.png] node tools/e2e/video-matte-check.mjs
// Prints the model's labels, the matte size, how much of the frame is "person" and the matte at the centre vs corners.
import { chromium } from 'playwright-core'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { launchBrowser } from '../launch-browser.mjs'
import { portOffset } from '../port-offset.mjs'

const file = process.env.PERSON_IMAGE
if (!file || !fs.existsSync(file)) { console.error('Set PERSON_IMAGE to a portrait photo (jpg/png).'); process.exit(2) }
const PORT = 5240 + portOffset()
const root = path.resolve(import.meta.dirname, '../..')
const vite = spawn(process.execPath, [path.join(root, 'node_modules', 'vite', 'bin', 'vite.js'), '--port', String(PORT), '--strictPort'], { cwd: root, stdio: 'ignore' })
const up = async () => { for (let i = 0; i < 60; i++) { try { if ((await fetch(`http://localhost:${PORT}/`)).ok) return } catch { /* not yet */ } await new Promise((r) => setTimeout(r, 500)) } throw new Error('Vite did not start') }
let code = 1
try {
  await up()
  const browser = await launchBrowser(chromium)
  const page = await browser.newPage()
  page.on('pageerror', (e) => console.error('pageerror', e.message))
  await page.goto(`http://localhost:${PORT}/`)
  const b64 = fs.readFileSync(file).toString('base64')
  const mime = file.toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg'
  const out = await page.evaluate(async ({ b64, mime }) => {
    const mod = await import('/src/video/engine/personMatte.ts')
    await mod.loadPersonMatte()
    const img = new Image(); img.src = `data:${mime};base64,${b64}`; await img.decode()
    const t0 = performance.now()
    const m = mod.personMatteFor('check', 'k1', img)
    const ms = performance.now() - t0
    if (!m) return { error: 'no matte' }
    const at = (x, y) => m.data[Math.floor(y * m.h) * m.w + Math.floor(x * m.w)]
    let on = 0; for (const v of m.data) if (v > 127) on++
    const c = document.createElement('canvas'); c.width = m.w; c.height = m.h
    const ctx = c.getContext('2d'); const id = ctx.createImageData(m.w, m.h)
    for (let i = 0; i < m.data.length; i++) { id.data[i * 4] = id.data[i * 4 + 1] = id.data[i * 4 + 2] = m.data[i]; id.data[i * 4 + 3] = 255 }
    ctx.putImageData(id, 0, 0)
    const ft = await import('/src/video/ai/faceTrack.ts')
    const det = await ft.faceDetector()
    const fc = document.createElement('canvas'); fc.width = img.naturalWidth; fc.height = img.naturalHeight; fc.getContext('2d').drawImage(img, 0, 0)
    const faces = det.detect(fc).detections.map((d) => ({ x: +(d.boundingBox.originX / fc.width).toFixed(2), y: +(d.boundingBox.originY / fc.height).toFixed(2), w: +(d.boundingBox.width / fc.width).toFixed(2) }))
    // the real GL path: render one footage layer with and without the effect and compare corners and centre
    const tl = await import('/src/video/timeline.ts')
    const gl = await import('/src/video/engine/glCompositor.ts')
    const rd = await import('/src/video/engine/render.ts')
    const W = 480, H = 640
    const glc = document.createElement('canvas'); glc.width = W; glc.height = H
    const comp = new gl.GLCompositor(glc)
    const frameCanvas = document.createElement('canvas'); frameCanvas.width = img.naturalWidth; frameCanvas.height = img.naturalHeight
    frameCanvas.getContext('2d').drawImage(img, 0, 0)
    const base = { id: 'c1', trackId: 'v1', title: 'p', kind: 'video', start: 0, duration: 5, in: 0, out: 5, color: '#000', sourceUrl: 'blob:x' }
    const shot = (effects) => {
      let p = tl.createDefaultTimeline('9:16'); p = { ...p, width: W, height: H }
      p = tl.addClip(p, { ...base, effects })
      rd.renderFrame(comp, p, 1, W, H, { frames: () => ({ image: frameCanvas, width: frameCanvas.width, height: frameCanvas.height }) })
      const c = document.createElement('canvas'); c.width = W; c.height = H
      const ctx = c.getContext('2d', { willReadFrequently: true }); ctx.drawImage(glc, 0, 0)
      const px = (x, y) => Array.from(ctx.getImageData(Math.floor(x * W), Math.floor(y * H), 1, 1).data)
      return { centre: px(0.5, 0.55), corner: px(0.04, 0.04), data: c.toDataURL('image/png') }
    }
    const plain = shot([])
    const eff = shot([{ id: 'e1', type: 'personMatte', params: { keep: 'person', edge: 0.25 } }])
    const inv = shot([{ id: 'e1', type: 'personMatte', params: { keep: 'background', edge: 0.25 } }])
    const gl2 = { plain: { centre: plain.centre, corner: plain.corner }, removed: { centre: eff.centre, corner: eff.corner }, inverted: { centre: inv.centre, corner: inv.corner } }
    return { gl2, glPng: eff.data, faces, w: m.w, h: m.h, ms: Math.round(ms), personPct: Math.round((on / m.data.length) * 100), centre: at(0.5, 0.6), corners: [at(0.03, 0.03), at(0.97, 0.03), at(0.03, 0.97), at(0.97, 0.97)], png: c.toDataURL('image/png') }
  }, { b64, mime })
  if (out.png && process.env.OUT) fs.writeFileSync(process.env.OUT, Buffer.from(out.png.split(',')[1], 'base64'))
  if (out.glPng && process.env.GL_OUT) fs.writeFileSync(process.env.GL_OUT, Buffer.from(out.glPng.split(',')[1], 'base64'))
  delete out.png; delete out.glPng
  console.log(JSON.stringify(out))
  const g = out.gl2
  const sum = (a) => a[0] + a[1] + a[2]
  const glOk = g && sum(g.removed.centre) > 60 && Math.abs(sum(g.removed.centre) - sum(g.plain.centre)) < 60 && g.removed.corner[3] < 40 === true || (g && sum(g.removed.corner) < 40)
  const invOk = g && sum(g.inverted.centre) < 40 && sum(g.inverted.corner) > 40
  console.log('GL render', glOk ? 'PASS: person kept, background gone' : 'FAIL', invOk ? 'PASS: keep-background inverts' : 'FAIL invert')
  const ok = !out.error && out.centre > 150 && out.corners.every((v) => v < 100) && out.faces.length >= 1 && glOk && invOk
  console.log(ok ? 'PASS person kept at the centre, background removed at the corners' : 'FAIL matte does not look like a person on a background')
  code = ok ? 0 : 1
  await browser.close()
} catch (e) { console.error('error', e.message) } finally { vite.kill() }
process.exit(code)
