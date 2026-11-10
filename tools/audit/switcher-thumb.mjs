// The desk switcher's sliding chip must sit exactly on the chosen desk's button after every switch (both nav styles).
import { _electron as electron } from 'playwright-core'
import path from 'node:path'; import fs from 'node:fs'; import os from 'node:os'
const root = path.resolve(import.meta.dirname, '../..')
const app = await electron.launch({ executablePath: path.join(root, 'node_modules/electron/dist/electron.exe'), args: [root, '--user-data-dir=' + fs.mkdtempSync(path.join(os.tmpdir(), 'esb-sw2-'))], env: { ...process.env, ESB_NO_SYNC: '1' } })
const page = await app.firstWindow(); page.setDefaultTimeout(20000); page.on('console', (m) => { if (m.text().startsWith('THUMBDBG')) console.log(m.text()) })
await app.evaluate(({ BrowserWindow }) => { const b = BrowserWindow.getAllWindows()[0]; b.setContentSize(Number(process.env.W || 1440), 860); if (b.isMinimized()) b.restore(); b.showInactive() })
await page.waitForSelector('.launch-tile'); await page.click('.launch-tile:has-text("Editorial")'); await page.waitForTimeout(1000)
let bad = 0
await page.evaluate(() => { window.__prevDesk = 'editorial' })
for (const d of ['news', 'graphics', 'outreach', 'editorial', 'video', 'news', 'outreach', 'graphics', 'editorial', 'news', 'video', 'outreach']) {
  const prev = await page.evaluate(() => document.querySelector('.desk-slot.is-active .ws-btn.on')?.dataset.ws)
  // the first frames of the glide in the arriving header: where does the chip start, against the previous desk's icon there?
  const start = await page.evaluate((d) => new Promise((res) => {
    document.querySelector(`.desk-slot.is-active .ws-btn[data-ws="${d}"]`)?.click()
    const t0 = performance.now()
    const look = () => {
      const sw = document.querySelector(`.desk-slot.is-active[data-desk="${d}"] .ws-switch`)
      const th = sw?.querySelector('.pill-slide')
      if (th && th.getAnimations().length) {
        const prevBtn = sw.querySelector(`.ws-btn[data-ws="${window.__prevDesk}"]`)
        const a = th.getBoundingClientRect(), b = prevBtn?.getBoundingClientRect()
        return res(b ? Math.round(a.left - b.left) : 'no prev button')
      }
      if (performance.now() - t0 > 900) return res('no glide')
      requestAnimationFrame(look)
    }
    requestAnimationFrame(look)
  }), d)
  await page.waitForTimeout(900)
  const r = await page.evaluate(() => {
    const sw = document.querySelector('.desk-slot.is-active .ws-switch'); if (!sw) return null
    const on = sw.querySelector('.ws-btn.on, .ws-btn[aria-pressed="true"], .ws-btn[aria-current]')
    const th = sw.querySelector('.pill-slide')
    const a = on?.getBoundingClientRect(), b = th?.getBoundingClientRect()
    return a && b ? { on: on.dataset.ws, dl: Math.round(b.left - a.left), dw: Math.round(b.width - a.width), dt: Math.round(b.top - a.top), dh: Math.round(b.height - a.height) } : { on: on?.dataset.ws, thumb: !!th }
  })
  if (typeof start === 'number' && Math.abs(start) > 6) bad++
  console.log('   glide starts', start, 'px from', prev + "'s icon")
  const ok = r && r.dl === 0 && r.dw === 0 && r.on === d
  if (!ok) bad++
  console.log(ok ? 'ok ' : 'BAD', d, JSON.stringify(r))
  await page.evaluate((d) => { window.__prevDesk = d }, d)
}
console.log(bad ? bad + ' misplaced' : 'all on target')
await app.close()
