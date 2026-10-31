// tools/e2e/capture-phase3-shots.mjs
// Captures Phase 3 Activity Desk screenshots at 900px, 1366px, 1920px (light + dark)
// and copies them directly to Desktop/outreach-autopilot/phase3/ for visual verification.

import { chromium } from 'playwright-core'
import { launchBrowser } from '../launch-browser.mjs'
import { spawn } from 'node:child_process'
import path from 'node:path'
import fs from 'node:fs'

import { portOffset } from '../port-offset.mjs'
const PORT = 5202 + portOffset()
const root = path.resolve(import.meta.dirname, '../..')
const outDir = path.join(root, 'docs', 'outreach-autopilot', 'shots', 'phase3')
const desktopDir = path.join('C:\\Users\\hamim\\Desktop', 'outreach-autopilot', 'phase3')

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

let browser
try {
  browser = await launchBrowser(chromium)

  for (const { w, h } of widths) {
    for (const theme of themes) {
      console.log(`Phase 3 capture: width=${w} height=${h} theme=${theme}...`)
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
        await page.click('.ws-btn[data-ws="outreach"]')
      }
      await page.waitForSelector('.outreach-workspace')
      await page.waitForTimeout(400)

      // Switch to Activity Desk
      await page.evaluate(() => {
        window.__outreachUi?.getState().set({ desk: 'activity' })
      })
      await page.waitForTimeout(400)

      const save = async (name) => {
        const fileName = `${w}-${theme}-${name}.png`
        const repoPath = path.join(outDir, fileName)
        const deskPath = path.join(desktopDir, fileName)
        await page.screenshot({ path: repoPath })
        fs.copyFileSync(repoPath, deskPath)
      }

      // 1. Activity empty desk
      await save('01-activity-empty')

      // Seed realistic stats & jobs into __activityStore
      await page.evaluate(() => {
        const act = window.__activityStore?.getState?.()
        if (!act) return

        const baseT = Date.parse('2026-11-01T03:00:00Z')
        const seededStats = {
          totals: {
            sent: 2400,
            failed: 31,
            rejected: 0,
            skipped: 118,
            bounced: 12,
            replied: 88,
            optedOut: 3,
            retries: 42,
          },
          today: Array.from({ length: 24 }, (_, i) => ({
            t: i,
            sent: i >= 9 && i <= 17 ? Math.round(15 + Math.sin(i) * 10) : 0,
            failed: i === 11 || i === 15 ? 1 : 0,
          })),
          byHour: Array.from({ length: 24 }, (_, i) => ({
            h: i,
            sent: i >= 9 && i <= 17 ? Math.round(120 + Math.sin(i) * 40) : 0,
            failed: i === 11 || i === 15 ? 4 : 0,
          })),
          byDay: [
            { day: '2026-11-01', sent: 140, failed: 2, bounced: 1, replied: 6 },
            { day: '2026-11-02', sent: 155, failed: 1, bounced: 0, replied: 8 },
            { day: '2026-11-03', sent: 160, failed: 3, bounced: 2, replied: 12 },
            { day: '2026-11-04', sent: 145, failed: 0, bounced: 0, replied: 7 },
            { day: '2026-11-05', sent: 150, failed: 2, bounced: 1, replied: 9 },
            { day: '2026-11-08', sent: 160, failed: 1, bounced: 0, replied: 11 },
            { day: '2026-11-09', sent: 165, failed: 2, bounced: 1, replied: 14 },
          ],
          window: { from: '09:00', to: '17:00', days: [0, 1, 2, 3, 4], tz: 'Asia/Dhaka' },
          cap: 60,
          durations: {
            avgSendMs: 420,
            p95SendMs: 890,
            avgGapSec: 238,
            activeMs: (41 * 3600 + 12 * 60) * 1000,
            elapsedMs: 9 * 86400 * 1000,
            perActiveHour: 58,
          },
          replyMedianMs: 18 * 60000,
          firstSendAt: baseT,
          lastSendAt: baseT + 8 * 86400 * 1000,
          jobs: [
            {
              jobId: 'job-active-1',
              campaignId: 'camp-1',
              name: 'Power Grid Modernization Q4',
              kind: 'first',
              status: 'running',
              dry: false,
              total: 2400,
              sent: 142,
              failed: 2,
              skipped: 14,
              held: 0,
              remaining: 2242,
              createdAt: baseT,
              startedAt: baseT + 1000,
              until: Date.now() + 192000,
              etaAt: baseT + 17 * 86400 * 1000,
            },
          ],
        }

        const seededEvents = [
          {
            id: 'ev-1',
            type: 'send.ok',
            email: 'rezwan.khan@pgcb.gov.bd',
            name: 'Engr. Rezwanul Khan',
            org: 'Power Grid Company of Bangladesh',
            campaignName: 'Power Grid Modernization Q4',
            t: Date.now() - 60000,
            ms: 412,
          },
          {
            id: 'ev-2',
            type: 'reply',
            email: 'director.planning@bpdb.gov.bd',
            name: 'Director (Planning)',
            org: 'Bangladesh Power Development Board',
            campaignName: 'Power Grid Modernization Q4',
            t: Date.now() - 180000,
            auto: false,
          },
          {
            id: 'ev-3',
            type: 'send.fail',
            email: 'info@old-substation.com',
            org: 'Old Substation',
            campaignName: 'Power Grid Modernization Q4',
            error: '550 5.1.1 User unknown',
            code: 550,
            kind: 'recipient_permanent',
            t: Date.now() - 360000,
            ms: 890,
          },
          {
            id: 'ev-4',
            type: 'bounce',
            email: 'admin@defunct-vendor.com',
            org: 'Defunct Vendor',
            reason: 'Host not found (NXDOMAIN)',
            t: Date.now() - 540000,
          },
          {
            id: 'ev-5',
            type: 'optout',
            email: 'staff@archive-dept.org',
            name: 'Archive Dept',
            on: true,
            t: Date.now() - 720000,
          },
          {
            id: 'ev-6',
            type: 'send.ok',
            email: 'dr.kabir@ruppur-power.gov.bd',
            name: 'Dr. Kabir Ahmed',
            org: 'Rooppur NPP Project',
            campaignName: 'Power Grid Modernization Q4',
            t: Date.now() - 900000,
            ms: 385,
          },
        ]

        window.__activityStore.setState({
          stats: seededStats,
          logEvents: seededEvents,
          hasDryEvents: true,
        })
      })
      await page.waitForTimeout(400)

      // 2. Activity Overview
      await save('02-activity-overview')

      // 3. Activity Log
      await page.evaluate(() => {
        window.__activityStore?.getState?.().setTab('log')
      })
      await page.waitForTimeout(400)
      await save('03-activity-log')

      // 4. Reports By Day with side panel open
      await page.evaluate(() => {
        const act = window.__activityStore?.getState?.()
        act?.setTab('reports')
        act?.setSelectedDay('2026-11-03')
      })
      await page.waitForTimeout(400)
      await save('04-activity-reports-day')

      // 5. Reports By Run with side panel open
      await page.evaluate(() => {
        const act = window.__activityStore?.getState?.()
        act?.setSelectedDay(null)
        act?.setSelectedJobId('job-active-1')
      })
      await page.waitForTimeout(400)
      await save('05-activity-reports-run')

      await ctx.close()
    }
  }

  console.log('Phase 3 screenshots captured successfully!')
} finally {
  await browser?.close()
  vite.kill()
}
