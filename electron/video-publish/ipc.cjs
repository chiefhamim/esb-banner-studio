// Phase 7: the IPC for publishing, checked in main as if the renderer were hostile.
//  - The renderer names a render by id (video-renders.cjs); main maps it to the file it wrote itself.
//  - A thumbnail is bytes (a real JPEG or PNG, small) that main writes itself; the renderer never names a path.
//  - Approving is a native dialog in main: the renderer cannot press it. Nothing is posted without that answer.
//  - Nothing returned carries a secret (credentials.status()).
'use strict'
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')

const MAX_THUMB = 2 * 1024 * 1024
const MAX_READ = 8 * 1024 * 1024
const isImage = (b) => b.length > 12 && ((b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) || (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47))
const isBytes = (b) => b instanceof Uint8Array

/** The text of the native Approve dialog: exactly what will be posted, where, and when. */
function approvalText(s) {
  const where = (s.destinations || []).map((d) => (d.kind === 'youtube' ? `YouTube (${d.privacyStatus})` : d.kind === 'facebook_reel' ? `Facebook Reel (${d.postState})` : `Facebook video (${d.postState})`)).join(', ')
  const when = s.schedule?.at ? `Goes out at ${new Date(s.schedule.at).toLocaleString()}` : 'Goes out as soon as the upload finishes (private or draft where you chose it)'
  return {
    message: `Post “${s.title}”?`,
    detail: [`Where: ${where}`, when, s.aiVoice ? 'This video uses an AI voice and says so.' : '', s.dryRun ? 'TEST RUN: nothing leaves this PC.' : '', `File: ${path.basename(s.renderPath)}`].filter(Boolean).join('\n'),
  }
}

