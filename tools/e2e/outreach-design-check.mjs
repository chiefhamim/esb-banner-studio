// Letter → Designed HTML, end to end in the desk (dev server, no sending): pick a self-contained HTML page, check the
// composer card, the plain-text version, and the Preview frame (pictures inline, placeholders filled, nothing remote).
// Usage: DESIGN=path/to/page.html node tools/e2e/outreach-design-check.mjs   (SHOTS=dir to keep screenshots)
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-core'
import { launchBrowser } from '../launch-browser.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const PORT = 5196
const design = process.env.DESIGN
const shots = process.env.SHOTS || ''
if (!design || !fs.existsSync(design)) { console.error('Set DESIGN to an HTML file'); process.exit(2) }

const server = spawn(process.execPath, [path.join(root, 'node_modules', 'vite', 'bin', 'vite.js'), '--port', String(PORT), '--strictPort'], { cwd: root, stdio: 'ignore' })
let failures = 0
const check = (ok, what) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}`); if (!ok) failures++ }
try {
  for (let i = 0; i < 60; i++) { try { if ((await fetch(`http://localhost:${PORT}/`)).ok) break } catch { /* not up yet */ } await new Promise((r) => setTimeout(r, 500)) }
  const browser = await launchBrowser(chromium)
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  const remote = []
  page.on('request', (r) => { const u = r.url(); if (!u.startsWith(`http://localhost:${PORT}`) && !u.startsWith('data:') && !u.startsWith('blob:')) remote.push(u) })
  await page.goto(`http://localhost:${PORT}/`)
  await page.waitForSelector('.studio-shell')
  const tile = page.locator('.launch-tile:has-text("Outreach")')
  if (await tile.count()) await tile.first().click(); else await page.click('.ws-btn[data-ws="outreach"]:visible')
  await page.waitForSelector('.outreach-workspace')
  await page.evaluate(async () => {
    const st = window.__outreachStore.getState()
    window.__outreachUi.getState().set({ desk: 'compose', sheet: null, view: 'edit' })
    const id = await st.createCampaign({ kind: 'direct', name: 'Designed letter check', blueprint: 'blank', subject: 'Discover ESB PowerLine', body: '' })
    await st.openCampaign(id)
    st.setRecipients(['desk@example.com'])
  })
  await page.waitForTimeout(300)
  // the file input behind Letter → Designed HTML…
  const before = remote.length
  // the top Letter menu offers it too, and opens the same file picker
  await page.locator('.menubar button').filter({ hasText: /^Letter$/ }).first().click()
  const item = page.locator('.menu .menu-item').filter({ hasText: 'Designed HTML' })
  check(await item.count() === 1, 'Letter menu has "Designed HTML" (no ellipsis)')
  const [chooser] = await Promise.all([page.waitForEvent('filechooser', { timeout: 5000 }), item.click()])
  await chooser.setFiles(design)
  await page.waitForSelector('.or-frame')
  await page.waitForTimeout(800)
  // the preview frame is sandboxed (no origin), so the page cannot reach into it; evaluate inside the frame itself
  const frame = await (await page.$('.or-frame')).contentFrame()
  const info = await frame.evaluate(() => {
    const d = document
    const imgs = [...d.images]
    return { imgs: imgs.length, loaded: imgs.filter((i) => i.complete && i.naturalWidth > 0).length, data: imgs.filter((i) => i.src.startsWith('data:image/')).length, text: d.body.innerText, unsub: [...d.links].find((a) => /unsubscribe/i.test(a.textContent))?.getAttribute('href') ?? '' }
  })
  check(info.imgs > 0 && info.loaded === info.imgs, `Preview shows every picture (${info.loaded}/${info.imgs}), all inline data`)
  check(info.data === info.imgs, 'No picture in the preview points anywhere but the message itself')
  check(/Dear (Reader|Sir\/Madam),/.test(info.text), 'Greeting placeholder filled for a contact with no name')
  check(!/\{[a-z_]+(\|[^}]*)?\}/i.test(info.text), 'No placeholder left unfilled in the preview')
  check(info.unsub === '#' || info.unsub.startsWith('mailto:'), `Unsubscribe link becomes the opt-out address (${info.unsub || 'none'})`)
  check(remote.length === before, `Preview loaded nothing from the internet (${remote.length - before} requests)`)
  if (shots) { fs.mkdirSync(shots, { recursive: true }); await page.screenshot({ path: path.join(shots, 'design-preview.png') }) }
  await page.evaluate(() => window.__outreachUi.getState().set({ view: 'edit' }))
  await page.waitForSelector('.or-design')
  const card = await page.locator('.or-design-meta').innerText()
  check(/Designed HTML · \d+ pictures? inside the message/.test(card), `Composer card: ${card.replace(/\n/g, ' | ')}`)
  const plain = await page.locator('.or-design-text').inputValue()
  check(plain.length > 200 && !/<[a-z]/i.test(plain), `Plain-text version generated (${plain.length} chars, no markup)`)
  const stored = await page.evaluate(() => { const st = window.__outreachStore.getState(); const c = st.campaign(); return { meta: c.design, loaded: !!st.design, body: c.body.length } })
  check(!!stored.meta && stored.loaded, 'Campaign remembers the design and the page is loaded from IndexedDB')
  if (shots) await page.screenshot({ path: path.join(shots, 'design-card.png') })
  // back to a written letter
  await page.evaluate(() => window.__outreachStore.getState().clearDesign())
  await page.waitForTimeout(200)
  check(await page.locator('.or-fmt').count() === 1, 'Clearing the design brings the mark editor back')
  await browser.close()
} finally {
  server.kill()
}
console.log(failures ? `${failures} failed` : 'all passed')
process.exit(failures ? 1 : 0)
