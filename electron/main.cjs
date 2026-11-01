const { spawn } = require('node:child_process')
// ESB Studio — desktop shell. Everything runs locally; no network access is needed.
const { app, BrowserWindow, Menu, ipcMain, dialog, shell, Tray, nativeImage, clipboard, protocol } = require('electron')
const path = require('node:path')
const fs = require('node:fs')
const { FsScope } = require('./fs-scope.cjs')
const { fetchArticleHtml, fetchImageData } = require('./net-guard.cjs')
const siteUpload = require('./site-upload.cjs')
const guard = require('./ipc-guard.cjs')
const { pathToFileURL } = require('node:url')
const dns = require('node:dns')
const { createEventLog } = require('./outreach-events.cjs')
const { createJobStore } = require('./outreach-jobs.cjs')
const { createSettingsManager } = require('./outreach-settings.cjs')
const { createEngine } = require('./outreach-engine.cjs')
const { createTray } = require('./outreach-tray.cjs')
const outreachGuard = require('./outreach-guard.cjs')
const videoMedia = require('./video-media.cjs')

// The Video desk's media protocol (esb-media://m/<id>, electron/video-media.cjs). Registered before the app is ready so
// <video>, fetch and the decoder can stream from it with range requests; served on the editor's session only.
protocol.registerSchemesAsPrivileged([{ scheme: 'esb-media', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true } }])

// Last line of defence: a stray network or stream error in the main process is logged (userData/main-errors.log) instead
// of stopping the editor with Electron's "A JavaScript error occurred in the main process" dialog. Each cause found is
// still fixed where it starts — this only keeps an unseen one from taking the desk down mid-story.
function logMainError(kind, err) {
  const line = `[${new Date().toISOString()}] ${kind}: ${err && err.stack ? err.stack : String(err)}\n`
  console.error(line)
  try { fs.appendFileSync(path.join(app.getPath('userData'), 'main-errors.log'), line) } catch { /* the log is best effort */ }
}
process.on('uncaughtException', (err) => logMainError('uncaughtException', err))
process.on('unhandledRejection', (err) => logMainError('unhandledRejection', err))

// Keep the profile folder of the earlier name so saved work, recents and export settings carry over after the rename.
if (process.env.ESB_USER_DATA) app.setPath('userData', process.env.ESB_USER_DATA)
else if (!app.commandLine.hasSwitch('user-data-dir')) app.setPath('userData', path.join(app.getPath('appData'), 'ESB Banner Studio'))

// High-refresh-rate monitor reactivity: GPU rasterization & zero-copy compositing
app.commandLine.appendSwitch('enable-gpu-rasterization')
app.commandLine.appendSwitch('enable-zero-copy')

// Single-instance lock: instant startup and window focus, avoids profile disk locks
const gotTheLock = app.requestSingleInstanceLock()
if (!gotTheLock) {
  app.quit()
  process.exit(0)
}

const DEV_URL = process.env.ESB_DEV_URL
const INDEX_FILE = path.join(__dirname, '..', 'dist', 'index.html')
// the only pages the editor window may show: its own index.html (or the dev server); a taken-over page cannot load another file: URL
const APP_URLS = [DEV_URL, pathToFileURL(INDEX_FILE).href]
const defaultDir = () => path.join(app.getPath('pictures'), 'ESB Banners')
let win

const fsScope = new FsScope()

let outreachEvents = null
let outreachJobs = null
let outreachSettings = null
let outreachEngineInstance = null
let outreachTrayInstance = null
let isQuitting = false

function pushToWindow(channel, payload) {
  if (win && !win.isDestroyed() && win.webContents) {
    win.webContents.send(channel, payload)
  }
}

async function checkOnline() {
  try {
    const s = outreachMailer().status()
    const host = (s.settings && s.settings.host) || 'smtp.gmail.com'
    await dns.promises.lookup(host)
    return true
  } catch {
    return false
  }
}

app.on('second-instance', () => {
  if (win) {
    if (win.isMinimized()) win.restore()
    win.show()
    win.focus()
  } else {
    createWindow()
  }
})

function createWindow() {
  win = new BrowserWindow({
    width: 1600,
    height: 940,
    minWidth: 900, // a 1366 × 768 laptop at 150 % scaling is 911 px wide; every workspace header fits at 900
    minHeight: 680,
    backgroundColor: '#15171c',
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    title: 'ESB AI Studio',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })
  // No native menu: the app has its own menu bar, and a hidden native one pops up whenever Alt is tapped (Alt is a drag modifier here).
  Menu.setApplicationMenu(null)
  win.setMenuBarVisibility(false)
  // zoom belongs to the canvas, not the whole window
  win.webContents.on('did-finish-load', () => {
    try {
      const p = win.webContents.setVisualZoomLevelLimits(1, 1)
      if (p && typeof p.catch === 'function') p.catch(() => {})
    } catch {}
  })
  if (DEV_URL) win.loadURL(DEV_URL)
  else win.loadFile(INDEX_FILE)
  // never navigate the editor away from itself; open links in the default browser
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:\/\//i.test(url)) shell.openExternal(url); return { action: 'deny' } })  // only web links ever leave the app (never file:, ms-settings:, custom schemes)
  win.webContents.on('will-navigate', (e, url) => { if (!guard.isAppUrl(url, APP_URLS)) e.preventDefault() })

  // S3: Install permission handlers: only microphone (media) for app origin, deny everything else
  const ses = win.webContents.session
  // the microphone, for the editor window only (the CMS window has its own session, which denies everything)
  ses.setPermissionRequestHandler((wc, permission, callback) => {
    callback(permission === 'media' && wc === win.webContents)
  })
  ses.setPermissionCheckHandler((wc, permission) => {
    return permission === 'media' && wc === win.webContents
  })

  win.on('close', (e) => {
    if (isQuitting) return
    const cfg = outreachSettings ? outreachSettings.get() : {}
    if (cfg.traySending !== false && outreachEngineInstance && outreachEngineInstance.isActive()) {
      e.preventDefault()
      win.hide()
      if (outreachTrayInstance) {
        outreachTrayInstance.showBalloonOnce()
      }
    }
  })
}

