// End-to-end test of the Editorial Wire desk (intake → Wire): sources, Check now, the inbox, Use this link, dismiss,
// backoff after a net-guard error. Hermetic: window.esb.fetchUrl is a stub that serves the synthetic fixture feed
// (tools/fixtures/feeds/rss2.xml) and counts calls; every browser request to a host other than localhost is aborted
// and recorded, and the suite fails if any of them came from the Wire desk.
import { chromium } from 'playwright-core'
import { spawn } from 'node:child_process'
import path from 'node:path'
import fs from 'node:fs'
import { launchBrowser } from '../launch-browser.mjs'
import { portOffset } from '../port-offset.mjs'

const PORT = 5213 + portOffset()
const root = path.resolve(import.meta.dirname, '../..')
const RSS = fs.readFileSync(path.join(root, 'tools', 'fixtures', 'feeds', 'rss2.xml'), 'utf8')
const FEED = 'https://feed.example.com/rss.xml'
const BAD = 'https://intranet.example.com/feed'
const PRIVATE_ERR = 'Host intranet.example.com resolved to private/restricted IP: 10.0.0.5'
const vite = spawn(process.execPath, [path.join(root, 'node_modules', 'vite', 'bin', 'vite.js'), '--port', String(PORT), '--strictPort'], { cwd: root, stdio: 'ignore' })

let failed = 0
function check(name, ok, extra = '') {
  if (ok) console.log('PASS', name, extra)
  else { console.log('FAIL', name, extra); failed++ }
}

const waitUp = async () => {
  for (let i = 0; i < 60; i++) {
    try { if ((await fetch(`http://localhost:${PORT}/`)).ok) return } catch {}
    await new Promise((r) => setTimeout(r, 500))
  }
  throw new Error('Vite did not start')
}

