// tools/e2e/capture-phase4-shots.mjs
// Captures Phase 4 screenshots at 900px, 1366px, 1920px (light + dark)
// and copies them directly to Desktop/outreach-autopilot/phase4/ for visual verification.

import { chromium } from 'playwright-core'
import { launchBrowser } from '../launch-browser.mjs'
import { spawn } from 'node:child_process'
import path from 'node:path'
import fs from 'node:fs'

const PORT = 5203
const root = path.resolve(import.meta.dirname, '../..')
const outDir = path.join(root, 'docs', 'outreach-autopilot', 'shots', 'phase4')
const desktopDir = path.join('C:\\Users\\hamim\\Desktop', 'outreach-autopilot', 'phase4')

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
      console.log(`Phase 4 capture: width=${w} height=${h} theme=${theme}...`)
      const ctx = await browser.newContext({ viewport: { width: w, height: h } })
      const page = await ctx.newPage()
      page.setDefaultTimeout(10000)
      page.on('console', (msg) => console.log('PAGE LOG:', msg.text()))
      page.on('pageerror', (err) => console.log('PAGE ERROR:', err.message))

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

      // Seed Phase 4 test data
      await page.evaluate(async () => {
        const st = window.__outreachStore?.getState()
        if (st) {
          // Switch to compose desk
          window.__outreachUi?.getState().set({ desk: 'compose', sheet: null })

          // Create/update test campaign
          let cmp = st.campaign()
          if (!cmp) {
            const id = await st.createCampaign({
              name: 'Energy Briefing',
              kind: 'list',
              blueprint: 'blank',
              subject: 'Official Energy Directory Briefing for {organization}',
              body: 'Dear {name},\n\nIn your role as {designation|Representative} at {organization}, we present the latest edition.\n\nOur office at {postal_address|Dhaka} welcomes your delegation.\n\nWith highest regards,\nESB PowerLine Desk',
            })
            await st.openCampaign(id)
            cmp = st.campaign()
          } else {
            st.patch({
              subject: 'Official Energy Directory Briefing for {organization}',
              body: 'Dear {name},\n\nIn your role as {designation|Representative} at {organization}, we present the latest edition.\n\nOur office at {postal_address|Dhaka} welcomes your delegation.\n\nWith highest regards,\nESB PowerLine Desk',
              blueprint: 'blank',
            })
          }

          // Populate contacts with custom fields, some with flags for Needs you
          const sampleContacts = [
            {
              id: 'c1',
              serial: 1,
              sectorGroup: 'Power Generation',
              groupNo: 1,
              organization: 'Summit Power Ltd.',
              personName: 'Muhammed Aziz Khan',
              designation: 'Chairman',
              email: 'aziz@summitpower.com',
              phone: '+8801711000001',
              purposes: ['MAGAZINE_DISTRIBUTION'],
              mxStatus: 'SAFE_TO_SEND',
              rawStatus: 'SAFE_TO_SEND',
              diagnostic: '',
              sheet: 'Energy',
              approved: true,
              status: 'QUEUED',
              fields: { postal_address: 'Summit Centre, Kawran Bazar, Dhaka', district: 'Dhaka' },
            },
            {
              id: 'c2',
              serial: 2,
              sectorGroup: 'Transmission',
              groupNo: 2,
              organization: 'Power Grid Co. of Bangladesh',
              personName: 'Engr. Kamal 01', // odd_name flag: digits
              designation: 'Chief Engineer',
              email: 'kamal@pgcb.gov.bd',
              phone: '+8801711000002',
              purposes: ['MAGAZINE_DISTRIBUTION'],
              mxStatus: 'REVIEW_REQUIRED',
              rawStatus: 'ELIGIBLE',
              diagnostic: '',
              sheet: 'Energy',
              approved: false,
              status: 'QUEUED',
              fields: { postal_address: 'Aftabnagar, Dhaka', district: 'Dhaka' },
            },
            {
              id: 'c3',
              serial: 3,
              sectorGroup: 'Renewable',
              groupNo: 3,
              organization: 'SREDA',
              personName: 'Tariq Rahman',
              designation: 'Director',
              email: 'info@sreda.gov.bd', // generic_mailbox_with_name flag: role mailbox + name
              phone: '+8801711000003',
              purposes: ['MAGAZINE_DISTRIBUTION'],
              mxStatus: 'REVIEW_REQUIRED',
              rawStatus: 'CHECK',
              diagnostic: '',
              sheet: 'Energy',
              approved: false,
              status: 'QUEUED',
              fields: { postal_address: 'IEB Bhaban, Ramna, Dhaka', district: 'Dhaka' },
            },
            {
              id: 'c4',
              serial: 4,
              sectorGroup: 'Distribution',
              groupNo: 4,
              organization: 'DESCO',
              personName: '',
              designation: 'Executive',
              email: 'office@desco.org.bd',
              phone: '',
              purposes: ['MAGAZINE_DISTRIBUTION'],
              mxStatus: 'SAFE_TO_SEND',
              rawStatus: 'SAFE_TO_SEND',
              diagnostic: '',
              sheet: 'Energy',
              approved: true,
              status: 'QUEUED',
              fields: { postal_address: 'Nikunja-2, Khilkhet, Dhaka', district: 'Dhaka' },
            },
          ]

          // Set verified domains and contacts
          window.__outreachStore?.setState({
            contacts: sampleContacts,
            activeContact: 'c1',
            verifiedAddrs: {
              'summitpower.com': { mx: true, a: true },
              'pgcb.gov.bd': { mx: true, a: true },
              'sreda.gov.bd': { mx: true, a: true },
              'desco.org.bd': { mx: true, a: true },
            },
          })
        }
      }, theme)
      await page.waitForTimeout(400)

      const save = async (name) => {
        const f = `${name}_${w}_${theme}.png`
        const localP = path.join(outDir, f)
        const deskP = path.join(desktopDir, f)
        await page.screenshot({ path: localP })
        fs.copyFileSync(localP, deskP)
      }

      // 1. Composer view showing placeholder chips with custom fields
      await page.evaluate(() => {
        window.__outreachUi?.getState().set({ left: 'contacts', right: 'send', view: 'edit' })
      })
      await page.waitForTimeout(300)
      await save('phase4_composer_chips')

      // 2. Contacts tab showing address check summary & bulk approve button
      await page.evaluate(() => {
        window.__outreachUi?.getState().set({ left: 'contacts' })
      })
      await page.waitForTimeout(300)
      await save('phase4_address_check_summary')

      // 3. Review tab showing Needs You exception queue
      await page.evaluate(() => {
        window.__outreachUi?.getState().set({ right: 'review' })
      })
      await page.waitForTimeout(300)
      await save('phase4_needs_you_queue')

      // 4. Contact tab showing address check verification status
      await page.evaluate(() => {
        window.__outreachUi?.getState().set({ right: 'contact' })
      })
      await page.waitForTimeout(300)
      await save('phase4_contact_details')

      // 5. Review & send dialog showing 3 plan metrics (will be sent, need you, skipped)
      await page.evaluate(() => {
        window.__outreachUi?.getState().set({ sheet: 'review-send' })
      })
      await page.waitForTimeout(400)
      await save('phase4_review_send_plan')

      // Close sheet
      await page.evaluate(() => {
        window.__outreachUi?.getState().set({ sheet: null })
      })

      await ctx.close()
    }
  }
} finally {
  if (browser) await browser.close()
  vite.kill()
}

console.log('Phase 4 screenshot capture complete!')
