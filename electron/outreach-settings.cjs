// ESB Studio — Outreach Settings Manager (electron/outreach-settings.cjs)
// Manages outreach-autopilot.json with strict validation and atomic writes (§1.6, §4.7).

const fs = require('node:fs')
const path = require('node:path')

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/

// The settings that belong to the sending ACCOUNT, not to one PC: both office PCs send from the same Gmail address,
// so its hours, daily limit, gaps, per-organisation limits and cooldown must be the same on both (cloud sync carries
// them, src/outreach/cloudSync.ts). Tray sending, the assistant's autonomy and reading replies stay per PC.
const SHARED_KEYS = ['window', 'dailyLimit', 'ramp', 'pace', 'minDelaySec', 'maxDelaySec', 'domainMaxPerDay', 'domainOverrides', 'domainMinGapSec', 'contactCooldownDays', 'gmailCeiling24h']

const DEFAULT_SETTINGS = {
  window: {
    enabled: true,
    from: '09:00',
    to: '17:00',
    days: [0, 1, 2, 3, 4], // Sun-Thu
    tz: 'Asia/Dhaka',
  },
  // per CALENDAR day in window.tz (resets at local midnight — outreach-schedule.cjs capState)
  dailyLimit: 100,
  ramp: true,
  // one pacing model since 2026-11-02: a random gap between minDelaySec and maxDelaySec. 'auto' ("spread over the
  // hours") is still accepted from an older file or another PC and read as 'manual'.
  pace: 'manual',
  minDelaySec: 180,
  maxDelaySec: 480,
  domainMaxPerDay: 3,
  // per-organisation exceptions to domainMaxPerDay: { 'example.gov.bd': 10 } (domain → emails per calendar day, 1–500)
  domainOverrides: {},
  domainMinGapSec: 20 * 60,
  contactCooldownDays: 30,
  // hard safety under Gmail's real limit (500 a rolling 24 h for a consumer account): however the calendar day resets,
  // never more than this in any 24 h. Not on screen; edit outreach-autopilot.json (50–2000) for a Workspace account.
  gmailCeiling24h: 400,
  traySending: true,
  aiAutonomy: 'suggest',
  aiReadsReply: false,
  autoResume: true,
}

function clone(obj) {
  return JSON.parse(JSON.stringify(obj))
}

function isValidTimeZone(tz) {
  if (typeof tz !== 'string' || !tz.trim()) return false
  try {
    new Intl.DateTimeFormat(undefined, { timeZone: tz })
    return true
  } catch {
    return false
  }
}

/**
 * Validates partial or full settings candidate against §4.7 bounds.
 * Refuses invalid values with the field name.
 * Drops unknown keys and hostile properties.
 *
 * @param {any} input
 * @param {object} currentSettings
 * @returns {{ valid: boolean, error?: string, field?: string, cleaned?: object }}
 */
