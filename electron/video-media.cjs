// ESB Studio — the Video desk's files, in the main process. The renderer is treated as hostile: naming a path never
// grants a read. Media files enter the registry only through the main process's own open dialog, a drop resolved by
// the preload (a File object, never a string), or a still / voiceover take the app wrote itself into userData.
// Opening a project approves nothing: its listed paths play only if they are already in the registry (a project
// saved by this app); anything else comes back missing and goes through Relink (the dialog again). Network (UNC) and
// device paths are refused everywhere, so a crafted path never makes Windows dial an SMB share. Each registered file
// gets an opaque id and `esb-media://m/<id>` serves it with range requests. The renderer does see the real path of a
// file the editor imported (the project file stores it; the bin shows it in a tooltip).
// Exports stream into a file the editor chose in the save dialog; autosave snapshots go to userData. Pure where
// possible, so it is unit-tested (tools/unit/video-main.test.ts).
const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')
const { Readable } = require('node:stream')

const MEDIA_TYPES = {
  mp4: 'video/mp4', m4v: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm', mkv: 'video/x-matroska',
  mp3: 'audio/mpeg', wav: 'audio/wav', m4a: 'audio/mp4', aac: 'audio/aac', ogg: 'audio/ogg', opus: 'audio/ogg', flac: 'audio/flac',
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif',
}
const MEDIA_EXT = new Set(Object.keys(MEDIA_TYPES))
const extOf = (p) => String(p).split('.').pop().toLowerCase()

/** A network share (\\server\share, //server/share) or a Win32 device / long-path form (\\?\, \\.\). A stat on a
 * UNC path makes Windows open an SMB connection and offer the account's NTLM hash to that server, so these are never
 * touched. Mapped drive letters are local paths to Node and still work. */
function isNetworkOrDevicePath(p) {
  return /^[\\/]{2}/.test(String(p))
}

/** A plain local absolute path with a media file extension (no control characters, not absurdly long, not UNC). */
function isMediaPath(p) {
  return typeof p === 'string' && p.length > 3 && p.length < 4096 && !/[\u0000-\u001f]/.test(p) && !isNetworkOrDevicePath(p) && path.isAbsolute(p) && MEDIA_EXT.has(extOf(p))
}

const norm = (p) => path.resolve(String(p)).replace(/\\/g, '/').toLowerCase()
/** The opaque id a file is served under. */
const mediaId = (p) => crypto.createHash('sha256').update(norm(p)).digest('hex').slice(0, 32)

const MAX_REGISTRY = 20000

/** Files the editor has approved for the Video desk, kept across launches (userData/video-media.json, oldest first).
 * At most `max` entries: when full, the oldest approval is forgotten (a project still using it then shows the file
 * missing, and Relink approves it again). Writes are debounced, so an import of 200 files is one write. */
function createMediaRegistry({ file, max = MAX_REGISTRY }) {
  const byId = new Map()
  try {
    const list = JSON.parse(fs.readFileSync(file, 'utf8'))
    // the file is oldest first: keep the newest approvals
    if (Array.isArray(list)) for (const p of list.slice(-max)) if (isMediaPath(p)) byId.set(mediaId(p), p)
  } catch { /* first run */ }
  let timer = null
  const flush = () => {
    clearTimeout(timer)
    try {
      const tmp = file + '.tmp'
      fs.writeFileSync(tmp, JSON.stringify([...byId.values()]))
      fs.renameSync(tmp, file)
    } catch { /* best effort; the next add retries */ }
  }
  const persist = () => {
    clearTimeout(timer)
    timer = setTimeout(flush, 500)
  }
  return {
    /** Approve a file; returns its id, or null when it is not a local media file that exists. */
    add(p) {
      if (!isMediaPath(p)) return null
      try { if (!fs.statSync(p).isFile()) return null } catch { return null }
      const id = mediaId(p)
      const known = byId.get(id)
      if (known) byId.delete(id) // approved again: it moves to the newest end
      byId.set(id, known || path.resolve(p))
      while (byId.size > max) byId.delete(byId.keys().next().value)
      persist()
      return id
    },
    /** Write the list now (quit, tests). */
    flush,
    has: (p) => isMediaPath(p) && byId.has(mediaId(p)),
    pathFor: (id) => (typeof id === 'string' && /^[0-9a-f]{32}$/.test(id) ? byId.get(id) || null : null),
    size: () => byId.size,
  }
}

