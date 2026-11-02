// ESB Studio — the Video desk's music library, in the main process. The library reads ONLY from one folder the owner
// chose in main's own dialog (Phase 4, docs/VIDEO_PRO_PLAN.md non-negotiable 5): nothing is bundled and nothing is
// downloaded. The renderer is treated as hostile: it never names an absolute path. It asks for the list, and for a file
// by its path RELATIVE to the chosen folder; main resolves that through every link and junction (realpath) and refuses
// anything whose real location is not inside the chosen folder's real location, anything that is not a plain audio
// file, and any traversal ("..", drive letters, UNC, absolute paths, control characters). The access is read-only: no
// write, rename or delete exists on this surface. A file the renderer asks to use is added to the Video media
// registry (so the editor's `esb-media://m/<id>` protocol can serve it with range requests); choosing the folder is
// the owner's approval of the files inside it, and nothing outside it is ever added.
const fs = require('node:fs')
const path = require('node:path')

const AUDIO_TYPES = {
  mp3: 'audio/mpeg', wav: 'audio/wav', m4a: 'audio/mp4', aac: 'audio/aac', ogg: 'audio/ogg', opus: 'audio/ogg', flac: 'audio/flac',
}
const AUDIO_EXT = new Set(Object.keys(AUDIO_TYPES))
const MAX_FILES = 2000
const MAX_DEPTH = 3
const MAX_REL = 400
/** The most directory entries looked at and folders opened in one listing (a drive root would otherwise be walked for seconds). */
const MAX_ENTRIES = 20000
const MAX_DIRS = 400

const extOf = (p) => String(p).split('.').pop().toLowerCase()
const isNetworkOrDevicePath = (p) => /^[\\/]{2}/.test(String(p))
const real = (p) => fs.realpathSync.native(p)
const sameish = (a, b) => (process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b)

/** `child` is `root` or lies inside it (both real paths). */
function within(root, child) {
  if (sameish(root, child)) return true
  const rel = path.relative(root, child)
  return !!rel && !rel.startsWith('..') && !path.isAbsolute(rel)
}

/** A folder the renderer may be told about: a plain local absolute directory. */
function isFolderPath(p) {
  if (typeof p !== 'string' || p.length < 3 || p.length > 4096 || /[\u0000-\u001f]/.test(p) || isNetworkOrDevicePath(p) || !path.isAbsolute(p)) return false
  try { return fs.statSync(p).isDirectory() } catch { return false }
}

/** A relative path the renderer may name: forward slashes, no empty / "." / ".." parts, no drive letter, colon (an
 * NTFS alternate stream), backslash, control character or reserved Windows character; a known audio extension. */
