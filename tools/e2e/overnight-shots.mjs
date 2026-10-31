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
const ALL = ['home', 'editorial-launcher', 'editorial-desk', 'editorial-insights', 'graphics', 'graphics-quote', 'video', 'outreach', 'outreach-activity']
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

// Insights (W2): a synthetic publish log and fixture Graph answers (every graph.facebook.com request is routed, none
// leaves the machine); the token is a fixture string. The unconfigured state is saved beside it as editorial-insights-unconfigured.
const D = 86_400_000
const INS_LOG = [
  ['Grid operator adds 400 MW of evening peak capacity', '03', 6e4, 1], ['Second LNG cargo of the month delayed at Moheshkhali', '02', 12e4, 2],
  ['Rooftop solar net-metering rule revised', '04', 18e4, 0], ['Regulator sets date for bulk tariff hearing', '01', 10 * D, 3], ['Payra unit returns after coal shortage', '01', 12 * D, 4],
].map(([headline, categoryId, ago, n], i) => ({ storyId: 'shot-i' + i, slug: 'shot-story-' + i, url: 'https://esbpowerline.com/articles/shot-story-' + i, headline, categoryId, format: n ? 'fb45' : 'web', publishedAt: new Date(now - ago).toISOString(), ...(n ? { facebookPostId: '100000000000001_20000000000000' + n } : {}), dryRun: false }))
const INS_FIG = { 1: [1520, 35, 41], 2: [860, 12, 9], 3: [2310, 50, 77], 4: [1240, 22, 30] }
async function insights(p, configured) {
  await p.route('https://graph.facebook.com/**', (r) => {
    const u = r.request().url()
    const n = /_20000000000000(\d)\/insights/.exec(u)?.[1]
    const v = (name, value) => ({ name, period: 'lifetime', values: [{ value }] })
    const body = n ? { data: [v('post_impressions', INS_FIG[n][0]), v('post_reactions_by_type_total', { like: INS_FIG[n][1] }), v('post_clicks', INS_FIG[n][2])] }
      : u.includes('/insights') ? { data: [{ name: 'page_impressions', period: 'day', values: [{ value: 5400, end_time: new Date(now).toISOString() }] }, { name: 'page_post_engagements', period: 'day', values: [{ value: 310, end_time: new Date(now).toISOString() }] }] }
      : { id: '100000000000001', name: 'Synthetic Test Page' }
    return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })
  })
  await p.evaluate(([log, on]) => {
    localStorage.setItem('esb-banner-studio/publish-log/v1', JSON.stringify(log))
    localStorage.removeItem('esb-banner-studio/insights-cache/v1')
    if (on) localStorage.setItem('esb-banner-studio/facebook', JSON.stringify({ pageId: '100000000000001', token: 'test-token-not-real', pageName: 'Synthetic Test Page' }))
    else localStorage.removeItem('esb-banner-studio/facebook')
  }, [INS_LOG, configured])
  await p.reload({ waitUntil: 'load' }); await p.waitForTimeout(900)
  await tile(p, 'Editorial')
  await p.locator('.ed-desk-seg button:has-text("Insights")').first().click()
  await p.waitForSelector('.ed-ins'); await p.waitForTimeout(900)
}

const tile = async (p, name) => { await p.locator(`.launch-tile:has-text("${name}")`).first().click(); await p.waitForTimeout(1600) }
const SETUP = {
  'home': async () => {},
  'editorial-launcher': async (p) => { await tile(p, 'Editorial'); await p.waitForSelector('.ed-launcher-wrap') },
  'editorial-desk': async (p) => {
    await tile(p, 'Editorial')
    await p.evaluate((d) => { const s = window.__editorialStore.getState(); s.setDraftField('headline', d.headline); s.setDraftField('body', d.body) }, DRAFT)
    await p.waitForSelector('.ed-desk'); await p.waitForTimeout(900)
  },
  'editorial-insights': async (p, file) => {
    await insights(p, false)
    await p.screenshot({ path: file.replace('editorial-insights__', 'editorial-insights-unconfigured__') })
    await insights(p, true)
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
      await SETUP[screen](p, file)
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