/** What the renderer gets for an approved file: the URL to play it and the facts to relink it later. */
function entryFor(registry, p) {
  const id = registry.add(p)
  if (!id) return null
  const st = fs.statSync(p)
  return { path: path.resolve(p), name: path.basename(p), size: st.size, mtimeMs: Math.round(st.mtimeMs), url: `esb-media://m/${id}` }
}

/** For reopening a project: each path is answered with a fresh URL if it is approved and still there, else missing.
 * Only approved local paths are ever stat'ed (never a path the renderer made up, never a network path). */
async function resolvePaths(registry, paths) {
  if (!Array.isArray(paths)) return []
  return Promise.all(paths.slice(0, 2000).map(async (p) => {
    if (!isMediaPath(p) || !registry.has(p)) return { path: String(p).slice(0, 4096), missing: true }
    try {
      const st = await fs.promises.stat(p)
      if (!st.isFile()) return { path: p, missing: true }
      return { path: p, url: `esb-media://m/${mediaId(p)}`, size: st.size, mtimeMs: Math.round(st.mtimeMs) }
    } catch {
      return { path: p, missing: true }
    }
  }))
}

/** The page origins that may read esb-media:// with CORS: the packaged app (file://, which Chromium may report as
 * "null") and the dev server. The protocol is registered on the editor's session only, so no other window asks. */
function allowedOrigin(origin, devUrl) {
  if (!origin) return null
  if (origin === 'file://' || origin === 'null') return origin
  try { if (devUrl && new URL(devUrl).origin === origin) return origin } catch { /* no dev url */ }
  return null
}

/** Parse a Range header against a file size: [start, end] inclusive, or null for the whole file, or 'bad'. */
function parseRange(header, size) {
  if (!header) return null
  const m = /^bytes=(\d*)-(\d*)$/.exec(String(header).trim())
  if (!m || (m[1] === '' && m[2] === '')) return 'bad'
  let start, end
  if (m[1] === '') { const n = Number(m[2]); start = Math.max(0, size - n); end = size - 1 } else { start = Number(m[1]); end = m[2] === '' ? size - 1 : Math.min(size - 1, Number(m[2])) }
  if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start >= size) return 'bad'
  return [start, end]
}

