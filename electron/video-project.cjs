// ESB Studio — the Video desk's project folders, in the main process (Phase 1).
//
//   <Pictures>/ESB Banners/Video/<name>.esbvideo/
//     project.json   the project (versioned schema, src/video/projectFolder.ts)
//     media/         files the editor chose to copy into the project (the default is to reference them by path)
//     proxies/       540p H.264 stand-ins for heavy footage, named by the source's quick hash (preview only)
//     cache/         waveforms, filmstrips and the like (key → bytes, capped)
//     autosave/      the last 5 snapshots (temp + rename)
//     renders/       exports kept with the project
//
// The renderer is hostile. It names a folder only by an opaque id this process handed out when the editor created or
// opened the folder in main's own dialog (`createFolderRegistry`), and a file in it only as `<dir>/<name>` under one
// of the folder's own subfolders (`safeRel`). Every such path is resolved to its real location (junctions and symlinks
// followed) and refused unless that is still inside the folder's real location (`confinedFile`), so a junction
// `media/x → C:\private`, a `..`, an alternate data stream (`clip.mp4:secret`), a device name or a UNC path never
// reaches the disk. Pure where possible, so it is unit-tested (tools/unit/video-project.test.ts).
const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')
const { isMediaPath, isNetworkOrDevicePath, MEDIA_EXT, videoKind, writeFileAtomicSync, writeFileAtomic } = require('./video-media.cjs')

const FOLDER_DIRS = ['media', 'proxies', 'cache', 'autosave', 'renders']
/** Subfolders whose files esb-media:// may serve (never cache/ or autosave/, which are read through IPC only). */
const SERVED_DIRS = new Set(['media', 'proxies', 'renders'])
const ALL_DIRS = new Set(FOLDER_DIRS)
const PROJECT_FILE = 'project.json'
const MAX_PROJECT_TEXT = 25 * 1024 * 1024
const LIBRARY_KEY = 'u'

/** Any colon after the drive letter: an NTFS alternate data stream (`clip.mp4:hidden`) or a malformed path. */
const hasStreamSuffix = (p) => String(p).replace(/^[a-zA-Z]:/, '').includes(':')

/** A plain local absolute path: no control characters, not UNC or a device path, no data stream. */
function isLocalAbsolute(p) {
  return typeof p === 'string' && p.length > 3 && p.length < 4096 && !/[\u0000-\u001f]/.test(p) && !isNetworkOrDevicePath(p) && !hasStreamSuffix(p) && path.isAbsolute(p)
}

/** A project folder path: local, absolute, its last part ending in `.esbvideo`. */
function isProjectFolderPath(p) {
  return isLocalAbsolute(p) && /\.esbvideo$/i.test(String(p).replace(/[\\/]+$/, ''))
}

const WIN_RESERVED = /^(con|prn|aux|nul|com\d|lpt\d|conin\$|conout\$)(\..*)?$/i

/** A file name the app may create or read inside a project subfolder: no separators, no reserved device name, no
 * trailing dot or space (Windows drops them, so `x.mp4.` would be `x.mp4`), no wildcard or stream characters. */
