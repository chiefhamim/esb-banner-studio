// Home → Settings → Time format: picking 12-hour / 24-hour changes the times shown on the Outreach and Editorial desks,
// and flipping it while a desk is on screen re-renders that desk without a reload.
// Usage: node tools/e2e/clock-format-check.mjs   (starts its own Vite dev server)
import { chromium } from 'playwright-core'
import { launchBrowser } from '../launch-browser.mjs'
import { spawn } from 'node:child_process'
import path from 'node:path'
import { portOffset } from '../port-offset.mjs'

const PORT = 5193 + portOffset()
const root = path.resolve(import.meta.dirname, '../..')
const vite = spawn(process.execPath, [path.join(root, 'node_modules', 'vite', 'bin', 'vite.js'), '--port', String(PORT), '--strictPort'], { cwd: root, stdio: 'ignore' })
for (let i = 0; i < 60; i++) { try { if ((await fetch(`http://localhost:${PORT}/`)).ok) break } catch {} await new Promise((r) => setTimeout(r, 500)) }

const H24 = /(^|\D)([01]\d|2[0-3]):[0-5]\d(?!\s?[AP]M)/
const H12 = /(^|\D)(1[0-2]|[1-9]):[0-5]\d(:[0-5]\d)? (AM|PM)/
let b, fails = 0
const check = (ok, what, got = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}${got ? '  — ' + JSON.stringify(got) : ''}`); if (!ok) fails++ }

async function pickOnHome(page, label) {
  if (!(await page.locator('.home-shell').count())) {
    await page.evaluate(() => window.__shell.getState().setWorkspace('home'))
    await page.waitForSelector('.home-shell')
  }
  // the corner controls are folded into one handle that unfolds on hover
  await page.hover('.home-head-actions')
  await page.waitForTimeout(400)
  await page.click('.home-head-btn[aria-label="Settings"]')
  await page.waitForSelector('.home-clock-seg').catch(async (e) => { if (process.env.SHOT) await page.screenshot({ path: process.env.SHOT }); throw e })
  await page.click(`.home-clock-seg button:has-text("${label}")`)
  const example = (await page.textContent('.home-clock-example')).trim()
  const pressed = await page.getAttribute(`.home-clock-seg button:has-text("${label}")`, 'aria-pressed')
  await page.click('.dialog button:has-text("Done"), [role="dialog"] button:has-text("Done")')
  return { example, pressed }
}

try {
  b = await launchBrowser(chromium)
  const page = await (await b.newContext({ viewport: { width: 1600, height: 950 } })).newPage()
  page.setDefaultTimeout(10000)
  await page.goto(`http://localhost:${PORT}/`)
  await page.waitForSelector('.home-shell')

  // ---- Home: the control and its example
  let r = await pickOnHome(page, '24-hour')
  check(r.example === 'e.g. 16:58' && r.pressed === 'true', 'Home Settings: 24-hour shows "e.g. 16:58"', r.example)
  check(await page.evaluate(() => localStorage.getItem('esb-banner-studio/clock')) === '24h', 'the choice is saved in localStorage esb-banner-studio/clock')

  // ---- Outreach: a campaign row says "Not sent · edited <time>"
  await page.click('.launch-tile:has-text("Outreach")')
  await page.waitForSelector('.outreach-workspace')
  const newEmail = page.locator('button:has-text("New email")')
  if (await newEmail.count()) await newEmail.first().click()
  await page.waitForTimeout(500)
  const campTab = page.locator('.side-tabs button:has-text("Campaigns")')
  if (await campTab.count()) await campTab.first().click()
  const row = page.locator('.or-camp-n:has-text("edited")').first()
  await row.waitFor()
  let t = await row.innerText()
  check(H24.test(t), 'Outreach campaign row reads 24-hour', t)
  await page.evaluate(() => window.__shell.getState().setClock('12h'))
  await page.waitForTimeout(150)
  t = await row.innerText()
  check(H12.test(t), 'Outreach re-renders live to 12-hour (no reload)', t)

  // ---- Home → 12-hour stays; then back to 24-hour from Home and the Outreach desk follows
  r = await pickOnHome(page, '12-hour')
  check(r.example === 'e.g. 4:58 PM', 'Home Settings: 12-hour shows "e.g. 4:58 PM"', r.example)
  r = await pickOnHome(page, '24-hour')
  await page.click('.launch-tile:has-text("Outreach")')
  await page.waitForSelector('.outreach-workspace')
  if (await campTab.count()) await campTab.first().click()
  t = await page.locator('.or-camp-n:has-text("edited")').first().innerText()
  check(H24.test(t), 'Outreach follows the Home setting back to 24-hour', t)

  // ---- Editorial: the CMS status pill's "checked <time>" (tooltip), written by the site probe
  await page.evaluate(() => window.__shell.getState().setWorkspace('editorial'))
  await page.waitForSelector('.outreach-workspace', { state: 'detached' })
  await page.waitForSelector('.ed-statusbar .sb-cms')
  const pill = page.locator('.ed-statusbar .sb-cms').first()
  let tip = ''
  for (let i = 0; i < 40 && !/checked \d/.test(tip); i++) { tip = (await pill.getAttribute('data-tip')) || ''; await page.waitForTimeout(250) }
  check(H24.test(tip), 'Editorial CMS pill reads 24-hour', tip)
  await page.evaluate(() => window.__shell.getState().setClock('12h'))
  await page.waitForTimeout(150)
  tip = (await pill.getAttribute('data-tip')) || ''
  check(H12.test(tip), 'Editorial re-renders live to 12-hour (no reload)', tip)
  await pill.hover()
  await page.waitForTimeout(900)
  const shown = await page.locator('.tooltip, .tip, [role="tooltip"]').first().innerText().catch(() => '')
  check(!shown || H12.test(shown), 'the visible tooltip reads 12-hour', shown)
} finally {
  await b?.close()
  vite.kill()
}
console.log(fails ? `${fails} failed` : 'all passed')
process.exit(fails ? 1 : 0)
