// Reproduce: Graphics → Video freezes the window. ORDER=comma list of desks (default Graphics,Video).
import { _electron as electron } from 'playwright-core'
import path from 'node:path'
import fs from 'node:fs'
import os from 'node:os'
const root = path.resolve(import.meta.dirname, '../..')
const win = process.platform === 'win32'
const exe = path.join(root, 'node_modules', 'electron', 'dist', win ? 'electron.exe' : 'electron')
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'esb-vc-'))
const app = await electron.launch({ executablePath: exe, args: [root, '--user-data-dir=' + profile], env: { ...process.env, ESB_NO_SYNC: '1' } })
const page = await app.firstWindow()
const logs = []
page.on('console', (m) => logs.push(m.type() + ': ' + m.text().slice(0, 300)))
page.on('pageerror', (e) => logs.push('PAGEERROR: ' + e.stack?.slice(0, 900)))
page.on('crash', () => logs.push('RENDERER CRASH'))
app.on('window', () => {})
await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1600, 950))
await page.evaluate(() => localStorage.setItem('esb-banner-studio/theme', 'dark')); await page.reload()
await page.waitForTimeout(1500)
const go = (l) => page.evaluate((l) => [...document.querySelectorAll('.ws-btn, .launch-tile, button')].find((x) => new RegExp('^' + l).test((x.getAttribute('aria-label') || x.textContent || '').trim()))?.click(), l)
const ping = async (tag) => {
  const t = Date.now()
  const r = await Promise.race([page.evaluate(() => new Promise(res => requestAnimationFrame(() => res(document.querySelector('.desk-slot.is-active')?.firstElementChild?.className?.slice(0, 60) || 'none')))), new Promise(r => setTimeout(() => r('TIMEOUT'), 5000))])
  console.log(tag, r, Date.now() - t + 'ms')
  const t2 = Date.now(); const ok = await page.screenshot({ timeout: 6000 }).then(() => 'painted', () => 'NO PAINT'); console.log('  screenshot', ok, Date.now() - t2 + 'ms')
}
for (const d of (process.env.ORDER || 'Graphics,Video').split(',')) {
  await go(d); await page.waitForTimeout(1600); await ping('after ' + d)
}
console.log(logs.filter(l => !/Download the React|DevTools/.test(l)).join('\n'))
await app.close().catch(() => {})
process.exit(0)
