// Read one day of esbpowerline.com's published grid data (the PGCB daily report JSON) for the Video desk's data
// cards, as the signed-in staff member, and keep a copy per date in userData with the time it was fetched.
//
// The renderer names a DATE, never a URL: the origin is fixed (https://esbpowerline.com), the path is one of the site's
// two documented ones (esbpowerline lib/data/grid/date-utils.ts — `/data/daily/<iso>.json`, then its runtime twin
// `/api/data/daily/<iso>.json` for days published since the last deploy), redirects are never followed, the body is
// capped and the whole request has a time limit. Treat every argument as hostile: the date is checked as a real
// calendar day in the site's range, the cookies by the same rules as the banner upload (site-upload.cjs).
//
// Authentication: the site's own session cookie (`sb-<ref>-auth-token`, what the CMS window and /api/upload use) and an
// honest user agent naming the Studio. Nothing here sends a Referer or Origin it is not entitled to: the site's data
// gate (middleware.ts → isSameOriginDailyAccess) wants a same-site page origin, which a desktop app does not have, so
// the site must accept an active staff session in its place — see docs/VIDEO_PRO_PROGRESS.md "Phase 3 — Part B" for
// the exact change. Until it does, the site answers 403 "Direct data access is restricted" and this module says so
// (code 'refused') instead of pretending.
const fs = require('node:fs')
const path = require('node:path')
const { checkCookies } = require('./site-upload.cjs')

const SITE_ORIGIN = 'https://esbpowerline.com'
const MAX_BYTES = 2 * 1024 * 1024 // a day is ~40–120 KB; 2 MB is far above any real file and stops a runaway body
const TIMEOUT_MS = 15000
const CACHE_DIR = 'grid-cache'
const CACHE_MAX_FILES = 400
const MAX_PER_MINUTE = 40
const PROBE_DAYS = 8 // the newest published day is always inside the site's 7-day public window
const LATEST_DEADLINE_MS = 20000 // the whole 'newest day' search, however many days it probes
const TOP_KEYS = ['systemStats', 'generationData', 'zoneGenerationData', 'regionalDemandData', 'regionalDemandSource', 'hourlyLoadData', 'borderImportsData', 'sourceFiles']
const MAX_DEPTH = 6 // a day is object > list > object > object > number; anything deeper is not a daily report

const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})$/

/** A real calendar day in the site's range (date-utils.ts parseIsoDate: 2011–2030), else null. */
function validDate(iso) {
  if (typeof iso !== 'string') return null
  const m = ISO_RE.exec(iso)
  if (!m) return null
  const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3])
  const dt = new Date(Date.UTC(y, mo - 1, d))
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null
  if (y < 2011 || y > 2030) return null
  return iso
}

/** Today's date in Dhaka (UTC+6, no DST): the energy day the site's files are named by. */
function dhakaToday(now = Date.now()) {
  return new Date(now + 6 * 3600 * 1000).toISOString().slice(0, 10)
}
function minusDays(iso, n) {
  const [y, m, d] = iso.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d - n))
  return dt.toISOString().slice(0, 10)
}

/** The origin requests go to. Only an unpackaged build may point it at a loopback test server (the e2e's stand-in for
 * the site); anything else — another host, https elsewhere, a packaged app — is the real site. */
function resolveOrigin(override, packaged) {
  if (!packaged && typeof override === 'string' && /^http:\/\/127\.0\.0\.1:\d{2,5}$/.test(override)) return override
  return SITE_ORIGIN
}

/** "21 Oct 2026" → "2026-10-21" (the label every daily file carries in systemStats.date). */
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
function labelToIso(label) {
  const m = /^(\d{1,2}) ([A-Z][a-z]{2}) (\d{4})$/.exec(String(label).trim())
  if (!m) return null
  const mi = MONTHS.indexOf(m[2])
  return mi < 0 ? null : `${m[3]}-${String(mi + 1).padStart(2, '0')}-${m[1].padStart(2, '0')}`
}

function withinDepth(v, left) {
  if (v === null || typeof v !== 'object') return true
  if (left <= 0) return false
  for (const k of Object.keys(v)) if (!withinDepth(v[k], left - 1)) return false
  return true
}

/** Only the report's known top-level parts, and only if they are plain, shallow JSON that crosses IPC: a nested bomb
 * that parses fine would otherwise fail (or hang) when the answer is cloned to the renderer. Null = refuse. */
function pickDay(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null
  const out = {}
  for (const k of TOP_KEYS) if (k in data) out[k] = data[k]
  if (!withinDepth(out, MAX_DEPTH)) return null
  try { JSON.stringify(out) } catch { return null }
  return out
}

/** The answer is a daily report for exactly this day (the renderer checks every field again with parseGridDay). */
function isDayFor(data, iso) {
  return !!data && typeof data === 'object' && !Array.isArray(data) && !!data.systemStats && typeof data.systemStats === 'object' && labelToIso(data.systemStats.date) === iso
}

