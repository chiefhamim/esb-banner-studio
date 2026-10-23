// Inspector + popover states: node tools/shot-pop.mjs <tag> [dark]
import { chromium } from 'playwright-core'
import { launchBrowser } from './launch-browser.mjs'
import { spawn } from 'node:child_process'
import path from 'node:path'
const PORT = 5201, root = path.resolve(import.meta.dirname, '..')
const tag = process.argv[2] ?? 'p', dark = process.argv[3] === 'dark'
const out = (n) => path.join(root, 'tools/out', `${tag}-${n}.png`)
const vite = spawn(process.execPath, [path.join(root, 'node_modules', 'vite', 'bin', 'vite.js'), '--port', String(PORT), '--strictPort'], { cwd: root, stdio: 'ignore' })
for (let i = 0; i < 60; i++) { try { if ((await fetch(`http://localhost:${PORT}/`)).ok) break } catch {} await new Promise((r) => setTimeout(r, 500)) }
let b
try {
  b = await launchBrowser(chromium)
  const page = await b.newPage({ viewport: { width: 1600, height: 950 } })
  page.on('pageerror', (e) => console.log('PAGE ERROR', e.message))
  await page.goto(`http://localhost:${PORT}/`); await page.waitForTimeout(1500)
  if (dark) await page.evaluate(() => window.__store.getState().setTheme('dark'))
  await page.evaluate(() => { localStorage.setItem('esb-banner-studio/panel/insp-fx', '1') })
  await page.locator('.el-row:has-text("Headline") .name').first().click(); await page.waitForTimeout(300)
  // shrink the dock so the inspector has room
  await page.locator('.dock > .splitter').focus(); for (let i = 0; i < 10; i++) await page.keyboard.press('ArrowDown'); await page.waitForTimeout(200)
  await page.screenshot({ path: out('inspector') })
  await page.locator('.scrub:has(.scrub-label:text-is("Size")) input').first().scrollIntoViewIfNeeded()
  await page.locator('.colorfield .cf-swatch').first().click(); await page.waitForTimeout(250)
  await page.screenshot({ path: out('colorpop') })
  await page.keyboard.press('Escape')
  await page.locator('.right .select').first().click(); await page.waitForTimeout(250)
  await page.screenshot({ path: out('selectpop') })
  await page.keyboard.press('Escape')
  await page.click('.datefield, .left .select >> nth=0'); await page.waitForTimeout(250)
  await page.screenshot({ path: out('datepop') })
} finally { await b?.close(); vite.kill() }
