// Records a ~30 s scripted demo of the app: CDP screencast frames -> ffmpeg -> 720p H.264 MP4 (WhatsApp friendly).
import { chromium } from 'playwright-core'
import { launchBrowser } from './launch-browser.mjs'
import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const PORT = 5196
const root = path.resolve(import.meta.dirname, '..')
const work = process.argv[2] ?? path.join(root, 'tools', 'out', 'demo-work')
const outMp4 = process.argv[3] ?? path.join(root, 'tools', 'out', 'ESB-Banner-Studio-demo.mp4')
fs.rmSync(work, { recursive: true, force: true })
fs.mkdirSync(path.join(work, 'frames'), { recursive: true })

const vite = spawn(process.execPath, [path.join(root, 'node_modules', 'vite', 'bin', 'vite.js'), '--port', String(PORT), '--strictPort'], { cwd: root, stdio: 'ignore' })
for (let i = 0; i < 60; i++) { try { if ((await fetch(`http://localhost:${PORT}/`)).ok) break } catch {} await new Promise((r) => setTimeout(r, 500)) }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let browser
const frames = [] // { file, t }
try {
  browser = await launchBrowser(chromium)
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 810 }, deviceScaleFactor: 1.5, acceptDownloads: true })
  const page = await ctx.newPage()
  page.setDefaultTimeout(10000)

  // ---- overlays injected into the page: cursor + caption + title cards
  await page.addInitScript(() => {
    const css = `
      #d-cursor{position:fixed;left:-50px;top:-50px;width:26px;height:26px;z-index:99999;pointer-events:none;filter:drop-shadow(0 2px 3px rgba(0,0,0,.55));transition:transform .08s}
      #d-cursor.down{transform:scale(.82)}
      .d-ripple{position:fixed;width:14px;height:14px;margin:-7px 0 0 -7px;border-radius:50%;border:3px solid #2cc07a;z-index:99998;pointer-events:none;animation:d-rip .55s ease-out forwards}
      @keyframes d-rip{to{transform:scale(4);opacity:0}}
      #d-cap{position:fixed;left:50%;bottom:50px;transform:translateX(-50%) translateY(8px);z-index:99997;display:flex;align-items:center;gap:14px;padding:11px 26px 11px 12px;border-radius:40px;background:rgba(10,12,16,.88);border:1px solid rgba(255,255,255,.14);color:#fff;font:600 23px 'Segoe UI Variable Display','Segoe UI',sans-serif;opacity:0;transition:opacity .3s,transform .3s;box-shadow:0 10px 40px rgba(0,0,0,.5);white-space:nowrap}
      #d-cap.on{opacity:1;transform:translateX(-50%)}
      #d-cap b{display:grid;place-items:center;width:34px;height:34px;border-radius:50%;background:#2cc07a;color:#04170d;font-size:19px}
      #d-card{position:fixed;inset:0;z-index:100000;display:grid;place-content:center;justify-items:center;gap:18px;background:radial-gradient(circle at 50% 40%,#16352a,#0c0e11 70%);color:#fff;font-family:'Segoe UI Variable Display','Segoe UI',sans-serif;opacity:1;transition:opacity .6s;text-align:center}
      #d-card.off{opacity:0;pointer-events:none}
      #d-card .logo{background:linear-gradient(135deg,#22a455,#0f6b3a);font-weight:800;font-size:54px;padding:6px 22px;border-radius:16px;letter-spacing:2px;box-shadow:inset 0 -9px 0 #e52d2d}
      #d-card h1{margin:0;font-size:52px;font-weight:700;letter-spacing:-.5px}
      #d-card p{margin:0;font-size:25px;color:#aab6b0}
    `
    const mount = () => {
      const st = document.createElement('style'); st.textContent = css; document.head.appendChild(st)
      document.body.insertAdjacentHTML('beforeend', `
        <svg id="d-cursor" viewBox="0 0 24 24"><path d="M4 3l16 7.4-6.6 2.1-2.2 6.7z" fill="#fff" stroke="#111" stroke-width="1.4" stroke-linejoin="round"/></svg>
        <div id="d-cap"><b></b><span></span></div>
        <div id="d-card"><div class="logo">ESB</div><h1></h1><p></p></div>`)
      const cur = document.getElementById('d-cursor')
      window.addEventListener('mousemove', (e) => { cur.style.left = e.clientX - 3 + 'px'; cur.style.top = e.clientY - 2 + 'px' }, true)
      window.addEventListener('mousedown', (e) => {
        cur.classList.add('down')
        const r = document.createElement('div'); r.className = 'd-ripple'; r.style.left = e.clientX + 'px'; r.style.top = e.clientY + 'px'
        document.body.appendChild(r); setTimeout(() => r.remove(), 600)
      }, true)
      window.addEventListener('mouseup', () => cur.classList.remove('down'), true)
    }
    if (document.body) mount(); else document.addEventListener('DOMContentLoaded', mount)
    window.__cap = (n, text) => {
      const c = document.getElementById('d-cap')
      if (!text) { c.classList.remove('on'); return }
      c.querySelector('b').textContent = n; c.querySelector('span').textContent = text; c.classList.add('on')
    }
    window.__card = (show, title, sub) => {
      const c = document.getElementById('d-card')
      if (title !== undefined) { c.querySelector('h1').textContent = title; c.querySelector('p').textContent = sub ?? '' }
      c.classList.toggle('off', !show)
    }
  })

  await page.goto(`http://localhost:${PORT}/`)
  await page.waitForSelector('.topbar')
  await page.evaluate(() => window.__card(true, 'ESB Studio', 'News banners — exact, fast, on-brand'))

  // ---- photo variants (clean crops of the sample, no baked-in banner)
  const crops = await page.evaluate(async () => {
    const img = new Image(); img.src = new URL('/src/assets/images/sample-photo.jpg', location.href).href
    await img.decode()
    const mk = (x, y, w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; c.getContext('2d').drawImage(img, x, y, w, h, 0, 0, w, h); return c.toDataURL('image/jpeg', 0.92) }
    return [mk(0, 108, 1110, 710), mk(0, 108, 640, 710), mk(470, 108, 640, 710)]
  })
  const photos = crops.map((d, i) => { const f = path.join(work, `photo-${i + 1}.jpg`); fs.writeFileSync(f, Buffer.from(d.split(',')[1], 'base64')); return f })

  // ---- screencast
  const cdp = await ctx.newCDPSession(page)
  let n = 0
  cdp.on('Page.screencastFrame', async (f) => {
    const file = path.join(work, 'frames', String(n++).padStart(5, '0') + '.jpg')
    fs.writeFileSync(file, Buffer.from(f.data, 'base64'))
    frames.push({ file, t: f.metadata.timestamp })
    cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {})
  })
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 92, maxWidth: 2160, maxHeight: 1215, everyNthFrame: 1 })

  // ---- helpers
  let mx = 720, my = 420
  const glide = async (x, y, ms = 650) => {
    const steps = Math.max(8, Math.round(ms / 22))
    const x0 = mx, y0 = my
    for (let i = 1; i <= steps; i++) {
      const t = i / steps, e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2
      await page.mouse.move(x0 + (x - x0) * e, y0 + (y - y0) * e)
      await sleep(20)
    }
    mx = x; my = y
  }
  const centerOf = async (loc) => { const b = await loc.boundingBox(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 } }
  const clickAt = async (loc, ms) => { const c = await centerOf(loc); await glide(c.x, c.y, ms); await page.mouse.down(); await sleep(70); await page.mouse.up(); await sleep(120) }
  const dragBy = async (from, dx, dy, ms = 700) => {
    await glide(from.x, from.y, 450); await page.mouse.down(); await sleep(90)
    await glide(from.x + dx, from.y + dy, ms); await page.mouse.up(); await sleep(150)
  }
  const stage = async () => page.evaluate(() => { const r = document.querySelector('.stage-overlay').getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height } })
  const propVal = async (label) => parseFloat(await page.inputValue(`.right .scrub:has(.scrub-label:text-is("${label}")) input`))
  const cap = (n, t) => page.evaluate(([a, b]) => window.__cap(a, b), [n, t])

  // ============================================================ SCENES
  await sleep(1700)                                   // intro card
  await page.evaluate(() => window.__card(false))
  await sleep(650)

  // 1 · category, headline, date
  await cap(1, 'Pick a category · type the headline')
  await clickAt(page.locator('.cat:has-text("Renewables")'), 800)
  await sleep(250)
  const area = page.locator('.pnl-body textarea.input')
  await clickAt(area, 600)
  await page.keyboard.press('Control+a')
  await page.keyboard.type('Solar-Powered Irrigation Transforming Bangladesh’s Agricultural Sector', { delay: 26 })
  await sleep(300)
  await clickAt(page.locator('button[aria-label="Next day"]'), 500)
  await sleep(500)

  // 2 · photos + collage
  await cap(2, 'Drop in photos · pick a collage')
  await clickAt(page.locator('.side-tabs button:has-text("Photos")'), 650)
  await page.setInputFiles('input[type=file]', photos)
  await sleep(900)
  await clickAt(page.locator('.collage-btn[title="Three columns"]'), 700)
  await sleep(450)
  await clickAt(page.locator('.collage-btn[title="Big left + 2 right"]'), 450)
  await sleep(400)
  let sb = await stage(); const sc = sb.w / 1598
  const p1 = { x: sb.x + 330 * sc, y: sb.y + 640 * sc }
  await glide(p1.x, p1.y, 500)
  await page.mouse.click(p1.x, p1.y)
  await page.mouse.wheel(0, -260); await sleep(250); await page.mouse.wheel(0, -200); await sleep(350)
  await dragBy(p1, -70 * sc, 25 * sc, 600)

  // 3 · edit anything
  await cap(3, 'Edit anything · move, align, restyle')
  await page.keyboard.press('Escape')
  await clickAt(page.locator('.side-tabs button:has-text("Story")'), 500)
  sb = await stage()
  await clickAt(page.locator('button[aria-label="Add text (T)"]').first(), 600)
  await sleep(300)
  const tx = await propVal('X'), ty = await propVal('Y'), tw = await propVal('W'), th = await propVal('H')
  await page.mouse.dblclick(sb.x + (tx + tw / 2) * sc, sb.y + (ty + th / 2) * sc)
  await sleep(300)
  await page.keyboard.press('Control+a')
  await page.keyboard.type('BREAKING', { delay: 70 })
  await page.keyboard.press('Enter')
  await sleep(300)
  const sizeIn = page.locator('.right .scrub:has(.scrub-label:text-is("Size")) input')
  await clickAt(sizeIn, 500)
  await page.keyboard.type('120'); await page.keyboard.press('Enter')
  await sleep(300)
  await clickAt(page.locator('.right .colorfield .cf-swatch').first(), 650)
  await sleep(250)
  await clickAt(page.locator('.colorpop .cp-sw').nth(4), 450)
  await page.keyboard.press('Escape')
  await sleep(250)
  const nx = await propVal('X'), ny = await propVal('Y'), nw = await propVal('W'), nh = await propVal('H')
  await dragBy({ x: sb.x + (nx + nw / 2) * sc, y: sb.y + (ny + nh / 2) * sc }, -(nx + nw / 2 - 360) * sc, -(ny + nh / 2 - 400) * sc, 800)
  await sleep(400)

  // 4 · web
  await cap(4, 'Facebook and Web — both built for you')
  await page.keyboard.press('Escape')
  await clickAt(page.locator('.formats button:has-text("Web")'), 800)
  await sleep(1200)

  // 5 · export
  await cap(5, 'Export both at exact sizes')
  await clickAt(page.locator('button:has-text("Export both")'), 800)
  await sleep(1700)
  await cap(0, '')

  // end card
  await page.evaluate(() => window.__card(true, 'ESB Studio', 'Exact templates · full control · seconds, not hours'))
  await sleep(2200)

  await cdp.send('Page.stopScreencast')
  await sleep(200)
} finally {
  await browser?.close().catch(() => {})
  vite.kill()
}

