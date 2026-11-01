// ESB Studio — Video publishing: Facebook Page videos (main process only). The Page token comes from the credential
// store and travels only in the Authorization header (Bearer for Graph, "OAuth" for the upload hosts, as Meta's docs
// show), never in a URL.
//
//   Reel:       POST /{page}/video_reels upload_phase=start → { video_id }
//               POST rupload …/{video_id}  (offset, file_size headers; the rest of the file as the body)
//               GET  /{video_id}?fields=status  (bytes_transferred tells where to resume after a cut)
//               POST /{page}/video_reels upload_phase=finish video_state=PUBLISHED|SCHEDULED|DRAFT
//   Feed video: POST /{app-id}/uploads?file_name&file_length&file_type → { id: 'upload:…' }
//               POST /upload:… (file_offset header, the rest of the file) → { h }    GET /upload:… → { file_offset }
//               POST graph-video /{page}/videos title, description, fbuploader_video_file_chunk = h
//   First comment: POST /{object}/comments message = the article link.
'use strict'
const { PublishError, backoffMs, sleepReal, fileStream } = require('./http.cjs')

function facebookError(status, body) {
  const e = body?.error || {}
  const code = e.code
  const own = e.message ? ` Facebook's own words: ${e.message}` : ''
  if (code === 190 || status === 401) return 'Facebook rejected the Page token — it expired or was revoked. Connect the Page again.' + own
  if (code === 200 || code === 10 || (code >= 200 && code < 300) || status === 403) return 'The Page token does not allow this. Video publishing needs pages_show_list, pages_read_engagement and pages_manage_posts (the link comment needs pages_manage_engagement).' + own
  if (code === 4 || code === 17 || code === 32 || code === 613) return 'Facebook is limiting requests right now. The app will try again later.' + own
  if (code === 100) return 'Facebook did not accept a field of this post.' + own
  return `Facebook answered ${status}.${own}`
}
const fbRetryable = (status, body) => status >= 500 || status === 429 || body?.error?.is_transient === true || [1, 2, 4, 17, 32, 613].includes(body?.error?.code)

