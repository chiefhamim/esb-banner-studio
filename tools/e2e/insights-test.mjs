// End-to-end test of the Editorial Insights desk (W2). Hermetic: every request to graph.facebook.com and to the AI
// provider is answered by page.route from fixtures below, and the suite counts every Graph request the page made
// against the ones the route answered, so a live call would fail it. The Page token is a fixture that is not a token.
import { chromium } from 'playwright-core'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { launchBrowser } from '../launch-browser.mjs'
import { portOffset } from '../port-offset.mjs'

const PORT = 5211 + portOffset()
const root = path.resolve(import.meta.dirname, '../..')
const vite = spawn(process.execPath, [path.join(root, 'node_modules', 'vite', 'bin', 'vite.js'), '--port', String(PORT), '--strictPort'], { cwd: root, stdio: 'ignore' })

const waitUp = async () => {
  for (let i = 0; i < 80; i++) {
    try { if ((await fetch(`http://localhost:${PORT}/`)).ok) return } catch {}
    await new Promise((r) => setTimeout(r, 500))
  }
  throw new Error('Vite did not start')
}

let failed = 0
function check(name, ok, extra = '') {
  if (ok) console.log('PASS', name, extra)
  else { console.log('FAIL', name, extra); failed++ }
}

const TOKEN = 'test-token-not-real'
const PAGE_ID = '100000000000001'
const FB = { pageId: PAGE_ID, token: TOKEN, pageName: 'Synthetic Test Page' }
const now = Date.now()
const ago = (ms) => new Date(now - ms).toISOString()
const DAYMS = 86_400_000
const post = (n) => `${PAGE_ID}_20000000000000${n}`
const LOG = [
  { storyId: 'ins-1', slug: 'grid-adds-400mw', url: 'https://esbpowerline.com/articles/grid-adds-400mw', headline: 'Grid operator adds 400 MW of evening peak capacity', categoryId: '03', format: 'fb45', publishedAt: ago(60_000), facebookPostId: post(1), dryRun: false },
  { storyId: 'ins-2', slug: 'lng-cargo-delayed', url: 'https://esbpowerline.com/articles/lng-cargo-delayed', headline: 'Second LNG cargo of the month delayed at Moheshkhali', categoryId: '02', format: 'fb45', publishedAt: ago(120_000), facebookPostId: post(2), dryRun: false },
  { storyId: 'ins-3', slug: 'rooftop-solar-rule', url: 'https://esbpowerline.com/articles/rooftop-solar-rule', headline: 'Rooftop solar net-metering rule revised', categoryId: '04', format: 'web', publishedAt: ago(180_000), dryRun: false },
  { storyId: 'ins-4', slug: 'tariff-hearing', url: 'https://esbpowerline.com/articles/tariff-hearing', headline: 'Regulator sets date for bulk tariff hearing', categoryId: '01', format: 'fb45', publishedAt: ago(10 * DAYMS), facebookPostId: post(3), dryRun: false },
  { storyId: 'ins-5', slug: 'old-story', url: 'https://esbpowerline.com/articles/old-story', headline: 'An older synthetic story', categoryId: '05', format: 'fb45', publishedAt: ago(50 * DAYMS), facebookPostId: post(4), dryRun: false },
]
const FIG = { [post(1)]: [1520, 35, 41], [post(2)]: [860, 12, 9], [post(3)]: [2310, 50, 77], [post(4)]: [400, 3, 2] }
const postInsights = ([imp, react, clicks]) => ({ data: [
  { name: 'post_impressions', period: 'lifetime', values: [{ value: imp }] },
  { name: 'post_impressions_unique', period: 'lifetime', values: [{ value: Math.round(imp * 0.8) }] },
  { name: 'post_engaged_users', period: 'lifetime', values: [{ value: react + clicks }] },
  { name: 'post_clicks', period: 'lifetime', values: [{ value: clicks }] },
  { name: 'post_reactions_by_type_total', period: 'lifetime', values: [{ value: { like: react - 2, love: 2 } }] },
] })
const PAGE = { data: [
  { name: 'page_impressions', period: 'day', values: [{ value: 900, end_time: ago(DAYMS).slice(0, 10) + 'T07:00:00+0000' }, { value: 1100, end_time: ago(0).slice(0, 10) + 'T07:00:00+0000' }] },
  { name: 'page_post_engagements', period: 'day', values: [{ value: 50, end_time: ago(DAYMS).slice(0, 10) + 'T07:00:00+0000' }, { value: 70, end_time: ago(0).slice(0, 10) + 'T07:00:00+0000' }] },
] }

