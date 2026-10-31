// End-to-end test of the Outreach weekly digest (W4): Campaigns → New → "Campaign from this week's stories".
// Hermetic: the site's public list (esbpowerline.com/feed.xml) is answered by page.route from a synthetic fixture,
// every other request that would leave the machine is aborted and counted, and the suite fails if any was made.
// Seeds a synthetic publish log (three stories, one outside the last 7 days) and story queue; nothing is sent —
// the dialog only creates a draft campaign, and the Send footer still says the desktop app is needed.
//
// `node tools/e2e/digest-test.mjs --electron` (after `npm run build`) runs the dry-run proof instead: the built app in
// Electron with an isolated profile and ESB_OUTREACH_DRYRUN=1, the main process's URL fetcher replaced by a stub (so
// the site list is the fixture and nothing reaches the network), a digest draft made through the real menu and sheet,
// then `window.esb.outreachStatus()` must still report sent24h === 0.
import { chromium, _electron as electron } from 'playwright-core'
import { spawn } from 'node:child_process'
import path from 'node:path'
import fs from 'node:fs'
import os from 'node:os'
import { launchBrowser } from '../launch-browser.mjs'
import { portOffset } from '../port-offset.mjs'

const PORT = 5212 + portOffset()
const root = path.resolve(import.meta.dirname, '../..')
const ELECTRON = process.argv.includes('--electron')
const vite = ELECTRON ? { kill() {} } : spawn(process.execPath, [path.join(root, 'node_modules', 'vite', 'bin', 'vite.js'), '--port', String(PORT), '--strictPort'], { cwd: root, stdio: 'ignore' })

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

const now = Date.now()
const H = 3_600_000, D = 86_400_000
const ago = (ms) => new Date(now - ms).toISOString()
const SITE = 'https://esbpowerline.com/articles/'
const S = {
  grid: { slug: 'digest-test-grid-upgrade', headline: 'Grid operator finishes a synthetic substation upgrade & tests it', at: 2 * H, deck: 'Queue deck: the synthetic upgrade adds two test transformers.' },
  solar: { slug: 'digest-test-solar-tender', headline: 'Synthetic solar tender draws <b>nine</b> bids', at: 3 * D, deck: 'Site deck: nine synthetic bidders answered the test tender.' },
  old: { slug: 'digest-test-old-story', headline: 'An older synthetic story outside the week', at: 20 * D, deck: 'Site deck of the older synthetic story.' },
  queued: { slug: 'digest-test-queue-only', headline: 'A synthetic story known only to the story queue', at: 25 * D, deck: 'Queue deck of the queue-only story.' },
}
const url = (x) => SITE + x.slug
const LOG = [S.grid, S.solar, S.old].map((x, i) => ({ storyId: 'dg-' + i, slug: x.slug, url: url(x), headline: x.headline, categoryId: '01', format: 'web', publishedAt: ago(x.at), dryRun: false }))
// a dry-run publish of a fourth story inside the week: must never appear
LOG.push({ storyId: 'dg-dry', slug: 'digest-test-dry-run', url: SITE + 'digest-test-dry-run', headline: 'A test-run publish that never went out', categoryId: '01', format: 'web', publishedAt: ago(H), dryRun: true })
const snap = (x) => ({ draft: { headline: x.headline, deck: x.deck, body: 'Synthetic body.', category: '01' } })
const QUEUE = { activeId: null, stories: [
  { id: 'dg-0', status: 'published', createdAt: now - S.grid.at, updatedAt: now - S.grid.at, publishedUrl: url(S.grid), publishedSlug: S.grid.slug, snapshot: snap(S.grid) },
  { id: 'dg-q', status: 'published', createdAt: now - S.queued.at, updatedAt: now - S.queued.at, publishedUrl: url(S.queued), publishedSlug: S.queued.slug, snapshot: snap(S.queued) },
] }
// the site's own list: decks for the stories the queue does not hold, a picture for one (never written into the letter)
const FEED = `<?xml version="1.0"?><rss version="2.0"><channel><title>Synthetic feed</title>${[S.solar, S.old].map((x) => `<item><title>${x.headline.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</title><link>${url(x)}</link><description>${x.deck}</description><category>Power</category><pubDate>${new Date(now - x.at).toUTCString()}</pubDate><enclosure url="https://cdn.example.com/${x.slug}.jpg" type="image/jpeg"/></item>`).join('')}</channel></rss>`

// Dhaka calendar days, as the dialog counts them
const dDay = (t) => new Date(t + 6 * H).toISOString().slice(0, 10)
const dStart = (day) => Date.parse(day + 'T00:00:00Z') - 6 * H
const today = dDay(now)
const sunday = dDay(dStart(today) - new Date(dStart(today) + 6 * H).getUTCDay() * D)
const inDays = (from, x) => dDay(now - x.at) >= from && dDay(now - x.at) <= today
const ALL4 = [S.grid, S.solar, S.old, S.queued]
const expectWeek = ALL4.filter((x) => inDays(sunday, x)).length
const expectToday = ALL4.filter((x) => inDays(today, x)).length

async function newPage(browser, seed) {
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 950 } })
  const page = await ctx.newPage()
  page.setDefaultTimeout(8000)
  const net = { feed: 0, outside: [] }
  // everything not served by the local dev server is answered (the site list) or refused and recorded
  await page.route((u) => !/^(http:\/\/localhost[:/]|data:|blob:)/.test(u.href), async (route) => {
    const u = route.request().url()
    if (u === 'https://esbpowerline.com/feed.xml') { net.feed++; return route.fulfill({ status: 200, contentType: 'application/rss+xml', headers: { 'access-control-allow-origin': '*' }, body: FEED }) }
    net.outside.push(u)
    return route.abort()
  })
  await page.addInitScript((sd) => {
    if (window.top !== window) return // the sandboxed preview frame has no storage
    if (sessionStorage.getItem('__seeded')) return
    sessionStorage.setItem('__seeded', '1')
    for (const [k, v] of Object.entries(sd)) localStorage.setItem(k, JSON.stringify(v))
  }, seed)
  return { ctx, page, net }
}