// ---- assemble: concat list with real frame durations -> 30 fps -> 720p mp4
frames.sort((a, b) => a.t - b.t)
const lines = []
frames.forEach((f, i) => {
  const dur = i < frames.length - 1 ? frames[i + 1].t - f.t : 0.6
  lines.push(`file '${f.file.replace(/\\/g, '/')}'`, `duration ${Math.max(dur, 0.001).toFixed(4)}`)
})
lines.push(`file '${frames[frames.length - 1].file.replace(/\\/g, '/')}'`)
const list = path.join(work, 'list.txt')
fs.writeFileSync(list, lines.join('\n'))
const total = frames[frames.length - 1].t - frames[0].t + 0.6
console.log('captured', frames.length, 'frames, real duration', total.toFixed(1), 's')
const factor = process.env.FIT ? 30 / total : 1
const r = spawnSync('ffmpeg', ['-y', '-f', 'concat', '-safe', '0', '-i', list,
  '-vf', `setpts=${factor.toFixed(5)}*PTS,fps=30,scale=1280:720:flags=lanczos,format=yuv420p`,
  '-t', '30', '-c:v', 'libx264', '-preset', 'slow', '-crf', '23', '-movflags', '+faststart', '-an', outMp4], { stdio: 'inherit' })
console.log('ffmpeg exit', r.status, fs.existsSync(outMp4) ? (fs.statSync(outMp4).size / 1e6).toFixed(2) + ' MB' : 'missing')
