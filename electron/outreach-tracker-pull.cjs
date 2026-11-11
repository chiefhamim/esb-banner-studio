// ESB Studio — brings opens and clicks from the ESB Mail Tracker (cloud/tracker) into the Outreach event log.
//
// Every 30 s while letters tracked through the Worker were sent in the last 60 days, the main process reads the
// Worker's raw hits after its cursor (/api/events?after=N, Bearer API_TOKEN — the token never reaches the renderer),
// matches each hit's message key to the letter in the send ledger (key → address, campaign, kind) and appends
//   { type: 'track.open' | 'track.click', email, campaignId, messageKey, kind, link, cls, why, client, device, country,
//     city, network, hitId, t }
// to the event log, which pushes it to the window at once (Activity → Log, the contact chips, the results panel).
// A hit whose key is not in the ledger yet (the send row is written just after) is kept and retried for 14 days.
// The cursor and the waiting hits are saved in userData/outreach-tracker-cursor.json after every page, and each
// appended event's id is `trk-<worker id>`, so a crash between the two never doubles a hit (seen ids are skipped).

const fs = require('node:fs')
const path = require('node:path')

const PAGE = 1000
const MAX_PAGES = 20
const PENDING_MS = 14 * 86_400_000
const PENDING_MAX = 5000
const ACTIVE_DAYS = 60
const CLS = new Set(['human', 'proxy', 'prefetch', 'scanner', 'bot'])
const KEY_RE = /^[A-Za-z0-9_-]{22}$/

const str = (v, n) => (typeof v === 'string' && v ? v.slice(0, n) : null)

/** One Worker row, checked field by field (it comes from the network). */
function cleanRow(r) {
  if (!r || typeof r !== 'object') return null
  const id = Number(r.id)
  if (!Number.isSafeInteger(id) || id <= 0) return null
  if (!KEY_RE.test(String(r.key ?? ''))) return null
  if (r.type !== 'open' && r.type !== 'click' && r.type !== 'file') return null
  const at = Number(r.at)
  if (!Number.isFinite(at) || at <= 0) return null
  return {
    id, key: r.key, type: r.type, at,
    target: str(r.target, 2000), cls: CLS.has(r.cls) ? r.cls : 'human', why: str(r.why, 60),
    client: str(r.client, 40), device: str(r.device, 40), country: str(r.country, 8), city: str(r.city, 80),
    network: str(r.as_org, 80), ua: str(r.ua, 400),
  }
}

function createTrackerPull({ tracker, dir, fetchFn = globalThis.fetch, ledger, append, clock = () => Date.now(), log = () => {} }) {
  const file = path.join(dir, 'outreach-tracker-cursor.json')
  let state = { after: 0, pending: [], seen: [] }
  try {
    const j = JSON.parse(fs.readFileSync(file, 'utf8'))
    if (j && Number.isSafeInteger(j.after)) state = { after: j.after, pending: Array.isArray(j.pending) ? j.pending : [], seen: Array.isArray(j.seen) ? j.seen : [] }
  } catch { /* first run */ }
  const save = () => {
    const tmp = file + '.tmp'
    fs.writeFileSync(tmp, JSON.stringify(state))
    fs.renameSync(tmp, file)
  }
  let timer = null
  let running = null
  let last = { at: null, ok: null, why: 'not checked yet', added: 0 }

  /** key → the letter it was sent in, from the ledger (newest wins). */
  function keyMap() {
    const m = new Map()
    for (const e of ledger()) if (e && e.key && KEY_RE.test(e.key)) m.set(e.key, e)
    return m
  }

  function hasTrackedRecently() {
    const since = clock() - ACTIVE_DAYS * 86_400_000
    return ledger().some((e) => e && e.key && e.t >= since)
  }

  function toEvent(r, l) {
    return {
      id: `trk-${r.id}`,
      type: r.type === 'open' ? 'track.open' : 'track.click',
      t: r.at,
      email: String(l.to || '').toLowerCase(),
      campaignId: l.c || null,
      kind: l.kind || 'campaign',
      messageKey: r.key,
      link: r.type === 'file' ? `file:${r.target}` : r.target,
      cls: r.cls, why: r.why, client: r.client, device: r.device, country: r.country, city: r.city, network: r.network,
      ua: r.ua, hitId: r.id, ...(l.kind === 'test' ? { test: true } : {}),
    }
  }

  async function pullOnce() {
    const keys = keyMap()
    const seen = new Set(state.seen)
    let added = 0
    const emit = (r) => {
      if (seen.has(r.id)) return true
      const l = keys.get(r.key)
      if (!l) return false
      append(toEvent(r, l))
      seen.add(r.id)
      added++
      return true
    }
    // hits that waited for their send row
    state.pending = state.pending.filter((r) => !emit(r) && clock() - r.at < PENDING_MS)
    for (let page = 0; page < MAX_PAGES; page++) {
      const ctl = new AbortController()
      const to = setTimeout(() => ctl.abort(), 15_000)
      let body
      try {
        const res = await fetchFn(`${tracker.base}/api/events?after=${state.after}&limit=${PAGE}`, { signal: ctl.signal, headers: { authorization: `Bearer ${tracker.token}`, 'user-agent': 'ESB-Studio' } })
        if (res.status === 401) throw new Error('tracker refused the API token')
        if (!res.ok) throw new Error(`tracker answered ${res.status}`)
        body = await res.json()
      } finally { clearTimeout(to) }
      const rows = Array.isArray(body?.events) ? body.events : []
      let maxId = state.after
      for (const raw of rows) {
        const r = cleanRow(raw)
        if (raw && Number.isSafeInteger(Number(raw.id))) maxId = Math.max(maxId, Number(raw.id))
        if (!r) continue
        if (!emit(r)) state.pending.push(r)
      }
      state.after = maxId
      state.pending = state.pending.slice(-PENDING_MAX)
      state.seen = [...seen].slice(-20_000)
      save()
      if (!body?.more || !rows.length) break
    }
    return added
  }

  async function poll({ force = false } = {}) {
    if (running) return running
    if (!force && !hasTrackedRecently() && !state.pending.length) return 0
    running = pullOnce()
      .then((n) => { last = { at: clock(), ok: true, why: null, added: n }; return n })
      .catch((e) => { last = { at: clock(), ok: false, why: String(e?.name === 'AbortError' ? 'no answer' : e?.message || e).slice(0, 120), added: 0 }; log(`tracker pull: ${last.why}`); return 0 })
      .finally(() => { running = null })
    return running
  }

  function start(everyMs = 30_000) {
    if (timer) return
    setTimeout(() => void poll(), 5_000)
    timer = setInterval(() => void poll(), everyMs)
    if (timer.unref) timer.unref()
  }
  function stop() { if (timer) clearInterval(timer); timer = null }
  const status = () => ({ ...last, cursor: state.after, waiting: state.pending.length })

  return { poll, start, stop, status }
}

module.exports = { createTrackerPull, cleanRow }
