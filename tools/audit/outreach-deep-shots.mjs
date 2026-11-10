import { chromium } from 'playwright-core'
import { launchBrowser } from '../launch-browser.mjs'
import { spawn } from 'node:child_process'
import path from 'node:path'
import fs from 'node:fs'
import { portOffset } from '../port-offset.mjs'

const PORT = 5193 + portOffset()
const root = path.resolve(import.meta.dirname, '../..')
const outDir = path.join(root, 'artifacts', 'outreach-deep')
fs.mkdirSync(outDir, { recursive: true })

const csvPath = path.join(root, 'tools', 'fixtures', 'synthetic-contacts.csv')
if (!fs.existsSync(csvPath)) {
  const { writeSyntheticList } = await import('../fixtures/outreach-synthetic.mjs')
  writeSyntheticList(path.join(root, 'tools', 'fixtures'))
}
const csvBuffer = fs.readFileSync(csvPath)

const vite = spawn(process.execPath,
  [path.join(root, 'node_modules', 'vite', 'bin', 'vite.js'), '--port', String(PORT), '--strictPort'],
  { cwd: root, stdio: 'ignore' })
for (let i = 0; i < 60; i++) { try { if ((await fetch(`http://localhost:${PORT}/`)).ok) break } catch {} await new Promise(r=>setTimeout(r,500)) }

let browser
try {
  browser = await launchBrowser(chromium)
  for (const theme of (process.env.THEMES || 'dark,light').split(',')) {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
    const page = await ctx.newPage()
    page.setDefaultTimeout(8000)
    await page.goto(`http://localhost:${PORT}/`)
    await page.evaluate(th => { localStorage.setItem('esb-banner-studio/theme', th); document.documentElement.setAttribute('data-theme', th) }, theme)
    await page.reload(); await page.waitForTimeout(800)
    const save = n => page.screenshot({ path: path.join(outDir, `${n}-${theme}.png`) })

    await page.evaluate(() => { const b=[...document.querySelectorAll('button')].find(x=>/Outreach/i.test(x.textContent||'')); b?.click() })
    await page.waitForSelector('.outreach-workspace'); await page.waitForTimeout(600)

    // import list
    const fi = page.locator('input[type=file][accept*=".xlsx"]')
    if (await fi.count()) { await fi.first().setInputFiles({ name:'synthetic-contacts.csv', mimeType:'text/csv', buffer: csvBuffer }); await page.waitForTimeout(1000) }
    await save('01-contacts')

    // new campaign
    await page.evaluate(() => { const b=[...document.querySelectorAll('button')].find(x=>/New campaign/i.test(x.textContent||'')); b?.click() })
    await page.waitForTimeout(800); await save('02-new-campaign')

    // composer letter
    await save('03-composer')

    // left tab campaigns + sources
    for (const t of ['Campaigns','Sources']) {
      await page.evaluate(tt => { const b=[...document.querySelectorAll('.or-body .tabs button, .tabs button')].find(x=>new RegExp(tt,'i').test(x.textContent||'')); b?.click() }, t)
      await page.waitForTimeout(400); await save(`04-left-${t.toLowerCase()}`)
    }

    // right tabs
    for (const t of ['Contact','Review','Send']) {
      await page.evaluate(tt => { const b=[...document.querySelectorAll('.tabs button')].find(x=>new RegExp('^\s*'+tt+'\s*$','i').test(x.textContent||'')); b?.click() }, t)
      await page.waitForTimeout(400); await save(`05-right-${t.toLowerCase()}`)
    }

    // review & send sheet
    await page.evaluate(() => { const b=[...document.querySelectorAll('button')].find(x=>/Review & send/i.test(x.textContent||'')); b?.click() })
    await page.waitForTimeout(700); await save('06-review-send-sheet')
    await page.keyboard.press('Escape'); await page.waitForTimeout(300)

    // sending settings dialog
    await page.evaluate(() => { const b=[...document.querySelectorAll('button')].find(x=>/Sending settings/i.test(x.textContent||'')); b?.click() })
    await page.waitForTimeout(700); await save('07-sending-settings')
    await page.keyboard.press('Escape'); await page.waitForTimeout(300)

    // assistant
    await page.evaluate(() => { const b=[...document.querySelectorAll('button')].find(x=>/Ask the assistant/i.test(x.textContent||'')); b?.click() })
    await page.waitForTimeout(600); await save('08-assistant')
    await page.keyboard.press('Escape'); await page.waitForTimeout(300)

    // activity desk tabs
    await page.evaluate(() => { const b=[...document.querySelectorAll('.topbar button')].find(x=>/Activity/i.test(x.textContent||'')); b?.click() })
    await page.waitForTimeout(700); await save('09-activity-overview')
    for (const t of ['Log','Reports','Session']) {
      await page.evaluate(tt => { const b=[...document.querySelectorAll('button')].find(x=>new RegExp('^\s*'+tt+'\s*$','i').test(x.textContent||'')); b?.click() }, t)
      await page.waitForTimeout(500); await save(`10-activity-${t.toLowerCase()}`)
    }
    await ctx.close()
  }
} finally { await browser?.close(); vite.kill() }
console.log('done →', outDir)
