import { _electron as electron } from 'playwright-core'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
const root = path.resolve(import.meta.dirname, '..')
const photo = path.join(root, 'src/assets/images/sample-photo.jpg')
// isolated copy of the profile folder so the user's real data is never touched
const prof = fs.mkdtempSync(path.join(os.tmpdir(), 'esb-iso-'))
const app = await electron.launch({ executablePath: path.join(root, 'release-v1.3.0', 'win-unpacked', 'ESB Studio.exe'), args: [] , env: { ...process.env, ESB_USER_DATA: prof } })
const page = await app.firstWindow()
await page.waitForSelector('.topbar'); await page.waitForTimeout(600)
console.log('userData in use:', await app.evaluate(({ app }) => app.getPath('userData')))
await page.click('.side-tabs button:has-text("Photos")')
const isOpen = () => page.locator('.left .pnl', { has: page.locator('h3', { hasText: 'Photo library' }) }).evaluate((e) => e.classList.contains('open'))
console.log('library open before:', await isOpen())
const ch = page.waitForEvent('filechooser'); await page.click('.pnl-actions button:has-text("Add")'); await (await ch).setFiles(photo)
await page.waitForTimeout(700)
console.log('library open after Add click:', await isOpen())
console.log('thumbs:', await page.locator('.thumb').count())
await app.close()