// ---------------------------------------------------------------- esbpowerline.com as the signed-in editor
// The Studio signs in with the site's own auth service (renderer: siteApi.authenticateStaff). To open the real CMS
// as that editor, the main process writes the site's own session cookie — the one @supabase/ssr reads — into a
// separate browser profile (persist:esb-site) and opens the CMS in its own window. The app's session never carries
// site cookies, and the window can only show esbpowerline.com; any other link goes to the system browser.
const SITE_ORIGIN = 'https://esbpowerline.com'
const SITE_PARTITION = 'persist:esb-site'
const { SITE_COOKIE_NAME, SITE_COOKIE_VALUE } = siteUpload
let siteWin = null

async function writeSiteSession(cookies) {
  const { session } = require('electron')
  const ses = session.fromPartition(SITE_PARTITION)
  if (!Array.isArray(cookies) || cookies.length < 1 || cookies.length > 6) throw new Error('bad session')
  for (const c of cookies) {
    if (!c || typeof c.name !== 'string' || typeof c.value !== 'string' || !SITE_COOKIE_NAME.test(c.name) || !SITE_COOKIE_VALUE.test(c.value)) throw new Error('bad session')
  }
  // drop any older session (whole or chunked) before writing this one
  const base = cookies[0].name.replace(/\.\d$/, '')
  for (const n of [base, ...[0, 1, 2, 3, 4, 5].map((i) => `${base}.${i}`)]) await ses.cookies.remove(SITE_ORIGIN, n).catch(() => {})
  const expirationDate = Math.floor(Date.now() / 1000) + 400 * 24 * 60 * 60
  for (const c of cookies) await ses.cookies.set({ url: SITE_ORIGIN, name: c.name, value: c.value, path: '/', secure: true, sameSite: 'lax', expirationDate })
  return ses
}

ipcMain.handle('esb:open-site-as', async (_e, cookies, sitePath) => {
  const target = typeof sitePath === 'string' && /^\/[A-Za-z0-9/_\-?=&.%]*$/.test(sitePath) && !sitePath.startsWith('//') ? sitePath : '/cms'
  await writeSiteSession(cookies)
  if (siteWin && !siteWin.isDestroyed()) { siteWin.loadURL(SITE_ORIGIN + target); siteWin.focus(); return true }
  siteWin = new BrowserWindow({
    width: 1360, height: 900, minWidth: 900, minHeight: 600, title: 'esbpowerline.com — CMS', autoHideMenuBar: true, backgroundColor: '#0b0b0d',
    webPreferences: { partition: SITE_PARTITION, contextIsolation: true, nodeIntegration: false, sandbox: true },
  })
  // the CMS profile asks for nothing: without these, Electron grants every permission request (camera, microphone,
  // location, notifications, clipboard) to esbpowerline.com and anything it loads
  const siteSes = siteWin.webContents.session
  siteSes.setPermissionRequestHandler((_wc, _permission, callback) => callback(false))
  siteSes.setPermissionCheckHandler(() => false)
  siteWin.setMenuBarVisibility(false)
  siteWin.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith(SITE_ORIGIN + '/')) { siteWin.loadURL(url); return { action: 'deny' } }
    if (/^https?:/.test(url)) shell.openExternal(url)
    return { action: 'deny' }
  })
  siteWin.webContents.on('will-navigate', (e, url) => { if (!url.startsWith(SITE_ORIGIN + '/') && url !== SITE_ORIGIN) { e.preventDefault(); if (/^https?:/.test(url)) shell.openExternal(url) } })
  siteWin.on('closed', () => { siteWin = null })
  siteWin.loadURL(SITE_ORIGIN + target)
  return true
})

// Publish uploads the rendered Web banner to the site's media library, so the article's image is the banner the
// desk made rather than the original photo's link. The checks and the plan limits live in site-upload.cjs.
ipcMain.handle('esb:site-upload', async (_e, cookies, bytes, mime, name) => {
  const buf = bytes instanceof Uint8Array ? bytes : (bytes && bytes.buffer instanceof ArrayBuffer ? new Uint8Array(bytes.buffer) : null)
  return siteUpload.uploadBanner({ cookies, bytes: buf, mime, name })
})
ipcMain.handle('esb:site-upload-probe', async (_e, cookies) => siteUpload.probeUpload(cookies))
ipcMain.handle('esb:site-revalidate', async (_e, cookies, slugs) => siteUpload.revalidateSite(cookies, slugs))