/** Answers every Graph request from fixtures and counts them. `mode`: 'ok' | 'expired'. */
function graph(page, mode = 'ok') {
  const s = { routed: 0, seen: 0, insights: 0, tokenInUrl: 0, badAuth: 0 }
  page.on('request', (r) => { if (r.url().startsWith('https://graph.facebook.com/')) s.seen++ })
  return page.route('https://graph.facebook.com/**', async (route) => {
    const req = route.request()
    const url = req.url()
    s.routed++
    if (url.includes(TOKEN)) s.tokenInUrl++
    if (req.headers().authorization !== `Bearer ${TOKEN}`) s.badAuth++
    const json = (status, body) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
    if (url.includes('/insights')) {
      s.insights++
      if (mode === 'expired') return json(400, { error: { message: 'Error validating access token: Session has expired.', type: 'OAuthException', code: 190 } })
      if (url.includes(`/${PAGE_ID}/insights`)) return json(200, PAGE)
      const id = decodeURIComponent(/v26\.0\/([^/]+)\/insights/.exec(url)?.[1] ?? '')
      return FIG[id] ? json(200, postInsights(FIG[id])) : json(400, { error: { message: 'Unknown object', code: 100 } })
    }
    if (url.includes('picture')) return route.fulfill({ status: 404, body: '' })
    return json(200, { id: PAGE_ID, name: FB.pageName })
  }).then(() => s)
}

/** Answers the Review AI (Gemini) from a fixture: the model list, the launch key check and the weekly summary. */
async function gemini(page) {
  const s = { calls: 0, summaryBody: '' }
  await page.route('https://generativelanguage.googleapis.com/**', async (route) => {
    s.calls++
    const url = route.request().url()
    if (url.includes('/models?')) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ models: [{ name: 'models/gemini-2.5-flash', supportedGenerationMethods: ['generateContent'] }] }) })
    const body = route.request().postData() ?? ''
    const isSummary = body.includes('analytics editor')
    if (isSummary) s.summaryBody = body
    const text = isSummary ? JSON.stringify({ summary: 'The grid capacity story led the week with 1,520 impressions and 35 reactions.' }) : JSON.stringify({ ok: 'yes' })
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text }] } }], usageMetadata: { promptTokenCount: 1200, cachedContentTokenCount: 200, candidatesTokenCount: 60, thoughtsTokenCount: 0 } }) })
  })
  return s
}

async function newPage(browser, seed) {
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 950 }, acceptDownloads: true })
  const page = await ctx.newPage()
  page.setDefaultTimeout(8000)
  // every AI host is answered or refused: nothing leaves the machine
  await page.route(/https:\/\/(api\.anthropic\.com|api\.openai\.com|openrouter\.ai)\//, (r) => r.abort())
  await page.addInitScript((sd) => {
    if (sessionStorage.getItem('__seeded')) return
    sessionStorage.setItem('__seeded', '1')
    for (const [k, v] of Object.entries(sd)) localStorage.setItem(k, JSON.stringify(v))
  }, seed)
  return { ctx, page }
}

async function openInsights(page) {
  await page.goto(`http://localhost:${PORT}/`)
  await page.waitForSelector('.studio-shell')
  await page.click('.launch-tile:has-text("Editorial")')
  await page.waitForSelector('.ed-desk-seg')
  await page.click('.ed-desk-seg button:has-text("Insights")')
  await page.waitForSelector('.ed-ins')
}

