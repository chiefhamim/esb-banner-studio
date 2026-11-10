// Outreach desk at list scale: 2,000 synthetic example.com contacts (tools/fixtures/outreach-synthetic.mjs — never
// the real list), 800 of them already "sent", measured in the dev server with the desk's own store and UI.
// Each step is timed from the action to the second animation frame after it (React render + layout + paint).
// Usage: node tools/e2e/outreach-perf.mjs   (RUNS=n repeats each step, default 5; JSON=path writes the numbers)
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-core'
import { launchBrowser } from '../launch-browser.mjs'
import { writeSyntheticList } from '../fixtures/outreach-synthetic.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const PORT = 5197
const RUNS = Number(process.env.RUNS) || 5
const N = Number(process.env.CONTACTS) || 2000

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'esb-perf-'))
const csv = fs.readFileSync(writeSyntheticList(dir, N), 'utf8')

const server = spawn(process.execPath, [path.join(root, 'node_modules', 'vite', 'bin', 'vite.js'), '--port', String(PORT), '--strictPort'], { cwd: root, stdio: 'ignore' })
const results = {}
const median = (a) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)] }
try {
  for (let i = 0; i < 80; i++) { try { if ((await fetch(`http://localhost:${PORT}/`)).ok) break } catch { /* not up yet */ } await new Promise((r) => setTimeout(r, 500)) }
  const browser = await launchBrowser(chromium)
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  page.on('pageerror', (e) => console.log('PAGE ERROR', e.message))
  await page.goto(`http://localhost:${PORT}/`)
  await page.waitForSelector('.studio-shell')
  const tile = page.locator('.launch-tile:has-text("Outreach")')
  if (await tile.count()) await tile.first().click(); else await page.click('.ws-btn[data-ws="outreach"]:visible')
  await page.waitForSelector('.outreach-workspace')

  // helpers inside the page: time an action to the second frame after it
  await page.evaluate(() => {
    const frames = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())))
    window.__perf = async (fn) => { const t0 = performance.now(); await fn(); await frames(); return performance.now() - t0 }
    window.__frames = frames
  })

  // a list campaign on the 2,000 rows, and a second one to switch to and back
  const ids = await page.evaluate(async (text) => {
    const st = window.__outreachStore.getState()
    window.__outreachUi.getState().set({ desk: 'compose', sheet: null, view: 'edit', left: 'contacts' })
    const a = await st.createCampaign({ name: 'Perf list', blueprint: 'blank', subject: 'Hello {name}', body: 'Dear {name},\n\nA short note.' })
    await window.__outreachStore.getState().importList(new File([text], 'perf-contacts.csv', { type: 'text/csv' }))
    const s2 = window.__outreachStore.getState()
    const sent = {}
    s2.contacts.slice(0, 800).forEach((c, i) => { sent[c.email] = Date.now() - i * 60_000 })
    s2.patch({ sent })
    const b = await s2.createCampaign({ name: 'Other campaign', blueprint: 'blank', subject: 'Other', body: 'Other' })
    await window.__outreachStore.getState().openCampaign(a)
    return { a, b, contacts: window.__outreachStore.getState().contacts.length }
  }, csv)
  console.log(`contacts loaded: ${ids.contacts}`)

  // PROFILE="part of a step name" records a CPU profile of that step and prints where the time went (self time)
  const cdp = process.env.PROFILE ? await page.context().newCDPSession(page) : null
  if (cdp) { await cdp.send('Profiler.enable'); await cdp.send('Profiler.setSamplingInterval', { interval: 200 }) }
  const step = async (name, fn, runs = RUNS) => {
    const t = []
    const prof = cdp && name.includes(process.env.PROFILE)
    if (prof) await cdp.send('Profiler.start')
    for (let i = 0; i < runs; i++) t.push(await fn(i))
    if (prof) {
      const { profile } = await cdp.send('Profiler.stop')
      const self = new Map()
      const dt = profile.timeDeltas
      const byId = new Map(profile.nodes.map((n) => [n.id, n]))
      profile.samples.forEach((id, i) => { const n = byId.get(id); const k = `${n.callFrame.functionName || '(anon)'} ${n.callFrame.url.split('/').pop()}:${n.callFrame.lineNumber + 1}`; self.set(k, (self.get(k) || 0) + (dt[i] || 0) / 1000) })
      console.log([...self].sort((a, b) => b[1] - a[1]).slice(0, 25).map(([k, v]) => `   ${v.toFixed(1).padStart(8)} ms  ${k}`).join('\n'))
    }
    results[name] = { median: +median(t).toFixed(1), max: +Math.max(...t).toFixed(1) }
    console.log(`${name.padEnd(34)} median ${results[name].median.toFixed(1).padStart(7)} ms   max ${results[name].max.toFixed(1).padStart(7)} ms`)
  }

  await step('open campaign (switch away + back)', () => page.evaluate(async ({ a, b }) => {
    await window.__outreachStore.getState().openCampaign(b)
    await window.__frames()
    return window.__perf(() => window.__outreachStore.getState().openCampaign(a))
  }, ids))

  await step('switch filter chip', (i) => page.evaluate(async (i) => {
    const chips = [...document.querySelectorAll('.or-chips .or-fchip')]
    const target = chips[(i % (chips.length - 1)) + 1]
    const t = await window.__perf(() => target.click())
    await window.__perf(() => chips[0].click())
    return t
  }, i))

  await step('type one key in search', (i) => page.evaluate(async (i) => {
    const input = document.querySelector('.or-search input')
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
    const word = 'executive 1'
    const t = await window.__perf(() => { set.call(input, word.slice(0, (i % word.length) + 1)); input.dispatchEvent(new Event('input', { bubbles: true })) })
    return t
  }, i), 11)
  await page.evaluate(async () => { const input = document.querySelector('.or-search input'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, ''); input.dispatchEvent(new Event('input', { bubbles: true })); await window.__frames() })

  await step('select a contact row', (i) => page.evaluate(async (i) => {
    const rows = [...document.querySelectorAll('.or-list .or-row')]
    return window.__perf(() => rows[(i * 7) % rows.length].click())
  }, i))

  await step('show all rows (Show more x9)', () => page.evaluate(async () => {
    const t0 = performance.now()
    for (let k = 0; k < 9; k++) { const b = document.querySelector('.or-more'); if (!b) break; b.click(); await window.__frames() }
    const dt = performance.now() - t0
    // back to the first page
    window.__outreachStore.getState().setView('sent'); await window.__frames(); window.__outreachStore.getState().setView('all'); await window.__frames()
    return dt
  }), 3)

  await step('scroll the list (30 frames)', () => page.evaluate(async () => {
    const list = document.querySelector('.or-list')
    const t0 = performance.now()
    for (let k = 0; k < 30; k++) { list.scrollTop += 300; await new Promise((r) => requestAnimationFrame(r)) }
    const dt = performance.now() - t0
    list.scrollTop = 0
    return dt / 30
  }), 3)

  await step('store tick (log line) re-render', () => page.evaluate(() => window.__perf(() => window.__outreachStore.getState().addLog('info', 'perf tick'))))

  await step('open Review & send', () => page.evaluate(async () => {
    const t = await window.__perf(() => window.__outreachUi.getState().set({ sheet: 'review-send' }))
    window.__outreachUi.getState().set({ sheet: null }); await window.__frames()
    return t
  }))

  await step('Preview as sent', () => page.evaluate(async () => {
    const t = await window.__perf(() => window.__outreachUi.getState().set({ view: 'preview' }))
    window.__outreachUi.getState().set({ view: 'edit' }); await window.__frames()
    return t
  }))

  await step('type in the letter (edit view)', (i) => page.evaluate(async (i) => {
    window.__outreachUi.getState().set({ view: 'edit' }); await window.__frames()
    const ta = document.querySelector('.or-text')
    const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set
    const t = await window.__perf(() => { set.call(ta, ta.value + (i % 2 ? '' : 'x')); ta.dispatchEvent(new Event('input', { bubbles: true })) })
    return t
  }, i), 7)

  await step('type in the letter (preview open)', (i) => page.evaluate(async (i) => {
    window.__outreachUi.getState().set({ view: 'preview' }); await window.__frames()
    const st = window.__outreachStore.getState()
    const body = st.campaign().body
    const t = await window.__perf(() => st.patch({ body: body + (i % 2 ? '' : 'x') }))
    return t
  }, i), 7)
  await page.evaluate(() => window.__outreachUi.getState().set({ view: 'edit' }))

  await step('reload the sheet (setSheet)', () => page.evaluate(async () => {
    const st = window.__outreachStore.getState()
    const before = st.contacts
    const t0 = performance.now()
    st.setSheet(st.campaign().sheet)
    for (let k = 0; k < 400 && window.__outreachStore.getState().contacts === before; k++) await new Promise((r) => setTimeout(r, 2))
    await window.__frames()
    return performance.now() - t0
  }))

  await browser.close()
  if (process.env.JSON) fs.writeFileSync(process.env.JSON, JSON.stringify({ contacts: ids.contacts, results }, null, 2))
} finally {
  server.kill()
  fs.rmSync(dir, { recursive: true, force: true })
}
