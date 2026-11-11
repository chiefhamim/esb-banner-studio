// Review & send with a big audience (1,076 synthetic example.com contacts) and a long subject: the sheet must fit the
// window, show Cancel, and close on Cancel, Esc and the close button, each within a few frames.
// Usage: node tools/e2e/outreach-review-close.mjs   (CONTACTS=n, SHOTS=dir saves screenshots)
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-core'
import { launchBrowser } from '../launch-browser.mjs'
import { writeSyntheticList } from '../fixtures/outreach-synthetic.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const PORT = 5198
const N = Number(process.env.CONTACTS) || 1076
const SHOTS = process.env.SHOTS
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'esb-rs-'))
const csv = fs.readFileSync(writeSyntheticList(dir, N), 'utf8')
// {name|Sir} has a fallback, so most contacts are ready (the expensive case: spot checks, the send queue)
const SUBJECT = 'ESB Power Line: free digital edition and the monthly energy brief for {name|Sir}, with tariff, LNG and grid figures from this month'

const server = spawn(process.execPath, [path.join(root, 'node_modules', 'vite', 'bin', 'vite.js'), '--port', String(PORT), '--strictPort'], { cwd: root, stdio: 'ignore' })
let failed = 0
const ok = (cond, msg) => { console.log(`${cond ? '✔' : '✘'} ${msg}`); if (!cond) failed++ }
try {
  for (let i = 0; i < 80; i++) { try { if ((await fetch(`http://localhost:${PORT}/`)).ok) break } catch { /* not up yet */ } await new Promise((r) => setTimeout(r, 500)) }
  const browser = await launchBrowser(chromium)
  for (const vp of [{ width: 1440, height: 900 }, { width: 1280, height: 720 }]) {
    const page = await browser.newPage({ viewport: vp })
    page.on('pageerror', (e) => console.log('PAGE ERROR', e.message))
    await page.goto(`http://localhost:${PORT}/`)
    await page.waitForSelector('.studio-shell')
    const tile = page.locator('.launch-tile:has-text("Outreach")')
    if (await tile.count()) await tile.first().click(); else await page.click('.ws-btn[data-ws="outreach"]:visible')
    await page.waitForSelector('.outreach-workspace')
    const n = await page.evaluate(async ({ text, subject }) => {
      const st = window.__outreachStore.getState()
      window.__outreachUi.getState().set({ desk: 'compose', sheet: null, view: 'edit', left: 'contacts' })
      await st.createCampaign({ name: 'Review close test', blueprint: 'blank', subject, body: 'Dear {name},\n\nA short note about the free digital edition.\n\nRegards' })
      await window.__outreachStore.getState().importList(new File([text], 'rs-contacts.csv', { type: 'text/csv' }))
      const s2 = window.__outreachStore.getState()
      // approve everyone by hand (as an editor does), so the audience is ready like the real campaign
      if (typeof s2.approveMany === 'function') s2.approveMany(s2.contacts.map((x) => x.email))
      else if (typeof s2.approve === 'function') for (const x of s2.contacts) s2.approve(x.email)
      return window.__outreachStore.getState().contacts.length
    }, { text: csv, subject: SUBJECT })
    const ready = await page.evaluate(() => document.querySelector('.or-aud b:nth-of-type(2)')?.textContent ?? '?')
    console.log(`ready in the composer: ${ready}`)
    // a running batch updates the campaign every second (sent map, countdown): do the same while the sheet is open
    await page.evaluate(() => {
      let i = 0
      window.__churn = setInterval(() => {
        const st = window.__outreachStore.getState()
        const c = st.campaign()
        st.patch({ sent: { ...(c.sent ?? {}), [`churn${i++}@example.com`]: Date.now() } })
      }, 1000)
    })
    console.log(`\n${vp.width}×${vp.height}: ${n} contacts`)

    const open = async () => {
      await page.evaluate(() => window.__outreachUi.getState().set({ sheet: 'review-send' }))
      await page.waitForSelector('.dialog', { timeout: 15_000 })
      await page.waitForTimeout(300)
    }
    const closedWithin = async (fn) => {
      const t0 = Date.now()
      await fn()
      try { await page.waitForFunction(() => window.__outreachUi.getState().sheet == null && !document.querySelector('.dialog'), null, { timeout: 3000 }) } catch { return null }
      return Date.now() - t0
    }

    await open()
    if (SHOTS) { fs.mkdirSync(SHOTS, { recursive: true }); await page.screenshot({ path: path.join(SHOTS, `review-${vp.width}.png`) }) }
    const geo = await page.evaluate(() => {
      const d = document.querySelector('.dialog').getBoundingClientRect()
      const cancel = [...document.querySelectorAll('.dialog button')].find((b) => b.textContent.trim() === 'Cancel')
      const cb = cancel?.getBoundingClientRect()
      return { top: d.top, bottom: d.bottom, h: innerHeight, cancelVisible: !!cb && cb.bottom <= innerHeight && cb.top >= 0 }
    })
    ok(geo.top >= 0 && geo.bottom <= geo.h, `sheet fits the window (top ${geo.top.toFixed(0)}, bottom ${geo.bottom.toFixed(0)} of ${geo.h})`)
    ok(geo.cancelVisible, 'Cancel is on screen')
    const tCancel = await closedWithin(() => page.click('.dialog button:has-text("Cancel")', { timeout: 3000 }).catch(() => null))
    ok(tCancel != null, `Cancel closes it${tCancel != null ? ` (${tCancel} ms)` : ''}`)
    await open()
    const tEsc = await closedWithin(() => page.keyboard.press('Escape'))
    ok(tEsc != null, `Esc closes it${tEsc != null ? ` (${tEsc} ms)` : ''}`)
    await open()
    const tX = await closedWithin(() => page.click('.dialog [data-tip^="Close"]', { timeout: 3000 }).catch(() => null))
    ok(tX != null, `close button closes it${tX != null ? ` (${tX} ms)` : ''}`)
    // the window must stay responsive while it is open: a frame should come back quickly
    await open()
    // time a whole store update while the sheet is open (what each second of a running batch costs)
    const upd = await page.evaluate(async () => {
      const t = []
      for (let k = 0; k < 5; k++) {
        const st = window.__outreachStore.getState()
        const t0 = performance.now()
        st.patch({ sent: { ...(st.campaign().sent ?? {}), [`m${k}@example.com`]: Date.now() } })
        await window.__frames?.() ?? await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
        t.push(performance.now() - t0)
      }
      return t.sort((a, b) => a - b)[2]
    })
    ok(upd < 100, `a store update with the sheet open renders in ${upd.toFixed(0)} ms (median)`)
    const frame = await page.evaluate(() => new Promise((r) => { const t = performance.now(); requestAnimationFrame(() => requestAnimationFrame(() => r(performance.now() - t))) }))
    ok(frame < 200, `window stays responsive while open (2 frames in ${frame.toFixed(0)} ms)`)
    await page.evaluate(() => clearInterval(window.__churn))
    await page.close()
  }
  await browser.close()
} finally {
  server.kill()
}
console.log(failed ? `\n${failed} FAILED` : '\nAll passed')
process.exit(failed ? 1 : 0)