function validateSettings(input, currentSettings = DEFAULT_SETTINGS, opts = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { valid: false, error: 'Settings input must be an object', field: 'root' }
  }

  // Prevent prototype pollution
  const safe = Object.create(null)
  const allowedKeys = [
    'window',
    'dailyLimit',
    'ramp',
    'pace',
    'minDelaySec',
    'maxDelaySec',
    'domainMaxPerDay',
    'domainOverrides',
    'domainMinGapSec',
    'contactCooldownDays',
    'gmailCeiling24h',
    'traySending',
    'aiAutonomy',
    'aiReadsReply',
    'autoResume',
    'legacyBackfilled',
    'pacingMigrated',
    'sharedUpdatedAt',
  ]

  for (const k of allowedKeys) {
    if (Object.prototype.hasOwnProperty.call(input, k)) {
      safe[k] = input[k]
    }
  }

  const result = clone(currentSettings)

  // 1. window
  if (safe.window !== undefined) {
    if (typeof safe.window !== 'object' || safe.window === null || Array.isArray(safe.window)) {
      return { valid: false, error: 'window must be an object', field: 'window' }
    }

    const curWin = result.window || clone(DEFAULT_SETTINGS.window)
    const win = { ...curWin }

    if (safe.window.enabled !== undefined) {
      if (typeof safe.window.enabled !== 'boolean') {
        return { valid: false, error: 'window.enabled must be boolean', field: 'window.enabled' }
      }
      win.enabled = safe.window.enabled
    }

    if (safe.window.from !== undefined) {
      if (typeof safe.window.from !== 'string' || !TIME_RE.test(safe.window.from)) {
        return { valid: false, error: 'window.from must be in HH:MM format', field: 'window.from' }
      }
      win.from = safe.window.from
    }

    if (safe.window.to !== undefined) {
      if (typeof safe.window.to !== 'string' || !TIME_RE.test(safe.window.to)) {
        return { valid: false, error: 'window.to must be in HH:MM format', field: 'window.to' }
      }
      win.to = safe.window.to
    }

    if (win.from >= win.to) {
      return { valid: false, error: 'window.to must be later than window.from', field: 'window.to' }
    }

    if (safe.window.days !== undefined) {
      if (!Array.isArray(safe.window.days) || safe.window.days.length === 0) {
        return { valid: false, error: 'window.days must be a non-empty array', field: 'window.days' }
      }
      const uniqueDays = new Set()
      for (const d of safe.window.days) {
        if (!Number.isInteger(d) || d < 0 || d > 6) {
          return { valid: false, error: 'window.days must contain integers 0-6', field: 'window.days' }
        }
        uniqueDays.add(d)
      }
      win.days = [...uniqueDays].sort((a, b) => a - b)
    }

    if (safe.window.tz !== undefined) {
      if (!isValidTimeZone(safe.window.tz)) {
        return { valid: false, error: `Invalid time zone: ${safe.window.tz}`, field: 'window.tz' }
      }
      win.tz = safe.window.tz
    }

    result.window = win
  }

  // 2. dailyLimit (10..500)
  if (safe.dailyLimit !== undefined) {
    if (!Number.isInteger(safe.dailyLimit) || safe.dailyLimit < 10 || safe.dailyLimit > 500) {
      return { valid: false, error: 'dailyLimit must be an integer between 10 and 500', field: 'dailyLimit' }
    }
    result.dailyLimit = safe.dailyLimit
  }

  // 3. ramp (boolean)
  if (safe.ramp !== undefined) {
    if (typeof safe.ramp !== 'boolean') {
      return { valid: false, error: 'ramp must be boolean', field: 'ramp' }
    }
    result.ramp = safe.ramp
  }

  // 4. pace ('auto' | 'manual')
  if (safe.pace !== undefined) {
    if (safe.pace !== 'auto' && safe.pace !== 'manual') {
      return { valid: false, error: "pace must be 'auto' or 'manual'", field: 'pace' }
    }
    // 'auto' is migrated: the engine has one model (random gap between the two numbers)
    result.pace = 'manual'
  }

  // 5. minDelaySec & maxDelaySec (30..3600)
  let minD = result.minDelaySec
  let maxD = result.maxDelaySec

  if (safe.minDelaySec !== undefined) {
    if (!Number.isInteger(safe.minDelaySec) || safe.minDelaySec < 30 || safe.minDelaySec > 3600) {
      return { valid: false, error: 'minDelaySec must be an integer between 30 and 3600', field: 'minDelaySec' }
    }
    minD = safe.minDelaySec
  }

  if (safe.maxDelaySec !== undefined) {
    if (!Number.isInteger(safe.maxDelaySec) || safe.maxDelaySec < 30 || safe.maxDelaySec > 3600) {
      return { valid: false, error: 'maxDelaySec must be an integer between 30 and 3600', field: 'maxDelaySec' }
    }
    maxD = safe.maxDelaySec
  }

  if (maxD < minD) {
    return { valid: false, error: 'maxDelaySec must be greater than or equal to minDelaySec', field: 'maxDelaySec' }
  }

  result.minDelaySec = minD
  result.maxDelaySec = maxD

  // 6. domainMaxPerDay (1..50)
  if (safe.domainMaxPerDay !== undefined) {
    if (!Number.isInteger(safe.domainMaxPerDay) || safe.domainMaxPerDay < 1 || safe.domainMaxPerDay > 50) {
      return { valid: false, error: 'domainMaxPerDay must be an integer between 1 and 50', field: 'domainMaxPerDay' }
    }
    result.domainMaxPerDay = safe.domainMaxPerDay
  }

  // 6b. domainOverrides: { domain: 1..500 }, ≤200 entries, plain lower-case domains only
  if (safe.domainOverrides !== undefined) {
    const o = safe.domainOverrides
    if (!o || typeof o !== 'object' || Array.isArray(o)) {
      return { valid: false, error: 'domainOverrides must be an object of domain → emails per day', field: 'domainOverrides' }
    }
    const entries = Object.keys(o)
    if (entries.length > 200) return { valid: false, error: 'domainOverrides can hold at most 200 organisations', field: 'domainOverrides' }
    const clean = Object.create(null)
    for (const k of entries) {
      const dom = String(k).trim().toLowerCase()
      if (dom === '__proto__' || dom === 'constructor' || dom === 'prototype' || dom.length > 253 || !/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(dom)) {
        return { valid: false, error: `domainOverrides: "${String(k).slice(0, 60)}" is not a domain`, field: 'domainOverrides' }
      }
      const v = o[k]
      if (!Number.isInteger(v) || v < 1 || v > 500) {
        return { valid: false, error: `domainOverrides: ${dom} must be an integer between 1 and 500`, field: 'domainOverrides' }
      }
      clean[dom] = v
    }
    result.domainOverrides = { ...clean }
  }

  // 7. domainMinGapSec (0..14400)
  if (safe.domainMinGapSec !== undefined) {
    if (!Number.isInteger(safe.domainMinGapSec) || safe.domainMinGapSec < 0 || safe.domainMinGapSec > 14400) {
      return { valid: false, error: 'domainMinGapSec must be an integer between 0 and 14400', field: 'domainMinGapSec' }
    }
    result.domainMinGapSec = safe.domainMinGapSec
  }

  // 8. contactCooldownDays (7..365)
  if (safe.contactCooldownDays !== undefined) {
    if (!Number.isInteger(safe.contactCooldownDays) || safe.contactCooldownDays < 7 || safe.contactCooldownDays > 365) {
      return {
        valid: false,
        error: 'contactCooldownDays must be an integer between 7 and 365',
        field: 'contactCooldownDays',
      }
    }
    result.contactCooldownDays = safe.contactCooldownDays
  }

  // 8b. gmailCeiling24h (50..2000) — the rolling 24 h safety ceiling
  if (safe.gmailCeiling24h !== undefined) {
    if (!Number.isInteger(safe.gmailCeiling24h) || safe.gmailCeiling24h < 50 || safe.gmailCeiling24h > 2000) {
      return { valid: false, error: 'gmailCeiling24h must be an integer between 50 and 2000', field: 'gmailCeiling24h' }
    }
    result.gmailCeiling24h = safe.gmailCeiling24h
  }

  // 9. traySending (boolean)
  if (safe.traySending !== undefined) {
    if (typeof safe.traySending !== 'boolean') {
      return { valid: false, error: 'traySending must be boolean', field: 'traySending' }
    }
    result.traySending = safe.traySending
  }

  // 10. aiAutonomy ('suggest' | 'confirm' | 'auto-safe')
  if (safe.aiAutonomy !== undefined) {
    if (safe.aiAutonomy !== 'suggest' && safe.aiAutonomy !== 'confirm' && safe.aiAutonomy !== 'auto-safe') {
      return { valid: false, error: "aiAutonomy must be 'suggest', 'confirm', or 'auto-safe'", field: 'aiAutonomy' }
    }
    result.aiAutonomy = safe.aiAutonomy
  }

  // 11. aiReadsReply (boolean)
  if (safe.aiReadsReply !== undefined) {
    if (typeof safe.aiReadsReply !== 'boolean') {
      return { valid: false, error: 'aiReadsReply must be boolean', field: 'aiReadsReply' }
    }
    result.aiReadsReply = safe.aiReadsReply
  }

  // 12. autoResume (boolean)
  if (safe.autoResume !== undefined) {
    if (typeof safe.autoResume !== 'boolean') {
      return { valid: false, error: 'autoResume must be boolean', field: 'autoResume' }
    }
    result.autoResume = safe.autoResume
  }

  // Legacy backfill marker
  if (safe.legacyBackfilled !== undefined) {
    result.legacyBackfilled = !!safe.legacyBackfilled
  }
  // one-time "adopt the Sender dialog's gaps" marker (migratePacingFromMailer)
  if (safe.pacingMigrated !== undefined) {
    result.pacingMigrated = !!safe.pacingMigrated
  }

  // when the settings every PC shares (SHARED_KEYS) last changed: set by the caller when the values come from another
  // PC (cloud sync), else stamped now — but only if one of them really changed, so re-saving the same dialog never
  // makes this PC's copy look newer than another PC's real change
  if (safe.sharedUpdatedAt !== undefined) {
    if (!Number.isFinite(safe.sharedUpdatedAt) || safe.sharedUpdatedAt < 0) {
      return { valid: false, error: 'sharedUpdatedAt must be a time in ms', field: 'sharedUpdatedAt' }
    }
    result.sharedUpdatedAt = Math.round(safe.sharedUpdatedAt)
  } else if (opts.stamp === true && SHARED_KEYS.some((k) => JSON.stringify(result[k]) !== JSON.stringify(currentSettings[k]))) {
    result.sharedUpdatedAt = Date.now()
  }

  return { valid: true, cleaned: result }
}

