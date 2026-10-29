// ESB Studio — Outreach Tray Manager (electron/outreach-tray.cjs)
// Tray icon, balloon notification, close-to-tray, and context menu (§1.8, §4.8).

const path = require('node:path')

function formatSec(seconds) {
  if (!seconds || seconds <= 0) return '0:00'
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

/**
 * Pure function: constructs the tray context menu template (§4.8).
 *
 * @param {{
 *   state: 'sending' | 'waiting' | 'paused' | 'idle',
 *   sent?: number,
 *   total?: number,
 *   nextInSec?: number,
 *   windowOpens?: string,
 *   why?: string,
 *   isPaused?: boolean
 * }} status
 * @param {{
 *   onOpen?: () => void,
 *   onTogglePause?: () => void,
 *   onQuit?: () => void
 * }} handlers
 * @returns {Array<{ label?: string, type?: string, enabled?: boolean, click?: () => void }>}
 */
function buildTrayTemplate(status = {}, handlers = {}) {
  const { state = 'idle', sent = 0, total = 0, nextInSec = 0, windowOpens = '', why = '', isPaused = false } = status

  let statusLabel = 'Idle'
  if (state === 'sending') {
    const nextStr = nextInSec > 0 ? ` · next in ${formatSec(nextInSec)}` : ''
    statusLabel = `Sending ${sent} of ${total}${nextStr}`
  } else if (state === 'waiting') {
    if (windowOpens) {
      statusLabel = `Waiting — window opens ${windowOpens}`
    } else if (why) {
      statusLabel = `Waiting — ${why}`
    } else {
      statusLabel = 'Waiting'
    }
  } else if (state === 'paused') {
    statusLabel = 'Paused'
  } else {
    statusLabel = 'Idle'
  }

  const pauseLabel = isPaused || state === 'paused' ? 'Resume sending' : 'Pause all sending'

  return [
    { label: statusLabel, enabled: false },
    {
      label: 'Open ESB AI Studio',
      click: () => {
        if (typeof handlers.onOpen === 'function') handlers.onOpen()
      },
    },
    {
      label: pauseLabel,
      click: () => {
        if (typeof handlers.onTogglePause === 'function') handlers.onTogglePause()
      },
    },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => {
        if (typeof handlers.onQuit === 'function') handlers.onQuit()
      },
    },
  ]
}

/**
 * Creates and binds an Electron Tray instance.
 */
function createTray(options = {}) {
  const { Tray, Menu, nativeImage, iconPath, getWindow, engine, onQuitRequest } = options

  if (!Tray || !Menu) return null

  const p = iconPath || path.join(__dirname, '..', 'build', 'icon.png')
  const icon = nativeImage ? nativeImage.createFromPath(p) : p
  let tray = null

  try {
    tray = new Tray(icon)
  } catch {
    return null
  }

  let balloonShown = false

  function currentStatus() {
    if (!engine) return { state: 'idle' }
    const snaps = engine.snapshot ? engine.snapshot() : []
    const active = snaps.find((j) => j.status === 'running' || j.status === 'queued' || j.status === 'waiting')
    const paused = snaps.find((j) => j.status === 'paused')

    if (active) {
      if (active.status === 'running') {
        const nextInSec = active.until ? Math.max(0, Math.round((active.until - Date.now()) / 1000)) : 0
        return {
          state: 'sending',
          sent: active.sent,
          total: active.total,
          nextInSec,
          isPaused: false,
        }
      }
      return {
        state: 'waiting',
        why: active.why,
        isPaused: false,
      }
    }

    if (paused) {
      return { state: 'paused', isPaused: true }
    }

    return { state: 'idle', isPaused: false }
  }

  function updateMenu() {
    if (!tray || tray.isDestroyed()) return
    const st = currentStatus()
    const template = buildTrayTemplate(st, {
      onOpen: () => {
        const win = getWindow ? getWindow() : null
        if (win && !win.isDestroyed()) {
          win.show()
          win.focus()
        }
      },
      onTogglePause: () => {
        if (!engine) return
        if (st.isPaused) {
          engine.pauseAll(false)
        } else {
          engine.pauseAll(true)
        }
        updateMenu()
      },
      onQuit: () => {
        if (typeof onQuitRequest === 'function') {
          onQuitRequest()
        }
      },
    })

    const menu = Menu.buildFromTemplate(template)
    tray.setContextMenu(menu)
    tray.setToolTip(`ESB AI Studio — ${template[0].label}`)
  }

  tray.on('click', () => {
    const win = getWindow ? getWindow() : null
    if (!win || win.isDestroyed()) return
    if (win.isVisible()) {
      win.hide()
    } else {
      win.show()
      win.focus()
    }
  })

  function showBalloonOnce() {
    if (balloonShown || !tray || tray.isDestroyed()) return
    balloonShown = true
    if (typeof tray.displayBalloon === 'function') {
      try {
        tray.displayBalloon({
          title: 'ESB AI Studio',
          content: 'ESB AI Studio is still sending. Use the tray icon to open it or quit.',
        })
      } catch {}
    }
  }

  updateMenu()

  return {
    tray,
    updateMenu,
    showBalloonOnce,
    destroy: () => {
      if (tray && !tray.isDestroyed()) {
        tray.destroy()
      }
    },
  }
}

module.exports = {
  buildTrayTemplate,
  createTray,
  formatSec,
}
