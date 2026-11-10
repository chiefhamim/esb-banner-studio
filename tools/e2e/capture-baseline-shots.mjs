import { chromium } from 'playwright-core'
import { launchBrowser } from '../launch-browser.mjs'
import { spawn } from 'node:child_process'
import path from 'node:path'
import fs from 'node:fs'

import { portOffset } from '../port-offset.mjs'
const PORT = 5199 + portOffset()
const root = path.resolve(import.meta.dirname, '../..')
const outDir = path.join(root, 'docs', 'outreach-autopilot', 'baseline')
const desktopDir = path.join('C:\\Users\\hamim\\Desktop', 'outreach-autopilot', 'baseline')

fs.mkdirSync(outDir, { recursive: true })
fs.mkdirSync(desktopDir, { recursive: true })

const widths = [
  { w: 900, h: 700 },
  { w: 1366, h: 768 },
  { w: 1920, h: 1080 },
]
const themes = ['light', 'dark']

const vite = spawn(
  process.execPath,
  [path.join(root, 'node_modules', 'vite', 'bin', 'vite.js'), '--port', String(PORT), '--strictPort'],
  { cwd: root, stdio: 'ignore' }
)

// Wait for vite server
for (let i = 0; i < 60; i++) {
  try {
    if ((await fetch(`http://localhost:${PORT}/`)).ok) break
  } catch {}
  await new Promise((r) => setTimeout(r, 500))
}

const csvPath = path.join(root, 'tools', 'fixtures', 'synthetic-contacts.csv')
if (!fs.existsSync(csvPath)) {
  const { writeSyntheticList } = await import('../fixtures/outreach-synthetic.mjs')
  writeSyntheticList(path.join(root, 'tools', 'fixtures'))
}
const csvBuffer = fs.readFileSync(csvPath)

let browser
try {
  browser = await launchBrowser(chromium)

  for (const { w, h } of widths) {
    for (const theme of themes) {
      console.log(`Capturing width=${w} height=${h} theme=${theme}...`)
      const ctx = await browser.newContext({ viewport: { width: w, height: h } })
      const page = await ctx.newPage()
      page.setDefaultTimeout(8000)

      await page.goto(`http://localhost:${PORT}/`)
      await page.waitForSelector('.studio-shell')
      await page.waitForTimeout(300)

      // Set theme
      await page.evaluate((th) => {
        window.__store?.getState().setTheme(th)
        document.documentElement.setAttribute('data-theme', th)
      }, theme)
      await page.waitForTimeout(300)

      // Switch to Outreach
      const tile = page.locator(`.launch-tile:has-text("Outreach")`)
      if ((await tile.count()) > 0) {
        await tile.first().click()
      } else {
        await page.click('.ws-btn[data-ws="outreach"]:visible')
      }
      await page.waitForSelector('.outreach-workspace')
      await page.waitForTimeout(400)

      const save = async (name) => {
        const fileName = `${w}-${theme}-${name}.png`
        const repoPath = path.join(outDir, fileName)
        const deskPath = path.join(desktopDir, fileName)
        await page.screenshot({ path: repoPath })
        fs.copyFileSync(repoPath, deskPath)
      }

      // 1. empty desk
      await save('01-empty-desk')

      // Import synthetic list
      await page.setInputFiles('input[type=file][accept*=".xlsx"]', {
        name: 'synthetic-contacts.csv',
        mimeType: 'text/csv',
        buffer: csvBuffer,
      })
      await page.waitForTimeout(800)

      // 2. list imported
      await save('02-list-imported')

      // 3. campaign open (Edit)
      await save('03-campaign-open-edit')

      // 4. campaign open (Preview)
      await page.evaluate(() => {
        const btn = [...document.querySelectorAll('.seg-ctl button')].find((b) => /preview/i.test(b.textContent || ''))
        btn?.click()
      })
      await page.waitForTimeout(400)
      await save('04-campaign-open-preview')

      // Switch back to Edit
      await page.evaluate(() => {
        const btn = [...document.querySelectorAll('.seg-ctl button')].find((b) => /edit/i.test(b.textContent || ''))
        btn?.click()
      })
      await page.waitForTimeout(400)

      // 5. Send tab (right column is already send by default)
      await page.evaluate(() => {
        const btn = document.querySelector('.or-right .or-tabs button[aria-label="Send"]')
        btn?.click()
      })
      await page.waitForTimeout(300)
      await save('05-send-tab')

      // 6. Review tab (right column)
      await page.evaluate(() => {
        const btn = document.querySelector('.or-right .or-tabs button[aria-label="Review"]')
        btn?.click()
      })
      await page.waitForTimeout(400)
      await save('06-review-tab')

      // Switch back to Send tab
      await page.evaluate(() => {
        const btn = document.querySelector('.or-right .or-tabs button[aria-label="Send"]')
        btn?.click()
      })
      await page.waitForTimeout(300)

      // 7. Header clock popover open
      await page.evaluate(() => {
        const btn = document.querySelector('.ed-tp-history')
        btn?.click()
      })
      await page.waitForTimeout(400)
      await save('07-header-clock-popover')
      await page.keyboard.press('Escape')
      await page.waitForTimeout(200)

      // 8. Review & send sheet
      await page.evaluate(() => {
        const items = [...document.querySelectorAll('.topbar .mb-item')]
        const camp = items.find((el) => /Campaign/i.test(el.textContent || ''))
        camp?.click()
      })
      await page.waitForTimeout(200)
      await page.evaluate(() => {
        const items = [...document.querySelectorAll('.menu-item')]
        const rs = items.find((el) => /Review & send/i.test(el.textContent || ''))
        rs?.click()
      })
      await page.waitForSelector('.dialog, .ed-sheet, .or-review-sheet', { timeout: 3000 }).catch(() => {})
      await page.waitForTimeout(400)
      await save('08-review-send-sheet')
      await page.keyboard.press('Escape')
      await page.waitForTimeout(300)

      // 9. Sender dialog
      await page.evaluate(() => {
        const btn = document.querySelector('.ed-account, .topbar button[aria-label="Sender account"]')
        btn?.click()
      })
      await page.waitForSelector('.dialog, .ed-sheet', { timeout: 3000 }).catch(() => {})
      await page.waitForTimeout(400)
      await save('09-sender-dialog')
      await page.keyboard.press('Escape')
      await page.waitForTimeout(200)

      await ctx.close()
    }
  }
  console.log('All baseline screenshots captured successfully!')
} finally {
  await browser?.close()
  vite.kill()
}
