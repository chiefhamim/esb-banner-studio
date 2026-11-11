// Activity → Log with ESB Mail Tracker rows (synthetic example.com events), both themes, one row opened.
// Usage: SHOTS=dir node tools/e2e/outreach-track-log-shots.mjs
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-core'
import { launchBrowser } from '../launch-browser.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const PORT = 5199
const SHOTS = process.env.SHOTS || path.join(root, 'tools', 'e2e', 'out', 'track-log')
fs.mkdirSync(SHOTS, { recursive: true })
const server = spawn(process.execPath, [path.join(root, 'node_modules', 'vite', 'bin', 'vite.js'), '--port', String(PORT), '--strictPort'], { cwd: root, stdio: 'ignore' })
try {
  for (let i = 0; i < 80; i++) { try { if ((await fetch(`http://localhost:${PORT}/`)).ok) break } catch { /* not up */ } await new Promise((r) => setTimeout(r, 500)) }
  const browser = await launchBrowser(chromium)
  for (const theme of ['light', 'dark']) {
    for (const width of [1584, 1100]) {
      const page = await browser.newPage({ viewport: { width, height: 760 } })
      // a minimal stand-in for the desktop bridge: the Activity desk only reads events through it
      await page.addInitScript(() => {
        window.__trkEvents = []
        window.esb = {
          outreachJobs: async () => [],
          outreachEvents: async (q) => ({ events: (window.__trkEvents || []).filter((e) => !q?.types || q.types.includes(e.type)), hasMore: false }),
          outreachStats: async () => null,
          onOutreach: () => () => {},
        }
      })
      await page.goto(`http://localhost:${PORT}/`)
      await page.waitForSelector('.studio-shell')
      await page.evaluate((t) => document.documentElement.setAttribute('data-theme', t), theme)
      const tile = page.locator('.launch-tile:has-text("Outreach")')
      if (await tile.count()) await tile.first().click(); else await page.click('.ws-btn[data-ws="outreach"]:visible')
      await page.waitForSelector('.outreach-workspace')
      await page.evaluate(async () => {
        const st = window.__outreachStore.getState()
        const id = await st.createCampaign({ name: 'First Promotion 273', blueprint: 'blank', subject: 'Hello', body: 'Hi' })
        window.__outreachUi.getState().set({ desk: 'activity' })
        const { useActivityStore } = await import('/src/outreach/activityStore.ts')
        const now = Date.now()
        const base = { campaignId: id, messageKey: 'AAECAwQFBgcICQoLDA0ODw' }
        const link = 'https://www.esbpowerline.com/magazine?utm_source=email&utm_medium=newsletter&utm_campaign=newsletter-nov'
        const events = [
          { id: 'e1', t: now - 60_000, type: 'track.click', email: 'reader@example.com', name: 'Farhana Rahman', link, cls: 'human', client: 'Chrome', device: 'Windows', city: 'Dhaka', country: 'BD', network: 'Grameenphone', ...base },
          { id: 'e2', t: now - 90_000, type: 'track.click', email: 'test@example.com', test: true, link: 'https://www.esbpowerline.com/?utm_source=email', cls: 'human', client: 'Edge', device: 'Windows', city: 'Dhaka', country: 'BD', ...base },
          { id: 'e3', t: now - 120_000, type: 'track.open', email: 'test@example.com', test: true, cls: 'proxy', why: 'gmail-proxy', client: 'Gmail', city: 'The Dalles', country: 'US', ...base },
          { id: 'e4', t: now - 180_000, type: 'track.open', email: 'ceo@example.org', name: 'Md. Kamal Hossain', cls: 'human', client: 'Outlook', device: 'Windows', city: 'Chattogram', country: 'BD', ...base },
          { id: 'e5', t: now - 240_000, type: 'track.open', email: 'it@example.net', cls: 'prefetch', why: 'apple-mpp-ua', client: 'Apple Mail', ...base },
          { id: 'e6', t: now - 300_000, type: 'track.click', email: 'it@example.net', link, cls: 'scanner', why: 'asn:8075', client: 'Chrome', device: 'Windows', city: 'Dublin', country: 'IE', ...base },
          { id: 'f1', t: now - 360_000, type: 'send.ok', email: 'ceo@example.org', name: 'Md. Kamal Hossain', org: 'Example Power Ltd', campaignId: id, ms: 2193, attempt: 1, messageKey: 'AAECAwQFBgcICQoLDA0ODw' },
          { id: 'f2', t: now - 420_000, type: 'send.fail', email: 'bad@example.com', campaignId: id, error: '550 5.1.1 The email account that you tried to reach does not exist', attempt: 3 },
          { id: 'f3', t: now - 480_000, type: 'send.skip', email: 'skip@example.com', name: 'Rafiq Ahmed', campaignId: id, reason: 'already sent from another PC' },
          { id: 'f4', t: now - 540_000, type: 'reply', email: 'reader@example.com', subject: 'Re: ESB Power Line digital edition', campaignId: id },
          { id: 'f5', t: now - 600_000, type: 'bounce', email: 'gone@example.com', reason: 'Mailbox full', campaignId: id },
          { id: 'f6', t: now - 660_000, type: 'job.paused', campaignId: id, reason: 'circuit', detail: '3 failures in the last 10 attempts' },
          { id: 'f7', t: now - 720_000, type: 'job.done', campaignId: id, sent: 106, failed: 2, skipped: 14 },
          { id: 'f8', t: now - 780_000, type: 'inbox.checked', scanned: 412, replies: 1, bounces: 0, ok: true },
        ]
        window.__trkEvents = events
        useActivityStore.getState().setTab?.('log')
        useActivityStore.setState({ tab: 'log' })
        useActivityStore.getState().setActiveChip(window.__chip || 'all')
      })
      await page.waitForTimeout(500)
      await page.hover('.oa-ev-time >> nth=0').catch(() => null)
      await page.waitForTimeout(700)
      await page.screenshot({ path: path.join(SHOTS, `log-${theme}-${width}.png`) })
      if (width === 1584 && theme === 'light') {
        await page.click('.oa-ev >> nth=0', { timeout: 3000 }).catch(() => null)
        await page.waitForTimeout(250)
        await page.screenshot({ path: path.join(SHOTS, `log-${theme}-open.png`) })
      }
      await page.close()
    }
  }
  await browser.close()
  console.log('shots in', SHOTS)
} finally {
  server.kill()
}
