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
const { createSettingsManager, migratePacingFromMailer } = require('./outreach-settings.cjs')
const { createEngine } = require('./outreach-engine.cjs')
const { createTray } = require('./outreach-tray.cjs')
const outreachGuard = require('./outreach-guard.cjs')
const videoMedia = require('./video-media.cjs')
const videoProject = require('./video-project.cjs')
const videoMusic = require('./video-music.cjs')

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

let recoveries = []
const DEV_URL = process.env.ESB_DEV_URL
const INDEX_FILE = path.join(__dirname, '..', 'dist', 'index.html')
// the only pages the editor window may show: its own index.html (or the dev server); a taken-over page cannot load another file: URL
const APP_URLS = [DEV_URL, pathToFileURL(INDEX_FILE).href]
const defaultDir = () => path.join(app.getPath('pictures'), 'ESB Banners')
let win

// Every bridge call must come from the editor window's own top-level page. The preload only runs there today, but this
// is checked on each call rather than assumed: a frame, a second window or a page the window was somehow steered to
// (all of which the sandbox and the navigation guard already block) still could not reach the file, mail or secret
// handlers. Wrapping the two registration functions covers every handler below, including ones added later.
const trustedSender = (e) => {
  try {
    const frame = e.senderFrame
    return !!frame && !!win && !win.isDestroyed() && e.sender === win.webContents && frame === win.webContents.mainFrame && guard.isAppFrame(frame.url, APP_URLS)
  } catch { return false }
}
const ipcHandle = ipcMain.handle.bind(ipcMain)
ipcMain.handle = (channel, fn) => ipcHandle(channel, (e, ...args) => {
  if (!trustedSender(e)) throw new Error('This call is not allowed from here')
  return fn(e, ...args)
})
const ipcOn = ipcMain.on.bind(ipcMain)
ipcMain.on = (channel, fn) => ipcOn(channel, (e, ...args) => { if (trustedSender(e)) fn(e, ...args) })

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
      // an installed build has no DevTools: with them, anyone at the PC could read the keys the page holds in memory
      devTools: !app.isPackaged || !!process.env.ESB_DEVTOOLS,
      spellcheck: true,
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
  // a video export streams from this window: if it crashes or reloads mid-render, close and remove the half file
  win.webContents.on('render-process-gone', (_e, details) => {
    videoExports.abortActive(); videoProxyWriter.abortActive()
    // a dead renderer left a blank window until the app was restarted: bring the page back (Video's autosave and
    // Editorial's story queue restore the work), at most 3 times a minute so a page that dies at load cannot loop
    if (process.env.ESB_NO_RENDERER_RECOVERY || details?.reason === 'clean-exit' || win.isDestroyed()) return
    const now = Date.now()
    recoveries = recoveries.filter((t) => now - t < 60000)
    if (recoveries.length >= 3) return
    recoveries.push(now)
    console.warn('[esb] renderer gone (' + details?.reason + ') — reloading')
    setTimeout(() => { if (!win.isDestroyed()) win.webContents.reload() }, 400)
  })
  win.webContents.on('did-start-navigation', (_e, _url, isInPlace, isMainFrame) => { if (isMainFrame && !isInPlace) { videoExports.abortActive(); videoProxyWriter.abortActive() } })

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

// Video data cards: one day of esbpowerline.com's grid data, read as the signed-in editor and cached per date in
// userData (electron/grid-data.cjs). The renderer names a date only; origin, path, size and time are fixed here.
let gridDataInstance = null
const gridData = () => (gridDataInstance ??= require('./grid-data.cjs').createGridData({
  userDataDir: app.getPath('userData'),
  origin: require('./grid-data.cjs').resolveOrigin(process.env.ESB_GRID_TEST_ORIGIN, app.isPackaged),
  userAgent: `ESB-AI-Studio/${app.getVersion()} (desktop; +https://esbpowerline.com)`,
}))
ipcMain.handle('esb:grid-day', (_e, cookies, iso, opts) => gridData().fetchDay(cookies, iso, opts))
ipcMain.handle('esb:grid-latest', (_e, cookies) => gridData().latest(cookies))
ipcMain.handle('esb:grid-cached', (_e, iso) => gridData().cached(iso))
ipcMain.handle('esb:grid-cached-dates', () => gridData().cachedDates())

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

