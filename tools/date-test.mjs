// Date picker: month / year dropdowns inside the calendar must stay open and apply.
import { chromium } from 'playwright-core'
import { spawn } from 'node:child_process'
import path from 'node:path'
const PORT = 5186
const root = path.resolve(import.meta.dirname, '..')
const vite = spawn(process.execPath, [path.join(root, 'node_modules', 'vite', 'bin', 'vite.js'), '--port', String(PORT), '--strictPort'], { cwd: root, stdio: 'ignore' })
for (let i = 0; i < 60; i++) { try { if ((await fetch(`http://localhost:${PORT}/`)).ok) break } catch {} await new Promise((r) => setTimeout(r, 500)) }
let b, ok = true
const check = (n, v, x = '') => { ok &&= v; console.log(v ? 'PASS' : 'FAIL', n, x) }
try {
  b = await chromium.launch({ channel: 'msedge', headless: true })
  const page = await (await b.newContext({ viewport: { width: 1600, height: 950 } })).newPage()
  page.setDefaultTimeout(6000)
  await page.goto(`http://localhost:${PORT}/`)
  await page.waitForSelector('.topbar'); await page.waitForTimeout(500)
  await page.click('.datefield'); await page.waitForSelector('.calpop')
  const selects = page.locator('.calpop .cal-head .select')
  await selects.nth(0).click()
  check('month list opens and the calendar stays open', (await page.locator('.popover.menu .menu-item').count()) === 12 && (await page.locator('.calpop').count()) === 1)
  await page.click('.popover.menu .menu-item:has-text("March")')
  check('picking a month applies', (await selects.nth(0).textContent()).includes('March') && (await page.locator('.calpop').count()) === 1, await selects.nth(0).textContent())
  await selects.nth(1).click()
  const years = await page.locator('.popover.menu .menu-item').allTextContents()
  await page.click(`.popover.menu .menu-item:has-text("${years[0].trim()}")`)
  check('picking a year applies', (await selects.nth(1).textContent()).includes(years[0].trim()) && (await page.locator('.calpop').count()) === 1, await selects.nth(1).textContent())
  await page.click('.cal-day:not(.out):text-is("15")')
  const shown = await page.textContent('.datefield')
  check('choosing a day closes the calendar and sets the date', (await page.locator('.calpop').count()) === 0 && shown.includes('15') && shown.includes('Mar') && shown.includes(years[0].trim()), shown)
  await page.click('.datefield'); await page.waitForSelector('.calpop')
  await selects.nth(0).click(); await page.keyboard.press('Escape')
  check('Escape closes only the dropdown first', (await page.locator('.calpop').count()) === 1 && (await page.locator('.popover.menu').count()) === 0)
  await page.mouse.click(700, 500); await page.waitForTimeout(200)
  check('clicking outside closes the calendar', (await page.locator('.calpop').count()) === 0)
} finally { await b?.close(); vite.kill() }
process.exit(ok ? 0 : 1)