async function openCampaigns(page) {
  await page.goto(`http://localhost:${PORT}/`)
  await page.waitForSelector('.studio-shell')
  await page.click('.launch-tile:has-text("Outreach")')
  await page.waitForSelector('.or-body')
  await page.click('.side-tabs button[aria-label="Campaigns"]')
  await page.waitForSelector('.or-new')
}
const DIALOG = '.dialog[aria-label="Campaign from this week\'s stories"]'
async function openDigest(page) {
  await page.click('.or-new .btn')
  await page.locator('.menu .menu-item:has-text("Campaign from this week\'s stories")').click()
  await page.waitForSelector(DIALOG)
}
const heads = (page) => page.locator(`${DIALOG} .or-dg-row .check > span`).evaluateAll((els) => els.map((e) => e.firstChild?.textContent ?? ''))
const campaigns = (page) => page.evaluate(() => window.__outreachStore.getState().campaigns)
const srcdoc = (page) => page.locator(`${DIALOG} iframe[title="Digest preview"]`).getAttribute('srcdoc')

async function electronProof() {
  const exe = path.join(root, 'node_modules', 'electron', 'dist', process.platform === 'win32' ? 'electron.exe' : 'electron')
  if (!fs.existsSync(path.join(root, 'dist', 'index.html'))) { check('dist/ is built (run npm run build first)', false); return }
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'esb-digest-'))
  const app = await electron.launch({
    executablePath: exe, args: [...(process.platform === 'win32' ? [] : ['--no-sandbox']), root, '--user-data-dir=' + profile],
    env: { ...process.env, ESB_NO_SYNC: '1', ESB_OUTREACH_DRYRUN: '1' },
  })
  try {
    // every renderer fetch goes through this one main-process handler: answer the site list, refuse the rest
    await app.evaluate(({ ipcMain }, feed) => {
      globalThis.__digestFetches = []
      ipcMain.removeHandler('esb:fetch-url')
      ipcMain.handle('esb:fetch-url', (_e, u) => {
        globalThis.__digestFetches.push(String(u))
        return u === 'https://esbpowerline.com/feed.xml' ? { ok: true, html: feed } : { ok: false, error: 'refused by the digest test' }
      })
    }, FEED)
    const page = await app.firstWindow()
    page.setDefaultTimeout(15000)
    const errors = []
    page.on('pageerror', (e) => errors.push(String(e)))
    await page.waitForSelector('.home-shell, .topbar')
    const s0 = await page.evaluate(() => window.esb.outreachStatus())
    check('[electron] dry run: the bridge reports nothing sent before', s0.sent24h === 0, `sent24h ${s0.sent24h}`)
    await page.evaluate(([log, q]) => { localStorage.setItem('esb-banner-studio/publish-log/v1', JSON.stringify(log)); localStorage.setItem('esb-banner-studio/editorial/queue/v1', JSON.stringify(q)) }, [LOG, QUEUE])
    await page.reload(); await page.waitForSelector('.home-shell, .topbar')
    await page.click('.launch-tile:has-text("Outreach")')
    await page.waitForSelector('.or-body')
    await page.click('.side-tabs button[aria-label="Campaigns"]')
    await openDigest(page)
    await page.waitForFunction(() => !document.querySelector('.or-dg .hint')?.textContent?.startsWith('Reading'))
    const h = await heads(page)
    check('[electron] the sheet lists the 2 stories of the last 7 days', h.length === 2 && h[0] === S.grid.headline, JSON.stringify(h))
    const decks = await page.locator(`${DIALOG} .or-dg-deck`).allInnerTexts()
    check('[electron] the site list came through the stubbed bridge (deck from the fixture)', decks[1] === S.solar.deck, JSON.stringify(decks))
    await page.locator(`${DIALOG} .or-dg-create`).click()
    await page.waitForSelector(DIALOG, { state: 'detached' })
    await page.waitForTimeout(1500)
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('esb-banner-studio/outreach/v2') ?? '{}'))
    const c = (saved.campaigns ?? []).find((x) => x.id === saved.activeId)
    check('[electron] the draft is saved and open', !!c && c.status === 'draft' && c.scheduledAt === null && c.body.includes(url(S.grid)), c ? c.name : 'none')
    const s1 = await page.evaluate(() => window.esb.outreachStatus())
    check('[electron] dry run: still nothing sent after the draft was made', s1.sent24h === 0 && !s1.sentTo.length, `sent24h ${s1.sent24h}`)
    check('[electron] the draft has no send results', !Object.keys(c?.sent ?? {}).length && !Object.keys(c?.failed ?? {}).length)
    const note = await page.locator('.or-foot-note').innerText()
    check('[electron] the Send footer still asks for a sender before anything can go', note.includes('sender account'), note)
    const fetched = await app.evaluate(() => globalThis.__digestFetches)
    check('[electron] the only URL the renderer asked for was the site list', fetched.length > 0 && fetched.every((u) => u === 'https://esbpowerline.com/feed.xml'), JSON.stringify(fetched.slice(0, 5)))
    check('[electron] no page errors', errors.length === 0, errors.slice(0, 2).join(' | '))
  } finally {
    await app.close().catch(() => {})
    fs.rmSync(profile, { recursive: true, force: true })
  }
}

