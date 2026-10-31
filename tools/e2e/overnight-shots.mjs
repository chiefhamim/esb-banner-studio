// Screenshots of every workspace for before/after comparison, at the desktop sizes the app is used at.
//
//   node tools/e2e/overnight-shots.mjs --out <dir> --tag before|after|baseline|final
//                                      [--screens home,editorial-launcher,...] [--sizes 1366x768,1920x1080]
//                                      [--themes light,dark]
//
// Files are named `<screen>__<WxH>__<theme>--<tag>.png`, so a before/after pair of the same screen sorts
// together and `tools/e2e/shot-diff.mjs <dir>` can pair them. Every screen is captured on a fresh page with
// the same synthetic state (two stories on the Editorial desk, one Outreach campaign), so two runs differ only
// by the code under test. Runs against Vite in Chromium: the Outreach Activity desk needs the desktop bridge
// and is captured in its honest "Desktop app required" state here (see docs/overnight/DECISIONS.md D5).
// Exits non-zero if any requested screen could not be captured.
import { chromium } from 'playwright-core'
import { launchBrowser } from '../launch-browser.mjs'
import { portOffset } from '../port-offset.mjs'
import { spawn } from 'node:child_process'
import path from 'node:path'
import fs from 'node:fs'

const args = Object.fromEntries(process.argv.slice(2).map((a, i, all) => (a.startsWith('--') ? [a.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : 'true'] : [])).filter((x) => x.length))
const out = args.out
const tag = args.tag || 'shot'
if (!out) { console.error('usage: --out <dir> --tag <before|after|...> [--screens a,b] [--sizes WxH,...] [--themes light,dark]'); process.exit(2) }
const sizes = (args.sizes || '1366x768,1920x1080').split(',').map((s) => s.split('x').map(Number))
const themes = (args.themes || 'light,dark').split(',')
const ALL = ['home', 'editorial-launcher', 'editorial-desk', 'editorial-wire', 'graphics', 'graphics-quote', 'video', 'outreach', 'outreach-activity']
const screens = (args.screens ? args.screens.split(',') : ALL).filter((s) => { if (!ALL.includes(s)) console.error('unknown screen', s); return ALL.includes(s) })
fs.mkdirSync(out, { recursive: true })

const root = path.resolve(import.meta.dirname, '../..')
const PORT = 5230 + portOffset()
const vite = spawn(process.execPath, [path.join(root, 'node_modules', 'vite', 'bin', 'vite.js'), '--port', String(PORT), '--strictPort'], { cwd: root, stdio: 'ignore' })
let up = false
for (let i = 0; i < 80; i++) { try { if ((await fetch(`http://localhost:${PORT}/`)).ok) { up = true; break } } catch {} await new Promise((r) => setTimeout(r, 500)) }
if (!up) { console.error(`Vite did not answer on ${PORT}`); vite.kill(); process.exit(1) }

const now = Date.now()
const heads = ['Petrobangla to drill two new wells in Sylhet gas field', 'Grid operator adds 400 MW of evening peak capacity']
const stories = heads.map((h, i) => ({ id: 'shot-s' + i, status: ['draft', 'review'][i], createdAt: now - i * 36e5, updatedAt: now - i * 36e5, snapshot: { draft: { headline: h, deck: 'Synthetic test story.', body: 'Body.', category: '01' } } }))
const DRAFT = { headline: 'Grid operator adds 400 MW of evening peak capacity', body: 'The grid operator added 400 MW of evening peak capacity on Saturday, the regulator said.\n\nA second synthetic paragraph for the desk.' }