function isSafeName(name) {
  return typeof name === 'string' && name.length > 0 && name.length <= 180 && !/[\u0000-\u001f\\/:*?"<>|]/.test(name) && name !== '.' && name !== '..' && !/[. ]$/.test(name) && !WIN_RESERVED.test(name)
}

/** A path the renderer names inside a project folder: exactly `<subfolder>/<file name>`, the subfolder one of `allowed`.
 * Returns it with forward slashes, or null. */
function safeRel(rel, allowed = SERVED_DIRS) {
  if (typeof rel !== 'string' || !rel || rel.length > 200) return null
  const parts = rel.split(/[\\/]/)
  if (parts.length !== 2 || !allowed.has(parts[0]) || !isSafeName(parts[1])) return null
  return parts.join('/')
}

const sameish = (a, b) => (process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b)

/** `p` lies strictly inside `root` (lexically; case-insensitive on Windows). */
function isInside(root, p) {
  const rel = path.relative(path.resolve(root), path.resolve(p))
  return !!rel && !rel.startsWith('..') && !path.isAbsolute(rel)
}

const real = (p) => fs.realpathSync.native(p)

/** The real path of an existing file `rel` (`<sub>/<name>`) inside the folder `root`, or null. The subfolder's real
 * location must be the folder's own `<sub>` (not a junction to elsewhere, not another subfolder), and the file's real
 * location (after every junction and symlink on the way) must sit directly in it, as a plain file. So
 * `proxies/x.mp4` can never be a link into `cache/` or `autosave/`, which are never served. */
function confinedFile(root, rel, allowed = SERVED_DIRS) {
  const r = safeRel(rel, allowed)
  if (!r || !isLocalAbsolute(root)) return null
  const [sub] = r.split('/')
  const target = path.join(root, r)
  if (!isInside(root, target)) return null
  try {
    const realRoot = real(root)
    const realSub = real(path.join(root, sub))
    if (!sameish(path.dirname(realSub), realRoot) || !sameish(path.basename(realSub), sub)) return null
    const file = real(target)
    if (!sameish(path.dirname(file), realSub) || !fs.statSync(file).isFile()) return null
    return file
  } catch {
    return null
  }
}

/** confinedFile behind a short-lived memo (esb-media://p range requests ask for the same file many times a second;
 * each answer cost a realpath of the folder, the subfolder and the file plus a stat). An entry lives `ttlMs` and is
 * dropped by `invalidate(key)` when this process changes that folder (a proxy finished). A file that turns out to be
 * gone when it is opened is simply a 404, and the next request resolves it again. */
function createConfinedResolver({ ttlMs = 1500, max = 500, now = () => Date.now() } = {}) {
  const memo = new Map()
  return {
    resolve(key, root, rel, allowed = SERVED_DIRS) {
      const k = `${key}\u0000${root}\u0000${rel}`
      const hit = memo.get(k)
      const t = now()
      if (hit && t - hit.at < ttlMs) return hit.file
      const file = confinedFile(root, rel, allowed)
      if (memo.size >= max) memo.delete(memo.keys().next().value)
      memo.set(k, { at: t, file, key })
      return file
    },
    invalidate(key) { for (const [k, v] of memo) if (key == null || v.key === key) memo.delete(k) },
    size: () => memo.size,
  }
}

/** The real path of the subfolder `name` of `root` (made if missing), refused if it is a junction or link that leads
 * anywhere but directly inside the folder. */
function confinedDir(root, name) {
  if (!ALL_DIRS.has(name) || !isLocalAbsolute(root)) throw new Error('Bad project subfolder')
  const dir = path.join(root, name)
  fs.mkdirSync(dir, { recursive: true })
  const realRoot = real(root)
  const realDir = real(dir)
  if (!sameish(path.dirname(realDir), realRoot) || !sameish(path.basename(realDir), name)) throw new Error(`The project's ${name} folder points outside the project`)
  return realDir
}

/** A fresh file path `<subfolder>/<name>` to write inside the folder: the subfolder is confined, and an existing
 * entry with that name that is not a plain file (a link, a junction, a folder) is refused. */
function confinedTarget(root, sub, name) {
  if (!isSafeName(name)) throw new Error('Bad file name')
  const dir = confinedDir(root, sub)
  const target = path.join(dir, name)
  try {
    const st = fs.lstatSync(target)
    if (!st.isFile()) throw new Error('Refusing to write over a link or folder')
  } catch (e) {
    if (e && e.code !== 'ENOENT') throw e
  }
  return target
}

const norm = (p) => path.resolve(String(p)).replace(/[\\/]+$/, '').replace(/\\/g, '/').toLowerCase()
/** The opaque id a project folder is known by: an HMAC of its path with this install's own secret (userData), so an
 * id cannot be worked out from a path (or a path checked against an id) by anyone who does not hold the secret. */
const folderId = (p, secret) => {
  if (typeof secret !== 'string' || secret.length < 32) throw new Error('folderId needs the install secret')
  return crypto.createHmac('sha256', secret).update('esb-folder:' + norm(p)).digest('hex').slice(0, 32)
}

/** This install's secret for folder ids: 32 random bytes kept in `file` (made once, 'wx', so two first runs agree on
 * one). A missing or damaged file gets a new secret: known folders then simply get new ids (the registry keeps paths). */
function loadInstallSecret(file) {
  try { const t = fs.readFileSync(file, 'utf8').trim(); if (/^[0-9a-f]{64}$/.test(t)) return t } catch { /* first run */ }
  const fresh = crypto.randomBytes(32).toString('hex')
  try {
    fs.writeFileSync(file, fresh, { flag: 'wx' })
    return fresh
  } catch {
    try { const t = fs.readFileSync(file, 'utf8').trim(); if (/^[0-9a-f]{64}$/.test(t)) return t } catch { /* unreadable */ }
    try { writeFileAtomicSync(file, fresh) } catch { /* memory only: ids last this session */ }
    return fresh
  }
}

/** Project folders the editor created or opened in main's own dialog, kept across launches (userData/video-folders.json,
 * newest last, at most `max`). Only these may be named by id. */
function createFolderRegistry({ file, secret, max = 200 }) {
  const byId = new Map()
  const idOf = (p) => folderId(p, secret)
  try {
    const list = JSON.parse(fs.readFileSync(file, 'utf8'))
    if (Array.isArray(list)) for (const p of list.slice(-max)) if (isProjectFolderPath(p)) byId.set(idOf(p), path.resolve(p))
  } catch { /* first run */ }
  const flush = () => {
    try { writeFileAtomicSync(file, JSON.stringify([...byId.values()])) } catch { /* best effort */ }
  }
  return {
    /** Approve a folder (it must exist as a directory); returns its id, or null. */
    add(p) {
      if (!isProjectFolderPath(p)) return null
      try { if (!fs.statSync(p).isDirectory()) return null } catch { return null }
      const id = idOf(p)
      byId.delete(id)
      byId.set(id, path.resolve(p))
      while (byId.size > max) byId.delete(byId.keys().next().value)
      flush()
      return id
    },
    /** The folder for an id, or null (unknown id, or the folder is gone). */
    pathFor(id) {
      if (typeof id !== 'string' || !/^[0-9a-f]{32}$/.test(id)) return null
      const p = byId.get(id)
      if (!p) return null
      try { return fs.statSync(p).isDirectory() ? p : null } catch { return null }
    },
    list: () => [...byId.values()],
    /** [{ id, path }] for every known folder (oldest first). */
    entries: () => [...byId.entries()].map(([id, p]) => ({ id, path: p })),
    size: () => byId.size,
    flush,
  }
}

/** Make (or reuse) a project folder with its subfolders. Refuses a file of that name, and a folder that is not empty and
 * is not already a project (so a Save never mixes a project into someone's footage folder). */
function createProjectFolder(dir) {
  if (!isProjectFolderPath(dir)) throw new Error('A project folder must be a local folder ending in .esbvideo')
  let st = null
  try { st = fs.statSync(dir) } catch { /* new */ }
  if (st && !st.isDirectory()) throw new Error('A file with that name is already there (an older single-file project?). Choose another name.')
  if (st) {
    const names = fs.readdirSync(dir)
    if (names.length && !names.includes(PROJECT_FILE)) throw new Error('That folder is not empty and is not a video project.')
  }
  fs.mkdirSync(dir, { recursive: true })
  for (const d of FOLDER_DIRS) confinedDir(dir, d)
  if (st) cleanFolder(dir)
  return path.resolve(dir)
}

const STRAY = /\.(partial|copying|tmp)$/

/** Remove half-written files (`*.partial`, `*.copying`, `*.tmp`) left in one folder by a session that ended mid-job
 * (they are redone). Plain files only: a link or folder of that name is left alone (never followed). */
function cleanPartials(dir) {
  try {
    for (const f of fs.readdirSync(dir)) {
      if (!STRAY.test(f)) continue
      const p = path.join(dir, f)
      try { if (fs.lstatSync(p).isFile() || fs.lstatSync(p).isSymbolicLink()) fs.rmSync(p, { force: true }) } catch { /* gone */ }
    }
  } catch { /* nothing there */ }
}

/** Clean a whole project folder (its root and every subfolder) of half-written files. Run once per folder per session
 * before this session writes there: on open, on a Save into an existing folder, and the first time an id is used. */
function cleanFolder(root) {
  if (!isLocalAbsolute(root)) return
  cleanPartials(root)
  for (const d of FOLDER_DIRS) { try { cleanPartials(confinedDir(root, d)) } catch { /* a linked or unreadable subfolder */ } }
}

/** project.json of a folder: its text (≤ 25 MB), read from inside the folder's real location. */
async function readProjectJson(dir) {
  if (!isProjectFolderPath(dir)) throw new Error('Not a project folder')
  const realRoot = real(dir)
  const file = real(path.join(dir, PROJECT_FILE))
  if (!sameish(path.dirname(file), realRoot)) throw new Error('project.json points outside the project')
  const st = await fs.promises.stat(file)
  if (!st.isFile() || st.size > MAX_PROJECT_TEXT) throw new Error('project.json is not a readable project')
  return fs.promises.readFile(file, 'utf8')
}

/** Write project.json (temp + rename). Only JSON is written. */
function writeProjectJson(dir, text) {
  if (typeof text !== 'string' || !text.length || text.length > MAX_PROJECT_TEXT) throw new Error('Bad project text')
  JSON.parse(text)
  if (!isProjectFolderPath(dir)) throw new Error('Not a project folder')
  const target = path.join(dir, PROJECT_FILE)
  try { if (!fs.lstatSync(target).isFile()) throw new Error('project.json is not a plain file') } catch (e) { if (e && e.code !== 'ENOENT') throw e }
  return writeFileAtomicSync(target, text, 'utf8')
}

// ---------------------------------------------------------------- quick hash (relink) and copying into media/

const QH_CHUNK = 64 * 1024

/** A quick content fingerprint for relinking: size + the first, middle and last 64 KB (the whole file when small).
 * 32 hex characters. Reads at most 192 KB, so hashing a bin of 4K files on open stays cheap. */
async function quickHash(p) {
  const fh = await fs.promises.open(p, 'r')
  try {
    const { size } = await fh.stat()
    const h = crypto.createHash('sha256').update(`esb-qh1:${size}:`)
    const spots = size <= 3 * QH_CHUNK ? [[0, size]] : [[0, QH_CHUNK], [Math.floor(size / 2) - QH_CHUNK / 2, QH_CHUNK], [size - QH_CHUNK, QH_CHUNK]]
    for (const [at, len] of spots) {
      const b = Buffer.alloc(len)
      const { bytesRead } = await fh.read(b, 0, len, at)
      h.update(b.subarray(0, bytesRead))
    }
    return h.digest('hex').slice(0, 32)
  } finally {
    await fh.close()
  }
}

/** A file name safe to create in media/ from an imported file's name (its media extension kept). */
function mediaNameFor(src) {
  const ext = String(src).split('.').pop().toLowerCase()
  const stem = path.basename(String(src), path.extname(String(src))).replace(/[\u0000-\u001f\\/:*?"<>|]+/g, '-').replace(/[. ]+$/, '').slice(0, 120) || 'media'
  const name = `${WIN_RESERVED.test(stem) ? '_' + stem : stem}.${ext}`
  return isSafeName(name) && MEDIA_EXT.has(ext) ? name : null
}

/** Free bytes on the volume holding `dir`, or null. */
function freeBytes(dir) {
  try { const s = fs.statfsSync(dir); return Number(s.bavail) * Number(s.bsize) } catch { return null }
}

/** Copy an imported file into the project's media/ (the editor chose "Copy into project"). The same file copied before
 * (same name, size and quick hash) is reused; another file of that name gets a free name. A file already in media/ is
 * used where it is. Written as `.copying` + rename, so a half copy never looks like media. */
async function copyIntoMedia(root, src, { minFree = 512 * 1024 * 1024 } = {}) {
  if (!isMediaPath(src) || hasStreamSuffix(src)) throw new Error('Not a local media file')
  const st = await fs.promises.stat(src)
  if (!st.isFile()) throw new Error('Not a file')
  const mediaDir = confinedDir(root, 'media')
  const realSrc = real(src)
  if (isInside(mediaDir, realSrc)) return realSrc
  const name = mediaNameFor(src)
  if (!name) throw new Error('That file name cannot be copied')
  const free = freeBytes(mediaDir)
  if (free != null && free < st.size + minFree) throw new Error(`Not enough free space to copy ${path.basename(src)} into the project.`)
  let target = confinedTarget(root, 'media', name)
  if (fs.existsSync(target)) {
    const tst = fs.statSync(target)
    if (tst.size === st.size && (await quickHash(target)) === (await quickHash(src))) return target
    const ext = path.extname(name)
    const stem = name.slice(0, name.length - ext.length)
    let n = 2
    while (fs.existsSync(path.join(mediaDir, `${stem} (${n})${ext}`)) && n < 10000) n++
    target = confinedTarget(root, 'media', `${stem} (${n})${ext}`)
  }
  const tmp = target + '.copying'
  try {
    await fs.promises.copyFile(src, tmp, fs.constants.COPYFILE_EXCL)
    await fs.promises.rename(tmp, target)
  } catch (e) {
    try { fs.rmSync(tmp, { force: true }) } catch { /* gone */ }
    throw e
  }
  return target
}

// ---------------------------------------------------------------- relink by hash

/** The folders to look in for a missing file: the project's media/, and — only when the original path is one this app
 * approved before (it is in the media registry) — the folder it was in and that folder's sibling folders (one level,
 * at most 40). A crafted project that names a path this app never imported gets no search outside the project. */
async function relinkDirs({ root, original, approved }) {
  const dirs = []
  if (root) { try { dirs.push(confinedDir(root, 'media')) } catch { /* no media folder */ } }
  if (approved && isMediaPath(original) && !hasStreamSuffix(original)) {
    const dir = path.dirname(original)
    dirs.push(dir)
    const parent = path.dirname(dir)
    if (parent !== dir) {
      try {
        const subs = (await fs.promises.readdir(parent, { withFileTypes: true })).filter((d) => d.isDirectory() && !sameish(path.join(parent, d.name), dir)).slice(0, 40)
        for (const d of subs) dirs.push(path.join(parent, d.name))
      } catch { /* parent unreadable */ }
    }
  }
  const seen = new Set()
  return dirs.filter((d) => { const k = norm(d); if (seen.has(k)) return false; seen.add(k); return true })
}

/** Find files matching each wanted {id, size, hash} in `dirs` (plain files only, links skipped; at most `maxEntries`
 * directory entries looked at in all). Only a file of the same size is hashed, one at a time, at most `maxHashes` in
 * all. Cloud placeholders (OneDrive "online-only" files) cannot be told apart cheaply from Node (no file-attribute
 * API), and hashing one downloads it: so a hash that takes longer than `slowMs` marks its folder slow and the rest of
 * that folder is skipped, and the whole search stops after `budgetMs`. Returns Map id → path. */
async function findByHash(items, dirs, { maxEntries = 20000, maxHashes = 200, slowMs = 1500, budgetMs = 20000, now = () => Date.now(), hash = quickHash } = {}) {
  const want = (Array.isArray(items) ? items : []).slice(0, 500).filter((i) => i && typeof i.id === 'string' && Number.isSafeInteger(i.size) && i.size > 0 && /^[0-9a-f]{32}$/.test(String(i.hash)))
  const bySize = new Map()
  for (const i of want) { const l = bySize.get(i.size) || []; l.push(i); bySize.set(i.size, l) }
  const found = new Map()
  let seen = 0
  let hashes = 0
  const t0 = now()
  outer: for (const dir of dirs) {
    if (!isLocalAbsolute(dir)) continue
    let entries
    try { entries = await fs.promises.readdir(dir, { withFileTypes: true }) } catch { continue }
    for (const d of entries) {
      if (++seen > maxEntries) break outer
      if (found.size === want.length) break outer
      if (now() - t0 > budgetMs || hashes >= maxHashes) break outer
      if (!d.isFile()) continue // a symlink or junction is never followed here
      const p = path.join(dir, d.name)
      if (!isMediaPath(p) || hasStreamSuffix(p)) continue
      let st
      try { st = await fs.promises.stat(p) } catch { continue }
      const cands = (bySize.get(st.size) || []).filter((c) => !found.has(c.id))
      if (!cands.length) continue
      let h
      const h0 = now()
      hashes++
      try { h = await hash(p) } catch { continue }
      for (const c of cands) if (c.hash === h) found.set(c.id, p)
      if (now() - h0 > slowMs) continue outer // a slow (cloud / network-backed) folder: skip the rest of it
    }
  }
  return found
}

// ---------------------------------------------------------------- cache/ (waveforms, filmstrips)

const CACHE_KEY = /^[a-z0-9-]{1,80}$/
const CACHE_MAX_EACH = 32 * 1024 * 1024
const CACHE_MAX_TOTAL = 1024 * 1024 * 1024

/** Key → bytes in a cache folder. Keys are `[a-z0-9-]{1,80}`; each entry ≤ 32 MB; the folder ≤ 1 GB. Past the cap a
 * write is refused (nothing is evicted: something may still use it); the caller recomputes what it needs. Writes to
 * one folder run one after another (a promise chain per folder), so 40 writes sent at once are each checked against
 * the total the previous ones left — they once all passed the cap together. Each goes to a random temp name opened
 * with 'wx', then is renamed into place. */
function createCacheStore({ maxEach = CACHE_MAX_EACH, maxTotal = CACHE_MAX_TOTAL } = {}) {
  const totals = new Map()
  const chains = new Map()
  const scan = (dir) => {
    let n = 0
    try { for (const f of fs.readdirSync(dir)) { if (!f.endsWith('.bin')) continue; try { n += fs.lstatSync(path.join(dir, f)).size } catch { /* gone */ } } } catch { /* empty */ }
    return n
  }
  const fileFor = (dir, key) => {
    if (typeof key !== 'string' || !CACHE_KEY.test(key)) throw new Error('Bad cache key')
    return path.join(dir, key + '.bin')
  }
  const serial = (dir, fn) => {
    const k = norm(dir)
    const run = (chains.get(k) || Promise.resolve()).then(fn, fn)
    const tail = run.catch(() => {})
    chains.set(k, tail)
    tail.then(() => { if (chains.get(k) === tail) chains.delete(k) })
    return run
  }
  return {
    async read(dir, key) {
      const f = fileFor(dir, key)
      try {
        const st = await fs.promises.lstat(f)
        if (!st.isFile() || st.size > maxEach) return null
        return new Uint8Array(await fs.promises.readFile(f))
      } catch { return null }
    },
    write(dir, key, bytes) {
      let f
      try { f = fileFor(dir, key) } catch (e) { return Promise.reject(e) }
      if (!(bytes instanceof Uint8Array) || bytes.length > maxEach) return Promise.reject(new Error(`Cache entries are at most ${Math.round(maxEach / 1048576)} MB`))
      return serial(dir, async () => {
        let old = 0
        try { const st = fs.lstatSync(f); if (!st.isFile()) throw new Error('Refusing to write over a link'); old = st.size } catch (e) { if (e && e.code !== 'ENOENT') throw e }
        const total = totals.has(dir) ? totals.get(dir) : scan(dir)
        if (total - old + bytes.length > maxTotal) throw new Error('The project cache is full')
        await writeFileAtomic(f, bytes)
        totals.set(dir, total - old + bytes.length)
      })
    },
    total: (dir) => (totals.has(dir) ? totals.get(dir) : scan(dir)),
  }
}

// ---------------------------------------------------------------- proxies

/** proxies/<hash>.mp4 for a source's quick hash. */
const proxyName = (hash) => (typeof hash === 'string' && /^[0-9a-f]{32}$/.test(hash) ? `${hash}.mp4` : null)

/** A finished proxy: the file is there and starts like an MP4. */
function proxyReady(root, hash) {
  const name = proxyName(hash)
  if (!name) return false
  const f = confinedFile(root, 'proxies/' + name)
  if (!f) return false
  try {
    const head = Buffer.alloc(16)
    const fd = fs.openSync(f, 'r')
    try { fs.readSync(fd, head, 0, 16, 0) } finally { fs.closeSync(fd) }
    return !!videoKind(head)
  } catch { return false }
}

/** The esb-media:// URL of a file inside a folder known by `key` (a folder id, or 'u' for the app's own library). */
const folderUrl = (key, rel) => `esb-media://p/${key}/${rel.split('/').map(encodeURIComponent).join('/')}`

/** Total size of the files in a folder (one level). */
function dirBytes(dir) {
  let n = 0
  try { for (const f of fs.readdirSync(dir)) { try { const st = fs.statSync(path.join(dir, f)); if (st.isFile()) n += st.size } catch { /* gone */ } } } catch { /* none */ }
  return n
}

module.exports = {
  FOLDER_DIRS, SERVED_DIRS, PROJECT_FILE, LIBRARY_KEY, MAX_PROJECT_TEXT,
  hasStreamSuffix, isLocalAbsolute, isProjectFolderPath, isSafeName, safeRel, isInside, confinedFile, confinedDir, confinedTarget, createConfinedResolver,
  folderId, loadInstallSecret, createFolderRegistry, createProjectFolder, cleanPartials, cleanFolder, readProjectJson, writeProjectJson,
  quickHash, mediaNameFor, copyIntoMedia, relinkDirs, findByHash,
  CACHE_KEY, CACHE_MAX_EACH, CACHE_MAX_TOTAL, createCacheStore,
  proxyName, proxyReady, folderUrl, dirBytes,
}
