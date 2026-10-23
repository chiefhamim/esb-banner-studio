// ESB Studio — desktop shell. Everything runs locally; no network access is needed.
const { app, BrowserWindow, Menu, ipcMain, dialog, shell } = require('electron')
const path = require('node:path')
const fs = require('node:fs')
const { FsScope } = require('./fs-scope.cjs')
const { fetchArticleHtml, fetchImageData } = require('./net-guard.cjs')

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
    minWidth: 1100,
    minHeight: 680,
    backgroundColor: '#15171c',
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    title: 'ESB Studio',
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
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' } })
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
