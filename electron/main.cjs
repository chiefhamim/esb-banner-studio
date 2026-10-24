// ESB Studio — desktop shell. Everything runs locally; no network access is needed.
const { app, BrowserWindow, Menu, ipcMain, dialog, shell } = require('electron')
const path = require('node:path')
const fs = require('node:fs')
const { FsScope } = require('./fs-scope.cjs')
const { fetchArticleHtml, fetchImageData } = require('./net-guard.cjs')
const siteUpload = require('./site-upload.cjs')

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
const defaultDir = () => path.join(app.getPath('pictures'), 'ESB Banners')
let win

const fsScope = new FsScope()

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
  else win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'))
  // never navigate the editor away from itself; open links in the default browser
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:\/\//i.test(url)) shell.openExternal(url); return { action: 'deny' } })  // only web links ever leave the app (never file:, ms-settings:, custom schemes)
  win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith('file:') && url !== DEV_URL) e.preventDefault() })

  // S3: Install permission handlers: only microphone (media) for app origin, deny everything else
  const ses = win.webContents.session
  ses.setPermissionRequestHandler((_webContents, permission, callback) => {
    callback(permission === 'media')
  })
  ses.setPermissionCheckHandler((_webContents, permission) => {
    return permission === 'media'
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

// Home → Quit: close every window and end the app (app.quit runs before-quit/will-quit, so nothing is cut short).
ipcMain.handle('esb:quit', () => { app.quit(); return true })

// Signing out of the Studio signs the CMS window out too.
ipcMain.handle('esb:site-sign-out', async () => {
  const { session } = require('electron')
  await session.fromPartition(SITE_PARTITION).clearStorageData({ origin: SITE_ORIGIN }).catch(() => {})
  if (siteWin && !siteWin.isDestroyed()) siteWin.close()
  return true
})

// Save one rendered banner. With `dir` (batch export) it is written straight there; otherwise ask where.
ipcMain.handle('esb:save-image', async (_e, name, bytes, dir) => {
  if (!bytes) return null
  if (bytes.length > 50 * 1024 * 1024) throw new Error('Payload too large')
  const safe = path.basename(String(name))
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
  fs.writeFileSync(target, Buffer.from(bytes))
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

ipcMain.handle('esb:fetch-url', async (_e, rawUrl, options) => {
  return await fetchArticleHtml(String(rawUrl), options || {})
})

ipcMain.handle('esb:fetch-image-data', async (_e, rawUrl, options) => {
  return await fetchImageData(String(rawUrl), options || {})
})

ipcMain.handle('esb:prepare-drag-file', async (_e, name, bytes) => {
  try {
    if (!bytes || bytes.length > 50 * 1024 * 1024) throw new Error('Payload too large')
    const tmpDir = path.join(app.getPath('temp'), 'esb-studio-drag')
    fs.mkdirSync(tmpDir, { recursive: true })
    const safe = path.basename(String(name || 'ESB-Banner.png'))
    const filePath = path.join(tmpDir, safe)
    fsScope.allowFile(filePath)
    fs.writeFileSync(filePath, Buffer.from(bytes))
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
      filePath = arg
    } else if (arg && arg.bytes) {
      if (arg.bytes.length > 50 * 1024 * 1024) throw new Error('Payload too large')
      const tmpDir = path.join(app.getPath('temp'), 'esb-studio-drag')
      fs.mkdirSync(tmpDir, { recursive: true })
      const safe = path.basename(String(arg.name || 'ESB-Banner.png'))
      filePath = path.join(tmpDir, safe)
      fsScope.allowFile(filePath)
      fs.writeFileSync(filePath, Buffer.from(arg.bytes))
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

app.whenReady().then(() => {
  // Allow-list app default folders
  fsScope.allow(defaultDir())
  fsScope.allow(app.getPath('userData'))
  fsScope.allow(path.join(app.getPath('temp'), 'esb-studio-drag'))
  fsScope.allow(app.getPath('temp'))

  createWindow()
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow() })
})

app.on('will-quit', () => {
  try {
    const tmpDir = path.join(app.getPath('temp'), 'esb-studio-drag')
    fs.rmSync(tmpDir, { recursive: true, force: true })
  } catch {}
})

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
