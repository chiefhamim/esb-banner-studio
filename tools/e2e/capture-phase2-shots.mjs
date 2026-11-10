import { chromium } from 'playwright-core'
import { launchBrowser } from '../launch-browser.mjs'
import { spawn } from 'node:child_process'
import path from 'node:path'
import fs from 'node:fs'

import { portOffset } from '../port-offset.mjs'
const PORT = 5199 + portOffset()
const root = path.resolve(import.meta.dirname, '../..')
const outDir = path.join(root, 'docs', 'outreach-autopilot', 'shots', 'phase2')
const desktopDir = path.join('C:\\Users\\hamim\\Desktop', 'outreach-autopilot', 'phase2')

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
      console.log(`Phase 2 capture: width=${w} height=${h} theme=${theme}...`)
      const ctx = await browser.newContext({ viewport: { width: w, height: h } })
      const page = await ctx.newPage()
      page.setDefaultTimeout(10000)

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

      // Import synthetic list
      await page.setInputFiles('input[type=file][accept*=".xlsx"]', {
        name: 'synthetic-contacts.csv',
        mimeType: 'text/csv',
        buffer: csvBuffer,
      })
      await page.waitForTimeout(600)

      // Ensure Send tab is open
      await page.evaluate(() => {
        window.__outreachUi?.getState().set({ right: 'send' })
      })
      await page.waitForTimeout(300)

      // 1. Autopilot card in Idle state
      await save('01-autopilot-idle')

      // Seed a running job in engineStore to show Sending state
      await page.evaluate(() => {
        const eng = window.__engineStore?.getState?.()
        const outreach = window.__outreachStore?.getState?.()
        const camp = outreach?.campaign?.()
        if (eng && camp) {
          eng.updateFromProgress({
            jobId: 'job-active-1',
            campaignId: camp.id,
            status: 'running',
            sent: 142,
            total: 2400,
            failed: 0,
            until: Date.now() + 192000,
          })
        }
      })
      await page.waitForTimeout(300)

      // 2. Autopilot card in Sending state + Status Bar pill active
      await save('02-autopilot-sending')

      // Seed a waiting state (window opens Sunday)
      await page.evaluate(() => {
        const eng = window.__engineStore?.getState?.()
        const outreach = window.__outreachStore?.getState?.()
        const camp = outreach?.campaign?.()
        if (eng && camp) {
          eng.updateFromProgress({
            jobId: 'job-active-1',
            campaignId: camp.id,
            status: 'waiting',
            why: 'window',
            until: Date.now() + 86400000,
            sent: 142,
            total: 2400,
            failed: 0,
          })
        }
      })
      await page.waitForTimeout(300)

      // 3. Autopilot card in Waiting state
      await save('03-autopilot-waiting')

      // 4. Open Review & send sheet
      const sendBtn = page.locator('.or-send-btn')
      if ((await sendBtn.count()) > 0) {
        await sendBtn.first().click()
        await page.waitForSelector('.dialog', { timeout: 3000 }).catch(() => {})
        await page.waitForTimeout(400)
        await save('04-review-send-plan')
        await page.keyboard.press('Escape')
        await page.waitForTimeout(300)
      }

      // 5. Open Autopilot settings sheet
      await page.evaluate(() => {
        window.__outreachUi?.getState().set({ sheet: 'autopilot' })
      })
      await page.waitForSelector('.dialog', { timeout: 3000 }).catch(() => {})
      await page.waitForTimeout(400)
      await save('05-autopilot-settings')
      await page.keyboard.press('Escape')
      await page.waitForTimeout(300)

      await ctx.close()
    }
  }

  console.log('Phase 2 screenshots captured successfully!')
} finally {
  await browser?.close()
  vite.kill()
}