function createSettingsManager(options = {}) {
  const dir = options.dir || process.cwd()
  const filePath = path.join(dir, 'outreach-autopilot.json')

  let currentSettings = clone(DEFAULT_SETTINGS)

  function ensureDir() {
    fs.mkdirSync(dir, { recursive: true })
  }

  function writeAtomic(settings) {
    ensureDir()
    const tmpPath = `${filePath}.tmp`
    fs.writeFileSync(tmpPath, JSON.stringify(settings, null, 2), 'utf8')
    fs.renameSync(tmpPath, filePath)
  }

  function load() {
    ensureDir()
    if (!fs.existsSync(filePath)) {
      writeAtomic(DEFAULT_SETTINGS)
      currentSettings = clone(DEFAULT_SETTINGS)
      return currentSettings
    }

    try {
      const raw = fs.readFileSync(filePath, 'utf8')
      const parsed = JSON.parse(raw)
      const res = validateSettings(parsed, DEFAULT_SETTINGS)
      if (res.valid && res.cleaned) {
        currentSettings = res.cleaned
        // 2026-11-02 migration: 'auto' pace → 'manual' and the new ceiling key, written back once; every value the
        // editor chose (limit, gaps, hours, days, organisation limits) is kept exactly
        if (parsed && (parsed.pace === 'auto' || parsed.gmailCeiling24h === undefined)) {
          try { writeAtomic(currentSettings) } catch {}
        }
      } else {
        // Fallback to defaults if file is completely corrupt
        currentSettings = clone(DEFAULT_SETTINGS)
      }
    } catch {
      currentSettings = clone(DEFAULT_SETTINGS)
    }

    return currentSettings
  }

  function get() {
    return clone(currentSettings)
  }

  function save(partial) {
    const res = validateSettings(partial, currentSettings, { stamp: true })
    if (!res.valid) {
      return { ok: false, error: res.error || 'Validation failed', field: res.field }
    }

    currentSettings = res.cleaned
    try {
      writeAtomic(currentSettings)
      return { ok: true, settings: clone(currentSettings) }
    } catch (err) {
      return { ok: false, error: err.message || 'Failed to write settings file' }
    }
  }

  function reset() {
    currentSettings = clone(DEFAULT_SETTINGS)
    writeAtomic(currentSettings)
    return clone(currentSettings)
  }

  // Initial load
  load()

  return {
    get,
    save,
    reset,
    load,
    validate: validateSettings,
    DEFAULT_SETTINGS: clone(DEFAULT_SETTINGS),
  }
}