// Home → Quit: close every window and end the app (refused if sending is active, unless forced).
ipcMain.handle('esb:quit', (_e, force) => {
  if (!force && outreachEngineInstance && outreachEngineInstance.isActive()) {
    return false
  }
  isQuitting = true
  app.quit()
  return true
})

// Signing out of the Studio signs the CMS window out too.
ipcMain.handle('esb:site-sign-out', async () => {
  const { session } = require('electron')
  await session.fromPartition(SITE_PARTITION).clearStorageData({ origin: SITE_ORIGIN }).catch(() => {})
  if (siteWin && !siteWin.isDestroyed()) siteWin.close()
  return true
})

// Read text from OS clipboard safely
ipcMain.handle('esb:read-clipboard', () => {
  try {
    return clipboard.readText() || ''
  } catch {
    return ''
  }
})

// Save one rendered banner. With `dir` (batch export) it is written straight there; otherwise ask where.
ipcMain.handle('esb:save-image', async (_e, name, bytes, dir) => {
  if (!guard.isImageBytes(bytes)) throw new Error('Not a PNG, JPEG or WebP image')
  if (bytes.length > 50 * 1024 * 1024) throw new Error('Payload too large')
  const safe = guard.imageFileName(name)
  let target
  if (dir) {
    const dirStr = String(dir)
    fsScope.assertAllowed(dirStr, 'save image dir')
    target = path.join(dirStr, safe)
  } else {
    fs.mkdirSync(defaultDir(), { recursive: true })
    const r = await dialog.showSaveDialog(win, {
      defaultPath: path.join(defaultDir(), safe),
      filters: [{ name: 'Image', extensions: [path.extname(safe).slice(1) || 'png'] }],
    })
    if (r.canceled || !r.filePath) return null
    target = r.filePath
    fsScope.allowFile(target)
  }
  fsScope.assertAllowed(target, 'save image target')
  fs.writeFileSync(target, Buffer.from(bytes.buffer, bytes.byteOffset, bytes.length))
  return target
})

// Save a rendered video. The renderer sends the finished file; it must be an MP4 or WebM by its own header, and
// lands only where the editor chose in the save dialog.
const MAX_VIDEO_BYTES = 2 * 1024 * 1024 * 1024
function videoKind(b) {
  if (b.length > 12 && b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70) return 'mp4' // ....ftyp
  if (b.length > 4 && b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) return 'webm' // EBML
  return null
}
ipcMain.handle('esb:save-video', async (_e, name, bytes) => {
  if (!(bytes instanceof Uint8Array) || bytes.length > MAX_VIDEO_BYTES) return null
  const kind = videoKind(bytes)
  if (!kind) throw new Error('Not an MP4 or WebM file')
  const safe = path.basename(String(name)).replace(/\.[a-z0-9]+$/i, '') + '.' + kind
  fs.mkdirSync(defaultDir(), { recursive: true })
  const r = await dialog.showSaveDialog(win, { defaultPath: path.join(defaultDir(), safe), filters: [{ name: kind === 'mp4' ? 'MP4 video' : 'WebM video', extensions: [kind] }] })
  if (r.canceled || !r.filePath) return null
  fsScope.allowFile(r.filePath)
  fsScope.assertAllowed(r.filePath, 'save video target')
  fs.writeFileSync(r.filePath, Buffer.from(bytes.buffer, bytes.byteOffset, bytes.length))
  return r.filePath
})

