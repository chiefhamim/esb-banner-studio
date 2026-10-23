import { _electron as electron } from 'playwright-core'
import path from 'node:path'
const root = path.resolve(import.meta.dirname, '..')
const app = await electron.launch({ executablePath: path.join(root, 'release-v1.3.0', 'win-unpacked', 'ESB Studio.exe'), args: [] })
const page = await app.firstWindow()
await page.waitForSelector('.topbar'); await page.waitForTimeout(600)
const ls = await page.evaluate(() => Object.fromEntries(Object.keys(localStorage).filter((k) => k.includes('panel') || k.includes('theme')).map((k) => [k.replace('esb-banner-studio/', ''), localStorage.getItem(k)])))
console.log(JSON.stringify(ls, null, 1))
await page.click('.side-tabs button:has-text("Photos")')
console.log('panel headers:', await page.locator('.left .pnl > header h3').allTextContents())
console.log('open panels :', await page.locator('.left .pnl.open > header h3').allTextContents())
await app.close()
