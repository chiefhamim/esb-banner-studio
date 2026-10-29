// ESB Studio — Outreach Settings Manager (electron/outreach-settings.cjs)
// Manages outreach-autopilot.json with strict validation and atomic writes (§1.6, §4.7).

const fs = require('node:fs')
const path = require('node:path')

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/

const DEFAULT_SETTINGS = {
  window: {
    enabled: true,
    from: '09:00',
    to: '17:00',
    days: [0, 1, 2, 3, 4], // Sun-Thu
    tz: 'Asia/Dhaka',
  },
  dailyLimit: 100,
  ramp: true,
  pace: 'auto',
  minDelaySec: 180,
  maxDelaySec: 480,
  domainMaxPerDay: 3,
  domainMinGapSec: 20 * 60,
  contactCooldownDays: 30,
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
function validateSettings(input, currentSettings = DEFAULT_SETTINGS) {
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
    'domainMinGapSec',
    'contactCooldownDays',
    'traySending',
    'aiAutonomy',
    'aiReadsReply',
    'autoResume',
    'legacyBackfilled',
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
    result.pace = safe.pace
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
    const res = validateSettings(partial, currentSettings)
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

module.exports = {
  createSettingsManager,
  validateSettings,
  DEFAULT_SETTINGS,
}