// OS-encrypted secret storage for API keys and tokens (DPAPI safeStorage)
let secretStore = null
const getSecretStore = () => (secretStore ??= require('./secret-store.cjs').createSecretStore({
  dir: app.getPath('userData'),
  safeStorage: require('electron').safeStorage,
}))
ipcMain.handle('esb:secret-set', (_e, key, val) => getSecretStore().set(key, val))
ipcMain.handle('esb:secret-get', (_e, key) => getSecretStore().get(key))

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
// A file is approved (put in the registry) only when it comes from a dialog main itself showed, a drop the preload
// resolved from a File, or a still / voiceover take main wrote into userData. Opening a project approves nothing.
// The renderer plays approved files through opaque esb-media:// URLs; naming a path back never grants a read.
let videoRegistry = null
const videoExports = videoMedia.createExportWriter()
// Phase 7 render queue: a render goes to Pictures/ESB Banners/Video renders under a free name, with no dialog (the editor
// asked for it by queueing it); it is written by the same confined export writer and registered like any export.
ipcMain.handle('esb:video-render-begin', async (_e, name, kind) => {
  const k = kind === 'webm' ? 'webm' : 'mp4'
  const base = guard.imageFileName(String(name ?? 'video')).replace(/\.[a-z0-9]+$/i, '')
  const dir = path.join(defaultDir(), 'Video renders')
  fs.mkdirSync(dir, { recursive: true })
  let target = path.join(dir, base + '.' + k)
  for (let i = 2; fs.existsSync(target) && i < 500; i++) target = path.join(dir, base + '-' + i + '.' + k)
  fsScope.allowFile(target)
  fsScope.assertAllowed(target, 'render queue target')
  return videoExports.begin(target)
})
// Phase 7: renders this app made (by opaque id) and the publishing IPC (YouTube / Facebook, behind the Approve dialog)
const videoRenders = require('./video-renders.cjs').createRenderRegistry({ file: path.join(app.getPath('userData'), 'video-renders.json') })
const videoPublish = require('./video-publish/ipc.cjs').registerVideoPublishIpc({
  ipcMain, dialog, shell, app, safeStorage: require('electron').safeStorage, getWindow: () => win, renders: videoRenders,
  createPublishing: (o) => require('./video-publish/index.cjs').createVideoPublishing(o),
  onUpdate: (job) => { try { if (win && !win.isDestroyed()) win.webContents.send('esb:vpub-update', job) } catch { /* window gone */ } },
})
const videoAutosaveDir = () => path.join(app.getPath('userData'), 'video-autosave')
const MEDIA_FILTERS = [
  { name: 'Video, audio and pictures', extensions: [...videoMedia.MEDIA_EXT] },
  { name: 'Video', extensions: ['mp4', 'm4v', 'mov', 'webm', 'mkv'] },
  { name: 'Audio', extensions: ['mp3', 'wav', 'm4a', 'aac', 'ogg', 'opus', 'flac'] },
  { name: 'Pictures', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif'] },
]
const videoEntries = (paths) => paths.map((p) => { try { return videoMedia.entryFor(videoRegistry, p) } catch { return null } }).filter(Boolean)
ipcMain.handle('esb:video-import', async (_e, opts) => {
  const r = await dialog.showOpenDialog(win, { title: 'Import media', properties: ['openFile', 'multiSelections'], filters: MEDIA_FILTERS })
  if (r.canceled || !r.filePaths.length) return []
  return importEntries(r.filePaths.slice(0, 200), opts)
})
ipcMain.handle('esb:video-import-dropped', (_e, paths, opts) => {
  // sent by the preload from dropped File objects (webUtils.getPathForFile); page script cannot pass a string here
  if (!Array.isArray(paths)) return []
  return importEntries(paths.filter(videoMedia.isMediaPath).slice(0, 200), opts)
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
  const stem = guard.imageFileName(name).replace(/\.[a-z0-9]+$/i, '')
  const file = videoMedia.storeGenerated(path.join(app.getPath('userData'), 'video-stills'), stem, ext, bytes, videoMedia.STILLS_CAP)
  return videoEntries([file])[0] || null
})
ipcMain.handle('esb:video-store-take', (_e, name, bytes) => {
  // a voiceover recorded on the desk: written to userData/video-takes so a saved or autosaved video keeps it
  if (!(bytes instanceof Uint8Array) || bytes.length === 0 || bytes.length > videoMedia.MAX_TAKE_BYTES) throw new Error('Bad voiceover take')
  const ext = videoMedia.audioTakeKind(bytes)
  if (!ext) throw new Error('Not a WebM, Ogg, WAV or M4A recording')
  const stem = guard.imageFileName(name).replace(/\.[a-z0-9]+$/i, '')
  const file = videoMedia.storeGenerated(path.join(app.getPath('userData'), 'video-takes'), stem, ext, bytes, videoMedia.TAKES_CAP)
  return videoEntries([file])[0] || null
})

// A take written while it is recorded (electron/video-take.cjs): pieces are appended on disk, so a crash keeps the take.
const videoTakeDir = () => path.join(app.getPath('userData'), 'video-takes')
let videoTakeRec = null
const takeRec = () => (videoTakeRec ??= require('./video-take.cjs').createTakeRecorder({ dir: videoTakeDir(), audioTakeKind: videoMedia.audioTakeKind, maxBytes: videoMedia.MAX_TAKE_BYTES }))
const keepTakeBytes = (name, data) => {
  const stem = guard.imageFileName(name).replace(/\.[a-z0-9]+$/i, '')
  const file = videoMedia.storeGenerated(videoTakeDir(), stem, videoMedia.audioTakeKind(data), data, videoMedia.TAKES_CAP)
  return videoEntries([file])[0] || null
}
ipcMain.handle('esb:video-take-begin', () => takeRec().begin())
ipcMain.handle('esb:video-take-chunk', (_e, id, bytes) => takeRec().append(String(id), bytes))
ipcMain.handle('esb:video-take-end', (_e, id, name) => {
  const r = takeRec().finish(String(id))
  return r ? keepTakeBytes(name, r.data) : null
})
ipcMain.handle('esb:video-take-discard', (_e, id) => { takeRec().discard(String(id)); return true })
ipcMain.handle('esb:video-take-recover', () => takeRec().recover().map((r, i) => keepTakeBytes(`Recovered voiceover ${new Date(r.mtimeMs).toISOString().slice(0, 16).replace('T', ' ')} ${i + 1}`, r.data)).filter(Boolean))

// ---------------------------------------------------------------- Video desk: the music library (one folder the owner chose)
// Read-only. The renderer never names an absolute path: the folder comes from main's own dialog, files are named
// relative to it and resolved through every link (electron/video-music.cjs). A file asked for is added to the media
// registry only if it lies inside that folder.
let videoMusicFolder = null
const musicInfo = () => { const p = videoMusicFolder?.get(); return p ? { path: p, name: path.basename(p) || p } : null }
ipcMain.handle('esb:video-music-folder', () => musicInfo())
ipcMain.handle('esb:video-music-choose', async () => {
  const r = await dialog.showOpenDialog(win, { title: 'Choose your music folder', properties: ['openDirectory'], buttonLabel: 'Use this folder' })
  if (r.canceled || !r.filePaths[0]) return musicInfo()
  forgetMusic()
  if (!videoMusicFolder.set(r.filePaths[0])) throw new Error('That is not a local folder')
  return musicInfo()
})
// files this folder choice registered for playback: forgotten again when the folder is cleared or changed, so a
// cleared library leaves nothing servable behind
const musicRegistered = new Set()
const forgetMusic = () => { for (const f of musicRegistered) { try { videoRegistry?.remove(f) } catch { /* gone */ } } musicRegistered.clear() }
ipcMain.handle('esb:video-music-clear', () => { forgetMusic(); videoMusicFolder.clear(); return null })
ipcMain.handle('esb:video-music-list', async () => {
  const root = videoMusicFolder?.get()
  return root ? videoMusic.listAudioAsync(root) : { files: [], truncated: false }
})
ipcMain.handle('esb:video-music-use', (_e, rel) => {
  const root = videoMusicFolder?.get()
  const file = root ? videoMusic.confinedAudio(root, rel) : null
  if (!file) throw new Error('That file is not in the music folder')
  const entry = videoEntries([file])[0] || null
  if (entry) musicRegistered.add(file)
  return entry
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
  // a project folder is opened by its project.json (Windows' file dialog cannot pick a folder and a file at once)
  const r = await dialog.showOpenDialog(win, { title: 'Open video project', defaultPath: dir, properties: ['openFile'], filters: [{ name: 'ESB video project', extensions: ['esbvideo', 'json'] }] })
  if (r.canceled || !r.filePaths[0]) return null
  const filePath = r.filePaths[0]
  let asFolder = null
  if (path.basename(filePath).toLowerCase() === videoProject.PROJECT_FILE) asFolder = path.dirname(filePath)
  else { try { if (fs.statSync(filePath).isDirectory()) asFolder = filePath } catch { /* not there */ } }
  if (asFolder) {
    if (!videoProject.isProjectFolderPath(asFolder)) throw new Error('project.json must be inside a .esbvideo project folder')
    const text = await videoProject.readProjectJson(asFolder)
    const id = videoFolders.add(asFolder)
    if (!id) throw new Error('Not a local project folder')
    cleanOnce(asFolder)
    return { path: path.resolve(asFolder), text, folder: { id, path: path.resolve(asFolder) } }
  }
  if (!videoMedia.isVideoProjectPath(filePath) || videoMedia.isNetworkOrDevicePath(filePath)) throw new Error('Not a local .esbvideo project')
  if ((await fs.promises.stat(filePath)).size > 25 * 1024 * 1024) throw new Error('Project file too large')
  const text = await fs.promises.readFile(filePath, 'utf8')
  // opening a project approves none of the media it lists: files this app imported are already in the registry and
  // play; anything else (a project from another PC, or a crafted one) comes back missing and is relinked by hand
  fsScope.allowFile(filePath)
  return { path: filePath, text }
})
// a project folder's snapshots go to its own autosave/; the rest to userData. The restore card offers the newest of all.
ipcMain.handle('esb:video-autosave', (_e, text, fid) => {
  const root = typeof fid === 'string' && fid !== videoProject.LIBRARY_KEY ? folderRoot(fid) : null
  return videoMedia.writeSnapshot(root ? videoProject.confinedDir(root, 'autosave') : videoAutosaveDir(), text)
})
ipcMain.handle('esb:video-autosave-latest', async () => {
  // every folder's autosave/ is confined (a junction out of the project is skipped); the newest snapshot is picked by
  // its file name across all of them before one is read, and only snapshots of at most 25 MB are read
  const dirs = [{ dir: videoAutosaveDir() }]
  for (const { id, path: dir } of videoFolders.entries().slice(-50)) {
    if (!folderRoot(id)) continue
    try { dirs.push({ dir: videoProject.confinedDir(dir, 'autosave'), folder: { id, path: dir } }) } catch { /* linked or unreadable */ }
  }
  const best = await videoMedia.latestSnapshotIn(dirs)
  if (!best) return null
  return best.folder ? { at: best.at, text: best.text, folder: best.folder } : { at: best.at, text: best.text }
})
ipcMain.handle('esb:video-autosave-clear', (_e, projectId, fid) => {
  const id = typeof projectId === 'string' ? projectId : undefined
  const root = typeof fid === 'string' && fid !== videoProject.LIBRARY_KEY ? folderRoot(fid) : null
  if (root) { try { videoMedia.clearSnapshots(videoProject.confinedDir(root, 'autosave'), id) } catch { /* no folder */ } }
  return videoMedia.clearSnapshots(videoAutosaveDir(), id)
})
ipcMain.handle('esb:video-export-begin', async (_e, name, kind, fid) => {
  const k = kind === 'webm' ? 'webm' : 'mp4'
  const safe = guard.imageFileName(name).replace(/\.[a-z0-9]+$/i, '') + '.' + k
  fs.mkdirSync(defaultDir(), { recursive: true })
  // a project folder suggests its own renders/ (the editor may still choose anywhere)
  let where = defaultDir()
  const root = typeof fid === 'string' && fid !== videoProject.LIBRARY_KEY ? folderRoot(fid) : null
  if (root) { try { where = videoProject.confinedDir(root, 'renders') } catch { /* keep the default */ } }
  const r = await dialog.showSaveDialog(win, { defaultPath: path.join(where, safe), filters: [{ name: k === 'mp4' ? 'MP4 video' : 'WebM video', extensions: [k] }] })
  if (r.canceled || !r.filePath) return null
  const target = r.filePath.toLowerCase().endsWith('.' + k) ? r.filePath : r.filePath + '.' + k
  fsScope.allowFile(target)
  fsScope.assertAllowed(target, 'export video target')
  return videoExports.begin(target)
})
// ---------------------------------------------------------------- Video desk, Phase 1: project folders, proxies, cache
// A folder is known by an opaque id once the editor created it (Save) or opened its project.json in main's own dialog
// (`videoFolders`, kept across launches). The renderer names files inside it only as `<subfolder>/<name>`, resolved and
// confined to the folder's real location (electron/video-project.cjs). Proxies and cache entries of a project that has
// no folder yet go to the app's own library (userData/video-library, key 'u').
let videoFolders = null
const videoProxyWriter = videoMedia.createExportWriter()
const videoCache = videoProject.createCacheStore()
const LIBRARY_PROXY_CAP = 20 * 1024 * 1024 * 1024
/** A project folder's proxies/ may hold this much in all (a 540p proxy is ~1-2 GB an hour). */
const FOLDER_PROXY_CAP = 100 * 1024 * 1024 * 1024
/** One proxy may be at most this big: twice its source (a 540p proxy is far smaller than any source that needs one),
 * at least 256 MB, never more than 8 GB. Unknown source: 8 GB. */
const proxyLimitFor = (sourceSize) => (Number.isSafeInteger(sourceSize) && sourceSize > 0 ? Math.min(8 * 1024 ** 3, Math.max(256 * 1024 ** 2, 2 * sourceSize)) : 8 * 1024 ** 3)
const libraryRoot = () => { const d = path.join(app.getPath('userData'), 'video-library'); fs.mkdirSync(d, { recursive: true }); return d }
/** Each folder is cleaned of half-written files (`*.tmp`, `*.partial`, `*.copying`) once per session, the first time
 * it is used — also a folder reused by id from an earlier session (autosave restore, proxies), not only one opened. */
const cleanedFolders = new Set()
const cleanOnce = (root) => {
  const k = path.resolve(root).toLowerCase()
  if (cleanedFolders.has(k)) return
  cleanedFolders.add(k)
  try { videoProject.cleanFolder(root) } catch { /* read-only */ }
}
const folderRoot = (fid) => {
  const root = fid === videoProject.LIBRARY_KEY ? libraryRoot() : videoFolders ? videoFolders.pathFor(fid) : null
  if (root) cleanOnce(root)
  return root
}
/** The folder a call works in: a known project folder by id, or the app's library when none is given. */
const workRoot = (fid) => {
  if (fid == null) return { key: videoProject.LIBRARY_KEY, root: libraryRoot() }
  const root = folderRoot(fid)
  if (!root) throw new Error('Unknown project folder')
  return { key: fid, root }
}
const projectRoot = (fid) => (typeof fid === 'string' && fid !== videoProject.LIBRARY_KEY ? folderRoot(fid) : null)
// esb-media://p answers go through a short memo (range requests ask for the same file many times a second)
const folderFiles = videoProject.createConfinedResolver()
const folderFile = (key, rel) => { const root = folderRoot(key); return root ? folderFiles.resolve(key, root, rel) : null }
/** Entries for imported files; with { mode: 'copy', folderId } each is first copied into the folder's media/. */
async function importEntries(paths, opts) {
  const copy = !!opts && opts.mode === 'copy'
  const root = copy ? projectRoot(opts.folderId) : null
  if (copy && !root) throw new Error('Copying needs a saved project folder')
  const out = []
  for (const p of paths) {
    try {
      const src = root ? await videoProject.copyIntoMedia(root, p) : p
      const e = videoMedia.entryFor(videoRegistry, src)
      if (e) out.push(root ? { ...e, file: 'media/' + path.basename(src) } : e)
    } catch (err) {
      out.push({ error: String((err && err.message) || err).slice(0, 300), name: path.basename(String(p)) })
    }
  }
  return out
}
ipcMain.handle('esb:video-folder-create', async (_e, name) => {
  const dir = path.join(defaultDir(), 'Video')
  fs.mkdirSync(dir, { recursive: true })
  const stem = guard.imageFileName(name).replace(/\.[a-z0-9]+$/i, '')
  const r = await dialog.showSaveDialog(win, { title: 'Save video project folder', defaultPath: path.join(dir, stem + '.esbvideo'), buttonLabel: 'Create project', filters: [{ name: 'ESB video project folder', extensions: ['esbvideo'] }] })
  if (r.canceled || !r.filePath) return null
  const target = /\.esbvideo$/i.test(r.filePath) ? r.filePath : r.filePath + '.esbvideo'
  const made = videoProject.createProjectFolder(target)
  cleanedFolders.add(path.resolve(made).toLowerCase()) // createProjectFolder cleaned a reused folder already
  const id = videoFolders.add(made)
  if (!id) throw new Error('Could not create the project folder')
  return { id, path: made }
})
ipcMain.handle('esb:video-folder-save', (_e, fid, text) => {
  const root = projectRoot(fid)
  if (!root) throw new Error('Unknown project folder')
  videoProject.writeProjectJson(root, text)
  return root
})
ipcMain.handle('esb:video-folder-resolve', (_e, fid, files) => {
  // the project's own copies (media/<name>): the folder was opened by the editor, so its media play
  const root = projectRoot(fid)
  if (!root || !Array.isArray(files)) return []
  const only = new Set(['media'])
  return files.slice(0, 2000).map((rel) => {
    const f = videoProject.confinedFile(root, rel, only)
    let e = null
    if (f) { try { e = videoMedia.entryFor(videoRegistry, f) } catch { e = null } }
    return e ? { ...e, file: rel } : { file: String(rel).slice(0, 200), missing: true }
  })
})
/** The file behind an esb-media URL this process handed out, or null. */
function pathForMediaUrl(u) {
  let url
  try { url = new URL(String(u)) } catch { return null }
  if (url.protocol !== 'esb-media:') return null
  if (url.hostname === 'm') return videoRegistry.pathFor(url.pathname.slice(1))
  const m = /^\/([0-9a-f]{32}|u)\/([^/]+)\/([^/]+)$/.exec(url.pathname)
  if (url.hostname !== 'p' || !m) return null
  // media files only (never, say, a project.json or a stray file a project put in renders/)
  try { const f = folderFile(m[1], decodeURIComponent(m[2]) + '/' + decodeURIComponent(m[3])); return f && videoMedia.isMediaPath(f) ? f : null } catch { return null }
}
ipcMain.handle('esb:video-media-facts', async (_e, urls) => {
  // size, modified time and quick hash (for relinking) of files the renderer already plays
  if (!Array.isArray(urls)) return []
  const out = []
  for (const u of urls.slice(0, 500)) {
    const p = pathForMediaUrl(u)
    if (!p) { out.push({ url: String(u).slice(0, 300), missing: true }); continue }
    try {
      const st = await fs.promises.stat(p)
      out.push({ url: u, size: st.size, mtimeMs: Math.round(st.mtimeMs), hash: await videoProject.quickHash(p) })
    } catch { out.push({ url: u, missing: true }) }
  }
  return out
})
// one relink search at a time: a hostile or impatient renderer cannot start many hashing scans at once
let relinkSearching = null
ipcMain.handle('esb:video-relink-search', async (_e, fid, items) => {
  const prev = relinkSearching
  const run = (async () => { if (prev) await prev.catch(() => {}); return relinkSearch(fid, items) })()
  relinkSearching = run
  try { return await run } finally { if (relinkSearching === run) relinkSearching = null }
})
async function relinkSearch(fid, items) {
  // missing files found again by size + quick hash in the project's media/ and, for files this app imported before,
  // the folder they were in and its sibling folders (video-project.cjs relinkDirs)
  if (!Array.isArray(items)) return []
  const root = projectRoot(fid)
  const list = items.slice(0, 500).filter((i) => i && typeof i.id === 'string' && i.id.length < 200)
  const dirs = []
  for (const i of list) {
    const original = typeof i.path === 'string' ? i.path : ''
    for (const d of await videoProject.relinkDirs({ root, original, approved: videoMedia.isMediaPath(original) && videoRegistry.has(original) })) dirs.push(d)
  }
  const unique = [...new Map(dirs.map((d) => [d.toLowerCase(), d])).values()].slice(0, 200)
  const found = await videoProject.findByHash(list, unique)
  const out = []
  for (const [id, p] of found) { try { const e = videoMedia.entryFor(videoRegistry, p); if (e) out.push({ id, entry: e }) } catch { /* gone */ } }
  return out
}
ipcMain.handle('esb:video-proxy-status', (_e, fid, hashes) => {
  if (!Array.isArray(hashes)) return {}
  const out = {}
  const roots = []
  const r = projectRoot(fid)
  if (r) roots.push([fid, r])
  roots.push([videoProject.LIBRARY_KEY, libraryRoot()])
  for (const h of hashes.slice(0, 2000)) {
    const name = videoProject.proxyName(h)
    if (!name) continue
    for (const [key, root] of roots) if (videoProject.proxyReady(root, h)) { out[h] = videoProject.folderUrl(key, 'proxies/' + name); break }
  }
  return out
})
let proxyJob = null
ipcMain.handle('esb:video-proxy-begin', async (_e, fid, hash, sourceUrl) => {
  const name = videoProject.proxyName(hash)
  if (!name) throw new Error('Bad proxy name')
  const { key, root } = workRoot(fid)
  const library = key === videoProject.LIBRARY_KEY
  const folderBytes = videoProject.dirBytes(videoProject.confinedDir(root, 'proxies'))
  const folderCap = library ? LIBRARY_PROXY_CAP : FOLDER_PROXY_CAP
  if (folderBytes >= folderCap) throw new Error(library ? 'The app’s proxy library is full (20 GB). Save the project as a folder to keep its proxies there.' : 'This project’s proxies folder is full (100 GB).')
  // the proxy's own limit follows its source when the renderer names it by an URL this process handed out
  let sourceSize = null
  const src = typeof sourceUrl === 'string' ? pathForMediaUrl(sourceUrl) : null
  if (src) { try { sourceSize = (await fs.promises.stat(src)).size } catch { sourceSize = null } }
  const target = videoProject.confinedTarget(root, 'proxies', name)
  // limits checked on every write too: the file's own size, the folder's running total, the free space left
  const job = videoProxyWriter.begin(target, { minFree: 1024 * 1024 * 1024, maxBytes: proxyLimitFor(sourceSize), folderCap, folderBytes })
  proxyJob = { id: job.id, key, name }
  return { id: job.id }
})
ipcMain.handle('esb:video-proxy-write', (_e, id, position, bytes) => videoProxyWriter.write(id, position, bytes))
ipcMain.handle('esb:video-proxy-end', (_e, id, ok) => {
  const j = proxyJob && proxyJob.id === id ? proxyJob : null
  const done = videoProxyWriter.end(id, ok === true)
  if (j) { proxyJob = null; folderFiles.invalidate(j.key) }
  if (!j || !done || path.basename(done) !== j.name) return null
  return { url: videoProject.folderUrl(j.key, 'proxies/' + j.name) }
})
ipcMain.handle('esb:video-cache-read', (_e, fid, key) => {
  const { root } = workRoot(fid)
  return videoCache.read(videoProject.confinedDir(root, 'cache'), key)
})
ipcMain.handle('esb:video-cache-write', async (_e, fid, key, bytes) => {
  const { root } = workRoot(fid)
  await videoCache.write(videoProject.confinedDir(root, 'cache'), key, bytes)
  return true
})
ipcMain.handle('esb:video-export-write', (_e, id, position, bytes) => videoExports.write(id, position, bytes))
ipcMain.handle('esb:video-export-end', (_e, id, ok) => {
  const out = videoExports.end(id, ok === true)
  // a finished render (never a .partial left behind) is remembered by id, so it can be shown in its folder and published
  if (ok === true && typeof out === 'string' && !out.endsWith('.partial')) { try { videoRenders.register(out) } catch { /* not remembered */ } }
  return out
})

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
// open/click tracking switches itself on only once its endpoints answer (outreach-tracking.cjs): the ESB Mail Tracker
// Worker when its config is on this PC (~/.config/esb-mail-tracker/secrets.env), else the website's /api/o and /r
let trackingGate = null
const outreachTracking = () => (trackingGate ??= require('./outreach-tracking.cjs').createTrackingGate({ env: process.env, tracker: process.env.ESB_OUTREACH_TRACKING === '0' ? null : require('./outreach-tracking.cjs').loadTrackerConfig() }))
// the Worker's opens and clicks come back into the event log (outreach-tracker-pull.cjs), every 30 s
let trackerPull = null
const outreachMailer = () => (mailer ??= require('./mailer.cjs').createMailer({ dir: app.getPath('userData'), safeStorage: require('electron').safeStorage, nodemailer: require('nodemailer'), tracking: outreachTracking(), pacing: () => (outreachSettings ? outreachSettings.get() : null) }))
// pcLabel: this computer's name, shown on other PCs as "Sending from …" (the shared send lock); tracking: whether the
// site's open/click endpoints were live at the last check
ipcMain.handle('esb:outreach-status', () => ({ ...outreachMailer().status(), pcLabel: require('node:os').hostname().slice(0, 60), tracking: { ...outreachTracking().status(), pull: trackerPull ? trackerPull.status() : null } }))
// "Check opens now" (status bar / Activity): one pull from the tracker at once, the answer is how many hits came in
ipcMain.handle('esb:outreach-tracker-pull', async () => (trackerPull ? { ok: true, added: await trackerPull.poll({ force: true }), status: trackerPull.status() } : { ok: false, error: 'tracker not set up on this PC' }))
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
    if (e.kind === 'test') continue
    // a bounce / reply another PC read: into this PC's log too, so Activity counts the same on both (the log keeps one
    // event per address + time, so a row pulled again is not counted twice)
    if (e.status === 'bounced') { if (outreachEvents.append({ type: 'bounce', remote: true, campaignId: e.campaignId, email: e.email, at: e.at, t: e.at, reason: e.detail || 'Bounced (read on another PC)' })) logged++; continue }
    if (e.status === 'replied') { if (outreachEvents.append({ type: 'reply', remote: true, campaignId: e.campaignId, email: e.email, at: e.at, t: e.at, auto: false })) logged++; continue }
    if (have.has(`${e.kind}|${e.email}|${e.campaignId}`)) continue
    outreachEvents.append({ type: 'send.ok', remote: true, campaignId: e.campaignId, email: e.email, run: e.kind === 'followup' ? 'followup' : 'first', t: e.at, ...(e.messageId ? { messageId: e.messageId } : {}) })
    logged++
  }
  // a bounce read on the other PC counts toward this PC's bounce circuit breaker too
  if (logged && outreachEngineInstance && typeof outreachEngineInstance.checkBounces === 'function') { try { outreachEngineInstance.checkBounces() } catch { /* never breaks the merge */ } }
  return { ok: true, ledger: added.length, events: logged, rejected: g.rejected }
})
ipcMain.handle('esb:outreach-save', (_e, settings, password, imapPassword) => {
  try { return { ok: true, status: outreachMailer().saveSettings(settings, password, typeof imapPassword === 'string' ? imapPassword : undefined) } } catch (e) { return { ok: false, error: e.message } }
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
  // a draft is checked like a save (same validator, nothing written); an invalid draft plans with the saved settings
  // and says which field is wrong
  let draft = null
  let error
  if (g.draft) {
    const v = outreachSettings.validate(g.draft, outreachSettings.get())
    if (v.valid) draft = v.cleaned
    else error = v.error
  }
  const res = outreachEngineInstance.plan(g.count, { draft, domains: g.domains })
  return error ? { ...res, error } : res
})
ipcMain.handle('esb:outreach-settings', () => {
  const s = outreachSettings.get()
  return { ...s, dryRun: !!(process.env.ESB_OUTREACH_DRYRUN || process.env.ESB_DRYRUN) }
})
ipcMain.handle('esb:outreach-settings-save', (_e, rawS) => {
  const r = outreachSettings.save(rawS)
  // new sending hours / limits apply to a batch that is already waiting, not only to the next one
  if (r && r.ok && outreachEngineInstance && typeof outreachEngineInstance.settingsChanged === 'function') outreachEngineInstance.settingsChanged()
  // the renderer replaces its copy with r.settings: keep the dry-run flag on it, or a save during a test run turned
  // cloud sync back on for simulated sends (cloudSync testRun reads settings.dryRun)
  if (r && r.ok && r.settings) return { ...r, settings: { ...r.settings, dryRun: !!(process.env.ESB_OUTREACH_DRYRUN || process.env.ESB_DRYRUN) } }
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
  // folder ids are an HMAC with this install's own secret (userData/video-folder-secret), never a plain hash of the path
  videoFolders = videoProject.createFolderRegistry({ file: path.join(userData, 'video-folders.json'), secret: videoProject.loadInstallSecret(path.join(userData, 'video-folder-secret')) })
  videoMusicFolder = videoMusic.createMusicFolder({ file: path.join(userData, 'video-music-folder.json') })
  cleanOnce(libraryRoot())
  // the editor's session only (the CMS window has its own partition, so it cannot read the editor's media)
  protocol.handle('esb-media', (request) => videoMedia.serveMedia(request, videoRegistry, { devUrl: DEV_URL, folderFile }))
  // the send results the desk projects onto its campaigns go to the window as they happen (engineClient.ts applyEvents);
  // without this the list only caught up at the next launch
  const LIVE = new Set(['send.ok', 'send.fail', 'send.skip', 'reply', 'bounce', 'optout', 'track.open', 'track.click'])
  outreachEvents = createEventLog({ dir: userData, onAppend: (ev) => { if (LIVE.has(ev.type)) pushToWindow('esb:outreach-push', { kind: 'event', event: ev }) } })
  {
    const tracker = outreachTracking().tracker
    if (tracker) {
      trackerPull = require('./outreach-tracker-pull.cjs').createTrackerPull({
        tracker, dir: userData, ledger: () => outreachMailer().ledger(), append: (ev) => outreachEvents.append(ev),
        log: (m) => console.warn(m),
      })
      trackerPull.start(30_000)
    }
  }
  outreachJobs = createJobStore({ dir: userData })
  outreachSettings = createSettingsManager({ dir: userData })
  // the Sender dialog's gaps / daily limit used to live only in outreach-smtp.json, which the engine never read —
  // adopt them once (outreach-settings.cjs migratePacingFromMailer); from now on the Autopilot settings are the one copy
  try {
    migratePacingFromMailer({ settings: outreachSettings, smtpFile: path.join(userData, 'outreach-smtp.json'), events: outreachEvents })
  } catch (e) {
    console.warn('Pacing migration warning:', e)
  }

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
  // continue posts the owner already approved that a quit cut off; never starts a new one
  void videoPublish.resume()
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow() })
})

app.on('before-quit', () => {
  isQuitting = true
  void videoPublish.stop()
  if (outreachEngineInstance) {
    outreachEngineInstance.shutdown({ clean: true })
  }
})

app.on('will-quit', () => {
  try { videoRegistry?.flush() } catch {}
  if (syncChild) {
    try { syncChild.kill() } catch {}
  }
  try {
    const tmpDir = path.join(app.getPath('temp'), 'esb-studio-drag')
    fs.rmSync(tmpDir, { recursive: true, force: true })
  } catch {}
})

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
