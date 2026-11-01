// ESB Studio — the Video desk's files, in the main process. The renderer is treated as hostile: it never names a path
// to read. Media files enter the registry only through the main process's own open dialog, a drop resolved by the
// preload (a File object, never a string), a still the app rendered itself, or a project file the editor opened in
// the dialog (its listed media, if they exist and are media by extension). Each registered file gets an opaque id;
// `esb-media://m/<id>` serves it with range requests. Exports stream into a file the editor chose in the save dialog;
// autosave snapshots go to userData. Pure where possible, so it is unit-tested (tools/unit/video-main.test.ts).
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

/** A plain absolute path with a media file extension (no control characters, not absurdly long). */
function isMediaPath(p) {
  return typeof p === 'string' && p.length > 3 && p.length < 4096 && !/[\u0000-\u001f]/.test(p) && path.isAbsolute(p) && MEDIA_EXT.has(extOf(p))
}

const norm = (p) => path.resolve(String(p)).replace(/\\/g, '/').toLowerCase()
/** The opaque id a file is served under. */
const mediaId = (p) => crypto.createHash('sha256').update(norm(p)).digest('hex').slice(0, 32)

/** Files the editor has approved for the Video desk, kept across launches (userData/video-media.json). */
function createMediaRegistry({ file }) {
  const byId = new Map()
  try {
    const list = JSON.parse(fs.readFileSync(file, 'utf8'))
    if (Array.isArray(list)) for (const p of list.slice(0, 20000)) if (isMediaPath(p)) byId.set(mediaId(p), p)
  } catch { /* first run */ }
  let timer = null
  const persist = () => {
    clearTimeout(timer)
    timer = setTimeout(() => {
      try {
        const tmp = file + '.tmp'
        fs.writeFileSync(tmp, JSON.stringify([...byId.values()]))
        fs.renameSync(tmp, file)
      } catch { /* best effort; the next add retries */ }
    }, 200)
  }
  return {
    /** Approve a file; returns its id, or null when it is not a media file that exists. */
    add(p) {
      if (!isMediaPath(p)) return null
      try { if (!fs.statSync(p).isFile()) return null } catch { return null }
      const id = mediaId(p)
      if (!byId.has(id)) { byId.set(id, path.resolve(p)); persist() }
      return id
    },
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

/** For reopening a project: each path is answered with a fresh URL if it is approved and still there, else missing. */
function resolvePaths(registry, paths) {
  if (!Array.isArray(paths)) return []
  return paths.slice(0, 2000).map((p) => {
    if (!isMediaPath(p) || !registry.has(p)) return { path: String(p).slice(0, 4096), missing: true }
    try {
      const st = fs.statSync(p)
      if (!st.isFile()) return { path: p, missing: true }
      return { path: p, url: `esb-media://m/${mediaId(p)}`, size: st.size, mtimeMs: Math.round(st.mtimeMs) }
    } catch {
      return { path: p, missing: true }
    }
  })
}

/** The media paths a project file lists (approved when the editor opens that project in the dialog). */
function projectMediaPaths(text) {
  try {
    const j = JSON.parse(text)
    const list = Array.isArray(j && j.mediaAssets) ? j.mediaAssets : []
    return list.map((a) => a && a.path).filter(isMediaPath).slice(0, 2000)
  } catch {
    return []
  }
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
async function serveMedia(request, registry) {
  const url = new URL(request.url)
  const id = url.hostname === 'm' ? url.pathname.replace(/^\//, '') : ''
  const p = registry.pathFor(id)
  const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Expose-Headers': 'Content-Length, Content-Range, Accept-Ranges', 'Cross-Origin-Resource-Policy': 'cross-origin' }
  if (request.method !== 'GET' && request.method !== 'HEAD') return new Response(null, { status: 405, headers: cors })
  if (!p) return new Response(null, { status: 404, headers: cors })
  let st
  try { st = fs.statSync(p) } catch { return new Response(null, { status: 404, headers: cors }) }
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

const MAX_EXPORT_BYTES = 256 * 1024 * 1024 * 1024 // far above any real render; a runaway renderer still stops somewhere
const MAX_WRITE_BYTES = 64 * 1024 * 1024

/** Exports in progress: a file opened in the place the editor chose, written at the positions the muxer asks for
 * (it goes back to patch box sizes), renamed into place only when it ends well. One export at a time. */
function createExportWriter() {
  let job = null
  return {
    begin(target) {
      if (job) { try { fs.closeSync(job.fd) } catch { /* gone */ } try { fs.rmSync(job.partial, { force: true }) } catch { /* gone */ } job = null }
      const partial = target + '.partial'
      const fd = fs.openSync(partial, 'w')
      job = { id: crypto.randomBytes(12).toString('hex'), target, partial, fd, size: 0 }
      return { id: job.id, path: target }
    },
    /** Validate and write one piece. The renderer is hostile: the id must be this job's, the position a whole number
     * inside what was written (patches) or exactly at its end (appends), the piece a byte array of sane size. */
    write(id, position, bytes) {
      if (!job || id !== job.id) throw new Error('No export in progress')
      if (!(bytes instanceof Uint8Array) || bytes.length === 0 || bytes.length > MAX_WRITE_BYTES) throw new Error('Bad export piece')
      if (!Number.isSafeInteger(position) || position < 0 || position > job.size) throw new Error('Bad export position')
      if (position + bytes.length > MAX_EXPORT_BYTES) throw new Error('Export too large')
      let off = 0
      while (off < bytes.length) off += fs.writeSync(job.fd, bytes, off, bytes.length - off, position + off)
      job.size = Math.max(job.size, position + bytes.length)
      return true
    },
    /** Finish: keep the file only if it ended well and its header is a video's; otherwise delete what was written. */
    end(id, ok) {
      if (!job || id !== job.id) return null
      const j = job
      job = null
      try { fs.closeSync(j.fd) } catch { /* already closed */ }
      if (ok) {
        try {
          const head = Buffer.alloc(16)
          const fd = fs.openSync(j.partial, 'r')
          fs.readSync(fd, head, 0, 16, 0)
          fs.closeSync(fd)
          if (videoKind(head)) {
            fs.rmSync(j.target, { force: true })
            fs.renameSync(j.partial, j.target)
            return j.target
          }
        } catch { /* fall through and remove */ }
      }
      try { fs.rmSync(j.partial, { force: true }) } catch { /* gone */ }
      return null
    },
    active: () => (job ? { id: job.id, size: job.size } : null),
  }
}

const MAX_SNAPSHOT = 25 * 1024 * 1024
const KEEP_SNAPSHOTS = 5

/** Write one autosave snapshot (temp + rename, so a crash mid-write never leaves a half file) and keep the last 5. */
function writeSnapshot(dir, text, now = Date.now()) {
  if (typeof text !== 'string' || !text.length || text.length > MAX_SNAPSHOT) throw new Error('Bad snapshot')
  JSON.parse(text) // only a project (JSON) is kept
  fs.mkdirSync(dir, { recursive: true })
  const name = `snap-${String(now).padStart(15, '0')}.json`
  const tmp = path.join(dir, name + '.tmp')
  fs.writeFileSync(tmp, text, 'utf8')
  fs.renameSync(tmp, path.join(dir, name))
  const snaps = fs.readdirSync(dir).filter((f) => /^snap-\d+\.json$/.test(f)).sort()
  for (const f of snaps.slice(0, Math.max(0, snaps.length - KEEP_SNAPSHOTS))) { try { fs.rmSync(path.join(dir, f)) } catch { /* in use */ } }
  return { ok: true, at: now }
}

/** The newest snapshot that reads as JSON (a damaged newest one falls back to the one before). */
function latestSnapshot(dir) {
  let snaps = []
  try { snaps = fs.readdirSync(dir).filter((f) => /^snap-\d+\.json$/.test(f)).sort().reverse() } catch { return null }
  for (const f of snaps) {
    try {
      const text = fs.readFileSync(path.join(dir, f), 'utf8')
      JSON.parse(text)
      return { at: Number(f.slice(5, -5)), text }
    } catch { /* try the older one */ }
  }
  return null
}

function clearSnapshots(dir) {
  try { for (const f of fs.readdirSync(dir)) if (/^snap-\d+\.json(\.tmp)?$/.test(f)) fs.rmSync(path.join(dir, f), { force: true }) } catch { /* nothing there */ }
  return true
}

/** A video project path the renderer may name to save again: ends in .esbvideo, no control characters. */
function isVideoProjectPath(p) {
  return typeof p === 'string' && p.length > 9 && p.length < 4096 && !/[\u0000-\u001f]/.test(p) && /\.esbvideo$/i.test(p)
}

module.exports = { MEDIA_EXT, MEDIA_TYPES, isMediaPath, mediaId, createMediaRegistry, entryFor, resolvePaths, projectMediaPaths, parseRange, serveMedia, videoKind, createExportWriter, writeSnapshot, latestSnapshot, clearSnapshots, isVideoProjectPath, KEEP_SNAPSHOTS }
