// Packaged-app check (isolated profile): neutral UI, Elements switches, resizable panels that survive a relaunch.
import { _electron as electron } from 'playwright-core'
import path from 'node:path'
import fs from 'node:fs'
import os from 'node:os'
const root = path.resolve(import.meta.dirname, '..')
const exe = path.join(root, 'release-v1.5.4', 'win-unpacked', 'ESB Studio.exe')
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'esb-pk-'))
const results = []
const check = (n, ok, d = '') => { results.push(!!ok); console.log((ok ? 'PASS ' : 'FAIL ') + n + (d ? ' — ' + d : '')) }
const launch = async () => { const app = await electron.launch({ executablePath: exe, args: [], env: { ...process.env, ESB_USER_DATA: profile } }); const page = await app.firstWindow(); await page.waitForSelector('.topbar'); await page.waitForTimeout(800); return { app, page } }
let { app, page } = await launch()
const errors = []; page.on('pageerror', (e) => errors.push(e.message))
const w = async (sel) => Math.round((await page.locator(sel).boundingBox()).width)
check('window title / chrome loaded', (await page.title()).includes('ESB'))
check('panels start at 312', (await w('.left')) === 312 && (await w('.right')) === 312, `${await w('.left')} / ${await w('.right')}`)
const sp = await page.locator('.left > .splitter').boundingBox()
await page.mouse.move(sp.x + sp.width / 2, sp.y + 200); await page.mouse.down(); await page.mouse.move(sp.x + 80, sp.y + 200, { steps: 6 }); await page.mouse.up()
check('left panel dragged wider', (await w('.left')) > 340, `${await w('.left')}`)
await page.click('.el-row:has-text("Date") .tgl')
check('Date switch turns off', (await page.locator('.el-row.off:has-text("Date")').count()) === 1)
const lw = await w('.left')
await app.close()
;({ app, page } = await launch())
check('panel width survives a relaunch', (await w('.left')) === lw, `${lw} -> ${await w('.left')}`)
check('no page errors', errors.length === 0, errors.join(' | '))
await app.close()
console.log(results.every(Boolean) ? 'ALL PASS' : 'SOME FAILED')
