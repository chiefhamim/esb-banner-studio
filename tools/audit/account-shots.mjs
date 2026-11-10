// The account sheet (avatar, top right) at laptop and desktop heights: does it scroll?
import { _electron as electron } from 'playwright-core'
import path from 'node:path'; import fs from 'node:fs'; import os from 'node:os'
const root = path.resolve(import.meta.dirname, '../..')
const out = path.join(root, 'artifacts', 'pass12'); fs.mkdirSync(out, { recursive: true })
const app = await electron.launch({ executablePath: path.join(root, 'node_modules/electron/dist/electron.exe'), args: [root, '--user-data-dir=' + fs.mkdtempSync(path.join(os.tmpdir(), 'esb-acct-'))], env: { ...process.env, ESB_NO_SYNC: '1' } })
const page = await app.firstWindow(); page.setDefaultTimeout(20000)
for (const [w, h] of [[1440, 900], [1366, 768], [1280, 720]]) {
  await app.evaluate(({ BrowserWindow }, [w, h]) => { const b = BrowserWindow.getAllWindows()[0]; b.setContentSize(w, h); if (b.isMinimized()) b.restore(); b.showInactive() }, [w, h])
  await page.evaluate((signed) => { localStorage.setItem('esb-banner-studio/theme', 'dark'); if (signed) localStorage.setItem('esb-banner-studio/site-session', JSON.stringify({ email: 'editor@example.com', name: 'Synthetic Editor', role: 'EDITOR', token: 'synthetic-not-a-token', expiresAt: Math.floor(Date.now() / 1000) + 86400 * 30, authenticatedAt: new Date().toISOString(), authType: 'supabase' })) }, !!process.env.SIGNED); await page.reload(); await page.waitForSelector('.launch-tile'); await page.click('.launch-tile:has-text("Graphics")'); await page.waitForTimeout(1200)
  await page.click('.desk-slot.is-active .ed-account'); await page.waitForTimeout(600)
  const r = await page.evaluate(() => { const s = document.querySelector('.signin-sheet, .acct-sheet, [class*="signin"]'); const sc = [...document.querySelectorAll('.signin-sheet *, .acct-sheet *')].find((e) => e.scrollHeight > e.clientHeight + 2 && /auto|scroll/.test(getComputedStyle(e).overflowY)); const b = s?.getBoundingClientRect(); return { cls: s?.className, h: b && Math.round(b.height), top: b && Math.round(b.top), scrolls: sc ? `${(sc.className || '').toString().slice(0, 30)} ${sc.scrollHeight}/${sc.clientHeight}` : 'no' } })
  console.log(w, h, JSON.stringify(r))
  await page.screenshot({ path: path.join(out, `account-${process.env.SIGNED ? 'in-' : ''}${w}x${h}.png`) })
  await page.keyboard.press('Escape')
}
await app.close()
