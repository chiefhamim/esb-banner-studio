const { computeStats } = require('./outreach-stats.cjs')
// ESB Studio — Outreach Event Log (electron/outreach-events.cjs)
// Append-only monthly JSONL event store with in-memory cache and incremental suppression tracking.

const nodeFs = require('node:fs')
const path = require('node:path')

const DAY_MS = 24 * 3600 * 1000
const NINETY_DAYS_MS = 90 * DAY_MS

function monthKeyOf(timestamp) {
  const d = new Date(timestamp)
  const y = d.getUTCFullYear()
  const m = String(d.getUTCMonth() + 1).padStart(2, '0')
  return `${y}-${m}`
}

function fileNameForMonth(dir, monthKey) {
  return path.join(dir, `outreach-events-${monthKey}.jsonl`)
}

function rand4() {
  return Math.random().toString(36).slice(2, 6)
}

function createEventLog(options = {}) {
  const dir = options.dir || process.cwd()
  const clock = options.clock || (() => Date.now())
  const fs = options.fs || nodeFs

  let seq = 0
  let badLines = 0

  // In-memory array of events from the last 90 days, newest last
  const recentEvents = []

  // Suppression state: email -> { suppressed: boolean, reason: string }
  // Fold rules (§4.4):
  // 1. latest optout per address (if on === true)
  // 2. any bounce
  // 3. any send.fail where kind === 'recipient_permanent' or kind === 'policy'
  const optOutState = new Map() // email -> boolean
  const bouncedSet = new Set() // email -> true
  const failedPermSet = new Set() // email -> true

  function normalizeEmail(email) {
    return typeof email === 'string' ? email.trim().toLowerCase() : ''
  }

  function applySuppression(ev) {
    const email = normalizeEmail(ev.email)
    if (!email) return

    if (ev.type === 'optout') {
      optOutState.set(email, ev.on !== false)
    } else if (ev.type === 'bounce') {
      bouncedSet.add(email)
    } else if (ev.type === 'send.fail') {
      if (ev.kind === 'recipient_permanent' || ev.kind === 'policy') {
        failedPermSet.add(email)
      }
    }
  }

  // W3 — distribution key ledger: key -> Map(jobId -> latest { type, dry, t }). A key is blocked while any job's latest
  // entry for it is created / fire / done / failed; only an explicit cancel clears that job's entry (never another's).
  const DIST_KEY_TYPES = new Set(['distribute.created', 'distribute.fire', 'distribute.done', 'distribute.failed', 'distribute.cancelled'])
  const distKeys = new Map()

  function applyDistKey(ev) {
    if (!ev || !DIST_KEY_TYPES.has(ev.type) || typeof ev.key !== 'string' || typeof ev.jobId !== 'string') return
    let m = distKeys.get(ev.key)
    if (!m) { m = new Map(); distKeys.set(ev.key, m) }
    m.set(ev.jobId, { type: ev.type, dry: ev.dry === true, t: ev.t || 0 })
  }

  /** Every job's latest ledger entry for a distribution key: [{ jobId, type, dry, t }]. */
  function distKeyState(key) {
    const m = distKeys.get(key)
    if (!m) return []
    return [...m.entries()].map(([jobId, v]) => ({ jobId, ...v }))
  }

  function isSuppressed(email) {
    const e = normalizeEmail(email)
    if (!e) return false
    if (bouncedSet.has(e)) return true
    if (failedPermSet.has(e)) return true
    if (optOutState.get(e) === true) return true
    return false
  }

  function suppression() {
    const map = new Map()
    for (const [e, on] of optOutState.entries()) {
      if (on) map.set(e, 'optout')
    }
    for (const e of bouncedSet) {
      map.set(e, 'bounce')
    }
    for (const e of failedPermSet) {
      map.set(e, 'permanent_fail')
    }
    return {
      isSuppressed,
      all: () => new Map(map),
      has: (email) => isSuppressed(email),
      size: map.size,
    }
  }

  // Load existing events from monthly files at construction
  function listMonthFiles() {
    try {
      if (!fs.existsSync(dir)) return []
      const entries = fs.readdirSync(dir)
      const months = []
      for (const entry of entries) {
        const m = /^outreach-events-(\d{4}-\d{2})\.jsonl$/.exec(entry)
        if (m) {
          months.push({ month: m[1], file: path.join(dir, entry) })
        }
      }
      months.sort((a, b) => a.month.localeCompare(b.month))
      return months
    } catch {
      return []
    }
  }

  function parseLine(line) {
    const t = line.trim()
    if (!t) return null
    try {
      return JSON.parse(t)
    } catch {
      badLines++
      return null
    }
  }

  function readLinesFromFile(filePath) {
    try {
      if (!fs.existsSync(filePath)) return []
      const content = fs.readFileSync(filePath, 'utf8')
      const lines = content.split('\n')
      const events = []
      for (const line of lines) {
        const ev = parseLine(line)
        if (ev) events.push(ev)
      }
      return events
    } catch {
      return []
    }
  }

  let dirEnsured = false
  function ensureDir() {
    if (!dirEnsured) {
      try {
        ensureDir()
        dirEnsured = true
      } catch {}
    }
  }

  // Initial load
  ensureDir()
  const now = clock()
  const monthFiles = listMonthFiles()
  for (const mf of monthFiles) {
    const fileEvents = readLinesFromFile(mf.file)
    for (const ev of fileEvents) {
      applySuppression(ev)
      applyDistKey(ev)
      if (ev.t && now - ev.t <= NINETY_DAYS_MS) {
        recentEvents.push(ev)
      }
    }
  }
  recentEvents.sort((a, b) => (a.t || 0) - (b.t || 0))

  function append(rawEvent) {
    const t = typeof rawEvent.t === 'number' ? rawEvent.t : clock()
    seq = (seq + 1) % 1000000
    const id = rawEvent.id || `${t.toString(36)}-${seq.toString(36)}-${rand4()}`
    const ev = { ...rawEvent, id, t }

    const mKey = monthKeyOf(t)
    const filePath = fileNameForMonth(dir, mKey)

    const line = JSON.stringify(ev) + '\n'
    ensureDir()
    fs.appendFileSync(filePath, line, 'utf8')

    applySuppression(ev)
    applyDistKey(ev)
    recentEvents.push(ev)

    // Trim recentEvents if it exceeds 90 days from the latest clock
    const cutoff = clock() - NINETY_DAYS_MS
    while (recentEvents.length > 0 && recentEvents[0].t < cutoff) {
      recentEvents.shift()
    }

    return ev
  }

  function read(query = {}) {
    const {
      from,
      to,
      jobId,
      campaignId,
      types,
      email,
      q,
      limit = 50,
      before,
      includeDry = true,
    } = query

    const typeSet = types && types.length ? new Set(types) : null
    const normEmail = email ? normalizeEmail(email) : null
    const search = q ? q.toLowerCase() : null

    // If query requires older events than what is in recentEvents, we can scan files
    let sourceEvents = recentEvents
    if ((from !== undefined && recentEvents.length > 0 && from < recentEvents[0].t) || from === 0) {
      // Need older events: load all available events
      const all = []
      const mFiles = listMonthFiles()
      for (const mf of mFiles) {
        all.push(...readLinesFromFile(mf.file))
      }
      all.sort((a, b) => (a.t || 0) - (b.t || 0))
      sourceEvents = all
    }

    // Filter matching events
    const matched = []
    let reachedBefore = !before

    // Scan backwards (newest to oldest)
    for (let i = sourceEvents.length - 1; i >= 0; i--) {
      const ev = sourceEvents[i]
      if (!reachedBefore) {
        if (ev.id === before) {
          reachedBefore = true
        }
        continue
      }

      if (from !== undefined && ev.t < from) continue
      if (to !== undefined && ev.t > to) continue
      if (!includeDry && ev.dry) continue
      if (jobId && ev.jobId !== jobId) continue
      if (campaignId && ev.campaignId !== campaignId) continue
      if (typeSet && !typeSet.has(ev.type)) continue
      if (normEmail && normalizeEmail(ev.email) !== normEmail) continue
      if (search) {
        const text = `${ev.type} ${ev.email || ''} ${ev.name || ''} ${ev.org || ''} ${ev.detail || ''} ${ev.error || ''}`.toLowerCase()
        if (!text.includes(search)) continue
      }

      matched.push(ev)
      if (matched.length > limit) {
        break
      }
    }

    const hasMore = matched.length > limit
    const events = hasMore ? matched.slice(0, limit) : matched

    return {
      events,
      hasMore,
    }
  }

  function count(predicate) {
    if (typeof predicate !== 'function') return recentEvents.length
    let n = 0
    for (const ev of recentEvents) {
      if (predicate(ev)) n++
    }
    return n
  }

  function recent(limit = 100) {
    return recentEvents.slice(-limit).reverse()
  }

  function stats(options = {}) {
    const from = typeof options.from === 'number' ? options.from : 0
    const to = typeof options.to === 'number' ? options.to : Date.now()
    const jobId = options.jobId
    const campaignId = options.campaignId
    const includeDry = options.includeDry !== undefined ? options.includeDry : false
    const jobsList = Array.isArray(options.jobs) ? options.jobs : []
    const settings = options.settings || {}

    const res = read({ from, to, jobId, campaignId, limit: 100000, includeDry })
    return computeStats(res.events, jobsList, {
      ...options,
      from,
      to,
      jobId,
      campaignId,
      includeDry,
      settings,
      tz: settings.tz || options.tz || 'Asia/Dhaka',
    })
  }

  function close() {
    // No-op for sync append
  }

  return {
    append,
    read,
    suppression,
    distKeyState,
    count,
    recent,
    stats,
    close,
    getBadLinesCount: () => badLines,
  }
}

module.exports = {
  createEventLog,
  monthKeyOf,
}
