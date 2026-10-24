// End-to-end test of the editor UI in real Edge.
import { chromium } from 'playwright-core'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { PNG } from 'pngjs'
import { launchBrowser } from './launch-browser.mjs'

const PORT = 5198
const root = path.resolve(import.meta.dirname, '..')
const out = path.join(root, 'tools', 'out')
fs.mkdirSync(out, { recursive: true })
const vite = spawn(process.execPath, [path.join(root, 'node_modules', 'vite', 'bin', 'vite.js'), '--port', String(PORT), '--strictPort'], { cwd: root, stdio: 'ignore' })
const waitUp = async () => { for (let i = 0; i < 60; i++) { try { if ((await fetch(`http://localhost:${PORT}/`)).ok) return } catch {} await new Promise((r) => setTimeout(r, 500)) } throw new Error('vite did not start') }
let browser
const results = []
const check = (name, ok, extra = '') => { results.push(ok); console.log(ok ? 'PASS' : 'FAIL', name, extra) }
const W = 1080 // default format: Facebook 4:5

try {
  await waitUp()
  browser = await launchBrowser(chromium)
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 950 }, acceptDownloads: true })
  const page = await ctx.newPage()
  await ctx.addInitScript(() => { try { if (!localStorage.getItem('esb-banner-studio/dock-tab')) localStorage.setItem('esb-banner-studio/dock-tab', 'layers') } catch {} })
  page.setDefaultTimeout(8000)
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
  await page.goto(`http://localhost:${PORT}/`)
  await page.waitForSelector('.topbar')
  await page.waitForTimeout(500)

  // A fresh launch shows one open section on the Story tab — Category — and no logo in the header
  const fresh = await page.evaluate(() => ({ open: [...document.querySelectorAll('.left .pnl.open')].map((p) => p.dataset.panel), logo: document.querySelectorAll('.topbar img[src*="esb-logo"]').length, sw: document.querySelectorAll('.topbar .ws-switch').length }))
  check('fresh launch: only Category is open, header has the workspace switcher and no logo', fresh.open.join() === 'Category' && fresh.logo === 0 && fresh.sw === 1, JSON.stringify(fresh))
  // The rest of this suite exercises the canvas through the panels it was written against: open those for every load.
  // (seeded once per tab, so a panel the suite closes stays closed across its own reloads)
  await ctx.addInitScript(() => {
    try {
      if (sessionStorage.getItem('esb-test/panels-seeded')) return
      sessionStorage.setItem('esb-test/panels-seeded', '1')
      for (const t of ['Date', 'Quote Statement', 'Data & Stat Callout', 'Headline', 'Optimal image dimensions', 'Collage', 'Slots & framing']) sessionStorage.setItem('esb-banner-studio/panel/' + t, '1')
    } catch {}
  })
  await page.reload()
  await page.waitForSelector('.topbar')
  await page.waitForTimeout(500)

  // Side panels are an accordion: open the section a step needs, as a user would
  const openPanel = async (title) => {
    const sel = `.left [data-panel="${title}"]`
    if (!(await page.locator(`${sel}.open`).count())) await page.click(`${sel} > header`)
    await page.waitForSelector(`${sel}.open > .pnl-body`)
  }
  const HL = '.left [data-panel="Headline"] textarea.input'
  const headlineValue = async () => { await openPanel('Headline'); return page.inputValue(HL) }
  const stageBox = async () => page.evaluate(() => { const r = document.querySelector('.stage-overlay').getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height } })
  const propVal = async (label) => parseFloat(await page.inputValue(`.right .scrub:has(.scrub-label:text-is("${label}")) input`))
  const esc = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const layerRow = (name) => page.locator('.layer', { has: page.locator('.name', { hasText: new RegExp('^' + esc(name) + '$') }) })
  const toClient = (sb, sc, x, y) => ({ x: sb.x + x * sc, y: sb.y + y * sc })
  const drag = async (from, to, mods = []) => {
    for (const m of mods) await page.keyboard.down(m)
    await page.mouse.move(from.x, from.y); await page.mouse.down(); await page.mouse.move(to.x, to.y, { steps: 8 }); await page.mouse.up()
    for (const m of mods) await page.keyboard.up(m)
  }

  // ---- defaults: Facebook 4:5
  check('default format is Facebook 4:5 (1080 x 1350)', (await page.textContent('.statusbar')).includes('1080 × 1350'))
  await page.setInputFiles('input[type=file]', path.join(root, 'src/assets/images/sample-photo.jpg'))
  await page.waitForTimeout(300)
  await openPanel('Category')
  await page.click('.cat:has-text("Renewables")')
  await openPanel('Headline'); await page.fill(HL, "Solar-Powered Irrigation Systems Transforming Bangladesh's Agricultural Sector")
  await openPanel('Date')
  await page.click('.datefield')
  await page.click('.cal-day:not(.out):text-is("19")')
  await page.keyboard.press('Escape')
  await page.waitForTimeout(300)
  await page.evaluate(() => window.__store.getState().setRulers(true))
  await page.waitForTimeout(150)
  let sb = await stageBox()
  let sc = sb.w / W
  check('canvas fits the window (rulers present)', sb.h > 300 && (await page.locator('.ruler').count()) === 2, `${Math.round(sb.w)}x${Math.round(sb.h)}`)

  // ---- drag, undo, resize
  await layerRow('Date number').click()
  const x0 = await propVal('X'), y0 = await propVal('Y'), w0 = await propVal('W'), h0 = await propVal('H')
  const c = toClient(sb, sc, x0 + w0 / 2, y0 + h0 / 2)
  await drag(c, { x: c.x - 60, y: c.y + 40 })
  const x1 = await propVal('X'), y1 = await propVal('Y')
  check('drag moves element', Math.abs((x1 - x0) + 60 / sc) < 12 && Math.abs((y1 - y0) - 40 / sc) < 12, `dx=${(x1 - x0).toFixed(1)} dy=${(y1 - y0).toFixed(1)}`)
  await page.keyboard.press('Control+z')
  await page.waitForTimeout(80) // let React apply the undo before reading the field
  check('Ctrl+Z restores position', Math.abs((await propVal('X')) - x0) < 0.6)
  await layerRow('Date number').click()
  const sizeBefore = await propVal('Size')
  const hb = await page.locator('.el-box.selected .handle').nth(2).boundingBox()
  await drag({ x: hb.x + hb.width / 2, y: hb.y + hb.height / 2 }, { x: hb.x + 50, y: hb.y + 30 })
  check('corner handle scales text', (await propVal('Size')) > sizeBefore)
  await page.keyboard.press('Control+z')

  // ---- nothing is locked, and backgrounds never steal a click: they move from their tag
  await page.keyboard.press('Escape')
  const hx = toClient(sb, sc, 520, 120)
  await page.mouse.click(hx.x, hx.y)
  check('clicking bare canvas leaves nothing selected', (await page.locator('.el-box.selected').count()) === 0 && (await page.textContent('.right .pnl h3')) === 'Inspector')
  await layerRow('Header background').click()
  const tagBox = await page.locator('.el-box.selected .el-tag').boundingBox()
  const hdrX0 = await propVal('X')
  await drag({ x: tagBox.x + 8, y: tagBox.y + 6 }, { x: tagBox.x + 48, y: tagBox.y + 6 })
  check('a selected background moves by its tag (no unlocking)', (await propVal('X')) > hdrX0 + 5, `x ${hdrX0} -> ${await propVal('X')}`)
  await page.keyboard.press('Control+z')
  check('background lock is off by default', (await page.locator('.layer .icon-btn[title="Unlock"]').count()) === 0)

  // ---- custom dropdown + scrub
  await layerRow('Month + year').click()
  await page.click('.right .grid2 .select')
  await page.click('.popover .menu-item:has-text("Medium")')
  check('custom dropdown changes weight', (await page.textContent('.right .grid2 .select .select-label')).includes('Medium'))
  const sz = await propVal('Size')
  const lb = await page.locator('.right .scrub:has(.scrub-label:text-is("Size")) .scrub-label').boundingBox()
  await drag({ x: lb.x + 8, y: lb.y + 8 }, { x: lb.x + 28, y: lb.y + 8 })
  check('dragging a label scrubs the value', (await propVal('Size')) > sz, `${sz} -> ${await propVal('Size')}`)
  await page.keyboard.press('Control+z'); await page.keyboard.press('Control+z')

  // ---- hide template element
  await layerRow('Weekday').click()
  await page.keyboard.press('Delete')
  check('Delete hides template element', (await page.locator('.layer.off', { hasText: 'Weekday' }).count()) === 1)

  // ---- custom layers + modifier-key resizing
  await page.keyboard.press('r')
  await page.waitForTimeout(200)
  check('R adds a rectangle layer', (await layerRow('Rectangle').count()) === 1)
  const rw = await propVal('W'), rh = await propVal('H')
  sb = await stageBox(); sc = sb.w / W
  const se = page.locator('.el-box.selected .handle').nth(4)
  const sbx = await se.boundingBox()
  await drag({ x: sbx.x + 5, y: sbx.y + 5 }, { x: sbx.x + 5 + 60, y: sbx.y + 5 + 8 }, ['Shift'])
  const w1 = await propVal('W'), h1 = await propVal('H')
  check('Shift + corner keeps proportions', Math.abs(w1 / h1 - rw / rh) < 0.03, `ratio ${(w1 / h1).toFixed(3)} vs ${(rw / rh).toFixed(3)}`)
  await page.keyboard.press('Control+z')
  const nw = page.locator('.el-box.selected .handle').nth(0)
  const nbx = await nw.boundingBox()
  const cxBefore = (await propVal('X')) + (await propVal('W')) / 2, cyBefore = (await propVal('Y')) + (await propVal('H')) / 2
  await drag({ x: nbx.x + 5, y: nbx.y + 5 }, { x: nbx.x + 5 - 40, y: nbx.y + 5 - 25 }, ['Alt'])
  const cxAfter = (await propVal('X')) + (await propVal('W')) / 2, cyAfter = (await propVal('Y')) + (await propVal('H')) / 2
  check('Alt + corner resizes from the centre', Math.abs(cxAfter - cxBefore) < 1.5 && Math.abs(cyAfter - cyBefore) < 1.5 && (await propVal('W')) > rw, `centre ${cxBefore.toFixed(1)},${cyBefore.toFixed(1)} -> ${cxAfter.toFixed(1)},${cyAfter.toFixed(1)}`)
  await page.keyboard.press('Control+z'); await page.waitForTimeout(200)
  const cx2 = (await propVal('X')) + (await propVal('W')) / 2
  const ne = page.locator('.el-box.selected .handle').nth(2)
  const nebx = await ne.boundingBox()
  await drag({ x: nebx.x + 5, y: nebx.y + 5 }, { x: nebx.x + 5 + 50, y: nebx.y + 5 - 10 }, ['Shift', 'Alt'])
  const w3 = await propVal('W'), h3 = await propVal('H')
  const cx3 = (await propVal('X')) + w3 / 2
  check('Shift + Alt + corner: proportional and from the centre', Math.abs(w3 / h3 - rw / rh) < 0.03 && Math.abs(cx3 - cx2) < 1.5, `ratio ${(w3 / h3).toFixed(3)}`)
  await page.keyboard.press('Control+z')

  // ---- text layer: add, edit in place, copy / paste / duplicate, align, reorder
  await page.keyboard.press('Escape')
  await page.keyboard.press('t')
  await page.waitForTimeout(150)
  check('T adds a text layer', (await layerRow('Text').count()) === 1)
  const ew = await propVal('W')
  await page.click('[aria-label="Centre on canvas"]')
  await page.waitForTimeout(100)
  const ex = await propVal('X')
  check('align centres layer on canvas', Math.abs(ex - (W - ew) / 2) < 1.5, `x=${ex.toFixed(1)} expected ${((W - ew) / 2).toFixed(1)}`)
  const ey = await propVal('Y'), eh = await propVal('H')
  const tc = toClient(sb, sc, ex + ew / 2, ey + eh / 2)
  await page.mouse.dblclick(tc.x, tc.y)
  await page.waitForSelector('textarea.inline-edit')
  await page.keyboard.press('Control+a'); await page.keyboard.type('Breaking'); await page.keyboard.press('Enter')
  await page.waitForTimeout(150)
  check('double-click edits text in place', (await page.inputValue('.right textarea.input')) === 'Breaking')
  await page.keyboard.press('Control+c')
  await page.keyboard.press('Control+v')
  await page.waitForTimeout(200)
  check('Ctrl+C then Ctrl+V pastes a copy of the layer', (await layerRow('Text').count()) === 2)
  await page.keyboard.press('Control+d')
  await page.waitForTimeout(150)
  check('Ctrl+D duplicates a layer', (await layerRow('Text copy').count()) === 1)
  await page.keyboard.press('Control+x')
  await page.waitForTimeout(150)
  check('Ctrl+X cuts the layer', (await layerRow('Text copy').count()) === 0)
  await page.keyboard.press('Control+z')
  await layerRow('Text copy').click()
  await page.keyboard.press('Control+Shift+BracketLeft')
  await page.waitForTimeout(150)
  const last = await page.locator('.layers .layer').last().locator('.name').textContent()
  check('send to back moves layer to the bottom', last === 'Text copy', `bottom is "${last}"`)

  // ---- selecting: Ctrl+drag marquee, Alt+click picks underneath
  await page.keyboard.press('Escape')
  const m0 = toClient(sb, sc, 520, 20), m1 = toClient(sb, sc, 1075, 210)
  await drag(m0, m1, ['Control'])
  await page.waitForTimeout(150)
  const title = (await page.textContent('.right .pnl h3')) ?? ''
  check('Ctrl+drag marquee selects several layers', /\d+ layers/.test(title) && parseInt(title) >= 3, title)
  await page.click('[aria-label="Align right edges"]')
  await page.waitForTimeout(100)
  await page.keyboard.press('Escape')
  const dateSpot = toClient(sb, sc, 800, 100)
  await page.mouse.click(dateSpot.x, dateSpot.y)
  const first = (await page.textContent('.right .pnl h3')) ?? ''
  await page.keyboard.down('Alt'); await page.mouse.click(dateSpot.x, dateSpot.y); await page.keyboard.up('Alt')
  const second = (await page.textContent('.right .pnl h3')) ?? ''
  check('Alt+click selects the layer underneath', first !== second && second.length > 0, `${first} -> ${second}`)

  // ---- guides from rulers
  await page.keyboard.press('Escape')
  const rt = await page.locator('.ruler-x').boundingBox()
  const g1 = toClient(sb, sc, 540, 700)
  await drag({ x: rt.x + 300, y: rt.y + 10 }, { x: rt.x + 300, y: g1.y })
  check('dragging from a ruler creates a guide', (await page.locator('.ug.y:not(.draft)').count()) === 1)
  await page.locator('.ug.y:not(.draft)').dblclick()
  check('double-click removes the guide', (await page.locator('.ug.y:not(.draft)').count()) === 0)

  // ---- photo pan/zoom and collage
  await page.click('.side-tabs button:has-text("Photos")')
  const pc = toClient(sb, sc, 300, 600)
  await page.mouse.click(pc.x, pc.y)
  await page.mouse.wheel(0, -400)
  await page.waitForTimeout(150)
  await openPanel('Slots & framing')
  const zoomTxt = await page.textContent('.frame-controls .field:first-child label')
  check('wheel zooms photo', parseFloat(zoomTxt.split('·')[1]) > 1.2, zoomTxt)
  await drag(pc, { x: pc.x + 90, y: pc.y + 40 })
  const panX = parseFloat(await page.locator('.frame-controls .field:has(label:text-is("Horizontal")) input[type=range]').inputValue())
  check('drag pans photo', Math.abs(panX) > 0.01, 'panX ' + panX)
  await page.mouse.move(pc.x, pc.y)
  await page.mouse.wheel(0, 1500)
  await page.waitForTimeout(200)
  const zoomOut = parseFloat((await page.textContent('.frame-controls .field:first-child label')).split('·')[1])
  check('a photo can zoom out below 1x', zoomOut < 0.6, 'zoom ' + zoomOut)
  await page.setInputFiles('input[type=file]', path.join(root, 'src/assets/images/sample-photo.jpg'))
  await page.waitForTimeout(300)
  await openPanel('Slots & framing')
  check('2nd photo switches to a 2-slot collage', (await page.locator('.slot').count()) >= 2)
  await openPanel('Collage')
  await page.click('.collage-btn[title="Big left + 2 right"]')

  // ---- menu bar + Edit menu shortcuts
  await page.click('.mb-item:has-text("Edit")')
  const undoRow = page.locator('.popover .menu-item', { hasText: 'Undo' })
  check('Edit menu shows Undo with its shortcut', (await undoRow.textContent()).includes('Ctrl+Z'))
  await page.keyboard.press('Escape')
  await page.click('.mb-item:has-text("View")')
  check('View menu lists zoom shortcuts', (await page.locator('.popover .menu-item', { hasText: 'Fit to window' }).textContent()).includes('Ctrl+0'))
  await page.keyboard.press('Escape')

  // ---- project save + open (.esb)
  await page.click('.side-tabs button:has-text("Story")')
  await openPanel('Headline'); await page.fill(HL, 'PROJECT ROUND TRIP HEADLINE')
  const dl = []
  page.on('download', (d) => dl.push(d))
  await page.keyboard.press('Control+s')
  await page.waitForTimeout(1200)
  const proj = dl.find((d) => d.suggestedFilename().endsWith('.esb'))
  check('Ctrl+S saves a .esb project file', !!proj, dl.map((d) => d.suggestedFilename()).join(','))
  if (proj) {
    const pPath = path.join(out, 'test-project.esb')
    await proj.saveAs(pPath)
    const j = JSON.parse(fs.readFileSync(pPath, 'utf8'))
    check('project embeds the photos', j.app === 'esb-banner-studio' && j.images.length >= 1 && j.images[0].dataUrl.startsWith('data:image'), `${j.images.length} image(s)`)
    await openPanel('Headline'); await page.fill(HL, 'something else entirely')
    const chooser = page.waitForEvent('filechooser')
    await page.click('.mb-item:has-text("File")')
    await page.click('.popover .menu-item:has-text("Open project")')
    await (await chooser).setFiles(pPath)
    await page.waitForTimeout(800)
    check('opening a project restores it', (await headlineValue()) === 'PROJECT ROUND TRIP HEADLINE')
    check('title shows the project name', (await page.title()).includes('test-project'))
  }

  // ---- every format renders
  for (const [name, dims] of [['Square', '1080 × 1080'], ['Facebook Classic', '1598 × 1431'], ['Web Hero', '1920 × 1080'], ['YouTube Thumbnail', '1280 × 720'], ['Facebook Feed', '1080 × 1350']]) {
    await page.click('.fmtpick')
    await page.click(`.fm-item:has-text("${name}")`)
    await page.waitForTimeout(250)
    check(`format ${name} switches`, (await page.textContent('.statusbar')).includes(dims))
  }

  // ---- per-layer reset (always available)
  await page.click('.fmtpick'); await page.click('.fm-item:has-text("Facebook Feed")'); await page.waitForTimeout(200)
  await layerRow('Headline').click()
  const hSize = await propVal('Size')
  const sizeInput = page.locator('.right .scrub:has(.scrub-label:text-is("Size")) input')
  await sizeInput.fill('90'); await sizeInput.press('Enter')
  check('layer size changed', (await propVal('Size')) === 90)
  await layerRow('Headline').hover()
  await layerRow('Headline').locator('.icon-btn.reset').click()
  check('per-layer reset button in the Layers list restores the template', (await propVal('Size')) === hSize, `${hSize}`)
  await sizeInput.fill('70'); await sizeInput.press('Enter')
  await page.click('.insp-actions .ibtn[aria-label^="Reset this layer"]')
  check('Inspector reset restores the template too', (await propVal('Size')) === hSize)

  // ---- everyday features
  await openPanel('Headline'); await page.fill(HL, 'Midnight Power Demand Hits 3,000 MW Amid Surge in Battery Rickshaws')
  await page.click('button:has-text("Suggest")')
  await openPanel('Headline')
  check('Suggest picks the figure to highlight', (await page.inputValue('input[placeholder="Phrase to highlight"]')) === '3,000 MW')
  await page.click('.pnl > header:has-text("Photo credit")')
  await openPanel('Photo credit')
  await page.fill('input[placeholder="e.g. Photo: PID"]', 'Photo: PID')
  await page.waitForTimeout(200)
  check('photo credit becomes a layer', (await layerRow('Photo credit').count()) === 1)
  await page.click('.pnl > header:has-text("Post caption")')
  await openPanel('Post caption')
  const cap = await page.inputValue('.left [data-panel="Post caption"] textarea.input')
  check('caption is generated from the headline and category', cap.includes('Midnight Power Demand') && cap.includes('#ESBPowerLine') && cap.includes('esbpowerline.com'), cap.slice(0, 30))
  await page.click('[aria-label^="Crop guides"]')
  check('crop guides overlay shows the other ratios', (await page.locator('.crop-guide').count()) >= 2, (await page.locator('.crop-guide').count()) + ' guides')
  await page.click('[aria-label^="Crop guides"]')
  await layerRow('Headline').click()
  await page.keyboard.press('Control+2')
  await page.waitForTimeout(300)
  check('Ctrl+2 zooms to the selection', !(await page.textContent('.zoomctl .select-label')).startsWith('Fit'), await page.textContent('.zoomctl .select-label'))
  await page.keyboard.press('Control+0')
  await page.keyboard.press('Control+Shift+n')
  await page.waitForTimeout(250)
  check('Next story keeps the layout but clears headline and credit', (await headlineValue()) === '' && (await layerRow('Photo credit').count()) === 0)
  await page.keyboard.press('Control+e'); await page.waitForSelector('.dialog')
  check('export preflight flags the empty headline', (await page.locator('.ex-checks .callout.warn').count()) >= 1)
  await page.keyboard.press('Escape')
  await openPanel('Headline'); await page.fill(HL, 'PROJECT ROUND TRIP HEADLINE')

  // ---- tooltips live in the top layer (never clipped by a card)
  await layerRow('Headline').click()
  await page.locator('.align-bar .ibtn').nth(3).hover()
  await page.waitForSelector('.tooltip')
  const tipInfo = await page.evaluate(() => { const t = document.querySelector('.tooltip'); const b = document.querySelector('.align-bar .ibtn:nth-of-type(4)'); const r = t.getBoundingClientRect(); return { parentIsBody: t.parentElement === document.body, visible: r.width > 0 && getComputedStyle(t).visibility !== 'hidden', cardOverflow: getComputedStyle(b.closest('.pnl')).overflow } })
  check('tooltip is rendered above every card (not clipped by it)', tipInfo.parentIsBody && tipInfo.visible, JSON.stringify(tipInfo))
  await page.mouse.move(5, 5)

  // ---- headline icon: own box, blur, size
  await layerRow('Headline icon').click()
  check('the headline icon has its own Icon panel', (await page.locator('.right .pnl h3', { hasText: 'Icon' }).count()) >= 1)
  const iconSize0 = await propVal('Size')
  const se2 = page.locator('.el-box.selected .handle').nth(2)
  const seb = await se2.boundingBox()
  await drag({ x: seb.x + 5, y: seb.y + 5 }, { x: seb.x + 5 + 50, y: seb.y + 5 + 50 })
  check('dragging an icon corner resizes the icon', (await propVal('Size')) > iconSize0, `${iconSize0} -> ${await propVal('Size')}`)
  const blurSlider = page.locator('.right .field:has(label:text("Blur")) input[type=range]')
  await blurSlider.focus()
  const blur0 = await blurSlider.inputValue()
  for (let i = 0; i < 10; i++) await page.keyboard.press('ArrowRight')
  check('blur slider changes the icon blur', parseFloat(await blurSlider.inputValue()) > parseFloat(blur0), `${blur0} -> ${await blurSlider.inputValue()}`)
  await page.click('.right button:has-text("Reset icon")')

  // ---- fonts + credit styling
  await layerRow('Headline').click()
  await page.click('.right .field:has(label:text-is("Font")) .select')
  await page.click('.popover .menu-item:has-text("Space Grotesk")')
  check('font family can be changed per text layer', (await page.textContent('.right .field:has(label:text-is("Font")) .select-label')).includes('Space Grotesk'))
  await page.keyboard.press('Control+z')
  await openPanel('Photo credit')
  await page.fill('input[placeholder="e.g. Photo: PID"]', 'Photo: PID')
  await page.click('.pnl-body .field:has(label:text-is("Placement")) .select')
  await page.click('.popover .menu-item:has-text("Top right")')
  await page.click('.switch:has-text("Dark pill") ')
  await page.waitForTimeout(200)
  check('credit pill layer appears when switched on', (await layerRow('Photo credit pill').count()) === 1)
  const cfont = page.locator('.pnl-body .field:has(label:text-is("Font")) .select').last()
  await cfont.click()
  await page.click('.popover .menu-item:has-text("Source Serif 4")')
  check('credit font can be chosen', (await cfont.textContent()).includes('Source Serif 4'))
  await openPanel('Photo credit')
  await page.fill('input[placeholder="e.g. Photo: PID"]', '')

  // ---- selection never sticks: bare canvas clears it, even inside the headline icon's area
  await page.click('.side-tabs button:has-text("Story")')
  await page.click('.fmtpick'); await page.click('.fm-item:has-text("Facebook Feed")'); await page.waitForTimeout(200)
  await layerRow('Headline icon').click()
  check('headline icon is selected from the Layers panel', (await page.locator('.el-box.selected').count()) >= 1)
  sb = await stageBox(); sc = sb.w / W
  const bare = toClient(sb, sc, 60, 975)
  await page.mouse.click(bare.x, bare.y)
  check('clicking empty canvas inside the band clears the selection', (await page.locator('.el-box.selected').count()) === 0 && (await page.textContent('.right .pnl h3')) === 'Inspector')
  await layerRow('Headline icon').click()
  const itag = await page.locator('.el-box.selected .el-tag').boundingBox()
  const dxBefore = await propVal('X')
  await drag({ x: itag.x + 8, y: itag.y + 6 }, { x: itag.x - 52, y: itag.y + 6 })
  check('the name tag drags the selected icon', (await propVal('X')) !== dxBefore, `${dxBefore} -> ${await propVal('X')}`)
  await page.keyboard.press('Control+z')
  await page.keyboard.press('Escape')

  // ---- label pills (as on the website)
  await page.click('.pnl > header:has-text("Label pill")')
  await page.click('.lp:has-text("BREAKING")')
  await page.waitForTimeout(200)
  check('Breaking pill adds shape, icon and text layers', (await layerRow('Label pill').count()) === 1 && (await layerRow('Label icon').count()) === 1 && (await layerRow('Label text').count()) === 1)
  await page.click('.lp:has-text("FEATURED")')
  await layerRow('Label text').click()
  check('Featured pill uses the website label text', (await page.inputValue('.right textarea.input')) === 'FEATURED')
  await openPanel('Label pill')
  await page.fill('input[placeholder="FEATURED"]', 'Exclusive')
  await page.waitForTimeout(150)
  await layerRow('Label text').click()
  check('pill text can be customised (uppercased)', (await page.inputValue('.right textarea.input')) === 'EXCLUSIVE')
  await page.click('.lp-none')
  check('None removes the pill', (await layerRow('Label pill').count()) === 0)

  // ---- photo library: adding photos always works, even if the panel was collapsed
  await page.click('.side-tabs button:has-text("Photos")')
  const lib = page.locator('.left .pnl', { has: page.locator('h3', { hasText: 'Photo library' }) })
  if ((await lib.getAttribute('class')).includes('open')) await lib.locator('> header').click()
  check('the Photo library panel can be collapsed', !(await lib.getAttribute('class')).includes('open'))
  await openPanel('Photo library')
  const thumbsBefore = await page.locator('.thumb').count()
  const fchoose = page.waitForEvent('filechooser')
  await page.click('.pnl-actions button:has-text("Add")')
  await (await fchoose).setFiles(path.join(root, 'src/assets/images/sample-photo.jpg'))
  await page.waitForTimeout(500)
  check('the Add button opens the file chooser and adds the photo', (await lib.getAttribute('class')).includes('open') && (await page.locator('.thumb').count()) > thumbsBefore, `${thumbsBefore} -> ${await page.locator('.thumb').count()}`)
  check('adding a photo reopens a collapsed library and shows a count', (await lib.locator('h3 small').textContent()).includes('photo'))
  await page.click('.side-tabs button:has-text("Story")')

  // ---- header-centre label pill: identical gap above and below, every format
  const gaps = await page.evaluate(() => {
    const st = window.__store.getState()
    st.setContent({ label: 'featured', labelPos: 'hc' })
    const out = {}
    for (const f of ['fb45', 'sq', 'social', 'web', 'yt']) {
      const els = st.scene(f).elements
      const pill = els.find((e) => e.id === 'label-bg')
      const top = els.find((e) => e.id === 'stripe-top-0-0' || e.id === 'stripe-0-0')
      const bottom = els.find((e) => e.id === 'stripe-head-0-0' || e.id === 'stripe-1-0')
      out[f] = +((pill.y - (top.y + top.h)) - (bottom.y - (pill.y + pill.h))).toFixed(3)
    }
    st.setContent({ label: 'none', labelPos: 'tl' })
    return out
  })
  check('header-centre pill has equal top and bottom gaps in all 5 formats', Object.values(gaps).every((d) => Math.abs(d) < 0.5), JSON.stringify(gaps))

  // ---- live Facebook preview window (top bar, next to the format selector)
  await page.click('.pv-btn')
  await page.waitForSelector('.pvw')
  check('Preview button sits next to the format selector', await page.evaluate(() => !!(document.querySelector('.fmtgroup .fmtpick') && document.querySelector('.fmtgroup .pv-btn'))))
  const imgBox = await page.locator('.pvw .fb-img').boundingBox()
  check('preview is realistic size (banner ~390 px wide on the phone)', imgBox.width >= 380, `${Math.round(imgBox.width)}x${Math.round(imgBox.height)}`)
  const pxv = await page.evaluate(() => { const c = document.querySelector('.pvw .fb-img'); return [...c.getContext('2d').getImageData(Math.floor(c.width / 2), Math.floor(c.height / 2), 1, 1).data] })
  check('the preview banner is actually painted', pxv[3] > 0 && !(pxv[0] === 223 && pxv[1] === 227 && pxv[2] === 232), pxv.join(','))
  await openPanel('Headline'); await page.fill(HL, 'LIVE PREVIEW FOLLOWS EDITS')
  await page.waitForTimeout(200)
  check('the preview updates live while you edit', (await page.textContent('.pvw .fb-text')).includes('LIVE PREVIEW FOLLOWS EDITS'))
  await page.click('.pvw .seg-ctl button:has-text("Link post")')
  check('link-post view crops to 1.91 : 1 with the headline', (await page.locator('.pvw .fb-link').count()) === 1 && (await page.textContent('.pvw .fb-link-meta b')).includes('LIVE PREVIEW'))
  await page.click('.pvw .seg-ctl button:has-text("Desktop")')
  check('desktop view renders a navbar and feed', (await page.locator('.pvw .fbd-nav').count()) === 1 && (await page.locator('.pvw .fb-card').count()) === 1)
  await page.click('.pvw .seg-ctl button:has-text("Phone")')
  await page.click('.pvw [aria-label^="Facebook dark"]')
  check('Facebook dark mode toggles', (await page.locator('.pvw .fb.dark').count()) === 1)
  await page.click('.pvw .pvw-zoom [aria-label$=" mode"]')
  const wBefore = (await page.locator('.pvw').boundingBox()).width
  await page.click('.pvw .pvw-zoom button[aria-label="Bigger"]')
  check('preview can be made bigger', (await page.locator('.pvw').boundingBox()).width > wBefore)
  const headBox = await page.locator('.pvw-head').boundingBox()
  const pos0 = await page.locator('.pvw').boundingBox()
  await drag({ x: headBox.x + 80, y: headBox.y + 20 }, { x: headBox.x - 60, y: headBox.y + 70 })
  const pos1 = await page.locator('.pvw').boundingBox()
  check('the preview window can be dragged anywhere', Math.abs(pos1.x - pos0.x) > 40 && Math.abs(pos1.y - pos0.y) > 30, `${Math.round(pos1.x - pos0.x)},${Math.round(pos1.y - pos0.y)}`)
  await page.keyboard.press('p')
  check('P hides the preview, P shows it again', (await page.locator('.pvw').count()) === 0)
  await page.keyboard.press('p')
  check('P shows it again', (await page.locator('.pvw').count()) === 1)
  await page.click('.pvw [aria-label^="Close preview"]')
  check('close button hides the preview', (await page.locator('.pvw').count()) === 0)
  await openPanel('Headline'); await page.fill(HL, 'PROJECT ROUND TRIP HEADLINE')

  // ---- theme + shortcuts + export
  await page.click('[aria-label="Dark theme"]')
  check('dark theme toggles', (await page.getAttribute('html', 'data-theme')) === 'dark')
  check('no logo in the header (it lives on Home and in About)', (await page.locator('.topbar .logo-wrap, .topbar img[src*="esb-logo"]').count()) === 0)
  check('no product text beside the menu bar', (await page.locator('.brand-name').count()) === 0)
  await page.screenshot({ path: path.join(out, 'ui-dark.png') })
  await page.click('[aria-label="Light theme"]')
  await page.keyboard.press('?')
  check('? opens shortcuts', (await page.locator('.dialog').count()) === 1)
  await page.keyboard.press('Escape')
  await page.click('.fmtpick'); await page.click('.fm-item:has-text("Web Hero")'); await page.waitForTimeout(250)
  await page.screenshot({ path: path.join(out, 'ui-web.png') })

  dl.length = 0
  await page.keyboard.press('Control+e')
  await page.waitForSelector('.dialog')
  check('Ctrl+E opens the export dialog', (await page.locator('.dialog').count()) === 1)
  await page.click('.preset:has-text("Retina set")')
  const listed = await page.locator('.ex-file').count()
  check('Retina preset plans 4 files (2 banners x 2 sizes)', listed === 4, 'listed ' + listed)
  await page.screenshot({ path: path.join(out, 'ui-export.png') })
  await page.click('.dialog footer .btn.primary')
  await page.waitForSelector('.callout.good', { timeout: 40000 })
  await page.waitForTimeout(500)
  const names = dl.map((d) => d.suggestedFilename())
  check('multi-resolution export writes 4 files incl. @2x', dl.length === 4 && names.filter((n) => n.includes('@2x')).length === 2, names.join(', '))
  const sizes = {}
  for (const d of dl) {
    const p = path.join(out, 'export-' + d.suggestedFilename())
    await d.saveAs(p)
    const png = PNG.sync.read(fs.readFileSync(p))
    sizes[d.suggestedFilename()] = `${png.width}x${png.height}`
  }
  const sizesOk = Object.entries(sizes).every(([n, v]) => {
    const base = n.includes('Facebook') ? [1080, 1350] : [1920, 1080]
    const k = n.includes('@2x') ? 2 : 1
    return v === `${base[0] * k}x${base[1] * k}`
  })
  check('exported pixel sizes are exact (1x and 2x)', sizesOk, JSON.stringify(sizes))
  dl.length = 0
  await page.click('.preset:has-text("Everything")')
  await page.click('.dialog footer .btn.primary')
  await page.waitForSelector('.callout.good', { timeout: 60000 })
  await page.waitForTimeout(500)
  check('ZIP preset produces exactly one .zip', dl.length === 1 && dl[0].suggestedFilename().endsWith('.zip'), dl.map((d) => d.suggestedFilename()).join(', '))
  if (dl.length) { await dl[0].saveAs(path.join(out, 'export-test.zip')) }
  await page.click('.dialog footer .btn.ghost')

  await page.keyboard.press('Control+e')
  await page.waitForSelector('.dialog')
  await page.click('.preset:has-text("Web optimised")')
  await page.fill('.dialog .mono-in', 'banner-{format}-{w}x{h}')
  const firstName = await page.locator('.ex-file b').first().textContent()
  check('file-name template + WebP applied', firstName === 'banner-Facebook-1080x1350.webp', firstName)
  await page.keyboard.press('Escape')

  // ================= v1.5 design language =================
  // ---- design system: one family, a 5-step type scale, 3 control heights, a neutral palette
  await page.click('.side-tabs button:has-text("Story")')
  const ds = await page.evaluate(() => {
    const chrome = '.topbar, .toolbar, .left, .right, .statusbar'
    // selection markers carry the story's category colour by design (open panel icon, switches and ticks that are on)
    const skip = '.pnl.open .pnl-icon, .switch, .tgl, .check, .seo-chip.on, .collage-btn.on, .cat, .meter, .menu-item, .el-row, .layer, .pv-btn, .chip, .ibtn, .cat-ico, .lp, .logo-wrap, .cf-swatch, .cp-sw, .collage, .thumb, .slot-img, .chip-note, .swatch-dot, .ratio-glyph, .fb, .stage-wrap, .hsv-sv, .hsv-hue, .el-tag, .stage-scroll'
    const sizes = new Set(), fams = new Set(), radii = new Set(), heights = {}, chroma = []
    const chromaOf = (c) => { const m = c.match(/rgba?\(([\d.]+)[, ]+([\d.]+)[, ]+([\d.]+)/); return m ? Math.max(+m[1], +m[2], +m[3]) - Math.min(+m[1], +m[2], +m[3]) : 0 }
    for (const el of document.querySelectorAll(chrome.split(',').map((c) => c.trim() + ' *').join(','))) {
      if (el.closest(skip)) continue
      const r = el.getBoundingClientRect(); if (!r.width || !r.height) continue
      const s = getComputedStyle(el)
      if ([...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) { sizes.add(s.fontSize); fams.add(s.fontFamily.split(',')[0]) }
      if (s.borderRadius !== '0px') radii.add(s.borderRadius.split(' ')[0])
      for (const c of [s.color, s.backgroundColor, s.borderTopColor]) if (chromaOf(c) > 14) chroma.push(el.className + ':' + c)
      if (el.matches('.btn, .input:not(textarea), .select, .scrub, .colorfield')) heights[Math.round(r.height)] = (heights[Math.round(r.height)] || 0) + 1
    }
    return { sizes: [...sizes], fams: [...fams], radii: [...radii], heights, chroma: chroma.slice(0, 6) }
  })
  check('UI type uses only the 11 / 12 / 13 / 15 / 18 px scale', ds.sizes.every((s) => ['11px', '12px', '13px', '15px', '18px'].includes(s)), ds.sizes.join(' '))
  check('one UI typeface (plus mono for hex / numbers)', ds.fams.every((f) => /ESB Sans|Cascadia Mono/.test(f)), ds.fams.join(' '))
  check('control heights sit on 28 / 32 / 36', Object.keys(ds.heights).every((h) => [28, 32, 36].includes(+h)), JSON.stringify(ds.heights))
  check('radii come from the 4 / 8 / 12 / 16 / pill set', ds.radii.every((r) => ['0px', '2px', '4px', '6px', '8px', '12px', '16px', '50%', '999px', '9999px'].includes(r) || parseFloat(r) > 100), ds.radii.join(' '))
  check('UI chrome is neutral grey (no coloured fills or text)', ds.chroma.length === 0, ds.chroma.join(' | '))

  // ---- tab switch: one thumb glides, content fades, nothing on the category cards moves
  await openPanel('Category')
  await page.locator('.cat').nth(1).scrollIntoViewIfNeeded()
  const rel = () => page.evaluate(() => { const g = document.querySelector('.cat-grid').getBoundingClientRect(), c = document.querySelectorAll('.cat')[1].getBoundingClientRect(); return { x: c.x - g.x, y: c.y - g.y, w: c.width, h: c.height } })
  const catBox0 = await rel()
  await openPanel('Category')
  await page.hover('.cat >> nth=1'); await page.waitForTimeout(250)
  const catBox1 = await rel()
  const icoT = await page.locator('.cat-ico').nth(1).evaluate((e) => getComputedStyle(e).transform)
  check('category cards do not move or scale on hover', Math.abs(catBox0.x - catBox1.x) < 0.5 && Math.abs(catBox0.y - catBox1.y) < 0.5 && (icoT === 'none' || icoT === 'matrix(1, 0, 0, 1, 0, 0)'), icoT + ' ' + JSON.stringify([catBox0, catBox1]))
  await page.mouse.move(5, 5)
  const tb = await page.evaluate(() => new Promise((res) => { const seen = new Set(); const t0 = performance.now(); document.querySelectorAll('.side-tabs button')[1].click(); const loop = () => { seen.add(Math.round(new DOMMatrix(getComputedStyle(document.querySelector('.side-tabs .pill-slide')).transform).m41 / 10)); if (performance.now() - t0 < 360) requestAnimationFrame(loop); else res(seen.size) }; loop() }))
  check('the tab thumb glides (several in-between positions), not a jump', tb >= 5, `${tb} distinct positions`)
  const th = await page.locator('.side-tabs .pill-slide').boundingBox(), ab = await page.locator('.side-tabs button.on').boundingBox()
  check('and lands exactly under the active tab', Math.abs(th.x - ab.x) <= 2 && Math.abs(th.width - ab.width) <= 2)
  await page.click('.side-tabs button:has-text("Story")'); await page.waitForTimeout(300)
  check('format picker shows platform icons, not a placeholder box', (await page.locator('.fmtpick .ratio-glyph svg').count()) === 1 && (await page.locator('.fmtpick .ratio-glyph i').count()) === 0)

  // ---- Elements: every part of the banner has an on/off switch
  await page.click('.dock-tabs button:has-text("Elements")')
  await page.evaluate(() => window.__store.getState().setContent({ label: 'none', credit: '' }))
  const vis = (ids) => page.evaluate((ids) => { const els = window.__store.getState().scene().elements; return ids.map((i) => els.find((e) => e.id === i)?.visible) }, ids)
  const DATE = ['date-num', 'date-month', 'date-weekday', 'date-rule']
  check('Elements lists Header, Photo, Headline and Footer groups', (await page.locator('.el-group span').allTextContents()).join() === 'Header,Photo,Headline,Footer')
  await page.click('.el-row:has-text("Date") .tgl')
  check('one Date switch hides all four date layers', (await vis(DATE)).every((v) => v === false), JSON.stringify(await vis(DATE)))
  check('the row shows as off and the dock counts it', (await page.locator('.el-row.off:has-text("Date")').count()) === 1 && (await page.locator('.dock-tabs .badge').first().textContent()).includes('off'))
  await page.keyboard.press('Control+z')
  check('and one Undo brings them all back', (await vis(DATE)).every((v) => v === true))
  await page.keyboard.press('Control+y')
  await page.click('.el-row:has-text("Date") .tgl')
  check('switching back on shows them again', (await vis(DATE)).every((v) => v === true))
  await page.click('.el-group:has-text("Footer") .tgl')
  check('a group switch hides the whole footer group', (await vis(['fb-text', 'web-text', 'yt-text', 'footer-bg'])).every((v) => v === false))
  await page.click('.dock-actions button:has-text("Show all")')
  check('Show all restores every hidden element', (await page.evaluate(() => window.__store.getState().scene().elements.filter((e) => !e.visible && !e.id.startsWith('x-')).length)) === 0)
  const absent = await page.locator('.el-row.absent .name').allTextContents()
  check('unused elements (label, credit) are disabled, not hidden', absent.includes('Label pill') && absent.includes('Photo credit'), absent.join())
  await page.click('.el-row:has-text("Logo")')
  check('clicking a row selects that element on the banner', (await page.locator('.insp, .right').first().textContent()).includes('Logo'))
  await page.evaluate(() => window.__store.getState().select(null))

  // ---- custom layers get a switch too, and "Show all" covers them
  await page.evaluate(() => window.__store.getState().addText())
  await page.waitForTimeout(150)
  check('a custom text layer appears under "Custom" in Elements', (await page.locator('.el-group:has-text("Custom")').count()) === 1 && (await page.locator('.el-row:has-text("Text")').count()) >= 1)
  await page.click('.el-group:has-text("Custom") .tgl')
  check('its switch hides it', (await page.evaluate(() => window.__store.getState().scene().elements.find((e) => e.id.startsWith('x-'))?.visible)) === false)
  await page.keyboard.press('Control+z'); await page.keyboard.press('Control+z')
  await page.evaluate(() => window.__store.getState().select(null))

  // ---- smooth dragging: the frozen-layer fast path draws exactly what a full render draws
  await page.locator('.el-row:has-text("Headline") .name').first().click()
  const hbx = await page.locator('.el-box.selected').boundingBox()
  const hcx = hbx.x + hbx.width / 2, hcy = hbx.y + hbx.height / 2
  await page.mouse.move(hcx, hcy); await page.mouse.down(); await page.mouse.move(hcx - 44, hcy - 30, { steps: 6 }); await page.waitForTimeout(300)
  const midFrame = await page.evaluate(() => document.querySelector('.stage-canvas').toDataURL())
  const fullFrame = await page.evaluate(() => window.__fullRender())
  const pdiff = await page.evaluate(async ([a, b]) => {
    const load = (u) => new Promise((r) => { const i = new Image(); i.onload = () => { const c = document.createElement('canvas'); c.width = i.width; c.height = i.height; const x = c.getContext('2d'); x.drawImage(i, 0, 0); r(x.getImageData(0, 0, c.width, c.height).data) }; i.src = u })
    const [A, B] = [await load(a), await load(b)]
    let max = 0, bad = 0
    for (let i = 0; i < A.length; i += 4) { const d = Math.max(Math.abs(A[i] - B[i]), Math.abs(A[i + 1] - B[i + 1]), Math.abs(A[i + 2] - B[i + 2]), Math.abs(A[i + 3] - B[i + 3])); if (d > max) max = d; if (d > 3) bad++ }
    return { max, bad, total: A.length / 4 }
  }, [midFrame, fullFrame])
  check('a mid-drag frame matches a full render of the same state (glyph anti-aliasing aside: < 0.5 % of pixels differ)', pdiff.bad < pdiff.total * 0.005, JSON.stringify(pdiff))
  await page.mouse.up(); await page.waitForTimeout(200)
  await page.keyboard.press('Control+z')
  await page.evaluate(() => window.__store.getState().select(null))

  // ---- resizable panels
  const w = async (sel) => Math.round((await page.locator(sel).boundingBox()).width)
  const h = async (sel) => Math.round((await page.locator(sel).boundingBox()).height)
  const mid = async (sel) => { const b = await page.locator(sel).boundingBox(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 } }
  const lw0 = await w('.left')
  let sp = await mid('.left > .splitter')
  await drag(sp, { x: sp.x + 64, y: sp.y })
  check('dragging the left handle widens the left panel', (await w('.left')) === lw0 + 64, `${lw0} -> ${await w('.left')}`)
  check('the canvas gives up exactly that space', (await w('.center')) > 400)
  sp = await mid('.left > .splitter')
  await drag(sp, { x: sp.x - 600, y: sp.y })
  check('the left panel stops at its 264 px minimum', (await w('.left')) === 264, `${await w('.left')}`)
  await page.locator('.left > .splitter').dblclick()
  check('double-click resets it to 312', (await w('.left')) === 312, `${await w('.left')}`)
  await page.locator('.left > .splitter').focus()
  await page.keyboard.press('ArrowRight'); await page.keyboard.press('ArrowRight')
  check('arrow keys nudge a focused handle by 16 px', (await w('.left')) === 344, `${await w('.left')}`)
  await page.keyboard.press('Home')
  const rw0 = await w('.right')
  sp = await mid('.right > .splitter')
  await drag(sp, { x: sp.x - 48, y: sp.y })
  check('dragging the right handle left widens the right panel', (await w('.right')) === rw0 + 48, `${rw0} -> ${await w('.right')}`)
  const dk0 = await h('.dock')
  sp = await mid('.dock > .splitter')
  await drag(sp, { x: sp.x, y: sp.y - 56 })
  check('dragging the dock handle up makes the Elements list taller', (await h('.dock')) > dk0 + 40, `${dk0} -> ${await h('.dock')}`)
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('esb-banner-studio/layout')))
  check('sizes are remembered between launches', saved.rw === rw0 + 48 && saved.lw === 312, JSON.stringify(saved))
  await page.reload(); await page.waitForSelector('.topbar'); await page.waitForTimeout(400)
  check('and applied again after a reload', (await w('.right')) === rw0 + 48)
  await page.locator('.right > .splitter').dblclick()
  await page.locator('.dock > .splitter').dblclick()
  check('every handle resets by double-click', (await w('.right')) === 312)

  // ---- preview window: drag and corner-resize
  await page.evaluate(() => localStorage.removeItem('esb-banner-studio/preview-window'))
  await page.click('.pv-btn'); await page.waitForSelector('.pvw'); await page.waitForTimeout(400)
  const rz = await mid('.pvw-resize')
  const pw1 = await page.locator('.pvw').boundingBox()
  await drag(rz, { x: rz.x + 80, y: rz.y })
  const pw2 = await page.locator('.pvw').boundingBox()
  check('preview window resizes from its corner', pw2.width > pw1.width + 60, `${Math.round(pw1.width)} -> ${Math.round(pw2.width)}`)
  const hd = await mid('.pvw-head')
  await drag({ x: hd.x - 60, y: hd.y }, { x: hd.x - 160, y: hd.y + 40 })
  const pw3 = await page.locator('.pvw').boundingBox()
  check('preview window drags by its title bar', Math.abs(pw3.x - pw2.x + 100) < 3 && Math.abs(pw3.y - pw2.y - 40) < 3, `${Math.round(pw3.x - pw2.x)},${Math.round(pw3.y - pw2.y)}`)
  await page.click('.pvw [aria-label^="Close preview"]')

  // ================= canvas craft: edit straight on the banner =================
  await page.click('.side-tabs button:has-text("Story")')
  await page.evaluate(() => { window.__store.getState().select(null); window.__store.getState().setContent({ headline: 'Canvas edit test headline', label: 'none' }) })
  await page.waitForTimeout(200)
  const cb = await stageBox(), cs = cb.w / W
  const elBox = async (id) => page.evaluate((id) => { const e = window.__store.getState().scene().elements.find((x) => x.id === id); return { x: e.x, y: e.y, w: e.w, h: e.h } }, id)
  const hlb = await elBox('headline')
  const hlc = toClient(cb, cs, hlb.x + hlb.w / 2, hlb.y + hlb.h / 2)

  // select -> floating toolbar with size / bold / align / colour
  await page.mouse.click(hlc.x, hlc.y); await page.waitForTimeout(200)
  check('selecting a layer shows its floating toolbar on the banner', (await page.locator('.qbar').count()) === 1 && (await page.locator('.qbar .qb-step').count()) >= 1)
  const size0 = await page.evaluate(() => window.__store.getState().scene().elements.find((e) => e.id === 'headline').size)
  await page.click('.qbar .qb-step button[aria-label="Size bigger"]'); await page.waitForTimeout(150)
  const size1 = await page.evaluate(() => window.__store.getState().scene().elements.find((e) => e.id === 'headline').size)
  check('the toolbar size stepper changes the type size', size1 === Math.round(size0) + 1, `${size0} -> ${size1}`)
  await page.fill('.qbar .qb-step input', '64'); await page.keyboard.press('Enter'); await page.waitForTimeout(150)
  check('and the size can be typed in directly', (await page.evaluate(() => window.__store.getState().scene().elements.find((e) => e.id === 'headline').size)) === 64)
  await page.click('.qbar [data-tip="Align left"]'); await page.waitForTimeout(100)
  check('alignment buttons work from the toolbar', (await page.evaluate(() => window.__store.getState().scene().elements.find((e) => e.id === 'headline').align)) === 'left')
  await page.keyboard.press('Control+z'); await page.keyboard.press('Control+z'); await page.keyboard.press('Control+z')

  // selection styling: crisp 1 px ring + halo, refined handles, no heavy outline
  const ring = await page.evaluate(() => { const b = document.querySelector('.el-box.selected'); const s = getComputedStyle(b); return { shadow: s.boxShadow, outline: s.outlineStyle } })
  check('selection is a 1 px ring with a white halo (box-shadow), not a thick outline', /0px 0px 0px 1px/.test(ring.shadow) && ring.outline === 'none', ring.shadow)
  check('corner and edge handles are different shapes', (await page.locator('.handle.corner').count()) >= 2 && (await page.locator('.handle.edge-h, .handle.edge-v').count()) >= 0)

  // live size badge while resizing
  const sel2 = await page.locator('.el-box.selected').boundingBox()
  const hse = page.locator('.el-box.selected .handle.corner').nth(3)
  const hnd = await hse.boundingBox()
  await page.mouse.move(hnd.x + hnd.width / 2, hnd.y + hnd.height / 2); await page.mouse.down()
  await page.mouse.move(hnd.x + 40, hnd.y + 24, { steps: 6 }); await page.waitForTimeout(150)
  const badge = await page.locator('.size-badge').textContent().catch(() => null)
  check('a live W × H badge shows while resizing', /\d+ × \d+/.test(badge ?? ''), String(badge))
  check('the toolbar steps out of the way during a drag', (await page.locator('.qbar').count()) === 0)
  await page.mouse.up(); await page.waitForTimeout(150)
  check('badge and toolbar settle after release', (await page.locator('.size-badge').count()) === 0 && (await page.locator('.qbar').count()) === 1)
  await page.keyboard.press('Control+z'); void sel2

  // edit the headline on the banner itself
  const hl2 = await elBox('headline')
  const hc2 = toClient(cb, cs, hl2.x + hl2.w / 2, hl2.y + hl2.h / 2)
  await page.mouse.dblclick(hc2.x, hc2.y); await page.waitForSelector('.inline-edit')
  await page.keyboard.press('Control+a'); await page.keyboard.type('Typed right on the banner'); await page.keyboard.press('Enter'); await page.waitForTimeout(200)
  check('double-click edits the headline in place (no jump to the side panel)', (await page.evaluate(() => window.__store.getState().doc.content.headline)) === 'Typed right on the banner')

  // date and category open as pickers on the banner
  const dn = await elBox('date-num')
  const dc = toClient(cb, cs, dn.x + dn.w / 2, dn.y + dn.h / 2)
  await page.mouse.dblclick(dc.x, dc.y); await page.waitForSelector('.calpop')
  await page.click('.calpop .cal-day:not(.out):text-is("20")'); await page.waitForTimeout(150)
  check('double-click the date: pick a day on a calendar over the banner', (await page.evaluate(() => window.__store.getState().doc.content.date)).endsWith('-20'))
  await page.evaluate(() => window.__store.getState().select(null)); await page.waitForTimeout(150)
  const cb2 = await stageBox(), cs2 = cb2.w / W
  const chip = await elBox('chip')
  const cc = toClient(cb2, cs2, chip.x + chip.w / 2, chip.y + chip.h / 2)
  await page.mouse.dblclick(cc.x, cc.y); await page.waitForSelector('.popover.menu')
  await page.click('.popover.menu .menu-item:has-text("Power Generation")'); await page.waitForTimeout(150)
  check('double-click the category chip: switch desk from a menu over the banner', (await page.evaluate(() => window.__store.getState().doc.content.categoryId)) === '02')
  await page.evaluate(() => { window.__store.getState().setContent({ categoryId: '01' }); window.__store.getState().select(null) })

  // panels tell you where you are
  await openPanel('Headline'); await page.click('.left .pnl:has(h3:has-text("Headline")) textarea'); await page.waitForTimeout(350)
  const pf = await page.evaluate(() => { const p = [...document.querySelectorAll('.left .pnl')].find((x) => x.querySelector('h3')?.textContent.startsWith('Headline')); return { bar: '1', tint: getComputedStyle(p).backgroundColor } })
  check('the panel being edited is marked with a soft desk-colour tint', pf.bar === '1' && pf.tint !== 'rgba(0, 0, 0, 0)', JSON.stringify(pf))
  check('and the banner highlights the element that panel edits', (await page.locator('.el-box.linked').count()) >= 1)
  await openPanel('Date'); await page.click('.left .pnl:has(h3:has-text("Date")) .select'); await page.keyboard.press('Escape')
  // click an empty spot of the chrome (never a fixed coordinate — the header layout is responsive)
  { const pt = await page.evaluate(() => { const sp = [...document.querySelectorAll('.topbar .spacer')].map((e) => e.getBoundingClientRect()).find((r) => r.width > 12); const r = sp || document.querySelector('.statusbar .spacer').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 } }); await page.mouse.click(pt.x, pt.y) }
  await page.waitForTimeout(200)

  // rulers
  const rzs = await (async () => {
    await page.evaluate(() => window.__store.getState().setRulers(true))
    await page.waitForTimeout(100)
    return page.evaluate(() => { const x = document.querySelector('.ruler-x').getBoundingClientRect(), y = document.querySelector('.ruler-y').getBoundingClientRect(); return { h: Math.round(x.height), w: Math.round(y.width) } })
  })()
  check('rulers are a clean 24 px, with no stretched canvas', rzs.h === 24 && rzs.w === 24, JSON.stringify(rzs))
  const cbm = await stageBox(), csm = cbm.w / W; await page.mouse.move(cbm.x + 200, cbm.y + 200); await page.waitForTimeout(320)
  const cur = await page.evaluate(() => ({ x: document.querySelector('.ruler-cursor.x').dataset.v, o: getComputedStyle(document.querySelector('.ruler-cursor.x')).opacity }))
  check('a cursor tag follows the pointer along the ruler', cur.o === '1' && Math.abs(+cur.x - 200 / csm) < 3, JSON.stringify(cur))

  // ---- centered format dropdown with gap, on-canvas headline highlight, granular canvas reset & About author
  await page.click('.fmtpick')
  await page.waitForSelector('.fmtmenu')
  const fmtAlign = await page.evaluate(() => {
    const b = document.querySelector('.fmtpick').getBoundingClientRect()
    const m = document.querySelector('.fmtmenu').getBoundingClientRect()
    return { centerDiff: Math.abs((b.left + b.width / 2) - (m.left + m.width / 2)), gap: Math.round(m.top - b.bottom) }
  })
  check('top template dropdown is center-aligned with a nice gap', fmtAlign.centerDiff <= 2 && fmtAlign.gap >= 10, JSON.stringify(fmtAlign))
  await page.keyboard.press('Escape')

  await page.evaluate(() => { window.__store.getState().setContent({ headline: 'Solar Grid Adds 500 MW Capacity Across Bangladesh', highlight: '' }); window.__store.getState().select('headline') })
  await page.waitForTimeout(150)
  await page.click('.qbar button:has-text("Highlight")')
  await page.waitForSelector('.hl-pop')
  await page.click('.hl-word:has-text("500")')
  await page.keyboard.down('Shift'); await page.click('.hl-word:has-text("MW")'); await page.keyboard.up('Shift')
  await page.waitForTimeout(100)
  check('headline words can be selected and highlighted directly on the canvas', (await page.evaluate(() => window.__store.getState().doc.content.highlight)) === '500 MW')
  await page.keyboard.press('Escape')

  await page.click('.qbar .qb-step button[aria-label="Size bigger"]')
  await page.waitForTimeout(100)
  check('modified stepper on canvas shows its inline reset button', (await page.locator('.qbar .qb-step-rst').count()) === 1)
  await page.click('.qbar .qb-reset-caret')
  await page.waitForSelector('.popover.menu')
  await page.click('.popover.menu .menu-item:has-text("Reset size & dimensions")')
  await page.waitForTimeout(100)
  check('granular reset menu on canvas resets size back to default', (await page. evaluate(() => window.__store.getState().doc.overrides['web:headline']?.size)) === undefined)

  await page.click('.mb-item:has-text("Help")')
  await page.click('.popover .menu-item:has-text("About ESB Studio")')
  await page.waitForSelector('.about2')
  check('About dialog displays Hamim Ruwayfi', (await page.textContent('.about2')).includes('Hamim Ruwayfi'))
  await page.keyboard.press('Escape')
  await page.waitForTimeout(200)
  // ---- Link to News: fetch & translate
  await page.click('.side-tabs button:has-text("Story")')
  await page.waitForSelector('.url-importer')
  await page.evaluate(() => {
    window.esb = {
      fetchUrl: async () => ({
        ok: true,
        html: `<html><head>
          <title>৫৯২ কোটি টাকায় নতুন দুটি কূপ খনন, গ্রিডে দৈনিক ৩০ মিলিয়ন ঘনফুট গ্যাস - বণিক বার্তা</title>
          <meta property="og:title" content="৫৯২ কোটি টাকায় নতুন দুটি কূপ খনন, গ্রিডে দৈনিক ৩০ মিলিয়ন ঘনফুট গ্যাস">
          <meta property="og:image" content="https://static.bonikbarta.com/original_images/led_yzSa7Dg.preview.jpg">
          <meta property="og:description" content="সিলেট গ্যাস ফিল্ডস লিমিটেড (এসজিএফএল) নিয়ন্ত্রণাধীন রশিদপুর গ্যাসক্ষেত্রের নতুন দুটি কূপ খনন">
          <script>var last_published_at = "2026-10-12";</script>
        </head><body><p>গ্যাস কূপ খনন</p></body></html>`
      }),
      fetchImageData: async () => ({ ok: true, dataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==' })
    }
  })
  await page.fill('.url-importer input', 'https://bonikbarta.com/bangladesh/rAqqU771JKDG8PlD')
  await page.click('.url-importer button:has-text("Fetch & Translate")')
  await page.waitForSelector('.article-studio-preview', { timeout: 10000 })
  const engHeadline = await page.textContent('.asp-head-eng')
  const origHeadline = await page.textContent('.asp-orig')
  const curCat = await page.evaluate(() => window.__store.getState().doc.content.categoryId)
  check('link to news translates headline into natural English', engHeadline.includes('Tk 592 crore') && engHeadline.includes('30 MMCFD Gas'), engHeadline)
  check('link to news detects Fossil Fuels & Commodities category (03)', curCat === '03', curCat)
  check('article studio tray displays original headline', origHeadline.includes('৫৯২ কোটি টাকায়'), origHeadline)
  check('article studio tray provides suggested sector photos', (await page.locator('.asp-thumb.suggested').count()) > 0)

  // ---- Body Section Optimal Dimensions for each template
  await page.click('.side-tabs button:has-text("Photos")')
  await openPanel('Optimal image dimensions')
  await page.waitForSelector('.opt-space-card')
  const optPhotosText = await page.textContent('.opt-space-card')
  check('photos panel displays optimal body image space (1080 × 719 px for Facebook)', optPhotosText.includes('1080 × 719 px') && optPhotosText.includes('3:2'), optPhotosText)

  // Empty slot canvas card on a fresh banner
  await page.evaluate(() => { window.__store.getState().setCollage('single'); window.__store.getState().assignImage(0, null); window.__store.getState().assignImage(1, null) })
  await page.waitForSelector('.slot-empty-card')
  const emptyCardText = await page.textContent('.slot-empty-card')
  check('canvas empty slot shows corner-to-corner dimension (1080 × 719 px)', emptyCardText.includes('1080 × 719') && emptyCardText.includes('Corner-to-corner fit'), emptyCardText)
  check('canvas shows header/footer deduction math for Facebook', emptyCardText.includes('Header (220px)') && emptyCardText.includes('411px'), emptyCardText)

  // Switch to Square
  await page.evaluate(() => window.__store.getState().setFormat('sq'))
  await page.waitForTimeout(100)
  const sqCardText = await page.textContent('.slot-empty-card')
  check('Square template updates canvas body dimension to 1080 × 519 px', sqCardText.includes('1080 × 519') && sqCardText.includes('353px'), sqCardText)

  // Switch to Web Hero
  await page.evaluate(() => window.__store.getState().setFormat('web'))
  await page.waitForTimeout(100)
  const webCardText = await page.textContent('.slot-empty-card')
  check('Web Hero template updates canvas body dimension to 1280 × 800 px', webCardText.includes('1280 × 800') && webCardText.includes('640px'), webCardText)

  // Restore Facebook format
  await page.evaluate(() => window.__store.getState().setFormat('fb45'))
  await page.keyboard.press('Escape')

  // ---- Element dimensions toggle (View menu / D key / Toolbar)
  check('element dimensions overlay is hidden by default', (await page.locator('.dimension-overlay').count()) === 0)
  await page.keyboard.press('d')
  await page.waitForTimeout(100)
  check('pressing D reveals element dimensions blueprint overlay', (await page.locator('.dimension-overlay').count()) === 1)
  const dimBadgeText = await page.textContent('.canvas-dim-badge')
  check('dimension overlay shows accurate canvas size (1080 × 1350 px)', dimBadgeText.includes('1080 × 1350') && dimBadgeText.includes('4:5'), dimBadgeText)
  const zoneTags = await page.$$eval('.layout-dim-tag', (els) => els.map((e) => e.textContent))
  check('layout zones show Header and Photo dimensions', zoneTags.some((t) => t.includes('Header') && t.includes('1080 × 220')) && zoneTags.some((t) => t.includes('Photo Body') && t.includes('1080 × 719')), JSON.stringify(zoneTags))
  await page.keyboard.press('d')
  await page.waitForTimeout(100)
  check('pressing D again hides element dimensions overlay cleanly', (await page.locator('.dimension-overlay').count()) === 0)

  check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '))
} catch (e) {
  console.log('TEST ERROR', e.stack ?? e)
  results.push(false)
} finally {
  await browser?.close().catch(() => {})
  vite.kill()
}
console.log(results.every(Boolean) ? 'ALL PASS' : 'SOME FAILED')