// ---------------------------------------------------------------- Video desk: media by path, projects, autosave, export
// Every path here comes from a dialog main itself showed, a drop the preload resolved from a File, a still the app
// rendered, or a project the editor opened; the renderer only ever receives opaque esb-media:// URLs for them.
let videoRegistry = null
const videoExports = videoMedia.createExportWriter()
const videoAutosaveDir = () => path.join(app.getPath('userData'), 'video-autosave')
const MEDIA_FILTERS = [
  { name: 'Video, audio and pictures', extensions: [...videoMedia.MEDIA_EXT] },
  { name: 'Video', extensions: ['mp4', 'm4v', 'mov', 'webm', 'mkv'] },
  { name: 'Audio', extensions: ['mp3', 'wav', 'm4a', 'aac', 'ogg', 'opus', 'flac'] },
  { name: 'Pictures', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif'] },
]
const videoEntries = (paths) => paths.map((p) => { try { return videoMedia.entryFor(videoRegistry, p) } catch { return null } }).filter(Boolean)
ipcMain.handle('esb:video-import', async () => {
  const r = await dialog.showOpenDialog(win, { title: 'Import media', properties: ['openFile', 'multiSelections'], filters: MEDIA_FILTERS })
  if (r.canceled || !r.filePaths.length) return []
  return videoEntries(r.filePaths.slice(0, 200))
})
ipcMain.handle('esb:video-import-dropped', (_e, paths) => {
  // sent by the preload from dropped File objects (webUtils.getPathForFile); page script cannot pass a string here
  if (!Array.isArray(paths)) return []
  return videoEntries(paths.filter(videoMedia.isMediaPath).slice(0, 200))
})
ipcMain.handle('esb:video-relink', async (_e, name) => {
  const r = await dialog.showOpenDialog(win, { title: `Find ${String(name || 'the missing file').slice(0, 120)}`, properties: ['openFile'], filters: MEDIA_FILTERS })
  if (r.canceled || !r.filePaths[0]) return null
  return videoEntries([r.filePaths[0]])[0] || null
})
ipcMain.handle('esb:video-resolve', (_e, paths) => videoMedia.resolvePaths(videoRegistry, paths))
ipcMain.handle('esb:video-store-still', (_e, name, bytes) => {
  // a banner or photo the app rendered for Story → video, kept in userData so a saved story video finds it again
  if (!guard.isImageBytes(bytes) || bytes.length > 50 * 1024 * 1024) throw new Error('Not a PNG, JPEG or WebP image')
  const ext = bytes[0] === 0x89 ? 'png' : bytes[0] === 0xff ? 'jpg' : 'webp'
  const dir = path.join(app.getPath('userData'), 'video-stills')
  fs.mkdirSync(dir, { recursive: true })
  const hash = require('node:crypto').createHash('sha256').update(bytes).digest('hex').slice(0, 24)
  const stem = guard.imageFileName(name).replace(/\.[a-z0-9]+$/i, '').slice(0, 60)
  const file = path.join(dir, `${stem}-${hash}.${ext}`)
  if (!fs.existsSync(file)) fs.writeFileSync(file, Buffer.from(bytes.buffer, bytes.byteOffset, bytes.length))
  return videoEntries([file])[0] || null
})
ipcMain.handle('esb:video-save-project', async (_e, name, text, existingPath) => {
  if (typeof text !== 'string' || text.length > 25 * 1024 * 1024) throw new Error('Project text too large')
  JSON.parse(text)
  let target = null
  if (existingPath != null) {
    if (!videoMedia.isVideoProjectPath(existingPath)) throw new Error('Not a video project file')
    fsScope.assertAllowed(String(existingPath), 'save video project')
    target = String(existingPath)
  } else {
    const dir = path.join(defaultDir(), 'Video')
    fs.mkdirSync(dir, { recursive: true })
    const stem = guard.imageFileName(name).replace(/\.[a-z0-9]+$/i, '')
    const r = await dialog.showSaveDialog(win, { title: 'Save video project', defaultPath: path.join(dir, stem + '.esbvideo'), filters: [{ name: 'ESB video project', extensions: ['esbvideo'] }] })
    if (r.canceled || !r.filePath) return null
    target = /\.esbvideo$/i.test(r.filePath) ? r.filePath : r.filePath + '.esbvideo'
    fsScope.allowFile(target)
  }
  const tmp = target + '.tmp'
  fs.writeFileSync(tmp, text, 'utf8')
  fs.renameSync(tmp, target)
  return target
})
ipcMain.handle('esb:video-open-project', async () => {
  const dir = path.join(defaultDir(), 'Video')
  fs.mkdirSync(dir, { recursive: true })
  const r = await dialog.showOpenDialog(win, { title: 'Open video project', defaultPath: dir, properties: ['openFile'], filters: [{ name: 'ESB video project', extensions: ['esbvideo', 'json'] }] })
  if (r.canceled || !r.filePaths[0]) return null
  const filePath = r.filePaths[0]
  if (fs.statSync(filePath).size > 25 * 1024 * 1024) throw new Error('Project file too large')
  const text = fs.readFileSync(filePath, 'utf8')
  // the editor chose this project: the media it lists (existing files with media extensions) may be played
  for (const p of videoMedia.projectMediaPaths(text)) videoRegistry.add(p)
  const isVideoProject = /\.esbvideo$/i.test(filePath)
  if (isVideoProject) fsScope.allowFile(filePath)
  return { path: isVideoProject ? filePath : null, text }
})
ipcMain.handle('esb:video-autosave', (_e, text) => videoMedia.writeSnapshot(videoAutosaveDir(), text))
ipcMain.handle('esb:video-autosave-latest', () => videoMedia.latestSnapshot(videoAutosaveDir()))
ipcMain.handle('esb:video-autosave-clear', () => videoMedia.clearSnapshots(videoAutosaveDir()))
ipcMain.handle('esb:video-export-begin', async (_e, name, kind) => {
  const k = kind === 'webm' ? 'webm' : 'mp4'
  const safe = guard.imageFileName(name).replace(/\.[a-z0-9]+$/i, '') + '.' + k
  fs.mkdirSync(defaultDir(), { recursive: true })
  const r = await dialog.showSaveDialog(win, { defaultPath: path.join(defaultDir(), safe), filters: [{ name: k === 'mp4' ? 'MP4 video' : 'WebM video', extensions: [k] }] })
  if (r.canceled || !r.filePath) return null
  const target = r.filePath.toLowerCase().endsWith('.' + k) ? r.filePath : r.filePath + '.' + k
  fsScope.allowFile(target)
  fsScope.assertAllowed(target, 'export video target')
  return videoExports.begin(target)
})
ipcMain.handle('esb:video-export-write', (_e, id, position, bytes) => videoExports.write(id, position, bytes))
ipcMain.handle('esb:video-export-end', (_e, id, ok) => videoExports.end(id, ok === true))

ipcMain.handle('esb:pick-folder', async () => {
  fs.mkdirSync(defaultDir(), { recursive: true })
  const r = await dialog.showOpenDialog(win, {
    title: 'Choose where to save both banners',
    defaultPath: defaultDir(),
    properties: ['openDirectory', 'createDirectory'],
  })
  if (r.canceled || !r.filePaths[0]) return null
  const folder = r.filePaths[0]
  fsScope.allow(folder)
  return folder
})

// Project files (.esb)
ipcMain.handle('esb:save-project', async (_e, name, text, existingPath) => {
  if (typeof text !== 'string' || text.length > 25 * 1024 * 1024) throw new Error('Project text too large')
  if (existingPath != null && !guard.isProjectPath(existingPath)) throw new Error('Not a project file')
  let target = existingPath ? String(existingPath) : null
  if (!target) {
    fs.mkdirSync(defaultDir(), { recursive: true })
    const r = await dialog.showSaveDialog(win, {
      title: 'Save banner project',
      defaultPath: path.join(defaultDir(), path.basename(String(name))),
      filters: [{ name: 'ESB Banner project', extensions: ['esb'] }],
    })
    if (r.canceled || !r.filePath) return null
    target = r.filePath.toLowerCase().endsWith('.esb') ? r.filePath : r.filePath + '.esb'
    fsScope.allowFile(target)
  } else {
    fsScope.assertAllowed(target, 'save project')
  }
  fs.writeFileSync(target, String(text), 'utf8')
  return target
})

ipcMain.handle('esb:open-project', async () => {
  fs.mkdirSync(defaultDir(), { recursive: true })
  const r = await dialog.showOpenDialog(win, {
    title: 'Open banner project',
    defaultPath: defaultDir(),
    properties: ['openFile'],
    filters: [{ name: 'ESB Banner project', extensions: ['esb'] }],
  })
  if (r.canceled || !r.filePaths[0]) return null
  const filePath = r.filePaths[0]
  fsScope.allowFile(filePath)
  return { path: filePath, text: fs.readFileSync(filePath, 'utf8') }
})

ipcMain.handle('esb:read-project', (_e, p) => {
  try {
    if (!guard.isProjectPath(p)) return null
    const target = String(p)
    if (!fsScope.isAllowed(target)) return null
    return fs.readFileSync(target, 'utf8')
  } catch {
    return null
  }
})

ipcMain.handle('esb:reveal', (_e, p) => {
  if (p) {
    const target = String(p)
    if (fsScope.isAllowed(target)) {
      shell.showItemInFolder(target)
    }
  }
})

// At most six renderer fetches in flight; the rest wait their turn. Each one may buffer up to its size cap (and an image
// is copied again to base64), so a renderer firing a hundred at once could run the main process out of memory.
const MAX_FETCHES = 6
let fetching = 0
const waiting = []
async function oneAtATime(job) {
  if (fetching >= MAX_FETCHES) await new Promise((r) => waiting.push(r))
  fetching++
  try { return await job() } finally { fetching--; waiting.shift()?.() }
}

// The renderer may ask for a longer wait and for a JSON feed, nothing else: every other net-guard option (loopback,
// custom DNS, size caps) stays out of its reach.
ipcMain.handle('esb:fetch-url', async (_e, rawUrl, options) => {
  const o = options && typeof options === 'object' ? options : {}
  const safe = {}
  if (Number.isFinite(o.timeoutMs)) safe.timeoutMs = Math.min(30000, Math.max(1000, o.timeoutMs))
  if (Array.isArray(o.allowedTypes) && o.allowedTypes.length && o.allowedTypes.every((t) => t === 'application/json')) safe.allowedTypes = ['application/json']
  return await oneAtATime(() => fetchArticleHtml(String(rawUrl), safe))
})

// as above: a shorter wait and a smaller cap are the renderer's to choose; loopback, DNS and content types are not
ipcMain.handle('esb:fetch-image-data', async (_e, rawUrl, options) => {
  return await oneAtATime(() => fetchImageData(String(rawUrl), guard.safeImageFetchOptions(options)))
})

// only files this process staged for a drag (prepare-drag-file, or the bytes form below) may be dragged out — never
// an arbitrary allowed path, so a drag cannot hand a project file or anything else in a scoped folder to the OS
const stagedDrags = new Set()
ipcMain.handle('esb:prepare-drag-file', async (_e, name, bytes) => {
  try {
    if (!bytes || bytes.length > 50 * 1024 * 1024) throw new Error('Payload too large')
    const tmpDir = path.join(app.getPath('temp'), 'esb-studio-drag')
    fs.mkdirSync(tmpDir, { recursive: true })
    if (!(bytes instanceof Uint8Array)) throw new Error('Bad payload')
    const safe = guard.dragFileName(name)
    const filePath = path.join(tmpDir, safe)
    fsScope.allowFile(filePath)
    stagedDrags.add(path.resolve(filePath))
    fs.writeFileSync(filePath, Buffer.from(bytes.buffer, bytes.byteOffset, bytes.length))
    return filePath
  } catch (err) {
    console.error('prepare-drag-file error:', err)
    return null
  }
})

ipcMain.on('esb:start-drag', (event, arg) => {
  try {
    let filePath
    if (typeof arg === 'string') {
      filePath = stagedDrags.has(path.resolve(arg)) ? arg : null
    } else if (arg && arg.bytes) {
      if (arg.bytes.length > 50 * 1024 * 1024) throw new Error('Payload too large')
      const tmpDir = path.join(app.getPath('temp'), 'esb-studio-drag')
      fs.mkdirSync(tmpDir, { recursive: true })
      if (!(arg.bytes instanceof Uint8Array)) throw new Error('Bad payload')
      const safe = guard.dragFileName(arg.name)
      filePath = path.join(tmpDir, safe)
      fsScope.allowFile(filePath)
      stagedDrags.add(path.resolve(filePath))
      fs.writeFileSync(filePath, Buffer.from(arg.bytes.buffer, arg.bytes.byteOffset, arg.bytes.length))
    }
    if (!filePath || !fsScope.isAllowed(filePath) || !fs.existsSync(filePath)) return
    const iconPath = path.join(__dirname, '..', 'build', 'icon.png')
    event.sender.startDrag({
      file: filePath,
      icon: fs.existsSync(iconPath) ? iconPath : filePath,
    })
  } catch (err) {
    console.error('startDrag error:', err)
  }
})

// Outreach desk: the account, the encrypted app password and the send ledger live here (electron/mailer.cjs); the
// renderer can ask for one checked email at a time and read the status, nothing more.
let mailer = null
// open/click tracking switches itself on only once esbpowerline.com answers on /api/o and /r (outreach-tracking.cjs)
let trackingGate = null
const outreachTracking = () => (trackingGate ??= require('./outreach-tracking.cjs').createTrackingGate({ env: process.env }))
const outreachMailer = () => (mailer ??= require('./mailer.cjs').createMailer({ dir: app.getPath('userData'), safeStorage: require('electron').safeStorage, nodemailer: require('nodemailer'), tracking: outreachTracking() }))
// pcLabel: this computer's name, shown on other PCs as "Sending from …" (the shared send lock); tracking: whether the
// site's open/click endpoints were live at the last check
ipcMain.handle('esb:outreach-status', () => ({ ...outreachMailer().status(), pcLabel: require('node:os').hostname().slice(0, 60), tracking: outreachTracking().status() }))
// sends another PC made (the shared ledger): validated, then entered in the mailer's ledger and the event log so no
// check on this PC — the 7-day repeat rule, the engine's "already sent", follow-up eligibility — can miss them
ipcMain.handle('esb:outreach-mark-sent', async (_e, raw) => {
  const g = outreachGuard.validateRemoteSends(raw)
  if (!g.ok) return { ok: false, error: g.error }
  const added = await outreachMailer().markSent(g.entries)
  const have = new Set(outreachEvents.read({ types: ['send.ok'], limit: 100000, includeDry: false }).events
    .filter((e) => e.campaignId).map((e) => `${e.run === 'followup' ? 'followup' : 'campaign'}|${String(e.email || '').toLowerCase()}|${e.campaignId}`))
  let logged = 0
  for (const e of g.entries) {
    if (e.kind === 'test' || have.has(`${e.kind}|${e.email}|${e.campaignId}`)) continue
    outreachEvents.append({ type: 'send.ok', remote: true, campaignId: e.campaignId, email: e.email, run: e.kind === 'followup' ? 'followup' : 'first', t: e.at })
    logged++
  }
  return { ok: true, ledger: added.length, events: logged, rejected: g.rejected }
})
ipcMain.handle('esb:outreach-save', (_e, settings, password) => {
  try { return { ok: true, status: outreachMailer().saveSettings(settings, password) } } catch (e) { return { ok: false, error: e.message } }
})
ipcMain.handle('esb:outreach-forget-password', () => outreachMailer().forgetPassword())
ipcMain.handle('esb:outreach-send', (_e, mail) => outreachMailer().send(mail))
ipcMain.handle('esb:outreach-verify', (_e, force) => outreachMailer().verify(force === true))
// replies, unsubscribes and bounces to the desk's own letters, read from the same account's inbox (read-only)
let inbox = null
const outreachInbox = () => (inbox ??= require('./inbox.cjs').createInbox({ ledger: () => outreachMailer().ledger(), account: () => outreachMailer().inboxAccount(), ImapFlow: require('imapflow').ImapFlow, isAiReadsReply: () => outreachSettings.get().aiReadsReply === true, onReplyText: (entry) => saveReplyText(entry) }))
ipcMain.handle('esb:outreach-inbox', (_e, force) => outreachInbox().check(force === true))

// --- Outreach Autopilot IPC Handlers (§1.8, Appendix A) ---
ipcMain.handle('esb:outreach-job-submit', (_e, rawSpec) => {
  const g = outreachGuard.validateJobSpec(rawSpec)
  if (!g.ok) return { ok: false, error: g.error, rejected: g.rejected || [] }
  const res = outreachEngineInstance.submit(g.cleaned)
  if (!res.ok) return { ok: false, error: res.error, rejected: g.rejected }
  return { ok: true, jobId: res.jobId, rejected: g.rejected }
})
ipcMain.handle('esb:outreach-job-control', (_e, jobId, action, arg) => {
  const g = outreachGuard.validateControl(jobId, action, arg)
  if (!g.ok) return { ok: false, error: g.error }
  return outreachEngineInstance.control(g.jobId, g.action, g.arg)
})
ipcMain.handle('esb:outreach-pause-all', (_e, on) => {
  return outreachEngineInstance.pauseAll(on === true)
})
ipcMain.handle('esb:outreach-jobs', () => {
  return outreachEngineInstance.snapshot()
})
ipcMain.handle('esb:outreach-events', (_e, rawQ) => {
  const g = outreachGuard.validateEventsQuery(rawQ)
  if (!g.ok) return { events: [], hasMore: false, error: g.error }
  return outreachEvents.read(g.query)
})
ipcMain.handle('esb:outreach-stats', (_e, rawQ) => {
  const g = outreachGuard.validateStatsQuery(rawQ)
  if (!g.ok) return { error: g.error }
  return outreachEvents.stats({
    ...g.query,
    jobs: outreachEngineInstance.snapshot(),
    settings: outreachSettings.get(),
  })
})
ipcMain.handle('esb:outreach-plan', (_e, rawQ) => {
  const g = outreachGuard.validatePlanQuery(rawQ)
  if (!g.ok) return { days: 0, firstAt: null, lastAt: null, perDay: [], notes: [g.error] }
  return outreachEngineInstance.plan(g.count)
})
ipcMain.handle('esb:outreach-settings', () => {
  const s = outreachSettings.get()
  return { ...s, dryRun: !!(process.env.ESB_OUTREACH_DRYRUN || process.env.ESB_DRYRUN) }
})
ipcMain.handle('esb:outreach-settings-save', (_e, rawS) => {
  const r = outreachSettings.save(rawS)
  // new sending hours / limits apply to a batch that is already waiting, not only to the next one
  if (r && r.ok && outreachEngineInstance && typeof outreachEngineInstance.settingsChanged === 'function') outreachEngineInstance.settingsChanged()
  return r
})
let dnsCheckerInstance = null
const getDnsChecker = () => (dnsCheckerInstance ??= require('./outreach-dns.cjs').createDnsChecker({
  cacheFile: path.join(app.getPath('userData'), 'outreach-dns-cache.json'),
}))

ipcMain.handle('esb:outreach-check-addresses', async (_e, rawDomains) => {
  const g = outreachGuard.validateDomains(rawDomains)
  if (!g.ok) return {}
  return getDnsChecker().checkDomains(g.domains)
})
const aiActionTimestamps = []

ipcMain.handle('esb:outreach-log-event', (_e, rawE) => {
  const g = outreachGuard.validateLogEvent(rawE)
  if (!g.ok) return { ok: false, error: g.error }
  if (g.event.type === 'ai.action') {
    const now = Date.now()
    const cutoff = now - 3600000
    while (aiActionTimestamps.length > 0 && aiActionTimestamps[0] < cutoff) {
      aiActionTimestamps.shift()
    }
    if (aiActionTimestamps.length >= 20) {
      return { ok: false, error: 'Rate limit exceeded: maximum 20 AI actions per hour' }
    }
    aiActionTimestamps.push(now)
  }
  outreachEvents.append(g.event)
  return { ok: true }
})
ipcMain.handle('esb:outreach-opt-out', (_e, email, on) => {
  if (typeof email !== 'string' || !email.trim()) return { ok: false }
  outreachEvents.append({ type: 'optout', email: email.toLowerCase().trim(), on: on === true, by: 'user' })
  return { ok: true }
})
ipcMain.handle('esb:outreach-sync-opt-outs', (_e, rawEmails) => {
  if (!Array.isArray(rawEmails)) return { ok: false, added: 0 }
  const supp = outreachEvents.suppression()
  let added = 0
  for (const em of rawEmails) {
    if (typeof em === 'string') {
      const norm = em.toLowerCase().trim()
      if (norm && !supp.has(norm)) {
        outreachEvents.append({ type: 'optout', email: norm, on: true, by: 'import' })
        added++
      }
    }
  }
  return { ok: true, added }
})
let replyTextsStore = null
function getReplyTextsFile() { return path.join(userData, 'outreach-reply-texts.json') }
function loadReplyTexts() {
  if (replyTextsStore) return replyTextsStore
  try {
    const f = getReplyTextsFile()
    if (fs.existsSync(f)) {
      replyTextsStore = JSON.parse(fs.readFileSync(f, 'utf8')) || []
    } else {
      replyTextsStore = []
    }
  } catch {
    replyTextsStore = []
  }
  return replyTextsStore
}
function saveReplyText(entry) {
  const list = loadReplyTexts()
  const normEmail = String(entry.email || '').toLowerCase().trim()
  const idx = list.findIndex((x) => x.email === normEmail && x.at === entry.at)
  const item = { email: normEmail, at: entry.at, subject: String(entry.subject || '').slice(0, 200), ownWords: String(entry.ownWords || '').slice(0, 1200) }
  if (idx >= 0) { list[idx] = item } else { list.push(item) }
  if (list.length > 500) { replyTextsStore = list.slice(-500) }
  try { fs.writeFileSync(getReplyTextsFile(), JSON.stringify(replyTextsStore), 'utf8') } catch {}
}

ipcMain.handle('esb:outreach-reply-texts', async (_e, rawEmails) => {
  const cfg = outreachSettings.get()
  if (!cfg.aiReadsReply) return []
  if (!Array.isArray(rawEmails)) return []
  const emails = new Set(rawEmails.filter((e) => typeof e === 'string').map((e) => e.toLowerCase().trim()).slice(0, 50))
  const list = loadReplyTexts()
  return list.filter((x) => emails.has(x.email))
})

// no page in this app may embed a <webview>, and any window not covered above opens nothing
app.on('web-contents-created', (_e, contents) => {
  contents.on('will-attach-webview', (e) => e.preventDefault())
  contents.setWindowOpenHandler(({ url }) => { if (/^https?:\/\//i.test(url)) shell.openExternal(url); return { action: 'deny' } })
})


let syncChild = null

function initAutoSync() {
  if (process.env.ESB_NO_SYNC) return
  try {
    const syncScript = path.join(__dirname, '..', 'tools', 'git-sync.mjs')
    if (fs.existsSync(syncScript)) {
      syncChild = spawn('node', [syncScript], {
        cwd: path.join(__dirname, '..'),
        stdio: 'ignore',
        detached: false,
        windowsHide: true,
      })
      syncChild.on('error', () => { /* ignore */ })
    }
  } catch {}
}

app.whenReady().then(() => {
  // Allow-list app default folders
  fsScope.allow(defaultDir())
  fsScope.allow(app.getPath('userData'))
  fsScope.allow(path.join(app.getPath('temp'), 'esb-studio-drag')) // the drag staging folder only, never the whole temp directory

  const userData = app.getPath('userData')
  videoRegistry = videoMedia.createMediaRegistry({ file: path.join(userData, 'video-media.json') })
  // the editor's session only (the CMS window has its own partition, so it cannot read the editor's media)
  protocol.handle('esb-media', (request) => videoMedia.serveMedia(request, videoRegistry))
  // the send results the desk projects onto its campaigns go to the window as they happen (engineClient.ts applyEvents);
  // without this the list only caught up at the next launch
  const LIVE = new Set(['send.ok', 'send.fail', 'send.skip', 'reply', 'bounce', 'optout'])
  outreachEvents = createEventLog({ dir: userData, onAppend: (ev) => { if (LIVE.has(ev.type)) pushToWindow('esb:outreach-push', { kind: 'event', event: ev }) } })
  outreachJobs = createJobStore({ dir: userData })
  outreachSettings = createSettingsManager({ dir: userData })

  // Legacy back-fill (§1.8f)
  const currentCfg = outreachSettings.get()
  if (!currentCfg.legacyBackfilled) {
    try {
      const l = outreachMailer().ledger()
      if (Array.isArray(l) && l.length > 0) {
        for (const entry of l) {
          outreachEvents.append({
            type: 'legacy.sent',
            email: entry.to,
            t: entry.t,
            run: entry.kind === 'followup' ? 'followup' : 'first',
          })
        }
      }
      outreachSettings.save({ legacyBackfilled: true })
    } catch (e) {
      console.warn('Legacy backfill warning:', e)
    }
  }

  outreachEngineInstance = createEngine({
    events: outreachEvents,
    jobs: outreachJobs,
    settings: outreachSettings,
    mailer: {
      send: (mail) => outreachMailer().send(mail),
      status: () => outreachMailer().status(),
    },
    inbox: {
      check: (force) => outreachInbox().check(force),
    },
    online: checkOnline,
    emit: (kind, data) => {
      pushToWindow('esb:outreach-push', { kind, ...data })
      if (outreachTrayInstance) {
        outreachTrayInstance.updateMenu()
      }
    },
    env: process.env,
  })

  outreachEngineInstance.start()

  outreachTrayInstance = createTray({
    Tray,
    Menu,
    nativeImage,
    iconPath: path.join(__dirname, '..', 'build', 'icon.png'),
    getWindow: () => win,
    engine: outreachEngineInstance,
    onQuitRequest: () => {
      if (!win || win.isDestroyed()) {
        isQuitting = true
        app.quit()
        return
      }
      win.show()
      win.focus()
      if (outreachEngineInstance && outreachEngineInstance.isActive()) {
        pushToWindow('esb:outreach-push', { kind: 'request-quit' })
      } else {
        isQuitting = true
        app.quit()
      }
    },
  })

  createWindow()
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow() })
})

app.on('before-quit', () => {
  isQuitting = true
  if (outreachEngineInstance) {
    outreachEngineInstance.shutdown({ clean: true })
  }
})

app.on('will-quit', () => {
  if (syncChild) {
    try { syncChild.kill() } catch {}
  }
  try {
    const tmpDir = path.join(app.getPath('temp'), 'esb-studio-drag')
    fs.rmSync(tmpDir, { recursive: true, force: true })
  } catch {}
})

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
