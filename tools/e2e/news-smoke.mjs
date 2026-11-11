// Live smoke test of the News desk, against the real internet, in a throwaway profile. It lets the app run one real check, then
// re-reads every source itself through the app's own fetch and compares:
//   - did each feed and official press source answer, and with what (dead, not a feed, empty, stale, undated)?
//   - of the headlines a source offered in the last 24 h that our rules accept, did every one reach the desk?
//   - do the links on the desk open (a sample per source)?
// Writes the full table to OUT (default tools/e2e/out/news-smoke.json), prints a summary. Reads only; posts nothing.
import { _electron as electron } from 'playwright-core'
import { createServer } from 'vite'
import path from 'node:path'; import fs from 'node:fs'; import os from 'node:os'

const root = path.resolve(import.meta.dirname, '../..')
const outFile = process.env.OUT || path.join(root, 'tools/e2e/out/news-smoke.json')
fs.mkdirSync(path.dirname(outFile), { recursive: true })
const vite = await createServer({ root, server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom', logLevel: 'error' })
const load = (m) => vite.ssrLoadModule(m)
const { EW_FEEDS, EW_PRESS_SOURCES, EW_KEYWORDS } = await load('/src/news/ewSources.ts')
const { buildMatcher } = await load('/src/news/matcher.ts')
const { parseFeed, parseDate } = await load('/src/news/feedparse.ts')
const press = await load('/src/news/pressParse.ts')
const parseDateFn = parseDate
const parseTable = press.parseGovPressTable
const match = buildMatcher(EW_KEYWORDS)

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'esb-news-'))
const app = await electron.launch({ executablePath: path.join(root, 'node_modules/electron/dist/electron.exe'), args: [root, '--user-data-dir=' + dir], env: { ...process.env, ESB_NO_SYNC: '1' } })
const page = await app.firstWindow(); page.setDefaultTimeout(30000)
await app.evaluate(({ BrowserWindow }) => { const b = BrowserWindow.getAllWindows()[0]; b.setContentSize(1400, 860); b.showInactive() })
await page.waitForSelector('.launch-tile')
await page.waitForTimeout(600)
const t0 = Date.now()
await page.evaluate(() => [...document.querySelectorAll('.launch-tile')].find((x) => /News/.test(x.textContent))?.click())
console.log('waiting for the app to finish its own check')
let data = null
while (Date.now() - t0 < 8 * 60_000) {
  await page.waitForTimeout(2500)
  data = await page.evaluate(() => { try { const d = JSON.parse(localStorage.getItem('esb-banner-studio/news/data/v1') || 'null'); return d && d.lastRun ? d : null } catch { return null } })
  if (data) break
}
if (!data) { console.log('FAIL the app never finished a check'); await app.close(); await vite.close(); process.exit(1) }
const checkSec = Math.round((Date.now() - t0) / 1000)
console.log(`the app checked in ${checkSec} s: ${data.items.length} headlines`)

const now = Date.now(), DAY = 864e5
const nrm = (t) => t.normalize('NFC').toLowerCase().replace(/\s+/g, ' ').trim()
const byKey = new Set(data.items.map((x) => x.key))
const byTitle = new Set(data.items.map((x) => nrm(x.title)))
const hiddenCount = (data.hidden || []).length

// a headline the check passed over: published after the check ran, or the same story already on the desk from another outlet?
const words = (t) => new Set(nrm(t).split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 1))
const desk = data.items.map((x) => ({ title: x.title, w: words(x.title) }))
function whyMissed(x) {
  if (x.pub && Date.parse(x.pub) > t0 - 60_000) return 'published after the check began'
  const w = words(x.title)
  let best = 0, like = ''
  for (const d of desk) { let n = 0; for (const a of w) if (d.w.has(a)) n++; const r = n / Math.max(1, Math.min(w.size, d.w.size)); if (r > best) { best = r; like = d.title } }
  return best >= 0.6 ? `same story on the desk: ${like.slice(0, 50)}` : 'NOT ON THE DESK'
}

const fetchOne = (url) => page.evaluate(async (u) => {
  try { const r = await window.esb.fetchUrl(u, { timeoutMs: 20000 }); return { ok: !!r.ok, error: r.error || r.code || '', status: r.status, finalUrl: r.url, body: r.ok ? (r.body ?? r.html ?? '') : '' } } catch (e) { return { ok: false, error: String(e && e.message || e), body: '' } }
}, url)
async function pool(list, n, fn) { let i = 0; await Promise.all(Array.from({ length: n }, async () => { while (i < list.length) { const k = i++; await fn(list[k], k) } })) }