function createFacebookClient({ httpClient, endpoints, page, sleep = sleepReal, maxRetries = 6, random = Math.random, pollMs = 3000, maxPolls = 200 }) {
  // page(): { pageId, token } from the credential store, read each time so a reconnect takes effect at once
  const creds = () => {
    const p = page()
    if (!p?.token || !p?.pageId) throw new PublishError('The Facebook Page is not connected for video publishing.', { kind: 'auth' })
    return p
  }
  const form = (o) => {
    const f = new URLSearchParams()
    for (const [k, v] of Object.entries(o)) if (v !== undefined && v !== null) f.set(k, String(v))
    return f.toString()
  }

  /** A Graph call with retries on transient answers. */
  async function graph(url, { method = 'GET', body, scheme = 'Bearer', headers = {}, signal } = {}) {
    const { token } = creds()
    for (let attempt = 0; ; attempt++) {
      let r
      try {
        r = await httpClient.request(url, { method, signal, auth: { scheme, token }, headers: body !== undefined && !headers['Content-Type'] ? { 'Content-Type': 'application/x-www-form-urlencoded', ...headers } : headers, body })
      } catch (e) {
        // a broken connection after a POST was sent may have been carried out: never send it again blindly — the
        // caller checks the platform first (finish / publish), so only reads are retried here
        if (e.retryable && method === 'GET' && attempt < maxRetries) { await sleep(backoffMs(attempt, null, random), signal); continue }
        throw e
      }
      if (r.status >= 200 && r.status < 300 && !r.json?.error) return r.json ?? {}
      if (fbRetryable(r.status, r.json) && attempt < maxRetries) { await sleep(backoffMs(attempt, r.headers.get('retry-after'), random), signal); continue }
      throw new PublishError(facebookError(r.status, r.json), { status: r.status, code: r.json?.error?.code, platform: 'facebook' })
    }
  }

  // ---- Reels ----
  async function reelStart(signal) {
    const { pageId } = creds()
    const j = await graph(`${endpoints.graph}/${pageId}/video_reels`, { method: 'POST', signal, body: form({ upload_phase: 'start' }) })
    if (!/^\d+$/.test(String(j.video_id ?? ''))) throw new PublishError('Facebook did not open a Reel upload.', { platform: 'facebook' })
    return String(j.video_id)
  }

  async function videoStatus(videoId, signal) {
    const j = await graph(`${endpoints.graph}/${videoId}?fields=status`, { signal })
    return j.status || {}
  }

  /** Upload the rest of the file to rupload from where Facebook says it is; resumes after a cut. */
  async function reelUpload({ videoId, filePath, fileSize, onProgress = () => {}, signal }) {
    const { token } = creds()
    for (let failures = 0; ; ) {
      if (signal?.aborted) throw new PublishError('Stopped.', { kind: 'stopped' })
      const st = await videoStatus(videoId, signal)
      const offset = Number(st.uploading_phase?.bytes_transferred) || 0
      onProgress(offset)
      if (st.uploading_phase?.status === 'complete' || offset >= fileSize) return
      let r
      try {
        r = await httpClient.request(`${endpoints.rupload}/${videoId}`, { method: 'POST', signal, auth: { scheme: 'OAuth', token }, headers: { offset: String(offset), file_size: String(fileSize), 'Content-Type': 'application/octet-stream', 'Content-Length': String(fileSize - offset) }, body: fileStream(filePath, offset, fileSize) })
      } catch (e) {
        if (!e.retryable || failures >= maxRetries) throw e
        await sleep(backoffMs(failures++, null, random), signal)
        continue
      }
      if (r.status === 200 && r.json?.success !== false && !r.json?.error) { onProgress(fileSize); return }
      if (fbRetryable(r.status, r.json) && failures < maxRetries) { await sleep(backoffMs(failures++, r.headers.get('retry-after'), random), signal); continue }
      throw new PublishError(facebookError(r.status, r.json), { status: r.status, platform: 'facebook' })
    }
  }

  /** Wait until Facebook has the whole file (and, with `untilReady`, until it is processed). */
  async function waitFor(videoId, { untilReady = false, signal } = {}) {
    for (let i = 0; i < maxPolls; i++) {
      const st = await videoStatus(videoId, signal)
      if (st.video_status === 'error' || st.processing_phase?.status === 'error') throw new PublishError(`Facebook could not process the video${st.processing_phase?.error?.message ? `: ${st.processing_phase.error.message}` : '.'}`, { platform: 'facebook' })
      const uploaded = st.uploading_phase?.status === 'complete'
      if (uploaded && (!untilReady || st.video_status === 'ready' || st.publishing_phase?.status === 'complete')) return st
      await sleep(pollMs, signal)
    }
    throw new PublishError('Facebook is still processing the video. Check again later.', { kind: 'pending', platform: 'facebook' })
  }

  /** True when this video's finish already went through (a lost answer must not post it twice). */
  async function reelFinished(videoId, signal) {
    const st = await videoStatus(videoId, signal)
    const ph = st.publishing_phase?.status
    return ph === 'complete' || ph === 'in_progress' || !!st.publishing_phase?.publish_status
  }

  async function reelFinish({ videoId, state, description, scheduledTime, signal }) {
    const { pageId } = creds()
    const j = await graph(`${endpoints.graph}/${pageId}/video_reels`, { method: 'POST', signal, body: form({ upload_phase: 'finish', video_id: videoId, video_state: state, description, scheduled_publish_time: state === 'SCHEDULED' ? scheduledTime : undefined }) })
    if (j.success === false) throw new PublishError('Facebook did not finish the Reel.', { platform: 'facebook' })
    return { postId: j.post_id ? String(j.post_id) : null }
  }

  // ---- Feed video (resumable upload API) ----
  async function feedSession({ appId, fileName, fileSize, mime = 'video/mp4', signal }) {
    if (!/^\d{5,20}$/.test(String(appId ?? ''))) throw new PublishError('A feed video needs the Meta app ID (Settings → Facebook).', { kind: 'config' })
    const q = new URLSearchParams({ file_name: fileName, file_length: String(fileSize), file_type: mime })
    const j = await graph(`${endpoints.graph}/${appId}/uploads?${q}`, { method: 'POST', signal, scheme: 'OAuth', body: '' })
    if (!/^upload:/.test(String(j.id ?? ''))) throw new PublishError('Facebook did not open an upload session.', { platform: 'facebook' })
    return String(j.id)
  }

  async function feedOffset(uploadId, signal) {
    const j = await graph(`${endpoints.graph}/${uploadId}`, { scheme: 'OAuth', signal })
    return Number(j.file_offset) || 0
  }

  async function feedUpload({ uploadId, filePath, fileSize, onProgress = () => {}, signal }) {
    const { token } = creds()
    for (let failures = 0; ; ) {
      if (signal?.aborted) throw new PublishError('Stopped.', { kind: 'stopped' })
      const offset = await feedOffset(uploadId, signal)
      onProgress(offset)
      let r
      try {
        r = await httpClient.request(`${endpoints.graph}/${uploadId}`, { method: 'POST', signal, auth: { scheme: 'OAuth', token }, headers: { file_offset: String(offset), 'Content-Type': 'application/octet-stream', 'Content-Length': String(fileSize - offset) }, body: fileStream(filePath, offset, fileSize) })
      } catch (e) {
        if (!e.retryable || failures >= maxRetries) throw e
        await sleep(backoffMs(failures++, null, random), signal)
        continue
      }
      if (r.status === 200 && r.json?.h) { onProgress(fileSize); return String(r.json.h) }
      if (fbRetryable(r.status, r.json) && failures < maxRetries) { await sleep(backoffMs(failures++, r.headers.get('retry-after'), random), signal); continue }
      throw new PublishError(facebookError(r.status, r.json), { status: r.status, platform: 'facebook' })
    }
  }

  async function feedPublish({ handle, title, description, state, scheduledTime, signal }) {
    const { pageId } = creds()
    const j = await graph(`${endpoints.graphVideo}/${pageId}/videos`, { method: 'POST', signal, body: form({ fbuploader_video_file_chunk: handle, title, description, published: state === 'PUBLISHED' ? 'true' : 'false', scheduled_publish_time: state === 'SCHEDULED' ? scheduledTime : undefined }) })
    if (!/^\d+$/.test(String(j.id ?? ''))) throw new PublishError('Facebook did not create the video post.', { platform: 'facebook' })
    return String(j.id)
  }

  /** The Page's recent videos (or Reels) whose title/description matches, created since `since`. Used before a retry. */
  async function findRecent({ kind, title, description, since, signal }) {
    const { pageId } = creds()
    const edge = kind === 'reel' ? 'video_reels' : 'videos'
    const j = await graph(`${endpoints.graph}/${pageId}/${edge}?fields=id,title,description,created_time&limit=25`, { signal })
    const hit = (j.data || []).find((v) => Date.parse(v.created_time) >= since - 5 * 60_000 && (title ? v.title === title : true) && (description ? v.description === description : true))
    return hit ? String(hit.id) : null
  }

  async function comment({ objectId, message, signal }) {
    const j = await graph(`${endpoints.graph}/${objectId}/comments`, { method: 'POST', signal, body: form({ message }) })
    return String(j.id ?? '')
  }

  async function checkPage(signal) {
    const { pageId } = creds()
    const j = await graph(`${endpoints.graph}/${pageId}?fields=name`, { signal })
    return { name: String(j.name ?? '') }
  }

  return { reelStart, videoStatus, reelUpload, waitFor, reelFinished, reelFinish, feedSession, feedOffset, feedUpload, feedPublish, findRecent, comment, checkPage }
}

module.exports = { createFacebookClient, facebookError }
