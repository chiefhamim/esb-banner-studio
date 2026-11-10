// Home's corner control: folded and open, both themes, plus sizes of everything inside. → artifacts/pass13/
import { _electron as electron } from 'playwright-core'
import path from 'node:path'; import fs from 'node:fs'; import os from 'node:os'
const root = path.resolve(import.meta.dirname, '../..')
const out = path.join(root, 'artifacts', 'pass13'); fs.mkdirSync(out, { recursive: true })
const app = await electron.launch({ executablePath: path.join(root, 'node_modules/electron/dist/electron.exe'), args: [root, '--user-data-dir=' + fs.mkdtempSync(path.join(os.tmpdir(), 'esb-hc-'))], env: { ...process.env, ESB_NO_SYNC: '1' } })
const page = await app.firstWindow(); page.setDefaultTimeout(20000)
await app.evaluate(({ BrowserWindow }) => { const b = BrowserWindow.getAllWindows()[0]; b.setContentSize(1440, 860); if (b.isMinimized()) b.restore(); b.showInactive() })
for (const t of ['dark', 'light']) {
  await page.evaluate((x) => localStorage.setItem('esb-banner-studio/theme', x), t); await page.reload(); await page.waitForSelector('.home-head-actions'); await page.mouse.move(700, 500); await page.waitForTimeout(900)
  await page.screenshot({ path: path.join(out, `corner-folded-${t}.png`), clip: { x: 1100, y: 0, width: 340, height: 70 } })
  const b = await page.locator('.home-user-btn').boundingBox(); await page.mouse.move(b.x + b.width - 10, b.y + b.height / 2); await page.waitForTimeout(600)
  await page.screenshot({ path: path.join(out, `corner-open-${t}.png`), clip: { x: 1100, y: 0, width: 340, height: 70 } })
  console.log(t, await page.evaluate(() => [...document.querySelectorAll('.home-head-actions > *')].map((e) => { const r = e.getBoundingClientRect(); return `${(e.className || '').toString().split(' ').slice(0, 2).join('.')}:${Math.round(r.width)}x${Math.round(r.height)}@y${Math.round(r.top)}` }).join(' ') + ' | capsule ' + (() => { const r = document.querySelector('.home-head-actions').getBoundingClientRect(); return `${Math.round(r.width)}x${Math.round(r.height)}@y${Math.round(r.top)}` })()))
}
await app.close()