const rows = []
const feeds = EW_FEEDS.filter((f) => f.on)
await pool(feeds, 6, async (f) => {
  const r = await fetchOne(f.url)
  const row = { kind: 'feed', id: f.id, name: f.name, url: f.url, host: new URL(f.url).hostname, appOk: data.feeds[f.id]?.ok ?? null, appError: data.feeds[f.id]?.error ?? '', appCount: data.feeds[f.id]?.count ?? null }
  if (!r.ok) { rows.push({ ...row, state: 'DEAD', why: r.error }); return }
  if (!/<(rss|feed|rdf:RDF)\b/i.test(r.body)) { rows.push({ ...row, state: 'NOT_A_FEED', why: r.body.slice(0, 80).replace(/\s+/g, ' ') }); return }
  const list = parseFeed(r.body)
  const dated = list.map((x) => ({ ...x, pub: parseDateFn(x.date) }))
  const times = dated.map((x) => x.pub && Date.parse(x.pub)).filter((t) => Number.isFinite(t))
  const newest = times.length ? Math.max(...times) : null
  const day = dated.filter((x) => x.pub && now - Date.parse(x.pub) <= DAY)
  const wanted = day.filter((x) => match(x.title))
  const missed = wanted.filter((x) => !byKey.has(x.key) && !byTitle.has(nrm(x.title)))
  const undated = list.length - times.length
  const future = times.filter((t) => t > now + 3600e3).length
  rows.push({ ...row, state: !list.length ? 'EMPTY' : newest == null ? 'NO_DATES' : now - newest > 7 * DAY ? 'STALE' : 'OK', items: list.length, in24h: day.length, wanted: wanted.length, missed: missed.length, missedTitles: missed.slice(0, 5).map((x) => `${x.title}  [${whyMissed(x)}]`), undated, future, newestH: newest ? Math.round((now - newest) / 36e5) : null })
})
const pressSrc = EW_PRESS_SOURCES.filter((s) => s.on)
await pool(pressSrc, 4, async (s) => {
  const r = await fetchOne(s.url)
  const row = { kind: 'press', id: s.id, name: s.name, url: s.url, sub: s.kind, host: new URL(s.url).hostname, appOk: data.feeds[s.id]?.ok ?? null, appError: data.feeds[s.id]?.error ?? '', appCount: data.feeds[s.id]?.count ?? null }
  if (!r.ok) { rows.push({ ...row, state: 'DEAD', why: r.error }); return }
  let list = []
  try { list = s.kind === 'portal-table' ? parseTable(r.body, r.finalUrl || s.url).map((p) => ({ title: p.title, pub: p.published })) : parseFeed(r.body).map((x) => ({ title: x.title, pub: parseDateFn(x.date) })) } catch (e) { rows.push({ ...row, state: 'PARSE_ERROR', why: String(e.message) }); return }
  const times = list.map((x) => x.pub && Date.parse(x.pub)).filter((t) => Number.isFinite(t))
  const newest = times.length ? Math.max(...times) : null
  rows.push({ ...row, state: !list.length ? 'EMPTY' : newest == null ? 'NO_DATES' : now - newest > 90 * DAY ? 'STALE' : 'OK', items: list.length, undated: list.length - times.length, newestH: newest ? Math.round((now - newest) / 36e5) : null })
})

// links on the desk: the two newest of each source, opened through the app's fetch
const bySrc = new Map()
for (const x of data.items) { const l = bySrc.get(x.source) ?? []; if (l.length < 2) l.push(x); bySrc.set(x.source, l) }
const sample = [...bySrc.values()].flat()
const links = []
await pool(sample, 6, async (x) => {
  const r = await fetchOne(x.link)
  links.push({ source: x.source, google: !!x.google, press: x.categories.includes('press'), ok: r.ok && r.body.length > 300, error: r.ok ? (r.body.length > 300 ? '' : 'nearly empty page') : r.error, host: (() => { try { return new URL(x.link).hostname } catch { return '?' } })(), link: x.link })
})

const summary = {
  appCheckSeconds: checkSec, items: data.items.length, hiddenCount,
  undatedOnDesk: data.items.filter((x) => x.timeUnknown).length,
  google: data.items.filter((x) => x.google).length,
  bySource: bySrc.size,
  states: rows.reduce((a, r) => { const k = r.kind + ':' + r.state; a[k] = (a[k] || 0) + 1; return a }, {}),
  appDisagrees: rows.filter((r) => r.appOk === false && r.state === 'OK').length,
  wanted: rows.reduce((n, r) => n + (r.wanted || 0), 0), missed: rows.reduce((n, r) => n + (r.missed || 0), 0),
  links: { tried: links.length, ok: links.filter((l) => l.ok).length, googleTried: links.filter((l) => l.google).length, googleOk: links.filter((l) => l.google && l.ok).length, pressTried: links.filter((l) => l.press).length, pressOk: links.filter((l) => l.press && l.ok).length },
}
fs.writeFileSync(outFile, JSON.stringify({ summary, rows: rows.sort((a, b) => a.state.localeCompare(b.state)), links: links.filter((l) => !l.ok), feedsInApp: data.feeds }, null, 1))
console.log(JSON.stringify(summary, null, 1))
for (const r of rows.filter((r) => r.state !== 'OK')) console.log(r.kind.padEnd(6), r.state.padEnd(11), r.name.padEnd(26), r.host.padEnd(28), String(r.why || r.appError || '').slice(0, 70))
for (const r of rows.filter((r) => r.missed)) console.log('MISSED', r.name, r.missed, 'of', r.wanted)
await app.close(); await vite.close()
fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 400 })
