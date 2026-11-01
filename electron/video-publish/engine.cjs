// ESB Studio — Video publishing: the publish job engine (main process only).
//
// THE APPROVE GATE (VIDEO_PRO_PLAN non-negotiable 3). A job runs only with an approval token that THIS process
// issued for that exact render (SHA-256 of the file, computed here, never taken from the renderer) and that exact
// metadata (hash of title, text, destinations, schedule, media facts). Tokens are random, single use, short-lived
// and kept in memory only. `approve()` additionally waits for `confirmApproval(summary)` — in the app a native
// main-process dialog — so a hostile renderer cannot mint one by calling the IPC on its own. A job whose render
// changed after approval is refused when it runs.
//
// IDEMPOTENCY. Each destination has an upload key. Its platform state (YouTube session URI, Facebook video id /
// upload session / handle) is persisted after every step and chunk, so a retry or a restart RESUMES, never starts
// over. Where the last answer may have been lost (a finished upload, a finish/publish call), the platform is asked
// first (session status, uploads by title, publishing phase) before anything is sent again. A ledger keyed by
// upload key records every post with its URL.
//
// Job state (userData/video-publish-jobs.json, temp + rename) survives a restart; `resumeAll()` carries on.
'use strict'
const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')
const { PublishError } = require('./http.cjs')
const { createDailyQuota, createMovingWindow } = require('./guards.cjs')

const KINDS = new Set(['youtube', 'facebook_reel', 'facebook_video'])
const TERMINAL = new Set(['done', 'cancelled'])
const MAX_JOBS = 200
const MAX_SRT = 1024 * 1024