let browser
try {
  await waitUp()
  browser = await launchBrowser(chromium)
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  page.setDefaultTimeout(8000)
  const pageErrors = []
  page.on('pageerror', (e) => pageErrors.push(String(e)))

  // Nothing leaves this machine: every non-localhost request is aborted and recorded.
  const external = []
  await page.route('**/*', (r) => {
    const u = new URL(r.request().url())
    if (u.protocol === 'data:' || u.protocol === 'blob:' || u.hostname === 'localhost' || u.hostname === '127.0.0.1') return r.continue()
    external.push(u.href)
    return r.abort()
  })

  // The desktop bridge, stubbed. Calls are counted in sessionStorage so the count survives a reload.
  await page.addInitScript(([rss, feed, bad, privErr]) => {
    const bump = (k) => sessionStorage.setItem(k, String(Number(sessionStorage.getItem(k) || 0) + 1))
    window.esb = {
      fetchUrl: async (url, opts) => {
        sessionStorage.setItem('wire-last-opts', JSON.stringify(opts ?? null))
        if (url === feed) { bump('wire-feed-calls'); return { ok: true, html: rss, url } }
        if (url === bad) { bump('wire-bad-calls'); return { ok: false, code: 'private_address', error: privErr } }
        bump('wire-other-calls')
        sessionStorage.setItem('wire-other-urls', JSON.stringify([...JSON.parse(sessionStorage.getItem('wire-other-urls') || '[]'), url]))
        return { ok: false, code: 'network_error', error: 'blocked in test' }
      },
    }
  }, [RSS, FEED, BAD, PRIVATE_ERR])

  const calls = (k = 'wire-feed-calls') => page.evaluate((key) => Number(sessionStorage.getItem(key) || 0), k)
  const sources = () => page.evaluate(() => JSON.parse(localStorage.getItem('esb-banner-studio/wire/sources/v1') || '[]'))
  const inbox = () => page.evaluate(() => JSON.parse(localStorage.getItem('esb-banner-studio/wire/inbox/v1') || '{}'))
  const openWire = async () => {
    await page.click('.ed-launcher-wrap .ed-intake-tabs button:has-text("Wire")')
    await page.waitForSelector('.ed-wire')
  }
  const openEditorial = async () => {
    await page.goto(`http://localhost:${PORT}/`)
    await page.waitForSelector('.studio-shell')
    await page.click('.launch-tile:has-text("Editorial")')
    await page.waitForSelector('.ed-launcher-wrap')
  }

  await openEditorial()
  await openWire()
  check('Wire tab sits in the intake Seg and selects', (await page.locator('.ed-intake-tabs button.on').innerText()).includes('Wire'))
  check('Empty state reads "No sources yet" with the add row', (await page.locator('.ed-wire-empty b').innerText()) === 'No sources yet' && (await page.locator('.ed-wire-add input[aria-label="Feed address"]').count()) === 1)
  check('Add source is disabled with no address', await page.locator('.ed-wire-add button:has-text("Add source")').isDisabled())

  // a bad address is refused with a message, nothing stored
  await page.fill('.ed-wire-add input[aria-label="Feed address"]', 'ftp://files.example.com/feed')
  await page.click('.ed-wire-add button:has-text("Add source")')
  check('Non-http address refused with a message', (await page.locator('.ed-wire-err').innerText()).includes('http') && (await sources()).length === 0)

  await page.fill('.ed-wire-add input[aria-label="Feed address"]', FEED)
  await page.fill('.ed-wire-add input[aria-label="Source name"]', 'Example Desk')
  await page.click('.ed-wire-add button:has-text("Add source")')
  await page.waitForSelector('.ed-wire-sources > summary')
  check('Sources list starts folded so the inbox has the room', !(await page.locator('.ed-wire-sources').evaluate((d) => d.open)) && (await page.locator('.ed-wire-sources > summary').innerText()).includes('1 of 1 on'))
  await page.click('.ed-wire-sources > summary')
  await page.waitForSelector('.ed-wire-src')
  check('Sources summary unfolds the source rows', await page.locator('.ed-wire-sources').evaluate((d) => d.open))
  let st = await sources()
  check('Add source stores the registry entry (sources/v1)', st.length === 1 && st[0].url === FEED && st[0].name === 'Example Desk' && st[0].intervalMin === 30 && st[0].enabled === true, JSON.stringify(st[0] ?? {}).slice(0, 160))
  check('Adding a source does not fetch by itself', (await calls()) === 0)
  check('New source reads "Not checked yet"', (await page.locator('.ed-wire-src-status').first().innerText()).includes('Not checked yet'))

  await page.click('.ed-wire-check')
  await page.waitForFunction(() => document.querySelectorAll('.ed-wire-item').length === 5)
  check('Check now fetches once through window.esb.fetchUrl', (await calls()) === 1)
  const opts = await page.evaluate(() => JSON.parse(sessionStorage.getItem('wire-last-opts') || 'null'))
  check('Bridge is asked with no allowedTypes override (net-guard defaults carry XML) and a timeout ≤ 30 s', opts && !('allowedTypes' in opts) && opts.timeoutMs <= 30000, JSON.stringify(opts))
  check('Inbox lists the 5 fixture items', (await page.locator('.ed-wire-item').count()) === 5)
  check('Check now reports what it did', (await page.locator('.ed-wire-note').innerText()).includes('Checked 1 source · 5 new'))
  const first = page.locator('.ed-wire-item').first()
  const dated = page.locator('.ed-wire-item[data-link="https://news.example.com/economy/port-terminal-opens"]')
  const firstTitle = await dated.locator('.ed-feed-text b').innerText()
  const firstMeta = await dated.locator('.ed-feed-text span').innerText()
  check('Rows show title, source and relative time', firstTitle.length > 10 && firstMeta.includes('Example Desk') && /\d+ (min|h|d) ago/.test(firstMeta), `${firstTitle} | ${firstMeta}`)
  check('CDATA title rendered as plain text', (await page.locator('.ed-wire-item b:has-text("Rice prices fall 5% after record harvest & imports")').count()) === 1 && (await page.locator('.ed-wire-item b b').count()) === 0)
  check('Relative link resolved to an absolute URL', (await page.locator('.ed-wire-item[data-link="https://news.example.com/city/river-bus-routes"]').count()) === 1)
  const undated = await page.locator('.ed-wire-item[data-link="https://news.example.com/economy/garment-exports-rise"] .ed-feed-text span').innerText()
  check('Item without a date says when it was found', /found (just now|\d+ min ago)/.test(undated), undated)
  check('Source status says when it was checked', (await page.locator('.ed-wire-src-status').first().innerText()).startsWith('Checked'))

  // filter
  await page.fill('.ed-wire input[aria-label="Filter wire stories"]', 'rice')
  check('Filter narrows the inbox', (await page.locator('.ed-wire-item').count()) === 1)
  await page.fill('.ed-wire input[aria-label="Filter wire stories"]', '২০২৬')
  check('Filter matches Bengali digits', (await page.locator('.ed-wire-item').count()) === 1)
  await page.fill('.ed-wire input[aria-label="Filter wire stories"]', 'zzzz-nothing')
  check('Filter with no match says so', (await page.locator('.ed-wire .ed-feed-empty').innerText()).includes('No stories match'))
  await page.fill('.ed-wire input[aria-label="Filter wire stories"]', '')
  check('Clearing the filter restores the list', (await page.locator('.ed-wire-item').count()) === 5)

  // Use this link → Link tab with the URL filled, no fetch
  const useLink = await first.getAttribute('data-link')
  await first.locator('button:has-text("Use this link")').click()
  await page.waitForSelector('#ed-link-input')
  check('Use this link switches the Seg to Link', (await page.locator('.ed-intake-tabs button.on').innerText()).includes('Link'))
  check('Use this link fills the Link field with the item URL', (await page.inputValue('#ed-link-input')) === useLink, useLink)
  const others = await page.evaluate(() => JSON.parse(sessionStorage.getItem('wire-other-urls') || '[]'))
  check('Use this link does not fetch (the item URL never reaches the bridge)', (await calls()) === 1 && !others.includes(useLink), `other bridge calls (the app's own site probe): ${[...new Set(others)].join(' ')}`)

  // dismiss persists across a reload
  await openWire()
  const victim = await page.locator('.ed-wire-item').nth(1).getAttribute('data-link')
  await page.locator('.ed-wire-item').nth(1).locator('button[aria-label="Dismiss"], button[data-tip="Dismiss"]').first().click()
  check('Dismiss removes the row', (await page.locator('.ed-wire-item').count()) === 4 && (await page.locator(`.ed-wire-item[data-link="${victim}"]`).count()) === 0)
  await openEditorial()
  await openWire()
  await page.click('.ed-wire-sources > summary')
  check('Dismissed item stays hidden after reload', (await page.locator('.ed-wire-item').count()) === 4 && (await page.locator(`.ed-wire-item[data-link="${victim}"]`).count()) === 0)
  check('Dismissed id kept in inbox/v1', ((await inbox()).dismissed ?? []).includes(victim))

  // a second Check now inside the interval makes no fetch
  await page.click('.ed-wire-check')
  await page.waitForSelector('.ed-wire-note')
  check('Second Check now within the interval makes no fetch', (await calls()) === 1, `calls=${await calls()}`)
  check('…and says nothing was due', (await page.locator('.ed-wire-note').innerText()).includes('Nothing due'))

  // interval scrub, name, enable switch
  const row = page.locator('.ed-wire-src').first()
  await row.locator('.ed-wire-interval input').fill('45')
  await row.locator('.ed-wire-interval input').press('Enter')
  check('Interval Scrub stores the new interval', (await sources())[0].intervalMin === 45)
  await row.locator('.ed-wire-interval input').fill('5')
  await row.locator('.ed-wire-interval input').press('Enter')
  check('Interval is held to the 15-minute floor', (await sources())[0].intervalMin === 15)
  await row.locator('input[aria-label="Source name"]').fill('Example Desk Renamed')
  await row.locator('input[aria-label="Source name"]').press('Enter')
  check('Source name edit is stored', (await sources())[0].name === 'Example Desk Renamed')
  await row.locator('.switch').click()
  check('Enable switch turns a source off', (await sources())[0].enabled === false && (await row.getAttribute('class')).includes('off') && (await row.locator('.ed-wire-src-status').innerText()) === 'Paused')
  await row.locator('.switch').click()
  check('Enable switch turns it back on', (await sources())[0].enabled === true)

  // a net-guard private-address error is shown as text and pushes nextAt out
  await page.fill('.ed-wire-sources input[aria-label="Feed address"] >> nth=-1', BAD)
  await page.click('.ed-wire-sources button:has-text("Add source")')
  await page.waitForFunction(() => document.querySelectorAll('.ed-wire-src').length === 2)
  const before = Date.now()
  await page.click('.ed-wire-check')
  await page.waitForFunction(() => /Retrying/.test(document.querySelectorAll('.ed-wire-src-status')[1]?.textContent || ''))
  const badRow = page.locator('.ed-wire-src').nth(1)
  const badText = await badRow.locator('.ed-wire-src-status').innerText()
  check('net-guard error shown as "Retrying in …" with its message', badText.startsWith('Retrying in') && badText.includes(PRIVATE_ERR), badText)
  st = await sources()
  check('Failed source backs off: failures 1, nextAt ≥ 2 × interval out', st[1].failures === 1 && st[1].lastError?.code === 'private_address' && st[1].nextAt >= before + 2 * 30 * 60000 - 1000, `nextAt in ${Math.round((st[1].nextAt - before) / 60000)} min`)
  check('The healthy source was not re-fetched (not due)', (await calls()) === 1 && (await calls('wire-bad-calls')) === 1)
  await page.click('.ed-wire-check')
  await page.waitForSelector('.ed-wire-note')
  check('Source in backoff is not retried before nextAt', (await calls('wire-bad-calls')) === 1)

  check('Sources summary counts the retrying source', (await page.locator('.ed-wire-sources > summary').innerText()).includes('1 retrying'))

  fs.mkdirSync(path.join(root, 'artifacts', 'overnight', 'screenshots', 'w5'), { recursive: true })
  await page.screenshot({ path: path.join(root, 'artifacts', 'overnight', 'screenshots', 'w5', 'wire-test-sources-open.png') })

  // remove
  await badRow.locator('button[aria-label="Remove source"], button[data-tip="Remove source"]').first().click()
  check('Remove deletes the source', (await page.locator('.ed-wire-src').count()) === 1 && (await sources()).length === 1)

  // the same desk in the source column's "New link" tab (compact intake) once a story is open
  await page.evaluate(() => { const s = window.__editorialStore.getState(); s.setDraftField('headline', 'Synthetic desk story for the wire test'); s.setDraftField('body', 'A synthetic paragraph for the wire test.') })
  await page.waitForSelector('.ed-desk')
  if (!(await page.locator('.ed-src .ed-intake.compact').count())) await page.click('.ed-src .side-tabs button[aria-label="New link"]')
  await page.click('.ed-src .ed-intake-tabs button:has-text("Wire")')
  await page.waitForSelector('.ed-src .ed-wire-item')
  check('Compact intake (New link tab) shows the Wire inbox', (await page.locator('.ed-src .ed-wire-item').count()) === 4)
  await page.screenshot({ path: path.join(root, 'artifacts', 'overnight', 'screenshots', 'w5', 'wire-test-compact.png') })
  const cLink = await page.locator('.ed-src .ed-wire-item').first().getAttribute('data-link')
  await page.locator('.ed-src .ed-wire-item').first().locator('button:has-text("Use this link")').click()
  await page.waitForSelector('.ed-src .ed-url-input')
  check('Compact: Use this link fills the link field and shows Link', (await page.inputValue('.ed-src .ed-url-input')) === cLink && (await page.locator('.ed-src .ed-intake-tabs button.on').innerText()).includes('Link'), cLink)

  // network hygiene
  const fromWire = external.filter((u) => /example\.com/.test(u))
  check('No browser request to any feed host', fromWire.length === 0, fromWire.join(' '))
  const hosts = [...new Set(external.map((u) => new URL(u).hostname))]
  const appOwn = hosts.filter((h) => !/(^|\.)esbpowerline\.com$|\.supabase\.co$/.test(h))
  check('No request left localhost except the app\'s own site probes (all aborted)', appOwn.length === 0, `aborted hosts: ${hosts.join(', ') || 'none'}`)
  check('No page errors', pageErrors.length === 0, pageErrors.slice(0, 2).join(' | '))
} catch (e) {
  console.log('FAIL', 'wire suite crashed:', String(e?.stack || e).split('\n').slice(0, 4).join(' '))
  failed++
} finally {
  await browser?.close()
  vite.kill()
}
console.log(failed ? `\n${failed} FAILED` : '\nALL PASS')
process.exit(failed ? 1 : 0)