/** Answer one esb-media:// request: only GET/HEAD, only an approved id, with byte ranges. */
async function serveMedia(request, registry, { devUrl, folderFile } = {}) {
  const url = new URL(request.url)
  let p = null
  if (url.hostname === 'm') p = registry.pathFor(url.pathname.replace(/^\//, ''))
  else if (url.hostname === 'p' && typeof folderFile === 'function') {
    // esb-media://p/<folder id | u>/<subfolder>/<file>: a file inside a project folder (or the app's own library),
    // confined to that folder's real location by the caller (electron/video-project.cjs confinedFile)
    const m = /^\/([0-9a-f]{32}|u)\/([^/]+)\/([^/]+)$/.exec(url.pathname)
    if (m) {
      let rel = null
      try { rel = decodeURIComponent(m[2]) + '/' + decodeURIComponent(m[3]) } catch { rel = null }
      const f = rel ? folderFile(m[1], rel) : null
      p = f && isMediaPath(f) ? f : null
    }
  }
  // CORS for the app's own page only (never '*')
  const origin = allowedOrigin(request.headers.get('origin'), devUrl)
  const cors = { 'Access-Control-Expose-Headers': 'Content-Length, Content-Range, Accept-Ranges', 'Cross-Origin-Resource-Policy': 'same-site', Vary: 'Origin' }
  if (origin) cors['Access-Control-Allow-Origin'] = origin
  if (request.method !== 'GET' && request.method !== 'HEAD') return new Response(null, { status: 405, headers: cors })
  if (!p) return new Response(null, { status: 404, headers: cors })
  let st
  try { st = await fs.promises.stat(p) } catch { return new Response(null, { status: 404, headers: cors }) }
  const type = MEDIA_TYPES[extOf(p)] || 'application/octet-stream'
  const range = parseRange(request.headers.get('range'), st.size)
  if (range === 'bad') return new Response(null, { status: 416, headers: { ...cors, 'Content-Range': `bytes */${st.size}` } })
  const [start, end] = range || [0, st.size - 1]
  const headers = { ...cors, 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Content-Length': String(st.size ? end - start + 1 : 0), 'Cache-Control': 'no-store' }
  if (range) headers['Content-Range'] = `bytes ${start}-${end}/${st.size}`
  const body = request.method === 'HEAD' || st.size === 0 ? null : Readable.toWeb(fs.createReadStream(p, { start, end }))
  return new Response(body, { status: range ? 206 : 200, headers })
}

/** The file type by its own header: MP4/MOV (…ftyp) or WebM/Matroska (EBML). */
function videoKind(b) {
  if (!b || b.length < 12) return null
  if (b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70) return 'mp4'
  if (b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) return 'webm'
  // an MP4 written with its header at the end starts with the media data box (….mdat) or a free box
  if ((b[4] === 0x6d && b[5] === 0x64 && b[6] === 0x61 && b[7] === 0x74) || (b[4] === 0x66 && b[5] === 0x72 && b[6] === 0x65 && b[7] === 0x65)) return 'mp4-mdat'
  return null
}

const MAX_EXPORT_BYTES = 50 * 1024 * 1024 * 1024 // a 2-hour 4K render is ~25 GB; a runaway renderer stops here
const MAX_WRITE_BYTES = 64 * 1024 * 1024
const MIN_FREE_BYTES = 512 * 1024 * 1024

/** Free bytes on the volume holding `dir`, or null when the OS will not say. */
function freeBytes(dir) {
  try { const s = fs.statfsSync(dir); return Number(s.bavail) * Number(s.bsize) } catch { return null }
}

/** A name next to `target` that is not taken: "clip (2).mp4", "clip (3).mp4", … */
function freeName(target) {
  const ext = path.extname(target)
  const stem = target.slice(0, target.length - ext.length)
  for (let n = 2; n < 1000; n++) { const c = `${stem} (${n})${ext}`; if (!fs.existsSync(c)) return c }
  return `${stem} (${Date.now()})${ext}`
}

/** Exports in progress: a file opened in the place the editor chose, written at the positions the muxer asks for
 * (it goes back to patch box sizes), renamed into place only when it ends well. One export at a time. */
function createExportWriter() {
  let job = null
  return {
    begin(target, { minFree = MIN_FREE_BYTES } = {}) {
      if (job) { try { fs.closeSync(job.fd) } catch { /* gone */ } try { fs.rmSync(job.partial, { force: true }) } catch { /* gone */ } job = null }
      const free = freeBytes(path.dirname(target))
      if (free != null && free < minFree) throw new Error(`Not enough free space on that drive (${Math.round(free / 1048576)} MB free).`)
      const partial = target + '.partial'
      const fd = fs.openSync(partial, 'w')
      job = { id: crypto.randomBytes(12).toString('hex'), target, partial, fd, size: 0 }
      return { id: job.id, path: target }
    },
    /** Validate and write one piece. The renderer is hostile: the id must be this job's, the position a whole number
     * inside what was written (patches) or exactly at its end (appends), the piece a byte array of sane size. */
    async write(id, position, bytes) {
      if (!job || id !== job.id) throw new Error('No export in progress')
      if (!(bytes instanceof Uint8Array) || bytes.length === 0 || bytes.length > MAX_WRITE_BYTES) throw new Error('Bad export piece')
      if (!Number.isSafeInteger(position) || position < 0 || position > job.size) throw new Error('Bad export position')
      if (position + bytes.length > MAX_EXPORT_BYTES) throw new Error('Export too large')
      const j = job
      // the size is claimed before the write, so a second piece sent while this one is on disk is checked against it
      j.size = Math.max(j.size, position + bytes.length)
      let off = 0
      while (off < bytes.length) {
        off += await new Promise((res, rej) => fs.write(j.fd, bytes, off, bytes.length - off, position + off, (e, n) => (e ? rej(e) : res(n))))
      }
      return true
    },
    /** Finish: keep the file only if it ended well and its header is a video's; otherwise delete what was written. */
    end(id, ok) {
      if (!job || id !== job.id) return null
      const j = job
      job = null
      try { fs.closeSync(j.fd) } catch { /* already closed */ }
      if (ok) {
        let isVideo = false
        try {
          const head = Buffer.alloc(16)
          const fd = fs.openSync(j.partial, 'r')
          fs.readSync(fd, head, 0, 16, 0)
          fs.closeSync(fd)
          isVideo = !!videoKind(head)
        } catch { /* unreadable: removed below */ }
        if (isVideo) {
          // the finished render is never thrown away: if the chosen file cannot be replaced (open in a player, read
          // only), it is kept under a free name next to it and that path is returned
          try {
            fs.rmSync(j.target, { force: true })
            fs.renameSync(j.partial, j.target)
            return j.target
          } catch { /* the chosen name is busy */ }
          try {
            const alt = freeName(j.target)
            fs.renameSync(j.partial, alt)
            return alt
          } catch { return j.partial }
        }
      }
      try { fs.rmSync(j.partial, { force: true }) } catch { /* gone */ }
      return null
    },
    /** The window that ran the export crashed or reloaded: close and remove what was written. */
    abortActive() {
      if (!job) return false
      this.end(job.id, false)
      return true
    },
    active: () => (job ? { id: job.id, size: job.size } : null),
  }
}

const MAX_SNAPSHOT = 25 * 1024 * 1024
const KEEP_SNAPSHOTS = 5
const KEEP_SNAPSHOTS_TOTAL = 20
const SNAP_RE = /^snap-(\d+)(?:-([0-9a-f]{12}))?\.json$/

/** The short tag a project's snapshots carry in their file name (a hash of its id), so saving one project clears only
 * its own snapshots and never another's unsaved work. */
const projectTag = (id) => crypto.createHash('sha256').update(String(id ?? '')).digest('hex').slice(0, 12)

const listSnaps = (dir) => {
  try {
    return fs.readdirSync(dir).map((f) => ({ f, m: SNAP_RE.exec(f) })).filter((x) => x.m).map((x) => ({ f: x.f, at: Number(x.m[1]), tag: x.m[2] || '' })).sort((a, b) => a.at - b.at || (a.f < b.f ? -1 : 1))
  } catch { return [] }
}

/** Write one autosave snapshot (temp + rename, so a crash mid-write never leaves a half file); keep the last 5 of each
 * project and the last 20 overall. */
function writeSnapshot(dir, text, now = Date.now()) {
  if (typeof text !== 'string' || !text.length || text.length > MAX_SNAPSHOT) throw new Error('Bad snapshot')
  const j = JSON.parse(text) // only a project (JSON) is kept
  // a Phase 1 project.json snapshot keeps its id in `timeline`
  const tag = projectTag(j && (j.id ?? (j.timeline && j.timeline.id)))
  fs.mkdirSync(dir, { recursive: true })
  const name = `snap-${String(now).padStart(15, '0')}-${tag}.json`
  const tmp = path.join(dir, name + '.tmp')
  fs.writeFileSync(tmp, text, 'utf8')
  fs.renameSync(tmp, path.join(dir, name))
  const all = listSnaps(dir)
  const drop = new Set()
  const mine = all.filter((x) => x.tag === tag)
  for (const x of mine.slice(0, Math.max(0, mine.length - KEEP_SNAPSHOTS))) drop.add(x.f)
  const left = all.filter((x) => !drop.has(x.f))
  for (const x of left.slice(0, Math.max(0, left.length - KEEP_SNAPSHOTS_TOTAL))) drop.add(x.f)
  for (const f of drop) { try { fs.rmSync(path.join(dir, f)) } catch { /* in use */ } }
  return { ok: true, at: now }
}

/** The newest snapshot that reads as JSON (a damaged newest one falls back to the one before). */
function latestSnapshot(dir) {
  for (const { f, at } of listSnaps(dir).reverse()) {
    try {
      const text = fs.readFileSync(path.join(dir, f), 'utf8')
      JSON.parse(text)
      return { at, text }
    } catch { /* try the older one */ }
  }
  return null
}

/** Remove the snapshots of one project (by its id), or every snapshot when no id is given. */
function clearSnapshots(dir, projectId) {
  const tag = projectId == null ? null : typeof projectId === 'string' && projectId.length < 300 ? projectTag(projectId) : undefined
  if (tag === undefined) return false
  try {
    for (const f of fs.readdirSync(dir)) {
      const m = /^snap-\d+(?:-([0-9a-f]{12}))?\.json(\.tmp)?$/.exec(f)
      if (!m) continue
      if (tag !== null) {
        let t = m[1] || ''
        // an older snapshot without a tag in its name: read its id
        if (!t) { try { const j = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); t = projectTag(j.id ?? (j.timeline && j.timeline.id)) } catch { continue } }
        if (t !== tag) continue
      }
      fs.rmSync(path.join(dir, f), { force: true })
    }
  } catch { /* nothing there */ }
  return true
}

// ---------------------------------------------------------------- pictures and sound the app writes itself

/** The kind of a voiceover take by its own header: WebM/Matroska (MediaRecorder), Ogg, WAV or MP4/M4A. */
function audioTakeKind(b) {
  if (!(b instanceof Uint8Array) || b.length < 12) return null
  if (b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) return 'webm'
  if (b[0] === 0x4f && b[1] === 0x67 && b[2] === 0x67 && b[3] === 0x53) return 'ogg'
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x41 && b[10] === 0x56 && b[11] === 0x45) return 'wav'
  if (b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70) return 'm4a'
  return null
}

/** Keep `bytes` in `dir` under a content-hash name (the same picture twice is one file). The folder is capped by file
 * count and total size: past the cap the write is refused (never deleting an older file a project may still use). */
function storeGenerated(dir, stem, ext, bytes, { maxFiles, maxBytes }) {
  fs.mkdirSync(dir, { recursive: true })
  const hash = crypto.createHash('sha256').update(bytes).digest('hex').slice(0, 24)
  const safeStem = String(stem || 'file').replace(/[^\w.-]+/g, '-').replace(/^[-.]+|[-.]+$/g, '').slice(0, 60) || 'file'
  const file = path.join(dir, `${safeStem}-${hash}.${ext}`)
  if (fs.existsSync(file)) return file
  const names = fs.readdirSync(dir)
  const same = names.find((f) => f.endsWith(`-${hash}.${ext}`))
  if (same) return path.join(dir, same) // the same bytes under another name
  let count = 0
  let total = 0
  for (const f of names) { try { const st = fs.statSync(path.join(dir, f)); if (st.isFile()) { count++; total += st.size } } catch { /* gone */ } }
  if (count + 1 > maxFiles || total + bytes.length > maxBytes) throw new Error(`The app's ${path.basename(dir)} folder is full (${count} files, ${Math.round(total / 1048576)} MB). Remove old ones from ${dir}.`)
  const tmp = file + '.tmp'
  fs.writeFileSync(tmp, Buffer.from(bytes.buffer, bytes.byteOffset, bytes.length))
  fs.renameSync(tmp, file)
  return file
}

const STILLS_CAP = { maxFiles: 5000, maxBytes: 4 * 1024 * 1024 * 1024 }
const TAKES_CAP = { maxFiles: 2000, maxBytes: 8 * 1024 * 1024 * 1024 }
const MAX_TAKE_BYTES = 512 * 1024 * 1024

/** A video project path the renderer may name to save again: ends in .esbvideo, no control characters. */
function isVideoProjectPath(p) {
  return typeof p === 'string' && p.length > 9 && p.length < 4096 && !/[\u0000-\u001f]/.test(p) && /\.esbvideo$/i.test(p)
}

module.exports = { MEDIA_EXT, MEDIA_TYPES, isMediaPath, isNetworkOrDevicePath, mediaId, createMediaRegistry, entryFor, resolvePaths, allowedOrigin, parseRange, serveMedia, videoKind, createExportWriter, freeName, writeSnapshot, latestSnapshot, clearSnapshots, projectTag, isVideoProjectPath, KEEP_SNAPSHOTS, audioTakeKind, storeGenerated, STILLS_CAP, TAKES_CAP, MAX_TAKE_BYTES }