/**
 * One-time move of the pacing the editor typed in the Sender dialog into the Autopilot settings.
 *
 * Until 2026-11-01 the Sender dialog saved "Emails a day" and "Wait at least / at most" to outreach-smtp.json, which
 * the engine never read; the engine used outreach-autopilot.json, whose gaps no screen could edit (the Autopilot
 * dialog only linked to the Sender dialog). So the Sender dialog's numbers are the editor's intent, and they are
 * adopted when they differ — if the smtp file is newer than the autopilot file, or if the autopilot values are still
 * the untouched defaults (an Autopilot save rewrites the whole file, so its time alone says nothing about the gaps).
 * Adopted gaps also mean pace 'manual' ("Fixed gap"): the editor asked for exactly that range. Runs once
 * (pacingMigrated), logs a settings.migrated event, never touches outreach-smtp.json.
 *
 * @returns {{ migrated: boolean, from?: object, to?: object, reason?: string }}
 */
function migratePacingFromMailer({ settings, smtpFile, events = null, fsImpl = fs }) {
  const cur = settings.get()
  if (cur.pacingMigrated) return { migrated: false, reason: 'already' }
  let smtp = null
  let smtpMtime = 0
  let autoMtime = 0
  try {
    smtp = JSON.parse(fsImpl.readFileSync(smtpFile, 'utf8'))
    smtpMtime = fsImpl.statSync(smtpFile).mtimeMs
  } catch {
    smtp = null
  }
  try {
    autoMtime = fsImpl.statSync(path.join(path.dirname(smtpFile), 'outreach-autopilot.json')).mtimeMs
  } catch {
    autoMtime = 0
  }
  const done = (res) => {
    settings.save({ pacingMigrated: true })
    return res
  }
  if (!smtp || typeof smtp !== 'object') return done({ migrated: false, reason: 'no-smtp' })

  const patch = {}
  const from = {}
  const smtpNewer = smtpMtime > autoMtime
  const okDelay = (v) => Number.isInteger(v) && v >= 30 && v <= 3600
  if (okDelay(smtp.minDelaySec) && okDelay(smtp.maxDelaySec) && smtp.maxDelaySec >= smtp.minDelaySec &&
      (smtp.minDelaySec !== cur.minDelaySec || smtp.maxDelaySec !== cur.maxDelaySec)) {
    const untouched = cur.minDelaySec === DEFAULT_SETTINGS.minDelaySec && cur.maxDelaySec === DEFAULT_SETTINGS.maxDelaySec
    if (smtpNewer || untouched) {
      from.minDelaySec = cur.minDelaySec
      from.maxDelaySec = cur.maxDelaySec
      from.pace = cur.pace
      patch.minDelaySec = smtp.minDelaySec
      patch.maxDelaySec = smtp.maxDelaySec
      patch.pace = 'manual'
    }
  }
  if (Number.isInteger(smtp.dailyLimit) && smtp.dailyLimit >= 10 && smtp.dailyLimit <= 500 && smtp.dailyLimit !== cur.dailyLimit) {
    if (smtpNewer || cur.dailyLimit === DEFAULT_SETTINGS.dailyLimit) {
      from.dailyLimit = cur.dailyLimit
      patch.dailyLimit = smtp.dailyLimit
    }
  }
  if (!Object.keys(patch).length) return done({ migrated: false, reason: 'same' })
  const r = settings.save({ ...patch, pacingMigrated: true })
  if (!r.ok) return done({ migrated: false, reason: r.error })
  if (events && typeof events.append === 'function') {
    try {
      // never `to`/`from`: the desk reads `to` as a recipient address (an object there blanked the Activity log)
      events.append({ type: 'settings.migrated', what: 'pacing', before: from, after: patch, source: 'outreach-smtp.json' })
    } catch {}
  }
  return { migrated: true, from, to: patch }
}

module.exports = {
  SHARED_KEYS,
  migratePacingFromMailer,
  createSettingsManager,
  validateSettings,
  DEFAULT_SETTINGS,
}