try {
  if (ELECTRON) { await electronProof(); throw null } // the browser suite is skipped in this mode
  await waitUp()
  const browser = await launchBrowser(chromium)

  try {
    const { ctx, page, net } = await newPage(browser, { 'esb-banner-studio/publish-log/v1': LOG, 'esb-banner-studio/editorial/queue/v1': QUEUE })
    const errors = []
    page.on('pageerror', (e) => errors.push(String(e)))
    await openCampaigns(page)
    const before = (await campaigns(page)).length

    // the menu entry, and Cancel / Esc create nothing
    await page.click('.or-new .btn')
    const entry = page.locator('.menu .menu-item:has-text("Campaign from this week\'s stories")')
    check('New menu has "Campaign from this week\'s stories"', await entry.count() === 1 && await entry.isEnabled())
    await entry.click()
    await page.waitForSelector(DIALOG)
    await page.locator(`${DIALOG} footer .btn:has-text("Cancel")`).click()
    check('Cancel closes the sheet and creates nothing', await page.locator(DIALOG).count() === 0 && (await campaigns(page)).length === before)
    await openDigest(page)
    await page.keyboard.press('Escape')
    check('Esc closes the sheet and creates nothing', await page.locator(DIALOG).count() === 0 && (await campaigns(page)).length === before)

    await openDigest(page)
    await page.waitForFunction(() => !document.querySelector('.or-dg .hint')?.textContent?.startsWith('Reading'))
    check('the site list was read once for three openings of the sheet (kept 5 minutes), through the mocked route', net.feed === 1, `feed requests: ${net.feed}`)
    check('range starts on "Last 7 days"', (await page.locator(`${DIALOG} .or-dg-seg button.on`).innerText()) === 'Last 7 days')
    let h = await heads(page)
    check('lists the 2 stories of the last 7 days, newest first (dry run and older ones left out)', h.length === 2 && h[0] === S.grid.headline && h[1] === S.solar.headline, JSON.stringify(h))
    const decks = await page.locator(`${DIALOG} .or-dg-deck`).allInnerTexts()
    check('decks: the queue copy for one, the site list for the other', decks[0] === S.grid.deck && decks[1] === S.solar.deck, JSON.stringify(decks))
    check('the headline with <b> shows as text in the list', (await page.locator(`${DIALOG} .or-dg-row b`).count()) === 0 && h[1].includes('<b>nine</b>'))
    check('subject names the range', (await page.locator(`${DIALOG} .or-dg-subject b`).innerText()).startsWith('This week at ESB PowerLine — '))

    // ticks: none ticked = Create disabled; ticked again = enabled
    const create = page.locator(`${DIALOG} .or-dg-create`)
    check('Create is enabled with stories ticked', await create.isEnabled())
    const boxes = page.locator(`${DIALOG} .or-dg-row .check`)
    await boxes.nth(0).click(); await boxes.nth(1).click()
    check('Create is disabled when nothing is ticked', await create.isDisabled() && (await page.locator(`${DIALOG} .or-dg-count`).innerText()).startsWith('0 of 2'))
    await boxes.nth(0).click(); await boxes.nth(1).click()
    check('re-ticking enables Create again', await create.isEnabled() && (await page.locator(`${DIALOG} .or-dg-count`).innerText()).startsWith('2 of 2'))

    // the other presets
    await page.locator(`${DIALOG} .or-dg-seg button:has-text("This week")`).click()
    h = await heads(page)
    check('"This week" (from Sunday, Dhaka) lists the stories since Sunday', h.length === expectWeek || (expectWeek === 0 && await page.locator(`${DIALOG} .or-dg-empty`).count() === 1), `expected ${expectWeek}, got ${h.length}`)
    await page.locator(`${DIALOG} .or-dg-seg button:has-text("Last 30 days")`).click()
    h = await heads(page)
    check('"Last 30 days" adds the older story and the queue-only one', h.length === 4 && h[2] === S.old.headline && h[3] === S.queued.headline, JSON.stringify(h))
    check('the queue-only story is marked as such', (await page.locator(`${DIALOG} .or-dg-row`).nth(3).innerText()).includes('from the story queue'))

    // custom days through the calendar: from Today = today only; to Yesterday = a backwards range
    await page.locator(`${DIALOG} .or-dg-dates .datefield`).nth(0).click()
    await page.locator('.calpop .cal-foot button:has-text("Today")').click()
    h = await heads(page)
    check('custom "from" day: the Seg shows no preset and only today\'s stories are listed', (await page.locator(`${DIALOG} .or-dg-seg button.on`).count()) === 0 && (h.length === expectToday || (expectToday === 0 && await page.locator(`${DIALOG} .or-dg-empty`).count() === 1)), `expected ${expectToday}, got ${h.length}`)
    await page.locator(`${DIALOG} .or-dg-dates .datefield`).nth(1).click()
    await page.locator('.calpop .cal-foot button:has-text("Yesterday")').click()
    check('a backwards range says so and cannot be created', (await page.locator(`${DIALOG} .hint.bad`).innerText()).includes('Pick a start day') && await create.isDisabled())

    // back to 30 days: untick the older story, reorder, edit the intro
    await page.locator(`${DIALOG} .or-dg-seg button:has-text("Last 30 days")`).click()
    const rows = page.locator(`${DIALOG} .or-dg-row`)
    check('first row cannot move up, last row cannot move down', await rows.nth(0).locator('button[aria-label="Move up"]').isDisabled() && await rows.nth(3).locator('button[aria-label="Move down"]').isDisabled())
    await rows.nth(2).locator('.check').click() // the older story out
    await rows.nth(1).locator('button[aria-label="Move up"]').click() // solar first
    await rows.nth(3).locator('button[aria-label="Move up"]').click() // queue-only above the unticked old one
    h = await heads(page)
    check('reordered: solar, grid, queue-only, old', JSON.stringify(h) === JSON.stringify([S.solar.headline, S.grid.headline, S.queued.headline, S.old.headline]), JSON.stringify(h))
    await rows.nth(0).locator('button[aria-label="Move down"]').click(); await rows.nth(1).locator('button[aria-label="Move up"]').click()
    check('Move down then Move up returns the row to its place', (await heads(page))[0] === S.solar.headline)
    check('the unticked row stays unticked after moving', (await page.locator(`${DIALOG} .or-dg-row.off`).innerText()).includes(S.old.headline))
    const INTRO = 'Synthetic intro written by the digest test.'
    await page.locator(`${DIALOG} textarea[aria-label="Intro"]`).fill(INTRO)

    // the preview is the email itself
    await page.waitForFunction(() => document.querySelector('iframe[title="Digest preview"]')?.getAttribute('srcdoc')?.includes('src="data:image/png'), null, { timeout: 5000 }).catch(() => {})
    const doc = await srcdoc(page)
    check('preview carries the bundled logo (the email as sent, letterhead on)', doc.includes('src="data:image/png'))
    // the frame's own document, not only its attribute: what the editor actually sees
    await page.waitForTimeout(500)
    const shown = await page.frameLocator(`${DIALOG} iframe[title="Digest preview"]`).locator('body').evaluate((body) => ({
      logo: body.querySelector('img')?.naturalWidth ?? 0, links: [...body.querySelectorAll('a')].map((a) => a.getAttribute('href')), text: body.innerText,
    }))
    const want = [url(S.solar), url(S.grid), url(S.queued)]
    check('the displayed preview shows the logo, the intro and the three links in order', shown.logo > 0 && shown.text.includes(INTRO) && JSON.stringify(shown.links.filter((h) => h.includes('/articles/'))) === JSON.stringify(want), JSON.stringify({ logo: shown.logo, links: shown.links.length }))
    const pos = (s) => doc.indexOf(s)
    check('preview has the intro and the three links in the chosen order', pos(INTRO) > 0 && pos(`href="${url(S.solar)}"`) > pos(INTRO) && pos(`href="${url(S.grid)}"`) > pos(`href="${url(S.solar)}"`) && pos(`href="${url(S.queued)}"`) > pos(`href="${url(S.grid)}"`))
    check('preview leaves the unticked story out', pos(url(S.old)) === -1)
    check('preview escapes the headline: <b> and & arrive as text', doc.includes('Synthetic solar tender draws &lt;b&gt;nine&lt;/b&gt; bids') && doc.includes('upgrade &amp; tests it') && !doc.includes('<b>nine</b>'))
    check('preview has no picture (letters have no picture mark)', !doc.includes('cdn.example.com'))
    const subject = await page.locator(`${DIALOG} .or-dg-subject b`).innerText()

    await create.click()
    await page.waitForSelector(DIALOG, { state: 'detached' })
    const all = await campaigns(page)
    const st = await page.evaluate(() => ({ activeId: window.__outreachStore.getState().activeId }))
    const c = all[0]
    check('one new campaign, and it is the open one', all.length === before + 1 && c.id === st.activeId)
    check('it is a draft with no schedule', c.status === 'draft' && c.scheduledAt === null, `${c.status} ${c.scheduledAt}`)
    check('name and subject: "This week at ESB PowerLine — <range>"', c.name === subject && c.subject === subject && /^This week at ESB PowerLine — \d/.test(c.name), c.name)
    check('kind list, blank blueprint, English, letterhead on', c.kind === 'list' && c.blueprint === 'blank' && c.lang === 'en' && c.letterhead === true)
    const b = c.body
    const bp = (s) => b.indexOf(s)
    check('body: intro, then the stories in the chosen order with their decks and links', bp(INTRO) === 0 && bp('## ' + S.solar.headline) > 0 && bp(S.solar.deck) > bp('## ' + S.solar.headline) && bp(`[Read the story](${url(S.solar)})`) > bp(S.solar.deck)
      && bp('## ' + S.grid.headline) > bp(url(S.solar)) && bp('## ' + S.queued.headline) > bp(url(S.grid)) && bp(S.old.headline) === -1, JSON.stringify(b.slice(0, 160)))
    check('body is marks, not HTML: the <b> is the headline\'s own text', b.includes('draws <b>nine</b> bids') && !b.includes('<h3') && !b.includes('<a '))
    check('nothing was sent: no results on the campaign', !Object.keys(c.sent).length && !Object.keys(c.failed).length)
    await page.click('.side-tabs button[aria-label="Send"]').catch(() => {})
    const note = await page.locator('.or-foot-note').innerText()
    check('the Send footer still needs the desktop app (no bridge here)', note.includes('desktop app') && await page.evaluate(() => !window.esb), note)
    check('the open letter is the digest', (await page.locator('.or-text').inputValue()).startsWith(INTRO))
    check('no request left the page except the mocked site list', net.outside.length === 0 && net.feed === 1, JSON.stringify(net.outside.slice(0, 5)))
    check('no page errors', errors.length === 0, errors.slice(0, 2).join(' | '))
    await ctx.close()

    // an empty log: the empty state, and nothing to create
    const e = await newPage(browser, {})
    await openCampaigns(e.page)
    await openDigest(e.page)
    const empty = await e.page.locator(`${DIALOG} .or-dg-empty`).innerText()
    check('empty week: says no stories were published, with the dates', empty.includes('No stories were published from this app between'), empty.replace(/\s+/g, ' '))
    check('empty week: Create is disabled', await e.page.locator(`${DIALOG} .or-dg-create`).isDisabled())
    check('empty week: no request left the page except the site list', e.net.outside.length === 0, JSON.stringify(e.net.outside.slice(0, 5)))
    await e.ctx.close()
  } finally {
    await browser.close()
  }
} catch (err) {
  if (err !== null) { console.log('FAIL suite crashed', String(err).split('\n')[0]); failed++ }
} finally {
  vite.kill()
}
console.log(failed ? `${failed} FAILED` : 'ALL PASS')
process.exit(failed ? 1 : 0)