const tile = async (p, name) => { await p.locator(`.launch-tile:has-text("${name}")`).first().click(); await p.waitForTimeout(1600) }
const SETUP = {
  'home': async () => {},
  'editorial-launcher': async (p) => { await tile(p, 'Editorial'); await p.waitForSelector('.ed-launcher-wrap') },
  'editorial-desk': async (p) => {
    await tile(p, 'Editorial')
    await p.evaluate((d) => { const s = window.__editorialStore.getState(); s.setDraftField('headline', d.headline); s.setDraftField('body', d.body) }, DRAFT)
    await p.waitForSelector('.ed-desk'); await p.waitForTimeout(900)
  },
  // W5: the Wire inbox with the synthetic fixture feed's items and one source in backoff (no fetch: no desktop bridge here)
  'editorial-wire': async (p) => {
    await p.evaluate((t) => {
      const H = 36e5, M = 6e4
      const sources = [
        { id: 'shot-w1', url: 'https://feed.example.com/rss.xml', name: 'Example Desk', kind: 'auto', intervalMin: 30, enabled: true, lastFetchedAt: t - 4 * M, lastOkAt: t - 4 * M, failures: 0, nextAt: t + 26 * M, lastError: null },
        { id: 'shot-w2', url: 'https://intranet.example.com/feed', name: 'Intranet', kind: 'auto', intervalMin: 30, enabled: true, lastFetchedAt: t - 4 * M, lastOkAt: null, failures: 1, nextAt: t + 56 * M, lastError: { code: 'private_address', message: 'Host intranet.example.com resolved to private/restricted IP: 10.0.0.5' } },
      ]
      const rows = [['Port authority opens second container terminal', 'https://news.example.com/economy/port-terminal-opens', 1], ['Rice prices fall 5% after record harvest & imports', 'https://news.example.com/economy/rice-prices-fall', 3], ['City council approves new river bus routes', 'https://news.example.com/city/river-bus-routes', 9], ['বাজেট ২০২৬: নতুন কর হার ঘোষণা', 'https://news.example.com/bn/budget-2026-tax', 20], ['Garment exports rise for third straight month', 'https://news.example.com/economy/garment-exports-rise', null]]
      const items = rows.map(([title, link, h]) => ({ id: link, title, link, date: h == null ? null : new Date(t - h * H).toISOString(), source: 'Example Desk', sourceId: 'shot-w1', fetchedAt: t - 4 * M }))
      localStorage.setItem('esb-banner-studio/wire/sources/v1', JSON.stringify(sources))
      localStorage.setItem('esb-banner-studio/wire/inbox/v1', JSON.stringify({ items, dismissed: [] }))
    }, now)
    await p.reload({ waitUntil: 'load' }); await p.waitForTimeout(900)
    await tile(p, 'Editorial'); await p.waitForSelector('.ed-launcher-wrap')
    await p.click('.ed-launcher-wrap .ed-intake-tabs button:has-text("Wire")'); await p.waitForSelector('.ed-wire-item'); await p.waitForTimeout(700)
  },
  'graphics': async (p) => { await tile(p, 'Graphics'); await p.waitForSelector('canvas') },
  'graphics-quote': async (p) => {
    await tile(p, 'Graphics'); await p.waitForSelector('canvas')
    await p.evaluate(() => window.__store.getState().setContent({ cardType: 'quote', quoteText: 'We will add 2,000 MW of solar to the grid by 2027, and every unit will be tendered openly.', speakerName: 'Ayesha Rahman', speakerTitle: 'Adviser, Ministry of Power' }))
    await p.waitForTimeout(500)
  },
  'video': async (p) => { await tile(p, 'Video'); await p.waitForTimeout(800) },
  'outreach': async (p) => {
    await tile(p, 'Outreach')
    await p.evaluate(() => window.__outreachStore?.getState().createCampaign?.({ name: 'Overnight shot campaign' }))
    await p.waitForTimeout(900)
  },
  'outreach-activity': async (p) => {
    await tile(p, 'Outreach')
    await p.locator('.or-desk-seg button:has-text("Activity")').first().click()
    await p.waitForTimeout(800)
  },
}

let failed = 0, saved = 0
const browser = await launchBrowser(chromium)
try {
  for (const theme of themes) for (const [w, h] of sizes) for (const screen of screens) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, reducedMotion: 'reduce' })
    const p = await ctx.newPage()
    const errors = []
    p.on('pageerror', (e) => errors.push(String(e)))
    await p.addInitScript(([t, q]) => {
      localStorage.setItem('esb-banner-studio/theme', t)
      localStorage.setItem('esb-banner-studio/editorial/queue/v1', JSON.stringify({ stories: q, activeId: null }))
    }, [theme, stories])
    const file = path.join(out, `${screen}__${w}x${h}__${theme}--${tag}.png`)
    try {
      await p.goto(`http://localhost:${PORT}/`, { waitUntil: 'load' }); await p.waitForTimeout(900)
      await SETUP[screen](p)
      await p.screenshot({ path: file })
      saved++
      console.log('PASS', `${screen} ${w}x${h} ${theme}`, errors.length ? `(page errors: ${errors.length})` : '')
      if (errors.length) { failed++; console.log('FAIL', `${screen} ${w}x${h} ${theme}: page error`, errors[0].slice(0, 200)) }
    } catch (e) {
      failed++
      console.log('FAIL', `${screen} ${w}x${h} ${theme}:`, String(e).split('\n')[0].slice(0, 200))
    }
    await ctx.close()
  }
} finally {
  await browser.close()
  vite.kill()
}
console.log(`${saved} screenshots → ${out}`)
console.log(failed ? `SOME FAILED (${failed})` : 'ALL PASS')
process.exit(failed ? 1 : 0)
