// ESB Studio — Outreach Job Store (electron/outreach-jobs.cjs)
// Manages immutable message definitions (.messages.jsonl) and compact atomic state files (.state.json) (§4.3).

const fs = require('node:fs')
const path = require('node:path')

function uid(prefix = 'job') {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
}

function createJobStore(options = {}) {
  const dir = path.join(options.dir || process.cwd(), 'outreach-jobs')
  const clock = options.clock || (() => Date.now())
  const setTimeoutFn = options.setTimeout || setTimeout
  const clearTimeoutFn = options.clearTimeout || clearTimeout

  // In-memory jobs: id -> job
  const jobs = new Map()
  // Save debounce timers: id -> timer
  const saveTimers = new Map()
  let writeCount = 0

  function messagesPath(jobId) {
    return path.join(dir, `${jobId}.messages.jsonl`)
  }

  function statePath(jobId) {
    return path.join(dir, `${jobId}.state.json`)
  }

  function ensureDir() {
    fs.mkdirSync(dir, { recursive: true })
  }

  function writeAtomicState(job) {
    ensureDir()
    const p = statePath(job.id)
    const tmp = `${p}.tmp`
    const now = clock()

    job.state.savedAt = now
    const payload = JSON.stringify({
      id: job.id,
      campaignId: job.campaignId,
      campaignName: job.campaignName,
      kind: job.kind,
      status: job.status,
      why: job.why || null,
      until: job.until || null,
      reason: job.reason || null,
      dry: !!job.dry,
      total: job.total,
      shared: job.shared,
      attachments: job.attachments,
      startAt: job.startAt,
      autoResume: job.autoResume !== false,
      createdAt: job.createdAt,
      startedAt: job.startedAt || null,
      endedAt: job.endedAt || null,
      state: {
        sent: Array.isArray(job.state.sent) ? job.state.sent : [...(job.state.sent || [])],
        failed: job.state.failed || {},
        skipped: job.state.skipped || {},
        held: Array.isArray(job.state.held) ? job.state.held : [...(job.state.held || [])],
        counters: {
          sent: (job.state.sent && job.state.sent.length) || 0,
          failed: Object.keys(job.state.failed || {}).length,
          skipped: Object.keys(job.state.skipped || {}).length,
        },
        savedAt: now,
      },
    })

    fs.writeFileSync(tmp, payload, 'utf8')
    fs.renameSync(tmp, p)
    writeCount++
  }

  function saveState(job, { force = false } = {}) {
    if (!job || !job.id) return

    if (force) {
      const existingTimer = saveTimers.get(job.id)
      if (existingTimer) {
        clearTimeoutFn(existingTimer)
        saveTimers.delete(job.id)
      }
      writeAtomicState(job)
      return
    }

    if (!saveTimers.has(job.id)) {
      const timer = setTimeoutFn(() => {
        saveTimers.delete(job.id)
        writeAtomicState(job)
      }, 5000)
      saveTimers.set(job.id, timer)
    }
  }

  function create(spec, { dry = false } = {}) {
    ensureDir()
    const id = uid('job')
    const now = clock()

    const rawMessages = Array.isArray(spec.messages) ? spec.messages : []
    const total = rawMessages.length

    // Write immutable messages file (.messages.jsonl)
    const mPath = messagesPath(id)
    const lines = rawMessages.map((m) => JSON.stringify(m)).join('\n') + '\n'
    fs.writeFileSync(mPath, lines, 'utf8')

    const job = {
      id,
      campaignId: spec.campaignId,
      campaignName: spec.campaignName || 'Untitled Campaign',
      kind: spec.kind === 'followup' ? 'followup' : 'first',
      status: 'queued',
      why: null,
      until: null,
      reason: null,
      dry: !!dry,
      total,
      shared: spec.shared || {},
      attachments: Array.isArray(spec.attachments) ? spec.attachments : [],
      startAt: typeof spec.startAt === 'number' ? spec.startAt : null,
      autoResume: spec.autoResume !== false,
      createdAt: now,
      startedAt: null,
      endedAt: null,
      state: {
        sent: [],
        failed: {},
        skipped: {},
        held: [],
        counters: { sent: 0, failed: 0, skipped: 0 },
        savedAt: now,
      },
      // In-memory reference to messages for the engine
      messages: rawMessages,
    }

    jobs.set(id, job)
    writeAtomicState(job)
    return job
  }

  function load() {
    ensureDir()
    jobs.clear()
    const files = fs.readdirSync(dir)

    for (const f of files) {
      if (!f.endsWith('.state.json')) continue
      const sPath = path.join(dir, f)
      try {
        const raw = fs.readFileSync(sPath, 'utf8')
        const data = JSON.parse(raw)
        if (!data || !data.id) continue

        const mPath = messagesPath(data.id)
        let messages = []
        if (fs.existsSync(mPath)) {
          const content = fs.readFileSync(mPath, 'utf8')
          messages = content
            .split('\n')
            .filter((l) => l.trim())
            .map((l) => JSON.parse(l))
        }

        const job = {
          ...data,
          state: {
            sent: data.state?.sent || [],
            failed: data.state?.failed || {},
            skipped: data.state?.skipped || {},
            held: data.state?.held || [],
            counters: data.state?.counters || { sent: 0, failed: 0, skipped: 0 },
            savedAt: data.state?.savedAt || data.createdAt,
          },
          messages,
        }
        jobs.set(job.id, job)
      } catch {
        // Corrupt state file is ignored
      }
    }

    return [...jobs.values()]
  }

  function get(id) {
    return jobs.get(id) || null
  }

  function list() {
    return [...jobs.values()]
  }

  function messages(id) {
    const job = jobs.get(id)
    if (job && job.messages && job.messages.length) {
      return job.messages
    }

    const mPath = messagesPath(id)
    if (!fs.existsSync(mPath)) return []
    try {
      return fs
        .readFileSync(mPath, 'utf8')
        .split('\n')
        .filter((l) => l.trim())
        .map((l) => JSON.parse(l))
    } catch {
      return []
    }
  }

  function remove(id) {
    const job = jobs.get(id)
    if (job) {
      jobs.delete(id)
      const t = saveTimers.get(id)
      if (t) {
        clearTimeoutFn(t)
        saveTimers.delete(id)
      }
    }
    try {
      const s = statePath(id)
      const m = messagesPath(id)
      if (fs.existsSync(s)) fs.unlinkSync(s)
      if (fs.existsSync(m)) fs.unlinkSync(m)
    } catch {}
  }

  return {
    create,
    load,
    get,
    list,
    messages,
    saveState,
    remove,
    getWriteCount: () => writeCount,
  }
}

module.exports = {
  createJobStore,
  uid,
}
