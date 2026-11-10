// Every desk-to-desk switch leaves the arriving desk whole: opacity 1, clickable, no stale animation on any slot.
// Usage: npm run build && node tools/audit/desk-cycle.mjs
import { _electron as electron } from 'playwright-core'
import path from 'node:path'; import fs from 'node:fs'; import os from 'node:os'
const root = path.resolve(import.meta.dirname, '../..')
const app = await electron.launch({ executablePath: path.join(root, 'node_modules/electron/dist/electron.exe'), args: [root, '--user-data-dir=' + fs.mkdtempSync(path.join(os.tmpdir(), 'esb-dc-'))], env: { ...process.env, ESB_NO_SYNC: '1' } })
const page = await app.firstWindow(); page.setDefaultTimeout(30000)
await page.waitForSelector('.launch-tile')
const desks = ['editorial', 'graphics', 'video', 'graphics', 'news', 'video', 'editorial', 'outreach', 'graphics', 'video', 'news', 'editorial', 'graphics', 'outreach', 'video', 'home', 'graphics', 'video']
let bad = 0
await page.click('.launch-tile:has-text("Editorial")'); await page.waitForTimeout(900)
for (const d of desks) {
  await page.evaluate((d) => { const b = [...document.querySelectorAll('.ws-btn[data-ws="' + d + '"], .ws-home-btn')].find((x) => x.offsetParent && (x.dataset.ws === d || (d === 'home' && x.classList.contains('ws-home-btn')))); b?.click() }, d)
  if (d === 'home') { await page.waitForTimeout(900); await page.click('.launch-tile:has-text("Graphics")'); await page.waitForTimeout(900); continue }
  await page.waitForTimeout(900)
  const r = await page.evaluate((d) => {
    const act = [...document.querySelectorAll('.workspace-main > .desk-slot.is-active')]
    const a = act[0]
    const cs = a && getComputedStyle(a)
    const stale = [...document.querySelectorAll('.workspace-main > .desk-slot')].filter((s) => s.getAnimations().some((x) => x.playState !== 'running')).map((s) => s.dataset.desk)
    const mid = document.elementFromPoint(innerWidth / 2, innerHeight / 2)
    return { n: act.length, desk: a?.dataset.desk, op: cs?.opacity, pe: cs?.pointerEvents, stale, inDesk: !!(a && a.contains(mid)) }
  }, d)
  const ok = r.n === 1 && r.desk === d && r.op === '1' && r.pe !== 'none' && !r.stale.length && r.inDesk
  if (!ok) bad++
  console.log((ok ? 'ok  ' : 'BAD ') + d.padEnd(10), JSON.stringify(r))
}
console.log(bad ? `${bad} BAD switches` : 'all switches clean')
await app.close()
