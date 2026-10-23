import { _electron as electron } from 'playwright-core'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
const root = path.resolve(import.meta.dirname, '..')
const photo = path.join(root, 'src/assets/images/sample-photo.jpg')
const app = await electron.launch({ executablePath: path.join(root, 'release-v1.3.0', 'win-unpacked', 'ESB Studio.exe'), args: ['--user-data-dir=' + fs.mkdtempSync(path.join(os.tmpdir(), 'esb-p-'))] })
const page = await app.firstWindow()
await page.waitForSelector('.topbar'); await page.waitForTimeout(600)
console.log('userData:', await app.evaluate(({ app }) => app.getPath('userData')))
const b64 = fs.readFileSync(photo).toString('base64')
const r = await page.evaluate(async (b64) => {
  const bin = atob(b64); const u8 = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i)
  const f = new File([u8], 'a.jpg', { type: 'image/jpeg' })
  const out = {}
  try { const u = URL.createObjectURL(f); out.url = u.slice(0, 40); const img = new Image(); img.src = u; await img.decode(); out.decoded = [img.naturalWidth, img.naturalHeight] } catch (e) { out.blobErr = String(e) }
  try { const bm = await createImageBitmap(f); out.bitmap = [bm.width, bm.height] } catch (e) { out.bitmapErr = String(e) }
  return out
}, b64)
console.log('in-page image load:', JSON.stringify(r))
await page.click('.side-tabs button:has-text("Photos")')
const ch = page.waitForEvent('filechooser'); await page.click('.pnl-actions button:has-text("Add")'); await (await ch).setFiles(photo)
await page.waitForTimeout(800)
console.log('toast:', await page.locator('.toast').allTextContents())
console.log('thumbs:', await page.locator('.thumb').count(), ' dropzone visible:', await page.locator('.dropzone').count())
await app.close()