/** Stable JSON: object keys sorted, so the same fields always hash the same. */
function canonical(v) {
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`
  if (v && typeof v === 'object') return `{${Object.keys(v).sort().filter((k) => v[k] !== undefined).map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}`
  return JSON.stringify(v ?? null)
}
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex')

function hashFile(file) {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash('sha256')
    fs.createReadStream(file).on('error', reject).on('data', (d) => h.update(d)).on('end', () => resolve(h.digest('hex')))
  })
}

function imageMime(buf) {
  if (buf.length > 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'image/png'
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg'
  return null
}

/** The fields an approval covers, cleaned to plain values. Throws on anything malformed. */
function normalizeRequest(input) {
  const i = input && typeof input === 'object' ? input : {}
  const m = i.metadata && typeof i.metadata === 'object' ? i.metadata : {}
  const str = (v, max) => (v == null ? '' : String(v).slice(0, max))
  const metadata = {
    title: str(m.title, 300),
    description: str(m.description, 70000),
    tags: Array.isArray(m.tags) ? m.tags.slice(0, 60).map((t) => str(t, 120)) : [],
    categoryId: str(m.categoryId || '25', 4),
    defaultLanguage: str(m.defaultLanguage, 20),
    link: str(m.link, 2000),
    aiVoice: !!m.aiVoice,
    thumbnailPath: m.thumbnailPath ? str(m.thumbnailPath, 4096) : '',
    captionsSrt: str(m.captionsSrt, MAX_SRT + 1),
    captionLanguage: str(m.captionLanguage, 20),
    facebookTitle: str(m.facebookTitle, 300),
    facebookDescription: m.facebookDescription == null ? undefined : str(m.facebookDescription, 70000),
  }
  if (metadata.captionsSrt.length > MAX_SRT) throw new PublishError('The captions file is too large.')
  if (metadata.link && !/^https:\/\/[^\s]+$/.test(metadata.link)) throw new PublishError('The article link must be an https address.')
  const dests = Array.isArray(i.destinations) ? i.destinations : []
  if (!dests.length || dests.length > 3) throw new PublishError('Choose one to three destinations.')
  const destinations = dests.map((d) => {
    const kind = String(d?.kind ?? '')
    if (!KINDS.has(kind)) throw new PublishError(`Unknown destination "${kind}".`)
    if (kind === 'youtube') return { kind, privacyStatus: ['private', 'unlisted', 'public'].includes(d.privacyStatus) ? d.privacyStatus : 'private' }
    return { kind, postState: ['PUBLISHED', 'SCHEDULED', 'DRAFT'].includes(d.state) ? d.state : 'DRAFT' }
  })
  if (new Set(destinations.map((d) => d.kind)).size !== destinations.length) throw new PublishError('Each destination may appear once.')
  const at = i.schedule?.at ? new Date(Date.parse(String(i.schedule.at))) : null
  if (at && !Number.isFinite(at.getTime())) throw new PublishError('The scheduled time is not a date.')
  const schedule = { at: at ? at.toISOString() : null }
  const facts = i.facts && typeof i.facts === 'object' ? JSON.parse(JSON.stringify(i.facts)) : {}
  return { metadata, destinations, schedule, facts }
}

const youtubeMeta = (job, d) => ({ title: job.metadata.title, description: job.metadata.description, tags: job.metadata.tags, categoryId: job.metadata.categoryId, defaultLanguage: job.metadata.defaultLanguage, privacyStatus: d.privacyStatus, publishAt: job.schedule.at, aiVoice: job.metadata.aiVoice })
const facebookMeta = (job, d) => ({ state: job.schedule.at && d.postState !== 'DRAFT' ? 'SCHEDULED' : d.postState, scheduledAt: job.schedule.at, description: job.metadata.facebookDescription ?? job.metadata.description, aiVoice: job.metadata.aiVoice })

/** Every problem the platform rules find in this request (validators.mjs), or []. */
function planProblems(v, req, now) {
  const out = []
  for (const d of req.destinations) {
    if (d.kind === 'youtube') {
      const media = v.validateYouTubeMedia(req.facts)
      const meta = v.buildYouTubeResource(youtubeMeta(req, d), now)
      out.push(...media.problems.map((p) => ({ destination: d.kind, ...p })), ...meta.problems.map((p) => ({ destination: d.kind, ...p })))
    } else {
      if (d.kind === 'facebook_reel') out.push(...v.validateReel(req.facts).problems.map((p) => ({ destination: d.kind, ...p })))
      out.push(...v.checkFacebookPost(facebookMeta(req, d), now).problems.map((p) => ({ destination: d.kind, ...p })))
    }
  }
  return out
}

const STEPS = {
  youtube: (m) => ['upload', ...(m.thumbnailPath ? ['thumbnail'] : []), ...(m.captionsSrt ? ['captions'] : [])],
  facebook_reel: (m) => ['start', 'upload', 'processing', 'finish', ...(m.link ? ['comment'] : [])],
  facebook_video: (m) => ['session', 'upload', 'publish', ...(m.link ? ['comment'] : [])],
}

function createPublishEngine({
  dir, credentials, youtube, facebook, validators, confirmApproval,
  clock = () => Date.now(), randomBytes = crypto.randomBytes, onUpdate = () => {},
  config = {}, dryRun = false,
}) {
  if (typeof confirmApproval !== 'function') throw new Error('The publish engine needs confirmApproval (the owner\'s Approve step)')
  const cfg = { ytDailyUploads: 100, reelsPer24h: 30, approvalTtlMs: 30 * 60_000, metaAppId: '', ...config }
  const tag = dryRun ? '.dryrun' : ''
  const jobsFile = path.join(dir, `video-publish-jobs${tag}.json`)
  const ledgerFile = path.join(dir, `video-publish-ledger${tag}.json`)
  const ytQuota = createDailyQuota({ file: path.join(dir, `video-publish-yt-quota${tag}.json`), limit: cfg.ytDailyUploads, clock })
  const reels = createMovingWindow({ file: path.join(dir, `video-publish-reels${tag}.json`), limit: cfg.reelsPer24h, clock })
  const approvals = new Map()
  const running = new Map()
  const controllers = new Map()
  const redact = (s) => (credentials?.redact ? credentials.redact(s) : String(s))

  const readJson = (f, fb) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')) } catch { return fb } }
  const writeJson = (f, v) => { fs.mkdirSync(dir, { recursive: true }); const tmp = `${f}.${process.pid}.tmp`; fs.writeFileSync(tmp, JSON.stringify(v)); fs.renameSync(tmp, f) }
  let jobs = (readJson(jobsFile, { jobs: [] }).jobs || []).filter((j) => j && j.id)
  const ledger = () => readJson(ledgerFile, {})

  function publicJob(j) {
    return {
      id: j.id, createdAt: j.createdAt, status: j.status, renderHash: j.renderHash, renderPath: j.renderPath, dryRun: !!j.dryRun,
      title: j.metadata.title, schedule: j.schedule,
      destinations: j.destinations.map((d) => ({ kind: d.kind, uploadKey: d.uploadKey, state: d.state, error: d.error || null, sent: d.sent || 0, total: d.total || 0, steps: d.steps, result: d.result || null })),
    }
  }
  function save(j) {
    if (j) j.updatedAt = clock()
    jobs = jobs.slice(-MAX_JOBS)
    writeJson(jobsFile, { v: 1, jobs })
    if (j) { try { onUpdate(publicJob(j)) } catch { /* a listener never breaks a job */ } }
  }
  const find = (id) => jobs.find((j) => j.id === id) || null
  const step = (d, name) => d.steps.find((s) => s.name === name)
  const setStep = (j, d, name, status, error = null) => {
    const s = step(d, name)
    if (s) { s.status = status; s.error = error ? redact(error) : null; s.at = clock() }
    save(j)
  }
  const isDone = (d, name) => step(d, name)?.status === 'done'

  // ---------------------------------------------------------------- the gate
  /**
   * The Publish sheet's Approve. `input` = { renderPath, renderHash?, metadata, destinations, schedule, facts }.
   * renderPath is resolved by the IPC layer from a project id + renders/<name>; never trusted as a hash.
   */
  async function approve(input) {
    const req = normalizeRequest(input)
    const renderPath = String(input?.renderPath ?? '')
    if (!renderPath || !fs.existsSync(renderPath)) throw new PublishError('The render to publish was not found.')
    const renderHash = await hashFile(renderPath)
    if (input.renderHash && input.renderHash !== renderHash) throw new PublishError('The render on disk is not the one shown for approval. Render it again and review it.')
    const problems = planProblems(validators, req, clock())
    if (problems.length) return { ok: false, problems }
    const metadataHash = sha256(canonical(req))
    const confirmed = await confirmApproval({ renderPath, renderHash, title: req.metadata.title, destinations: req.destinations, schedule: req.schedule, aiVoice: req.metadata.aiVoice, dryRun })
    if (confirmed !== true) return { ok: false, cancelled: true }
    const approvalToken = randomBytes(32).toString('hex')
    const expiresAt = clock() + cfg.approvalTtlMs
    approvals.set(approvalToken, { renderHash, metadataHash, expiresAt })
    return { ok: true, approvalToken, renderHash, metadataHash, expiresAt }
  }

  /** Create a job from an approved request. Refuses without a valid, unused token for this exact render + metadata. */
  async function submit(input) {
    const token = typeof input?.approvalToken === 'string' ? input.approvalToken : ''
    const a = token ? approvals.get(token) : null
    if (!a) throw new PublishError('This post has not been approved. Press Approve in the Publish sheet.', { kind: 'unapproved' })
    approvals.delete(token)
    if (a.expiresAt < clock()) throw new PublishError('The approval has expired. Review the post and press Approve again.', { kind: 'unapproved' })
    const req = normalizeRequest(input)
    if (sha256(canonical(req)) !== a.metadataHash) throw new PublishError('The post changed after it was approved. Review it and press Approve again.', { kind: 'unapproved' })
    const renderPath = String(input?.renderPath ?? '')
    const renderHash = renderPath && fs.existsSync(renderPath) ? await hashFile(renderPath) : ''
    if (renderHash !== a.renderHash) throw new PublishError('The render changed after it was approved. Review it and press Approve again.', { kind: 'unapproved' })
    const id = randomBytes(12).toString('hex')
    const total = fs.statSync(renderPath).size
    const job = {
      id, createdAt: clock(), status: 'queued', dryRun, renderPath, renderHash, metadataHash: a.metadataHash, approvedAt: clock(),
      ...req,
      destinations: req.destinations.map((d) => ({
        ...d, uploadKey: sha256(`${id}|${d.kind}|${renderHash}`).slice(0, 24), state: 'queued', error: null, sent: 0, total,
        steps: STEPS[d.kind](req.metadata).map((name) => ({ name, status: 'pending', error: null, at: null })),
        p: {}, result: null,
      })),
    }
    jobs.push(job)
    save(job)
    return publicJob(job)
  }

  // ---------------------------------------------------------------- running
  function recordPost(j, d, result) {
    const l = ledger()
    l[d.uploadKey] = { kind: d.kind, jobId: j.id, title: j.metadata.title, ...result, at: clock() }
    writeJson(ledgerFile, l)
  }

  async function runYouTube(j, d, signal) {
    const meta = youtubeMeta(j, d)
    const built = validators.buildYouTubeResource(meta, Math.min(clock(), j.approvedAt))
    if (!built.resource) throw new PublishError(built.problems.map((p) => p.message).join(' '))
    if (built.resource.status.publishAt && Date.parse(built.resource.status.publishAt) <= clock()) throw new PublishError('The scheduled time has passed. Choose a new time and approve again.')
    const p = d.p
    if (!d.result && !isDone(d, 'upload')) {
      setStep(j, d, 'upload', 'running')
      let sessionsThisRun = 0
      while (!d.result) {
        if (!p.sessionUri) {
          if (p.sessionsCreated > 0) {
            // a session existed and is gone: did the video land before it went?
            const found = await youtube.findRecentUpload({ title: built.resource.snippet.title, since: p.firstSessionAt, signal })
            if (found?.id) { d.result = { videoId: found.id }; break }
          }
          if (++sessionsThisRun > 3) throw new PublishError('YouTube kept ending the upload session. Try again later.')
          ytQuota.check()
          const uri = await youtube.startSession({ fileSize: d.total, mime: 'video/mp4', resource: built.resource, signal })
          ytQuota.record()
          p.sessionUri = uri
          p.sessionsCreated = (p.sessionsCreated || 0) + 1
          p.firstSessionAt ??= clock()
          d.sent = 0
          save(j)
        } else {
          const st = await youtube.queryStatus(p.sessionUri, d.total, signal)
          if (st.state === 'complete') { d.result = { videoId: st.video?.id }; break }
          if (st.state === 'expired') { p.sessionUri = null; save(j); continue }
          d.sent = st.offset
        }
        try {
          const video = await youtube.upload({ sessionUri: p.sessionUri, filePath: j.renderPath, fileSize: d.total, offset: d.sent, signal, onProgress: (n) => { d.sent = n; save(j) } })
          d.result = { videoId: video?.id }
        } catch (e) {
          if (e.kind === 'expired') { p.sessionUri = null; save(j); continue }
          throw e
        }
      }
      if (!d.result?.videoId) throw new PublishError('YouTube finished the upload without a video id.')
      d.result.url = `https://youtu.be/${d.result.videoId}`
      d.sent = d.total
      recordPost(j, d, d.result)
      setStep(j, d, 'upload', 'done')
    }
    const errors = []
    if (step(d, 'thumbnail') && !isDone(d, 'thumbnail')) {
      try {
        setStep(j, d, 'thumbnail', 'running')
        const bytes = fs.readFileSync(j.metadata.thumbnailPath)
        const mime = imageMime(bytes)
        if (!mime) throw new PublishError('The thumbnail must be a PNG or JPEG image.')
        await youtube.setThumbnail({ videoId: d.result.videoId, bytes, mime, signal })
        setStep(j, d, 'thumbnail', 'done')
      } catch (e) { if (e.kind === 'stopped') throw e; setStep(j, d, 'thumbnail', 'failed', e.message); errors.push(e.message) }
    }
    if (step(d, 'captions') && !isDone(d, 'captions')) {
      try {
        setStep(j, d, 'captions', 'running')
        await youtube.insertCaption({ videoId: d.result.videoId, srt: j.metadata.captionsSrt, language: j.metadata.captionLanguage || j.metadata.defaultLanguage || 'en', name: '', signal })
        setStep(j, d, 'captions', 'done')
      } catch (e) { if (e.kind === 'stopped') throw e; setStep(j, d, 'captions', 'failed', e.message); errors.push(e.message) }
    }
    if (errors.length) throw new PublishError(`The video is on YouTube, but: ${errors.join(' ')}`)
  }

  async function commentStep(j, d, objectId, state, signal) {
    if (!step(d, 'comment') || isDone(d, 'comment')) return
    if (state !== 'PUBLISHED') { setStep(j, d, 'comment', 'waiting', 'The link comment is added once the post is live.'); return }
    try {
      setStep(j, d, 'comment', 'running')
      await facebook.waitFor(d.p.videoId || objectId, { untilReady: true, signal })
      await facebook.comment({ objectId, message: `Full story: ${j.metadata.link}`, signal })
      setStep(j, d, 'comment', 'done')
    } catch (e) {
      if (e.kind === 'stopped') throw e
      if (e.kind === 'pending') { setStep(j, d, 'comment', 'waiting', e.message); return }
      setStep(j, d, 'comment', 'failed', e.message)
      throw new PublishError(`The video is posted, but the link comment failed: ${e.message}`)
    }
  }

  async function runReel(j, d, signal) {
    const fm = validators.checkFacebookPost(facebookMeta(j, d), Math.min(clock(), j.approvedAt))
    if (!fm.ok) throw new PublishError(fm.problems.map((x) => x.message).join(' '))
    if (fm.state === 'SCHEDULED' && fm.scheduledTime * 1000 - clock() < 10 * 60_000) throw new PublishError('The scheduled time is now less than 10 minutes away. Choose a new time and approve again.')
    const { pageId } = credentials.facebook() || {}
    const p = d.p
    if (!p.videoId) {
      setStep(j, d, 'start', 'running')
      reels.check(pageId)
      p.videoId = await facebook.reelStart(signal)
      save(j)
    }
    if (!isDone(d, 'start')) setStep(j, d, 'start', 'done')
    if (!isDone(d, 'upload')) {
      setStep(j, d, 'upload', 'running')
      await facebook.reelUpload({ videoId: p.videoId, filePath: j.renderPath, fileSize: d.total, signal, onProgress: (n) => { d.sent = n; save(j) } })
      d.sent = d.total
      setStep(j, d, 'upload', 'done')
    }
    if (!isDone(d, 'processing')) {
      setStep(j, d, 'processing', 'running')
      await facebook.waitFor(p.videoId, { signal })
      setStep(j, d, 'processing', 'done')
    }
    if (!isDone(d, 'finish')) {
      setStep(j, d, 'finish', 'running')
      let already = false
      if (p.finishSent) already = await facebook.reelFinished(p.videoId, signal)
      if (!already) {
        reels.check(pageId)
        p.finishSent = true
        save(j)
        try {
          const r = await facebook.reelFinish({ videoId: p.videoId, state: fm.state, description: facebookMeta(j, d).description, scheduledTime: fm.scheduledTime, signal })
          p.postId = r.postId
        } catch (e) {
          // the answer was lost: ask Facebook whether it went through before anything is sent again
          if (!e.retryable || !(await facebook.reelFinished(p.videoId, signal))) throw e
        }
      }
      reels.record(pageId)
      d.result = { videoId: p.videoId, postId: p.postId || null, state: fm.state, url: `https://www.facebook.com/reel/${p.videoId}` }
      recordPost(j, d, d.result)
      setStep(j, d, 'finish', 'done')
    }
    await commentStep(j, d, p.postId || p.videoId, fm.state, signal)
  }

  async function runFeedVideo(j, d, signal) {
    const fm = validators.checkFacebookPost(facebookMeta(j, d), Math.min(clock(), j.approvedAt))
    if (!fm.ok) throw new PublishError(fm.problems.map((x) => x.message).join(' '))
    if (fm.state === 'SCHEDULED' && fm.scheduledTime * 1000 - clock() < 10 * 60_000) throw new PublishError('The scheduled time is now less than 10 minutes away. Choose a new time and approve again.')
    const p = d.p
    const title = j.metadata.facebookTitle || j.metadata.title
    if (!p.uploadId) {
      setStep(j, d, 'session', 'running')
      p.uploadId = await facebook.feedSession({ appId: cfg.metaAppId, fileName: path.basename(j.renderPath), fileSize: d.total, signal })
      save(j)
    }
    if (!isDone(d, 'session')) setStep(j, d, 'session', 'done')
    if (!p.handle) {
      setStep(j, d, 'upload', 'running')
      p.handle = await facebook.feedUpload({ uploadId: p.uploadId, filePath: j.renderPath, fileSize: d.total, signal, onProgress: (n) => { d.sent = n; save(j) } })
      d.sent = d.total
      setStep(j, d, 'upload', 'done')
    }
    if (!p.videoId) {
      setStep(j, d, 'publish', 'running')
      if (p.publishSent) p.videoId = await facebook.findRecent({ kind: 'video', title, since: j.createdAt, signal })
      if (!p.videoId) {
        p.publishSent = true
        save(j)
        try {
          p.videoId = await facebook.feedPublish({ handle: p.handle, title, description: facebookMeta(j, d).description, state: fm.state, scheduledTime: fm.scheduledTime, signal })
        } catch (e) {
          if (!e.retryable) throw e
          p.videoId = await facebook.findRecent({ kind: 'video', title, since: j.createdAt, signal })
          if (!p.videoId) throw e
        }
      }
      d.result = { videoId: p.videoId, state: fm.state, url: `https://www.facebook.com/${pageIdOf()}/videos/${p.videoId}` }
      recordPost(j, d, d.result)
      setStep(j, d, 'publish', 'done')
    }
    await commentStep(j, d, p.videoId, fm.state, signal)
  }
  const pageIdOf = () => credentials.facebook()?.pageId || ''

  /** Run (or resume) a job. Resolves to its public state; never rejects for a platform failure (the job is red). */
  function run(id) {
    if (running.has(id)) return running.get(id)
    const j = find(id)
    if (!j) return Promise.reject(new PublishError('No such publish job.'))
    if (TERMINAL.has(j.status)) return Promise.resolve(publicJob(j))
    if (!j.approvedAt || !j.metadataHash) return Promise.reject(new PublishError('This job was never approved.', { kind: 'unapproved' }))
    const ctl = new AbortController()
    controllers.set(id, ctl)
    const p = (async () => {
      j.status = 'running'
      save(j)
      let renderOk = true
      try {
        if ((await hashFile(j.renderPath)) !== j.renderHash) renderOk = false
      } catch { renderOk = false }
      for (const d of j.destinations) {
        if (TERMINAL.has(d.state)) continue
        if (!renderOk) { d.state = 'failed'; d.error = 'The render file changed or is missing since it was approved. Nothing was sent.'; continue }
        d.state = 'running'
        d.error = null
        save(j)
        try {
          if (d.kind === 'youtube') await runYouTube(j, d, ctl.signal)
          else if (d.kind === 'facebook_reel') await runReel(j, d, ctl.signal)
          else await runFeedVideo(j, d, ctl.signal)
          d.state = 'done'
        } catch (e) {
          const stopped = e?.kind === 'stopped' || ctl.signal.aborted
          d.state = ctl.signal.reason === 'cancel' ? 'cancelled' : stopped ? 'paused' : 'failed'
          d.error = stopped ? null : redact(e?.message || String(e))
          const s = d.steps.find((x) => x.status === 'running')
          if (s) { s.status = stopped ? 'pending' : 'failed'; s.error = d.error }
        }
        save(j)
        if (ctl.signal.aborted) break
      }
      const states = j.destinations.map((d) => d.state)
      j.status = states.every((s) => s === 'done') ? 'done'
        : ctl.signal.reason === 'cancel' ? 'cancelled'
          : states.includes('failed') ? 'failed'
            : states.some((s) => s === 'paused' || s === 'running' || s === 'queued') ? 'paused' : 'done'
      save(j)
      return publicJob(j)
    })().finally(() => { running.delete(id); controllers.delete(id) })
    running.set(id, p)
    return p
  }

  /** Retry the failed destinations of a job, from where each stopped. */
  function retry(id) {
    const j = find(id)
    if (!j) throw new PublishError('No such publish job.')
    if (running.has(id)) return running.get(id)
    for (const d of j.destinations) {
      if (d.state === 'failed' || d.state === 'paused') {
        d.state = 'queued'
        d.error = null
        for (const s of d.steps) if (s.status === 'failed' || s.status === 'running') { s.status = 'pending'; s.error = null }
      }
    }
    j.status = 'queued'
    save(j)
    return run(id)
  }

  /** Stop a job for good. Anything already on a platform stays there (a scheduled post is removed in the app's next step). */
  async function cancel(id) {
    const j = find(id)
    if (!j) throw new PublishError('No such publish job.')
    const ctl = controllers.get(id)
    if (ctl) { ctl.abort('cancel'); await running.get(id)?.catch(() => {}) }
    for (const d of j.destinations) if (d.state !== 'done') d.state = 'cancelled'
    j.status = 'cancelled'
    save(j)
    return publicJob(j)
  }

  /** Pause every running job (app quit); `resumeAll()` carries on next launch. */
  async function stopAll() {
    for (const ctl of controllers.values()) ctl.abort('stop')
    await Promise.allSettled([...running.values()])
  }
  function resumeAll() {
    return jobs.filter((j) => ['queued', 'running', 'paused'].includes(j.status)).map((j) => run(j.id))
  }

  function status() {
    const fb = credentials.facebook?.()
    return { dryRun, ytUploadsToday: ytQuota.used(), ytDailyLimit: cfg.ytDailyUploads, reels24h: fb?.pageId ? reels.used(fb.pageId) : 0, reelsLimit: cfg.reelsPer24h }
  }

  return {
    approve, submit, run, retry, cancel, stopAll, resumeAll, status,
    list: () => jobs.map(publicJob),
    get: (id) => { const j = find(id); return j ? publicJob(j) : null },
    ledger,
  }
}

module.exports = { createPublishEngine, canonical, normalizeRequest, hashFile, planProblems }