const txt = (page, sel) => page.locator(sel).first().innerText()

try {
  await waitUp()
  const browser = await launchBrowser(chromium)

  // ------------------------------------------------------------ configured: fixture Graph answers
  {
    const { ctx, page } = await newPage(browser, {
      'esb-banner-studio/publish-log/v1': LOG,
      'esb-banner-studio/facebook': FB,
      'esb-banner-studio/ai-settings': { provider: 'gemini', seo: '', social: '', outreach: '', research: '', review: '', keys: { gemini: 'test-key-not-real', anthropic: '', openai: '', openrouter: '' }, models: { gemini: 'auto', anthropic: 'auto', openai: 'auto', openrouter: 'auto' }, prompt: '', paused: false },
    })
    const g = await graph(page)
    const ai = await gemini(page)
    await openInsights(page)
    check('Header Desk · Insights switch opens the Insights desk', await page.locator('.ed-desk-seg button.on:has-text("Insights")').count() === 1)
    await page.waitForFunction(() => document.querySelector('[data-kpi="impressions"] b')?.textContent !== '—', null, { timeout: 8000 }).catch(() => {})
    check('Opening Insights reads the page and each post on Facebook once', g.insights === 5, `insights requests ${g.insights}`)
    check('Five KPI tiles render', await page.locator('.ed-ins-kpi').count() === 5)
    check('Published (28 days) counts the log, not samples', (await txt(page, '[data-kpi="published"] b')) === '4', await txt(page, '[data-kpi="published"]'))
    check('Impressions (28 days) is the sum of the fixture figures', (await txt(page, '[data-kpi="impressions"] b')) === '4,690', await txt(page, '[data-kpi="impressions"] b'))
    check('Reactions and clicks are summed', (await txt(page, '[data-kpi="reactions"] b')) === '97' && (await txt(page, '[data-kpi="clicks"] b')) === '127')
    check('AI cost tile is honest with no priced call', (await txt(page, '[data-kpi="ai-cost"] b')) === '—')
    check('Impressions chart draws one bar per post with figures', await page.locator('.ed-ins-chart svg .oa-bar-group').count() === 3, String(await page.locator('.ed-ins-chart svg .oa-bar-group').count()))
    check('Weekly tables list every story in range', await page.locator('.ed-ins-table tbody tr').count() === 4, String(await page.locator('.ed-ins-table tbody tr').count()))
    check('A site-only story says so instead of showing zeros', await page.locator('.ed-ins-table td.ed-ins-nofb').count() === 1)
    check('Page totals are shown with their age', /2,000 impressions · 120 post engagements · read just now/.test(await txt(page, '.ed-ins-page')), await txt(page, '.ed-ins-page'))
    check('Cache age shows in the toolbar', /Figures from just now/.test(await txt(page, '.ed-ins-age')), await txt(page, '.ed-ins-age'))

    // range
    await page.click('.ed-ins-range button:has-text("7 days")')
    const shape = async () => [await txt(page, '[data-kpi="published"] b'), await page.locator('.ed-ins-chart svg .oa-bar-group').count(), await page.locator('.ed-ins-table tbody tr').count()].join('/')
    check('7 days range narrows KPIs, bars and rows', (await shape()) === '3/2/3', await shape())
    await page.click('.ed-ins-range button:has-text("90 days")')
    check('90 days range includes the older story', (await shape()) === '5/4/5', await shape())
    await page.click('.ed-ins-range button:has-text("28 days")')

    // refresh inside 15 minutes: served from cache
    const before = g.insights
    check('Refresh is enabled while not rate-limited', await page.locator('.ed-ins-refresh').isEnabled())
    await page.click('.ed-ins-refresh')
    await page.waitForTimeout(600)
    check('Refresh inside 15 minutes serves the cache (no new Graph request)', g.insights === before, `${before} -> ${g.insights}`)

    // export
    const [dl] = await Promise.all([page.waitForEvent('download'), page.click('.ed-ins-export')])
    const csv = fs.readFileSync(await dl.path(), 'utf8').replace(/^﻿/, '')
    const lines = csv.trim().split('\r\n')
    check('Export CSV downloads a file named for the range', /^esb-insights-28d-\d{4}-\d{2}-\d{2}\.csv$/.test(dl.suggestedFilename()), dl.suggestedFilename())
    check('Export CSV has the header and one row per story in range', lines.length === 5 && lines[0].startsWith('"Week of","Published (ISO)","Headline"'), `${lines.length} lines`)
    check('Export CSV rows carry the fixture figures and blanks for site-only', csv.includes('"Grid operator adds 400 MW of evening peak capacity","grid-adds-400mw"') && csv.includes('"1520","35","41"') && /"rooftop-solar-rule",[^\n]*"no","","",""/.test(csv))

    // AI summary (opt-in, Review role has a key)
    check('Summarise week renders when the Review AI has a provider', await page.locator('.ed-ins-ai').count() === 1)
    await page.click('.ed-ins-ai')
    await page.waitForSelector('.ed-ins-summary p:has-text("1,520")')
    check('Summarise week shows the AI draft, labelled as one', /AI draft/i.test(await txt(page, '.ed-ins-summary')) && /1,520 impressions/.test(await txt(page, '.ed-ins-summary p')))
    check('The summary request carries only the table (no token, no story text)', ai.summaryBody.includes('Headline | Category') && !ai.summaryBody.includes(TOKEN) && !ai.summaryBody.includes(PAGE_ID))

    // W6: Engine panel — per-story cost rows (Gemini reports usage now) and the opt-in escalation switch
    await page.click('.sb-engine-btn')
    await page.waitForSelector('.eng-pop')
    check('Engine panel lists cost rows with prompt, cache, output and an estimate column', await page.locator('.eng-cost-row').count() >= 2 && /estimate/i.test(await txt(page, '.eng-cost-row.head')), await txt(page, '.eng-cost'))
    check('Unpriced (Gemini) calls show a dash for cost, never a guessed price', /—/.test(await txt(page, '.eng-cost-row[data-story="other"]')) && /unpriced/.test(await txt(page, '.eng-cost-row[data-story="other"]')), await txt(page, '.eng-cost-row[data-story="other"]'))
    if (process.env.INS_SHOT) await page.locator('.eng-pop').screenshot({ path: process.env.INS_SHOT }) // optional: eyeball the panel
    const escOff = await page.evaluate(() => JSON.parse(localStorage.getItem('esb-banner-studio/ai-settings')).escalate?.main ?? false)
    await page.click('.eng-esc .switch')
    const escOn = await page.evaluate(() => JSON.parse(localStorage.getItem('esb-banner-studio/ai-settings')).escalate?.main)
    check('Escalation switch is off by default and turns on (saved in AI settings)', escOff === false && escOn === true, `${escOff} -> ${escOn}`)
    await page.click('.eng-esc .switch')
    check('Escalation switch turns off again', (await page.evaluate(() => JSON.parse(localStorage.getItem('esb-banner-studio/ai-settings')).escalate?.main)) === false)
    await page.keyboard.press('Escape')
    check('AI cost tile counts unpriced calls honestly', (await txt(page, '[data-kpi="ai-cost"] b')) === '—' && /unpriced/.test(await txt(page, '[data-kpi="ai-cost"] i')), await txt(page, '[data-kpi="ai-cost"] i'))

    // switch back
    await page.click('.ed-desk-seg button:has-text("Desk")')
    check('Desk switch returns to the story desk', await page.locator('.ed-ins').count() === 0 && await page.locator('.ed-launcher-wrap, .ed-desk').count() === 1)

    check('Every Graph request was answered by the fixture route (zero live calls)', g.seen === g.routed && g.routed > 0, `seen ${g.seen}, routed ${g.routed}`)
    check('The token never appears in a Graph URL, and every call sends it as Bearer', g.tokenInUrl === 0 && g.badAuth === 0, `inUrl ${g.tokenInUrl}, badAuth ${g.badAuth}`)
    await ctx.close()
  }

  // ------------------------------------------------------------ no Page token: unconfigured, no Graph request
  {
    const { ctx, page } = await newPage(browser, { 'esb-banner-studio/publish-log/v1': LOG })
    const g = await graph(page)
    await openInsights(page)
    await page.waitForTimeout(800)
    check('No token: the unconfigured card renders', await page.locator('.ed-ins-unconf:has-text("Facebook Page not connected")').count() === 1)
    check('No token: Facebook figures are dashes, the log still counts', (await txt(page, '[data-kpi="impressions"] b')) === '—' && (await txt(page, '[data-kpi="published"] b')) === '4')
    check('No token: Refresh is disabled', await page.locator('.ed-ins-refresh').isDisabled())
    check('No token: no Graph request at all', g.seen === 0, `seen ${g.seen}`)
    await page.click('.ed-ins-unconf button:has-text("Connect a Page")')
    check('Connect a Page opens the Facebook dialog', await page.locator('.dialog').count() >= 1)
    await ctx.close()
  }

  // ------------------------------------------------------------ empty log
  {
    const { ctx, page } = await newPage(browser, { 'esb-banner-studio/facebook': FB })
    const g = await graph(page)
    await openInsights(page)
    await page.waitForTimeout(500)
    check('Empty log: "Nothing published from this app yet" and no KPI tiles', await page.locator('.ed-ins-empty:has-text("Nothing published from this app yet")').count() === 1 && await page.locator('.ed-ins-kpi').count() === 0)
    check('Empty log: Export CSV is disabled', await page.locator('.ed-ins-export').isDisabled())
    check('Empty log: no insights request', g.insights === 0)
    await ctx.close()
  }

  // ------------------------------------------------------------ expired token (190)
  {
    const { ctx, page } = await newPage(browser, { 'esb-banner-studio/publish-log/v1': LOG, 'esb-banner-studio/facebook': FB })
    const g = await graph(page, 'expired')
    await openInsights(page)
    await page.waitForSelector('.ed-ins-note.bad')
    check('190: the honest expired-token state renders', /rejected the Page token/.test(await txt(page, '.ed-ins-note.bad')))
    check('190: one request, then it stops (no retry of the other posts)', g.insights === 1, `insights ${g.insights}`)
    check('190: Refresh is disabled', await page.locator('.ed-ins-refresh').isDisabled())
    await page.locator('.ed-ins-refresh').click({ force: true })
    await page.waitForTimeout(500)
    check('190: a second Refresh makes no new request', g.insights === 1, `insights ${g.insights}`)
    await page.click('.ed-desk-seg button:has-text("Desk")')
    await page.click('.ed-desk-seg button:has-text("Insights")')
    await page.waitForTimeout(500)
    check('190: reopening the desk does not try the token again', g.insights === 1, `insights ${g.insights}`)
    const cache = await page.evaluate(() => localStorage.getItem('esb-banner-studio/insights-cache/v1') ?? '')
    check('190: the cache never stores the token', cache.length > 0 && !cache.includes('test-token-not-real'))
    await page.click('.ed-ins-note.bad button:has-text("Paste a new token")')
    check('190: "Paste a new token" opens the Facebook dialog', await page.locator('.dialog').count() >= 1)
    check('190: every Graph request was intercepted', g.seen === g.routed, `seen ${g.seen}, routed ${g.routed}`)
    await ctx.close()
  }

  await browser.close()
} catch (err) {
  console.error('Test error:', err)
  failed++
} finally {
  vite.kill()
  console.log(failed ? `FAILED (${failed})` : 'ALL PASS')
  process.exit(failed > 0 ? 1 : 0)
}