function registerVideoPublishIpc({ ipcMain, dialog, shell, app, safeStorage, getWindow, renders, createPublishing, onUpdate }) {
  let vpPromise = null
  const dir = () => app.getPath('userData')
  const thumbsDir = () => path.join(dir(), 'video-publish', 'thumbs')

  const confirmApproval = async (s) => {
    const win = getWindow()
    const t = approvalText(s)
    const r = await dialog.showMessageBox(win && !win.isDestroyed() ? win : undefined, {
      type: 'question',
      title: 'Approve this post',
      message: t.message,
      detail: t.detail,
      buttons: ['Cancel', 'Approve and post'],
      defaultId: 0, // Enter cancels; approving takes a deliberate click
      cancelId: 0,
      noLink: true,
    })
    return r.response === 1
  }

  // the one setting that is not a secret: the Meta app id feed-video uploads need (Reels do not). Kept in a small file.
  const configFile = () => path.join(dir(), 'video-publish', 'config.json')
  const readConfig = () => { try { const c = JSON.parse(fs.readFileSync(configFile(), 'utf8')); return /^\d{5,30}$/.test(String(c?.metaAppId ?? '')) ? { metaAppId: String(c.metaAppId) } : {} } catch { return {} } }
  // what the renderer may see of a job: never the path of the file on disk, only its name
  const pub = (j) => { if (!j) return j; const { renderPath, ...rest } = j; return { ...rest, file: renderPath ? path.basename(renderPath) : '' } }
  const vp = () => (vpPromise ??= createPublishing({ dir: dir(), safeStorage, openExternal: (u) => shell.openExternal(u), confirmApproval, onUpdate: (j) => onUpdate(pub(j)), config: readConfig() }))
  const handle = (channel, fn) => ipcMain.handle(channel, async (_e, ...args) => {
    try { return await fn(...args) } catch (e) { return { ok: false, error: String(e?.message || e).slice(0, 600) } }
  })

  const statusOf = async () => { const p = await vp(); return { ok: true, credentials: p.credentials.status(), engine: p.engine.status(), dryRun: p.dryRun } }
  const str = (v, max) => (typeof v === 'string' ? v.slice(0, max) : '')

  handle('esb:vpub-status', statusOf)
  handle('esb:vpub-yt-client', async (input) => { const p = await vp(); p.credentials.saveYouTubeClient({ clientId: str(input?.clientId, 300), clientSecret: str(input?.clientSecret, 300) }); return statusOf() })
  handle('esb:vpub-yt-connect', async (input) => { const p = await vp(); await p.connectYouTube({ captions: input?.captions === true }); return statusOf() })
  handle('esb:vpub-forget', async (kind) => { const p = await vp(); if (!['youtube', 'youtube-client', 'facebook'].includes(kind)) throw new Error('Unknown connection'); p.credentials.forget(kind); return statusOf() })
  handle('esb:vpub-fb-use-page', async (input) => { const p = await vp(); p.credentials.saveFacebook({ pageId: str(input?.pageId, 40), token: str(input?.token, 1200), pageName: str(input?.pageName, 200) }); return statusOf() })

  handle('esb:vpub-config', async (input) => {
    const id = str(input?.metaAppId, 40).trim()
    if (id && !/^\d{5,30}$/.test(id)) throw new Error('A Meta app ID is only digits.')
    const p = await vp()
    if (p.engine.status().running) throw new Error('A post is uploading. Change this when it has finished.')
    fs.mkdirSync(path.dirname(configFile()), { recursive: true })
    fs.writeFileSync(configFile(), JSON.stringify(id ? { metaAppId: id } : {}))
    vpPromise = null // the engine is made again with the new setting
    return { ok: true, metaAppId: id || null }
  })
  handle('esb:vpub-config-get', async () => ({ ok: true, metaAppId: readConfig().metaAppId ?? null }))
  handle('esb:vpub-renders', async () => ({ ok: true, renders: renders.list() }))
  // the renderer reads a registered render in pieces (to read its facts with the same demuxer the app uses); main bounds every read
  ipcMain.handle('esb:vpub-render-read', async (_e, id, start, end) => {
    try {
      const f = renders.pathOf(id)
      if (!f) return { ok: false, error: 'That file is not there any more.' }
      if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end <= start || end - start > MAX_READ) return { ok: false, error: 'Bad read.' }
      const size = fs.statSync(f).size
      const to = Math.min(end, size)
      if (start >= size) return { ok: false, error: 'Past the end of the file.' }
      const fd = fs.openSync(f, 'r')
      try {
        const buf = Buffer.alloc(to - start)
        let off = 0
        while (off < buf.length) { const n = fs.readSync(fd, buf, off, buf.length - off, start + off); if (!n) break; off += n }
        return new Uint8Array(buf.buffer, buf.byteOffset, off)
      } finally { fs.closeSync(fd) }
    } catch (e) { return { ok: false, error: String(e?.message || e).slice(0, 300) } }
  })
  handle('esb:vpub-render-show', async (id) => { const f = renders.pathOf(id); if (!f) throw new Error('That file is not there any more.'); shell.showItemInFolder(f); return { ok: true } })

  // the request the renderer may make: a render by id, text, a few choices, facts about the file, an optional thumbnail
  async function request(input) {
    const renderPath = renders.pathOf(input?.renderId)
    if (!renderPath) throw new Error('The render to publish was not found. Render it again.')
    let thumbnailPath = ''
    if (input?.thumbnail != null) {
      const b = input.thumbnail
      if (!isBytes(b) || b.length > MAX_THUMB || !isImage(b)) throw new Error('The thumbnail must be a JPEG or PNG under 2 MB.')
      fs.mkdirSync(thumbsDir(), { recursive: true })
      const name = crypto.createHash('sha256').update(b).digest('hex').slice(0, 24) + (b[0] === 0x89 ? '.png' : '.jpg')
      thumbnailPath = path.join(thumbsDir(), name)
      if (!fs.existsSync(thumbnailPath)) fs.writeFileSync(thumbnailPath, b)
    }
    return { renderPath, metadata: { ...(input?.metadata && typeof input.metadata === 'object' ? input.metadata : {}), thumbnailPath }, destinations: input?.destinations, schedule: input?.schedule, facts: input?.facts }
  }

  handle('esb:vpub-approve', async (input) => { const p = await vp(); return p.engine.approve(await request(input)) })
  handle('esb:vpub-start', async (input) => {
    const p = await vp()
    const req = await request(input)
    const job = await p.engine.submit({ ...req, approvalToken: str(input?.approvalToken, 200) })
    // run in the background; the renderer follows it through esb:vpub-update
    p.engine.run(job.id).catch(() => { /* the job carries the platform's own error text */ })
    return { ok: true, jobId: job.id }
  })
  handle('esb:vpub-jobs', async () => { const p = await vp(); return { ok: true, jobs: p.engine.list().map(pub) } })
  handle('esb:vpub-job', async (id) => { const p = await vp(); return { ok: true, job: pub(p.engine.get(str(id, 80))) } })
  handle('esb:vpub-retry', async (id) => { const p = await vp(); p.engine.retry(str(id, 80)).catch(() => {}); return { ok: true } })
  handle('esb:vpub-cancel', async (id) => { const p = await vp(); await p.engine.cancel(str(id, 80)); return { ok: true } })

  return {
    /** At launch: continue jobs the owner already approved and that were cut off (never starts a new post). */
    async resume() { try { const p = await vp(); await p.engine.resumeAll() } catch { /* nothing to resume, or not configured */ } },
    /** At quit: stop uploads cleanly; they resume at the next launch. */
    async stop() { try { if (vpPromise) { const p = await vpPromise; await p.engine.stopAll() } } catch { /* quitting */ } },
  }
}

module.exports = { registerVideoPublishIpc, approvalText }
