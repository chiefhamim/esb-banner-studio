// Home lockup + tagline: one line, same width. → artifacts/pass10/home-title-<theme>-<w>.png
import { _electron as electron } from 'playwright-core'
import path from 'node:path'; import fs from 'node:fs'; import os from 'node:os'
const root = path.resolve(import.meta.dirname, '../..')
const out = path.join(root, 'artifacts', 'pass10'); fs.mkdirSync(out, { recursive: true })
const app = await electron.launch({ executablePath: path.join(root, 'node_modules/electron/dist/electron.exe'), args: [root, '--user-data-dir=' + fs.mkdtempSync(path.join(os.tmpdir(), 'esb-ht-'))], env: { ...process.env, ESB_NO_SYNC: '1' } })
const page = await app.firstWindow(); page.setDefaultTimeout(20000)
for (const t of ['dark', 'light']) for (const w of [1440, 1000]) {
  await app.evaluate(({ BrowserWindow }, w) => { const b = BrowserWindow.getAllWindows()[0]; b.setContentSize(w, 860); if (b.isMinimized()) b.restore(); b.showInactive() }, w)
  await page.evaluate((x) => localStorage.setItem('esb-banner-studio/theme', x), t); await page.reload(); await page.waitForSelector('.home-title'); await page.waitForTimeout(900)
  const r = await page.evaluate(() => { const g = (s) => document.querySelector(s).getBoundingClientRect(); const m = g('.home-mark'), n = g('.home-title-accent'), s = g('.home-subtitle'); return { mark: [Math.round(m.left), Math.round(n.right)], sub: [Math.round(s.left), Math.round(s.right)], lines: Math.round(s.height / parseFloat(getComputedStyle(document.querySelector('.home-subtitle')).lineHeight)) } })
  console.log(t, w, JSON.stringify(r))
  await page.screenshot({ path: path.join(out, `home-title-${t}-${w}.png`), clip: { x: Math.max(0, r.mark[0] - 40), y: 100, width: Math.min(w, r.mark[1] - r.mark[0] + 80), height: 260 } })
}
await app.close()
