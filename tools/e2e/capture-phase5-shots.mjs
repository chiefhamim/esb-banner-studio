// tools/e2e/capture-phase5-shots.mjs
// Captures Phase 5 screenshots at 900px, 1366px, 1920px (light + dark)
// and copies them directly to Desktop/outreach-autopilot/phase5/ for visual verification.

import { chromium } from 'playwright-core'
import { launchBrowser } from '../launch-browser.mjs'
import { spawn } from 'node:child_process'
import path from 'node:path'
import fs from 'node:fs'

const PORT = 5204
const root = path.resolve(import.meta.dirname, '../..')
const outDir = path.join(root, 'docs', 'outreach-autopilot', 'shots', 'phase5')
const desktopDir = path.join('C:\\Users\\hamim\\Desktop', 'outreach-autopilot', 'phase5')

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
      console.log(`Phase 5 capture: width=${w} height=${h} theme=${theme}...`)
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

      // Seed Phase 5 test data
      await page.evaluate(async () => {
        const st = window.__outreachStore?.getState()
        if (st) {
          // Switch to compose desk
          window.__outreachUi?.getState().set({ desk: 'compose', sheet: null })

          // Create/update test campaign with segment variants and subject variants
          let cmp = st.campaign()
          const sampleBody =
            'Dear {name},\n\n{opener|}\n\nIn your role as {designation|Representative} at {organization}, we present the latest ESB PowerLine directory.\n\nOur editorial desk in {sector} welcomes your insights.\n\nWith highest regards,\nESB PowerLine Desk'

          if (!cmp) {
            const id = await st.createCampaign({
              name: 'Q4 National Energy Outreach',
              kind: 'list',
              blueprint: 'corporate_sponsorship',
              subject: 'Complimentary Leadership Copy: Bangladesh Energy Directory ({organization})',
              body: sampleBody,
            })
            await st.openCampaign(id)
            cmp = st.campaign()
          } else {
            st.patch({
              name: 'Q4 National Energy Outreach',
              subject: 'Complimentary Leadership Copy: Bangladesh Energy Directory ({organization})',
              body: sampleBody,
              blueprint: 'corporate_sponsorship',
              subjectVariants: [
                'Executive Briefing: National Energy Directory for {organization}',
                'Energy Transition Leadership & Collaboration: {organization}',
                'Exclusive Sector Intelligence: ESB PowerLine Briefing',
              ],
              variants: {
                '1:corporate_sponsorship': {
                  subject: 'Power Generation Sponsorship & Partnership ({organization})',
                  body: 'Dear {name},\n\n{opener|}\n\nAs a recognized power generation leader at {organization}, we invite your executive partnership in our 2026 Directory.\n\nWith regards,\nESB PowerLine Team',
                  status: 'approved',
                  by: 'you',
                  at: Date.now() - 3600000,
                },
                '2:magazine_distribution': {
                  subject: 'Complimentary Transmission Briefing for {organization}',
                  body: 'Dear {name},\n\n{opener|}\n\nCovering high-voltage transmission advancements at {organization}.\n\nWith regards,\nESB PowerLine Team',
                  status: 'draft',
                  by: 'ai',
                  at: Date.now() - 1800000,
                },
              },
              openers: {
                'aziz@summitpower.com': {
                  text: 'We commend your ongoing executive leadership at Summit Power International as the sector expands generation capacity.',
                  at: Date.now() - 3600000,
                },
                'kamal@pgcb.gov.bd': {
                  text: 'Following your dedicated stewardship across national transmission reliability at Power Grid Co. of Bangladesh.',
                  at: Date.now() - 1800000,
                },
              },
            })
          }

          // Populate realistic audience contacts
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
              purposes: ['SPONSORSHIP'],
              mxStatus: 'SAFE_TO_SEND',
              rawStatus: 'SAFE_TO_SEND',
              diagnostic: '',
              sheet: 'Energy',
              approved: true,
              status: 'QUEUED',
              fields: { postal_address: 'Summit Centre, Kawran Bazar, Dhaka' },
            },
            {
              id: 'c2',
              serial: 2,
              sectorGroup: 'Transmission',
              groupNo: 2,
              organization: 'Power Grid Co. of Bangladesh',
              personName: 'Engr. Kamal Hossain',
              designation: 'Managing Director',
              email: 'kamal@pgcb.gov.bd',
              phone: '+8801711000002',
              purposes: ['MAGAZINE_DISTRIBUTION'],
              mxStatus: 'SAFE_TO_SEND',
              rawStatus: 'SAFE_TO_SEND',
              diagnostic: '',
              sheet: 'Energy',
              approved: true,
              status: 'QUEUED',
              fields: { postal_address: 'Aftabnagar, Dhaka' },
            },
            {
              id: 'c3',
              serial: 3,
              sectorGroup: 'Renewable Energy',
              groupNo: 3,
              organization: 'SREDA',
              personName: 'Munira Sultana',
              designation: 'Secretary & Chairman',
              email: 'chairman@sreda.gov.bd',
              phone: '+8801711000003',
              purposes: ['POLICY_DIALOGUE'],
              mxStatus: 'SAFE_TO_SEND',
              rawStatus: 'SAFE_TO_SEND',
              diagnostic: '',
              sheet: 'Energy',
              approved: true,
              status: 'QUEUED',
              fields: { postal_address: 'IEB Bhaban, Ramna, Dhaka' },
            },
            {
              id: 'c4',
              serial: 4,
              sectorGroup: 'Distribution Utilities',
              groupNo: 4,
              organization: 'DESCO',
              personName: 'Md. Kausar Ameen',
              designation: 'Chief Executive Officer',
              email: 'ceo@desco.org.bd',
              phone: '+8801711000004',
              purposes: ['MAGAZINE_DISTRIBUTION'],
              mxStatus: 'SAFE_TO_SEND',
              rawStatus: 'SAFE_TO_SEND',
              diagnostic: '',
              sheet: 'Energy',
              approved: true,
              status: 'QUEUED',
              fields: { postal_address: 'Nikunja-2, Khilkhet, Dhaka' },
            },
            {
              id: 'c5',
              serial: 5,
              sectorGroup: 'Energy Exploration',
              groupNo: 5,
              organization: 'Petrobangla',
              personName: 'Zanendra Nath Sarker',
              designation: 'Chairman',
              email: 'chairman@petrobangla.org.bd',
              phone: '+8801711000005',
              purposes: ['EXECUTIVE_INTERVIEW'],
              mxStatus: 'SAFE_TO_SEND',
              rawStatus: 'SAFE_TO_SEND',
              diagnostic: '',
              sheet: 'Energy',
              approved: true,
              status: 'QUEUED',
              fields: { postal_address: 'Petrocentre, Kawran Bazar, Dhaka' },
            },
          ]

          window.__outreachStore?.setState({
            contacts: sampleContacts,
            activeContact: 'c1',
          })
        }
      })
      await page.waitForTimeout(400)

      const save = async (name) => {
        const f = `${name}_${w}_${theme}.png`
        const localP = path.join(outDir, f)
        const deskP = path.join(desktopDir, f)
        await page.screenshot({ path: localP })
        fs.copyFileSync(localP, deskP)
      }

      // 1. Composer view showing {opener|} placeholder chip
      await page.evaluate(() => {
        window.__outreachUi?.getState().set({ left: 'contacts', right: 'send', view: 'edit', sheet: null })
      })
      await page.waitForTimeout(300)
      await save('phase5_composer_openers')

      // 2. Versions by sector dialog (top: segments list with approved/draft/default badges)
      await page.evaluate(() => {
        window.__outreachUi?.getState().set({ sheet: 'segments' })
      })
      await page.waitForTimeout(400)
      await save('phase5_segments_dialog')

      // 3. Versions by sector dialog (scrolled down to VIP openers)
      await page.evaluate(() => {
        const dlg = document.querySelector('.or-seg-dialog')
        if (dlg) dlg.scrollTop = dlg.scrollHeight
      })
      await page.waitForTimeout(300)
      await save('phase5_segments_openers')

      // Close segments sheet
      await page.evaluate(() => {
        window.__outreachUi?.getState().set({ sheet: null })
      })
      await page.waitForTimeout(200)

      // 4. Subject line versions dialog showing alternates and live preview
      await page.evaluate(() => {
        window.__outreachUi?.getState().set({ sheet: 'subject-versions' })
      })
      await page.waitForTimeout(400)
      await save('phase5_subject_versions')

      // Close subject versions sheet
      await page.evaluate(() => {
        window.__outreachUi?.getState().set({ sheet: null })
      })
      await page.waitForTimeout(200)

      // 5. Review & send sheet showing AI Second Reading check row
      await page.evaluate(() => {
        window.__outreachUi?.getState().set({ sheet: 'review-send' })
      })
      await page.waitForTimeout(400)
      await save('phase5_review_send_second_reading')

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

console.log('Phase 5 screenshot capture complete!')