function safeRel(rel) {
  if (typeof rel !== 'string' || !rel || rel.length > MAX_REL) return null
  if (/[\u0000-\u001f\\:*?"<>|]/.test(rel) || rel.startsWith('/') || /^[a-zA-Z]:/.test(rel)) return null
  const parts = rel.split('/')
  if (parts.length > MAX_DEPTH + 1) return null
  for (const part of parts) if (!part || part === '.' || part === '..' || /[. ]$/.test(part)) return null
  if (!AUDIO_EXT.has(extOf(parts[parts.length - 1]))) return null
  return parts.join('/')
}

/** The real path of the audio file `rel` inside `root`, or null. Every link on the way is resolved: a junction or a
 * symlink that leads out of the folder is refused, and so is anything that is not a plain file. */
function confinedAudio(root, rel) {
  const r = safeRel(rel)
  if (!r || !isFolderPath(root)) return null
  try {
    const realRoot = real(root)
    const file = real(path.join(realRoot, ...r.split('/')))
    if (!within(realRoot, file) || sameish(realRoot, file)) return null
    if (!fs.statSync(file).isFile() || !AUDIO_EXT.has(extOf(file))) return null
    return file
  } catch {
    return null
  }
}

/** The audio files under `root` (at most MAX_DEPTH folders deep, MAX_FILES of them; at most MAX_ENTRIES entries and
 * MAX_DIRS folders looked at), as relative paths with their size and modified time. Directory links and junctions are
 * not followed. Read-only. Asynchronous: the main process is never held while a big folder is read. */
async function listAudioAsync(root) {
  const out = []
  if (!isFolderPath(root)) return { files: out, truncated: false }
  let realRoot
  try { realRoot = real(root) } catch { return { files: out, truncated: false } }
  let truncated = false
  let seen = 0
  let dirs = 0
  const walk = async (dir, prefix, depth) => {
    if (++dirs > MAX_DIRS) { truncated = true; return }
    let entries
    try { entries = await fs.promises.readdir(dir, { withFileTypes: true }) } catch { return }
    entries.sort((a, b) => a.name.localeCompare(b.name))
    for (const e of entries) {
      if (out.length >= MAX_FILES || ++seen > MAX_ENTRIES) { truncated = true; return }
      const abs = path.join(dir, e.name)
      const rel = prefix ? `${prefix}/${e.name}` : e.name
      if (e.isSymbolicLink()) continue // a link could lead anywhere: not listed, not followed
      if (e.isDirectory()) {
        if (depth < MAX_DEPTH) {
          // a junction (Windows) reads as a directory: it must still resolve inside the chosen folder
          try { if (!within(realRoot, await fs.promises.realpath(abs))) continue } catch { continue }
          await walk(abs, rel, depth + 1)
          if (truncated) return
        }
        continue
      }
      if (!e.isFile() || !AUDIO_EXT.has(extOf(e.name)) || !safeRel(rel)) continue
      try {
        const st = await fs.promises.stat(abs)
        out.push({ rel, name: e.name, size: st.size, mtimeMs: Math.round(st.mtimeMs) })
      } catch { /* gone */ }
    }
  }
  await walk(realRoot, '', 0)
  return { files: out, truncated }
}

/** Synchronous listing with the same limits (tests, tools). */
function listAudio(root) {
  const out = []
  if (!isFolderPath(root)) return { files: out, truncated: false }
  let realRoot
  try { realRoot = real(root) } catch { return { files: out, truncated: false } }
  let truncated = false
  let seen = 0
  let dirs = 0
  const walk = (dir, prefix, depth) => {
    if (++dirs > MAX_DIRS) { truncated = true; return }
    let entries
    try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return }
    entries.sort((a, b) => a.name.localeCompare(b.name))
    for (const e of entries) {
      if (out.length >= MAX_FILES || ++seen > MAX_ENTRIES) { truncated = true; return }
      const abs = path.join(dir, e.name)
      const rel = prefix ? `${prefix}/${e.name}` : e.name
      if (e.isSymbolicLink()) continue
      if (e.isDirectory()) {
        if (depth < MAX_DEPTH) {
          try { if (!within(realRoot, real(abs))) continue } catch { continue }
          walk(abs, rel, depth + 1)
          if (truncated) return
        }
        continue
      }
      if (!e.isFile() || !AUDIO_EXT.has(extOf(e.name)) || !safeRel(rel)) continue
      try {
        const st = fs.statSync(abs)
        out.push({ rel, name: e.name, size: st.size, mtimeMs: Math.round(st.mtimeMs) })
      } catch { /* gone */ }
    }
  }
  walk(realRoot, '', 0)
  return { files: out, truncated }
}

/** The chosen folder, kept across launches in `file` (userData/video-music-folder.json). */
function createMusicFolder({ file }) {
  let folder = null
  try {
    const j = JSON.parse(fs.readFileSync(file, 'utf8'))
    if (j && typeof j.path === 'string' && isFolderPath(j.path)) folder = path.resolve(j.path)
  } catch { /* first run */ }
  const save = () => {
    try { fs.writeFileSync(file, JSON.stringify({ path: folder })) } catch { /* best effort */ }
  }
  return {
    get: () => (folder && isFolderPath(folder) ? folder : null),
    /** Only main's own dialog result reaches this. */
    set(p) { if (!isFolderPath(p)) return null; folder = path.resolve(p); save(); return folder },
    clear() { folder = null; save() },
  }
}

module.exports = { AUDIO_EXT, AUDIO_TYPES, MAX_FILES, MAX_DEPTH, MAX_ENTRIES, MAX_DIRS, safeRel, confinedAudio, listAudio, listAudioAsync, isFolderPath, createMusicFolder }
