// Video's right column (clip inspector) with footage, a title and the audio selected, both themes. → artifacts/pass13/
import { _electron as electron } from 'playwright-core'
import path from 'node:path'; import fs from 'node:fs'; import os from 'node:os'
const root = path.resolve(import.meta.dirname, '../..')
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'esb-vr-'))
const speech = path.join(work, 'speech-6s.mp4'); fs.copyFileSync(path.join(root, 'tools/fixtures/video/speech-6s.mp4'), speech)
const app = await electron.launch({ executablePath: path.join(root, 'node_modules/electron/dist/electron.exe'), args: [root, '--user-data-dir=' + path.join(work, 'p')], env: { ...process.env, ESB_NO_SYNC: '1' } })
const page = await app.firstWindow(); page.setDefaultTimeout(20000)
await app.evaluate(({ dialog }, p) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] }) }, speech)
await app.evaluate(({ BrowserWindow }) => { const b = BrowserWindow.getAllWindows()[0]; b.setContentSize(1440, 900); if (b.isMinimized()) b.restore(); b.showInactive() })
for (const t of ['dark', 'light']) {
  await page.evaluate((x) => localStorage.setItem('esb-banner-studio/theme', x), t); await page.reload(); await page.waitForSelector('.launch-tile')
  await page.click('.launch-tile:has-text("Video")'); await page.waitForTimeout(1200)
  if (await page.locator('.desk-slot.is-active .vw-start-import').count()) { await page.click('.desk-slot.is-active .vw-start-import'); await page.waitForSelector('.vw-media-card'); await page.click('.vw-media-card .vw-add'); await page.waitForTimeout(700) }
  const clips = page.locator('.desk-slot.is-active .vw-clip-block')
  for (const [i, name] of [[0, 'footage'], [1, 'audio']]) {
    if (await clips.count() > i) { await clips.nth(i).click(); await page.waitForTimeout(500) }
    const p = await page.locator('.desk-slot.is-active .vw-inspector-panel').boundingBox()
    if (p) await page.screenshot({ path: path.join(root, `artifacts/pass13/video-right-${name}-${t}.png`), clip: { x: p.x - 4, y: p.y, width: p.width + 4, height: Math.min(560, p.height) } })
    console.log(t, name, await page.evaluate(() => { const panel = document.querySelector('.desk-slot.is-active .vw-inspector-panel'); if (!panel) return 'no panel'; const pr = panel.getBoundingClientRect(); const out = []; for (const el of panel.querySelectorAll('button, input, .select, .seg-ctl, .side-tabs, label, h3, h4')) { const r = el.getBoundingClientRect(); if (!r.width || !el.offsetParent) continue; if (r.right > pr.right - 1 || r.left < pr.left) out.push(`${(el.className || el.tagName).toString().slice(0, 30)} ${Math.round(r.left)}-${Math.round(r.right)} (panel ${Math.round(pr.left)}-${Math.round(pr.right)})`) } const cut = [...panel.querySelectorAll('*')].filter((e) => e.children.length === 0 && e.scrollWidth > e.clientWidth + 1 && getComputedStyle(e).overflow !== 'visible' && e.textContent.trim()).slice(0, 5).map((e) => (e.className || e.tagName).toString().slice(0, 30) + ' "' + e.textContent.trim().slice(0, 24) + '"'); return `outside: ${out.length ? out.slice(0, 6).join(' | ') : 'none'} · cut text: ${cut.length ? cut.join(' | ') : 'none'}` }))
  }
}
await app.close()