async function readCapped(res, cap) {
  const len = Number(res.headers.get('content-length'))
  if (Number.isFinite(len) && len > cap) return { tooLarge: true }
  if (!res.body || typeof res.body.getReader !== 'function') {
    const buf = Buffer.from(await res.arrayBuffer())
    return buf.length > cap ? { tooLarge: true } : { text: buf.toString('utf8') }
  }
  const reader = res.body.getReader()
  const parts = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.length
    if (total > cap) { try { await reader.cancel() } catch { /* gone */ } return { tooLarge: true } }
    parts.push(Buffer.from(value))
  }
  return { text: Buffer.concat(parts).toString('utf8') }
}

const fail = (code, error, status = 0) => ({ ok: false, code, error, status })

/**
 * @param {{ userDataDir: string, fetchImpl?: typeof fetch, origin?: string, userAgent?: string, now?: () => number, maxBytes?: number, timeoutMs?: number }} o
 */
function createGridData(o) {
  const fetchImpl = o.fetchImpl || fetch
  const origin = o.origin || SITE_ORIGIN
  const ua = o.userAgent || 'ESB-AI-Studio (desktop; +https://esbpowerline.com)'
  const now = o.now || Date.now
  const cap = o.maxBytes || MAX_BYTES
  const timeoutMs = o.timeoutMs || TIMEOUT_MS
  const dir = path.join(o.userDataDir, CACHE_DIR)

  const cacheFile = (iso) => path.join(dir, `${iso}.json`)
  // a hostile or looping renderer must not turn the Studio into a load generator against the site: at most
  // MAX_PER_MINUTE network requests in any rolling minute (a day costs 1–2; 'latest' at most 16)
  const sent = []
  const overBudget = () => {
    const t = now()
    while (sent.length && t - sent[0] > 60000) sent.shift()
    if (sent.length >= (o.maxPerMinute || MAX_PER_MINUTE)) return true
    sent.push(t)
    return false
  }

  function readCache(iso) {
    try {
      const j = JSON.parse(fs.readFileSync(cacheFile(iso), 'utf8'))
      const data = j && pickDay(j.data)
      if (!j || j.iso !== iso || typeof j.fetchedAt !== 'string' || typeof j.source !== 'string' || !isDayFor(data, iso)) return null
      return { ok: true, iso, fetchedAt: j.fetchedAt, source: j.source, data, cached: true }
    } catch {
      return null
    }
  }

  function writeCache(entry) {
    try {
      fs.mkdirSync(dir, { recursive: true })
      const file = cacheFile(entry.iso)
      const tmp = `${file}.${process.pid}.${Date.now()}.tmp`
      fs.writeFileSync(tmp, JSON.stringify({ v: 1, iso: entry.iso, fetchedAt: entry.fetchedAt, source: entry.source, data: entry.data }))
      fs.renameSync(tmp, file)
      const files = fs.readdirSync(dir).filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f))
      if (files.length > CACHE_MAX_FILES) {
        const aged = files.map((f) => ({ f, t: fs.statSync(path.join(dir, f)).mtimeMs })).sort((a, b) => a.t - b.t)
        for (const { f } of aged.slice(0, files.length - CACHE_MAX_FILES)) fs.rmSync(path.join(dir, f), { force: true })
      }
    } catch { /* a cache that cannot be written only costs a refetch */ }
  }

  /** One GET with the fixed origin, no redirects, a whole-request time limit and a body cap. */
  async function get(pathname, cookies, outer) {
    const url = origin + pathname
    if (outer && outer.aborted) return { url, status: 0, error: 'timeout' }
    if (overBudget()) return { url, status: 429, local: true }
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), timeoutMs)
    if (outer) outer.addEventListener('abort', () => ctrl.abort(), { once: true })
    try {
      const res = await fetchImpl(url, {
        method: 'GET',
        redirect: 'manual',
        signal: ctrl.signal,
        headers: { Cookie: cookies.map((c) => `${c.name}=${c.value}`).join('; '), Accept: 'application/json', 'User-Agent': ua },
      })
      if (res.status >= 300 && res.status < 400) return { url, status: res.status, redirect: true }
      const body = await readCapped(res, cap)
      return { url, status: res.status, ...body }
    } catch (err) {
      return { url, status: 0, error: err && err.name === 'AbortError' ? 'timeout' : 'network' }
    } finally {
      clearTimeout(timer)
    }
  }

  function explain(r, iso) {
    if (r.error === 'timeout') return fail('timeout', 'esbpowerline.com did not answer in time.')
    if (r.error === 'network') return fail('network', 'Could not reach esbpowerline.com (offline?).')
    if (r.tooLarge) return fail('too-large', 'The site sent more data than a daily report can be; nothing was read.', r.status)
    if (r.redirect) return fail('signed-out', 'Not signed in: the site sent the request to its sign-in page.', r.status)
    if (r.status === 401) return fail('signed-out', 'Not signed in: the site did not accept this session.', 401)
    if (r.status === 403) {
      const t = String(r.text || '')
      if (/subscription required/i.test(t)) return fail('window', 'Outside your access window.', 403)
      if (/direct data access/i.test(t)) return fail('refused', 'esbpowerline.com does not accept the Studio\'s staff session for grid data yet (a site change is pending).', 403)
      return fail('refused', 'esbpowerline.com refused the request.', 403)
    }
    if (r.status === 429) return fail('rate', r.local ? 'Too many grid requests from the Studio in a minute; try again shortly.' : 'Too many requests to esbpowerline.com; try again in a minute.', 429)
    if (r.status === 404) return fail('not-published', `No data published for ${iso}.`, 404)
    return fail('http', `esbpowerline.com answered HTTP ${r.status}.`, r.status)
  }

  /**
   * The day's report. Uses the cached copy unless `refresh`; otherwise asks the site (static path, then the runtime
   * twin when the static one is not there) and caches what it gets. Resolves, never throws.
   */
  async function fetchDay(cookies, isoIn, opts, outer) {
    const iso = validDate(isoIn)
    if (!iso) return fail('bad-date', 'Pick a valid date (YYYY-MM-DD).')
    if (iso > dhakaToday(now())) return fail('not-published', `No data published for ${iso} (that day has not happened yet).`)
    const refresh = !!(opts && typeof opts === 'object' && opts.refresh === true)
    if (!refresh) { const hit = readCache(iso); if (hit) return hit }
    if (cookies == null || (Array.isArray(cookies) && cookies.length === 0)) return fail('signed-out', 'Not signed in.')
    if (!checkCookies(cookies)) return fail('signed-out', 'Not signed in (the session could not be read).')
    let r = await get(`/data/daily/${iso}.json`, cookies, outer)
    if (r.status === 404) r = await get(`/api/data/daily/${iso}.json`, cookies, outer)
    if (r.status !== 200 || r.text === undefined) return explain(r, iso)
    let data
    try { data = JSON.parse(r.text) } catch { return fail('bad-data', 'The site\'s answer was not JSON.', 200) }
    data = pickDay(data)
    if (!isDayFor(data, iso)) return fail('bad-data', `The site's answer is not the daily report for ${iso}.`, 200)
    const entry = { ok: true, iso, fetchedAt: new Date(now()).toISOString(), source: r.url, data, cached: false }
    writeCache(entry)
    return entry
  }

  /** The newest published day: today (Dhaka) and back, at most PROBE_DAYS days. The days are asked together (one
   * round of waiting, not eight in a row), read newest first, and the search stops at the first answer that settles
   * it: a day found, a refusal, or the network being down. The whole search has one deadline. */
  async function latest(cookies) {
    const today = dhakaToday(now())
    const all = new AbortController()
    const timer = setTimeout(() => all.abort(), o.latestDeadlineMs || LATEST_DEADLINE_MS)
    try {
      const days = Array.from({ length: PROBE_DAYS }, (_, i) => minusDays(today, i))
      const asked = days.map((iso) => fetchDay(cookies, iso, { refresh: true }, all.signal))
      for (let i = 0; i < PROBE_DAYS; i++) {
        const r = await asked[i]
        if (r.ok) return { ok: true, iso: days[i], fetchedAt: r.fetchedAt, source: r.source, data: r.data, cached: r.cached }
        if (r.code !== 'not-published') return { ...r, cachedLatest: newestCached() }
      }
      return { ...fail('not-published', `No data published in the last ${PROBE_DAYS} days.`), cachedLatest: newestCached() }
    } finally {
      clearTimeout(timer)
      all.abort() // whatever is still in flight is not needed
    }
  }

  function newestCached() {
    try {
      const files = fs.readdirSync(dir).filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort()
      return files.length ? files[files.length - 1].slice(0, 10) : null
    } catch {
      return null
    }
  }

  /** The cached copy only (offline, or a card's stored day); never touches the network. */
  function cached(isoIn) {
    const iso = validDate(isoIn)
    if (!iso) return fail('bad-date', 'Pick a valid date (YYYY-MM-DD).')
    return readCache(iso) || fail('not-cached', `No saved copy of ${iso}.`)
  }

  /** Dates with a saved copy (newest first), for the picker when offline. */
  function cachedDates() {
    try {
      return fs.readdirSync(dir).filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f)).map((f) => f.slice(0, 10)).sort().reverse().slice(0, 60)
    } catch {
      return []
    }
  }

  return { fetchDay, latest, cached, cachedDates, origin }
}

module.exports = { createGridData, pickDay, validDate, dhakaToday, resolveOrigin, labelToIso, SITE_ORIGIN, MAX_BYTES, TIMEOUT_MS }
