// ESB Studio — checks on what the renderer hands the main process over IPC. The renderer is sandboxed, but a page that
// has been taken over (a hostile article, a poisoned AI reply) can call every bridge function with any argument; these
// make sure a call can only do what the editor could do through the UI. Pure functions, so they are unit-tested.
const path = require('node:path')

const IMAGE_EXT = new Set(['png', 'jpg', 'jpeg', 'webp'])
const DRAG_EXT = new Set(['png', 'jpg', 'jpeg', 'webp', 'mp4', 'webm'])
const MAX_IMAGE_FETCH_BYTES = 25 * 1024 * 1024

/** A bare file name (no directories) with an image extension; anything else becomes .png. */
function imageFileName(name, allowed = IMAGE_EXT, fallback = 'png') {
  // split on both separators: path.basename only knows the host's, so a Windows path kept its folders on Linux
  const base = String(name || '').split(/[\\/]/).pop().replace(/[\u0000-\u001f<>:"|?*]/g, '').trim() || 'ESB-Banner'
  const m = base.match(/^(.*?)(?:\.([a-z0-9]+))?$/i)
  const stem = (m && m[1]) || base
  const ext = m && m[2] ? m[2].toLowerCase() : ''
  return `${stem || 'ESB-Banner'}.${allowed.has(ext) ? ext : fallback}`
}

/** A name for a file the editor drags out: an image or a finished video. */
const dragFileName = (name) => imageFileName(name, DRAG_EXT)

/** The bytes start like a PNG, JPEG or WebP (what the renderer's canvas can produce). */
function isImageBytes(b) {
  if (!(b instanceof Uint8Array) || b.length < 16) return false
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return true
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return true
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return true
  return false
}

/** The renderer may shorten the wait and cap the size of an image fetch, nothing else: no loopback, no custom DNS, no other types. */
function safeImageFetchOptions(o) {
  const src = o && typeof o === 'object' ? o : {}
  const out = {}
  if (Number.isFinite(src.timeoutMs)) out.timeoutMs = Math.min(15000, Math.max(1000, src.timeoutMs))
  if (Number.isFinite(src.maxBytes)) out.maxBytes = Math.min(MAX_IMAGE_FETCH_BYTES, Math.max(1024, src.maxBytes))
  return out
}

/** A project path the renderer may name on its own (recents, "save again"): a string ending in .esb, no control characters. */
function isProjectPath(p) {
  return typeof p === 'string' && p.length > 4 && p.length < 4096 && !/[\u0000-\u001f]/.test(p) && /\.esb$/i.test(p)
}

/** Only the app's own page may be navigated to; the rest (other file: URLs, remote pages) is dropped. */
function isAppUrl(url, allowed) {
  const strip = (u) => String(u || '').split('#')[0].split('?')[0].toLowerCase()
  const want = strip(url)
  return allowed.some((a) => a && strip(a) === want)
}

module.exports = { IMAGE_EXT, DRAG_EXT, MAX_IMAGE_FETCH_BYTES, imageFileName, dragFileName, isImageBytes, safeImageFetchOptions, isProjectPath, isAppUrl }
