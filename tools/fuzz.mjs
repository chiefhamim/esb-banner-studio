// Fuzz test: random operations (store + real mouse/keyboard), invariants checked after every step.
//   node tools/fuzz.mjs [ops=350] [seed=1]
import { chromium } from 'playwright-core'
import { spawn } from 'node:child_process'
import path from 'node:path'

const OPS = Number(process.argv[2] ?? 350)
let seed = Number(process.argv[3] ?? 1)
const rnd = () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
const pick = (a) => a[Math.floor(rnd() * a.length)]
const PORT = 5189
const root = path.resolve(import.meta.dirname, '..')
const vite = spawn(process.execPath, [path.join(root, 'node_modules', 'vite', 'bin', 'vite.js'), '--port', String(PORT), '--strictPort'], { cwd: root, stdio: 'ignore' })
for (let i = 0; i < 60; i++) { try { if ((await fetch(`http://localhost:${PORT}/`)).ok) break } catch {} await new Promise((r) => setTimeout(r, 500)) }

const HEADLINES = ['', 'A', 'Short headline', 'Solar-Powered Irrigation Systems Transforming Bangladesh’s Agricultural Sector', 'x'.repeat(140), 'Ünïcödé & emoji ⚡ test — 3–4 Months', 'Line one\nLine two', '   spaced   out   ', 'Tk 108.78 per Litre for October 2026 — BERC Sets Furnace Oil Price at a very long headline that keeps going and going']
const FORMATS = ['fb45', 'sq', 'social', 'web', 'yt']
let browser
let failure = null
const log = []
try {
  browser = await chromium.launch({ channel: 'msedge', headless: true })
  const page = await (await browser.newContext({ viewport: { width: 1500, height: 900 } })).newPage()
  page.setDefaultTimeout(6000)
  const errors = []
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message))
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()) })
  await page.goto(`http://localhost:${PORT}/`)
  await page.waitForSelector('.topbar'); await page.waitForTimeout(500)
  const ph = path.join(root, 'src/assets/images/sample-photo.jpg')
  await page.setInputFiles('input[type=file]', [ph, ph]); await page.waitForTimeout(600)

  const check = async () => page.evaluate(() => {
    const st = window.__store.getState()
    const bad = []
    for (const f of ['fb45', 'sq', 'social', 'web', 'yt']) {
      let sc
      try { sc = st.scene(f) } catch (e) { return ['scene(' + f + ') threw: ' + e.message] }
      for (const el of sc.elements) {
        for (const k of ['x', 'y', 'w', 'h', 'opacity']) if (!Number.isFinite(el[k])) bad.push(`${f}:${el.id}.${k}=${el[k]}`)
        if (el.w < 0 || el.h < 0) bad.push(`${f}:${el.id} negative size ${el.w}x${el.h}`)
        if (el.kind === 'text' && !(el.size > 0)) bad.push(`${f}:${el.id} text size ${el.size}`)
        if (el.kind === 'rect' && el.radius < 0) bad.push(`${f}:${el.id} radius ${el.radius}`)
      }
    }
    try { JSON.stringify(st.doc) } catch (e) { bad.push('doc not serialisable') }
    const have = new Set(st.scene().elements.map((e) => e.id))
    for (const id of st.selectedIds) if (!have.has(id)) bad.push('selected id missing: ' + id)
    if (st.selectedId && !st.selectedIds.includes(st.selectedId)) bad.push('primary not in selection')
    return bad
  })

  const ops = {
    addText: () => page.evaluate(() => window.__store.getState().addText()),
    addRect: () => page.evaluate(() => window.__store.getState().addRect()),
    addImage: () => page.evaluate(() => { const s = window.__store.getState(); if (s.images[0]) s.addImageLayer(s.images[0].id) }),
    duplicate: () => page.evaluate(() => window.__store.getState().duplicateSelected()),
    delete: () => page.evaluate(() => window.__store.getState().deleteSelected()),
    copyPaste: () => page.evaluate(() => { const s = window.__store.getState(); if (s.copySelected()) s.pasteClip(false) }),
    cut: () => page.evaluate(() => window.__store.getState().cutSelected()),
    paste: () => page.evaluate(() => window.__store.getState().pasteClip(Math.random() < 0.5)),
    undo: () => page.evaluate(() => window.__store.getState().undo()),
    redo: () => page.evaluate(() => window.__store.getState().redo()),
    align: () => page.evaluate((m) => window.__store.getState().alignSelected(m), pick(['left', 'hcenter', 'right', 'top', 'vcenter', 'bottom'])),
    distribute: () => page.evaluate((a) => window.__store.getState().distributeSelected(a), pick(['x', 'y'])),
    layerOrder: () => page.evaluate(([how, r]) => { const s = window.__store.getState(); const els = s.scene().elements; if (els.length) s.moveLayer(els[Math.floor(r * els.length)].id, how) }, [pick(['front', 'back', 'up', 'down']), rnd()]),
    format: () => page.evaluate((f) => window.__store.getState().setFormat(f), pick(FORMATS)),
    headline: () => page.evaluate((h) => window.__store.getState().setContent({ headline: h }), pick(HEADLINES)),
    category: () => page.evaluate((c) => window.__store.getState().setContent({ categoryId: c }), pick(['01', '02', '03', '04', '05', '06', '07', '08', '09', '10'])),
    highlight: () => page.evaluate((h) => window.__store.getState().setContent({ highlight: h }), pick(['', 'Month', 'zzz', 'Tk 108.78', '3–4'])),
    credit: () => page.evaluate((h) => window.__store.getState().setContent({ credit: h }), pick(['', 'Photo: PID', 'x'.repeat(120)])),
    pill: () => page.evaluate((v) => window.__store.getState().setContent({ showLinkPill: v, highlightOnSocial: !v }), rnd() < 0.5),
    collage: () => page.evaluate((c) => window.__store.getState().setCollage(c), pick(['single', 'two-cols', 'two-rows', 'big-left-2', 'big-right-2', 'big-top-2', 'big-bottom-2', 'three-cols', 'grid-2x2', 'big-left-3', 'big-top-3'])),
    override: () => page.evaluate(([r, patch]) => { const s = window.__store.getState(); const els = s.scene().elements; if (els.length) s.setOverride(els[Math.floor(r * els.length)].id, patch) }, [rnd(), pick([{ size: 6 }, { size: 400 }, { ls: -5 }, { ls: 30 }, { lh: 60 }, { lh: 300 }, { opacity: 0 }, { opacity: 0.5 }, { visible: false }, { visible: true }, { locked: true }, { locked: false }, { radius: 0 }, { radius: 200 }, { fill: '#123456' }, { color: '#ff00aa' }, { align: 'right' }, { weight: 500 }, { text: 'Edited\ntext' }, { w: 5 }, { w: 3000 }, { h: 1 }, { dx: 2000, dy: -2000 }, { font: 'oswald' }, { font: 'serif' }, { font: 'grotesk' }, { iconSize: 40 }, { iconSize: 2500 }, { iconDx: -900, iconDy: 900 }, { blur: 0 }, { blur: 120 }, { iconOpacity: 1 }, { iconStroke: 1 }, { iconStroke: 300 }, { shadow: { x: 0, y: 8, blur: 24, color: '#000000', alpha: 0.4 } }, { stroke: { color: '#fff', width: 8 } }])]),
    reset: () => page.evaluate((r) => { const s = window.__store.getState(); const els = s.scene().elements; if (els.length) s.resetOverride(els[Math.floor(r * els.length)].id) }, rnd()),
    resetAll: () => page.evaluate(() => window.__store.getState().resetAllOverrides()),
    newBanner: () => page.evaluate((k) => window.__store.getState().newBanner(k), rnd() < 0.5),
    selectSome: () => page.evaluate((r) => { const s = window.__store.getState(); const ids = s.scene().elements.map((e) => e.id).filter(() => Math.random() < r); s.selectMany(ids) }, rnd()),
    selectAll: () => page.evaluate(() => window.__store.getState().selectAll()),
    guide: () => page.evaluate(([a, v]) => window.__store.getState().addGuide(a, v), [pick(['x', 'y']), Math.round(rnd() * 1000)]),
    clearGuides: () => page.evaluate(() => window.__store.getState().clearGuides()),
    slotZoom: () => page.evaluate(([i, z, b]) => { const s = window.__store.getState(); s.setSlot(i, { zoom: z, panX: b, panY: -b }); s.setBackdrop(['blur', 'black', 'white', 'tint'][Math.floor(Math.abs(b) * 3.99)]) }, [Math.floor(rnd() * 2), pick([0.1, 0.3, 0.6, 1, 2.5, 6]), rnd() * 2 - 1]),
    creditStyle: () => page.evaluate((c) => window.__store.getState().setContent(c), { creditPos: pick(['bl', 'br', 'tl', 'tr']), creditSize: pick([10, 24, 80]), creditChip: rnd() < 0.5, creditFont: pick(['inter', 'grotesk', 'serif', 'oswald']), credit: pick(['Photo: PID', '', 'x'.repeat(90)]) }),
    label: () => page.evaluate((c) => window.__store.getState().setContent(c), { label: pick(['none', 'breaking', 'featured', 'trending', 'custom']), labelText: pick(['', 'Exclusive', 'x'.repeat(60)]), labelPos: pick(['tl', 'tr', 'bl', 'br', 'hc']), labelScale: pick([0.4, 1, 3]), labelColor: pick(['#dc2828', '#000000', '#ffffff']) }),
    zoom: () => page.evaluate((z) => window.__store.getState().setZoom(z), pick(['fit', 0.25, 1, 2, 4])),
    save: () => page.evaluate(async () => { const m = await import('/src/project.ts'); const t = await m.serializeProject(); await m.applyProject(t, 'fuzz', null) }),
    drag: async () => {
      const box = await page.evaluate(() => { const r = document.querySelector('.stage-overlay').getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height } })
      const mods = pick([[], [], ['Shift'], ['Alt'], ['Shift', 'Alt'], ['Control']])
      const from = { x: box.x + rnd() * box.w, y: box.y + rnd() * box.h }
      const to = { x: box.x + rnd() * box.w, y: box.y + rnd() * box.h }
      for (const m of mods) await page.keyboard.down(m)
      await page.mouse.move(from.x, from.y); await page.mouse.down(); await page.mouse.move(to.x, to.y, { steps: 4 }); await page.mouse.up()
      for (const m of mods) await page.keyboard.up(m)
    },
    handleDrag: async () => {
      const h = page.locator('.el-box.selected .handle')
      const n = await h.count()
      if (!n) return
      const b = await h.nth(Math.floor(rnd() * n)).boundingBox()
      if (!b) return
      const mods = pick([[], ['Shift'], ['Alt'], ['Shift', 'Alt']])
      for (const m of mods) await page.keyboard.down(m)
      await page.mouse.move(b.x + 5, b.y + 5); await page.mouse.down(); await page.mouse.move(b.x + 5 + (rnd() - 0.5) * 300, b.y + 5 + (rnd() - 0.5) * 300, { steps: 4 }); await page.mouse.up()
      for (const m of mods) await page.keyboard.up(m)
    },
    nudge: async () => { await page.keyboard.press(pick(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'])) },
    shortcut: async () => { await page.keyboard.press(pick(['Control+z', 'Control+Shift+z', 'Control+a', 'Control+d', 'Control+c', 'Control+v', 'Control+x', 'Delete', 'Escape', 'Control+0', 'Control+2'])) },
    dblclick: async () => {
      const box = await page.evaluate(() => { const r = document.querySelector('.stage-overlay').getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height } })
      await page.mouse.dblclick(box.x + rnd() * box.w, box.y + rnd() * box.h)
      if (await page.locator('textarea.inline-edit').count()) { await page.keyboard.type('fuzz'); await page.keyboard.press(rnd() < 0.5 ? 'Enter' : 'Escape') }
    },
  }
  const names = Object.keys(ops)
  const weights = { undo: 3, redo: 2, drag: 4, handleDrag: 4, override: 4, shortcut: 3, format: 2, headline: 2 }
  const bag = names.flatMap((n) => Array(weights[n] ?? 1).fill(n))

  for (let i = 0; i < OPS; i++) {
    const name = pick(bag)
    log.push(name)
    try { await ops[name]() } catch (e) { failure = { i, name, why: 'op threw: ' + e.message }; break }
    await page.waitForTimeout(8)
    const bad = await check()
    if (bad.length || errors.length) { failure = { i, name, why: [...bad.slice(0, 5), ...errors.slice(0, 3)].join(' | ') }; break }
  }
  console.log(failure ? `FAIL at op ${failure.i} (${failure.name}): ${failure.why}\nlast ops: ${log.slice(-10).join(', ')}` : `PASS ${OPS} random operations, no errors, all invariants held`)
} catch (e) {
  console.log('FUZZ ERROR', e.stack ?? e.message)
  failure = { why: String(e) }
} finally {
  await browser?.close().catch(() => {})
  vite.kill()
}
process.exit(failure ? 1 : 0)
