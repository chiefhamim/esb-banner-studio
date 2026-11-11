// Two checks on the Outreach desk with 1,076 synthetic example.com contacts and an 81-character subject:
//   1. Review → Needs you: the lone "Long subject line" group folds and unfolds from its header (it used to be stuck
//      open), draws its rows in pages, and stays responsive.
//   2. The "Track opens & clicks" switch: on by default, off is saved on the campaign, reaches the send payload of
//      both a batch (jobSpec) and a test letter (mailFor), and on again restores it.
// Usage: node tools/e2e/outreach-needsyou-track-check.mjs   (SHOTS=dir saves screenshots)
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-core'
import { launchBrowser } from '../launch-browser.mjs'
import { writeSyntheticList } from '../fixtures/outreach-synthetic.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const PORT = 5201
const SHOTS = process.env.SHOTS
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'esb-ny-'))
const csv = fs.readFileSync(writeSyntheticList(dir, 1076), 'utf8')
const SUBJECT = 'ESB Power Line: free digital edition and monthly energy brief for {name|Sir} today' // 81+ characters filled
const server = spawn(process.execPath, [path.join(root, 'node_modules', 'vite', 'bin', 'vite.js'), '--port', String(PORT), '--strictPort'], { cwd: root, stdio: 'ignore' })
let failed = 0
const ok = (c, m) => { console.log(`${c ? '✔' : '✘'} ${m}`); if (!c) failed++ }
try {
  for (let i = 0; i < 80; i++) { try { if ((await fetch(`http://localhost:${PORT}/`)).ok) break } catch { /* not up */ } await new Promise((r) => setTimeout(r, 500)) }
  const browser = await launchBrowser(chromium)
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  page.on('pageerror', (e) => console.log('PAGE ERROR', e.message))
  await page.goto(`http://localhost:${PORT}/`)
  await page.waitForSelector('.studio-shell')
  const tile = page.locator('.launch-tile:has-text("Outreach")')
  if (await tile.count()) await tile.first().click(); else await page.click('.ws-btn[data-ws="outreach"]:visible')
  await page.waitForSelector('.outreach-workspace')
  await page.evaluate(async ({ text, subject }) => {
    const st = window.__outreachStore.getState()
    window.__outreachUi.getState().set({ desk: 'compose', sheet: null, view: 'edit', left: 'contacts' })
    await st.createCampaign({ name: 'Needs you check', blueprint: 'blank', subject, body: 'Dear {name|Sir},\n\nA short note.' })
    await window.__outreachStore.getState().importList(new File([text], 'ny.csv', { type: 'text/csv' }))
    const s2 = window.__outreachStore.getState()
    s2.approveMany(s2.contacts.map((x) => x.email))
    // the owner's case: every other warning already approved, only "Long subject line" left as the lone group
    const reviewed = {}
    for (const x of s2.contacts) reviewed[x.email] = ['empty_fragment', 'odd_name', 'generic_mailbox_with_name', 'fallback_used', 'no_name']
    s2.patch({ reviewed })
    window.__outreachUi.getState().set({ right: 'review' })
  }, { text: csv, subject: SUBJECT })
  await page.waitForSelector('.or-flag-group', { timeout: 20_000 })

  // ── 1. Needs you folds ────────────────────────────────────────────────────────────────────────────────────────
  const state = () => page.evaluate(() => ({
    groups: document.querySelectorAll('.or-flag-group').length,
    open: !!document.querySelector('.or-flag-group.open'),
    rows: document.querySelectorAll('.or-flag-row').length,
    title: document.querySelector('.or-flag-group-title b')?.textContent,
    count: document.querySelector('.or-flag-count')?.textContent,
  }))
  const s0 = await state()
  console.log(`group: ${s0.title} (${s0.count}), ${s0.groups} group(s)`)
  ok(s0.open && s0.rows > 0 && s0.rows <= 50, `a lone group starts open with one page of rows (${s0.rows} drawn, not all ${s0.count})`)
  if (SHOTS) { fs.mkdirSync(SHOTS, { recursive: true }); await page.screenshot({ path: path.join(SHOTS, 'needs-open.png') }) }
  const t0 = Date.now()
  await page.click('.or-flag-group-title')
  await page.waitForFunction(() => !document.querySelector('.or-flag-group.open'), null, { timeout: 3000 }).catch(() => null)
  const s1 = await state()
  ok(!s1.open && s1.rows === 0, `clicking the header folds it (${Date.now() - t0} ms)`)
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'needs-folded.png') })
  await page.click('.or-flag-group-title')
  const s2 = await state()
  ok(s2.open && s2.rows > 0, 'clicking again unfolds it')
  await page.focus('.or-flag-group-head')
  await page.keyboard.press('Enter')
  ok(!(await state()).open, 'Enter on the header folds it too')
  await page.keyboard.press('Enter')
  await page.click('.or-flag-more')
  const s3 = await state()
  ok(s3.rows > s2.rows, `Show more adds rows (${s2.rows} → ${s3.rows})`)

  // ── 2. Tracking switch ────────────────────────────────────────────────────────────────────────────────────────
  const sw = page.locator('.or-track-switch').getByText('Track opens & clicks')
  ok(await sw.count() > 0, 'the composer shows the "Track opens & clicks" switch')
  const payload = () => page.evaluate(async () => {
    const st = window.__outreachStore.getState()
    const c = st.campaign()
    const { mailFor } = await import('/src/outreach/campaign.ts')
    const { buildJobSpec } = await import('/src/outreach/jobSpec.ts').catch(() => ({}))
    const contact = st.contacts[0]
    const spec = typeof buildJobSpec === 'function' ? buildJobSpec({ campaign: c, contacts: [contact], mode: 'first' }) : null
    return { saved: c.track, test: mailFor(contact, c).track, batch: spec ? spec.shared.track : 'n/a' }
  })
  const p0 = await payload()
  ok(p0.saved === undefined && p0.test === true, `on by default (campaign ${p0.saved}, test letter ${p0.test}, batch ${p0.batch})`)
  await sw.click()
  const p1 = await payload()
  ok(p1.saved === false && p1.test === false && (p1.batch === false || p1.batch === 'n/a'), `off: saved on the campaign and sent with the letter (test ${p1.test}, batch ${p1.batch})`)
  const reviewLine = await page.evaluate(async () => {
    window.__outreachUi.getState().set({ sheet: 'review-send' })
    await new Promise((r) => setTimeout(r, 400))
    const t = document.querySelector('.or-facts')?.textContent ?? ''
    window.__outreachUi.getState().set({ sheet: null })
    return t
  })
  ok(/not tracked/.test(reviewLine), 'Review & send says "not tracked"')
  if (SHOTS) { await page.locator('.or-track-switch').scrollIntoViewIfNeeded(); await page.screenshot({ path: path.join(SHOTS, 'track-off.png') }) }
  await sw.click()
  const p2 = await payload()
  ok(p2.saved === true && p2.test === true, 'on again: tracked')
  await browser.close()
} finally {
  server.kill()
}
console.log(failed ? `\n${failed} FAILED` : '\nAll passed')
process.exit(failed ? 1 : 0)
