import { useState, useEffect, useRef } from 'react'
import { WorkspaceSwitcher } from './WorkspaceRail'
import logoUrl from '../assets/images/esb-logo.png'
import lightBgUrl from '../assets/images/home/home-light.jpg'
import darkBgUrl from '../assets/images/home/home-dark.jpg'
import { readRecent, openProject, openRecent } from '../project'
import type { RecentProject } from '../project'
import { useShellStore } from './shellStore'
import { useStore } from '../store'
import { FORMAT_LIST } from '../core/tokens'
import type { FormatId } from '../core/types'
import { Icon } from '../ui/Icon'
import { Dialog } from '../ui/controls'

const HOME_BG_KEY = (t: 'light' | 'dark') => `esb-banner-studio/home-bg-${t}`

export function HomeWorkspace() {
  const setWorkspace = useShellStore((s) => s.setWorkspace)
  const theme = useStore((s) => s.theme)
  // Quit exists only in the desktop app; a browser tab is closed by the browser
  const canQuit = typeof window !== 'undefined' && !!window.esb?.quit
  const [recents, setRecents] = useState<RecentProject[]>([])
  const [recoverySnapshot, setRecoverySnapshot] = useState<{ time: string; name: string } | null>(null)

  useEffect(() => {
    setRecents(readRecent())

    // Check for crash recovery snapshot
    try {
      const raw = localStorage.getItem('esb-banner-studio/autosave-snapshot')
      if (raw) {
        const snap = JSON.parse(raw)
        if (snap && snap.dirty && snap.savedAt) {
          const dateStr = new Date(snap.savedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
          setRecoverySnapshot({ time: dateStr, name: snap.name || 'Untitled project' })
        }
      }
    } catch { /* ignore */ }
  }, [])

  const handleNewProject = (formatId?: FormatId) => {
    useStore.getState().newBanner(false)
    if (formatId) useStore.getState().setFormat(formatId)
    setWorkspace('graphics')
  }

  // The editor can put any image of their own behind Home. It is scaled to 1600 px and kept in this machine's local
  // storage as a JPEG (a few hundred KB), so it survives restarts without copying files anywhere.
  const [customBgs, setCustomBgs] = useState<Record<'light' | 'dark', string | null>>(() => {
    const read = (t: 'light' | 'dark') => { try { return localStorage.getItem(HOME_BG_KEY(t)) } catch { return null } }
    return { light: read('light'), dark: read('dark') }
  })
  const customBg = customBgs[theme]
  const bgInput = useRef<HTMLInputElement>(null)
  const [showSettings, setShowSettings] = useState(false)
  const pickBackground = async (file: File | undefined) => {
    if (!file || !file.type.startsWith('image/')) return
    const url = URL.createObjectURL(file)
    try {
      const img = new Image()
      img.src = url
      await img.decode()
      const scale = Math.min(1, 1600 / Math.max(img.naturalWidth, img.naturalHeight))
      const c = document.createElement('canvas')
      c.width = Math.max(1, Math.round(img.naturalWidth * scale))
      c.height = Math.max(1, Math.round(img.naturalHeight * scale))
      c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height)
      const data = c.toDataURL('image/jpeg', 0.86)
      try { localStorage.setItem(HOME_BG_KEY(theme), data) } catch { /* storage full: still show it for this session */ }
      setCustomBgs((b) => ({ ...b, [theme]: data }))
    } catch {
      /* not a decodable image: keep the current background */
    } finally {
      URL.revokeObjectURL(url)
    }
  }
  const resetBackground = () => {
    try { localStorage.removeItem(HOME_BG_KEY(theme)) } catch { /* ignore */ }
    setCustomBgs((b) => ({ ...b, [theme]: null }))
  }

  const handleOpenProject = async () => {
    await openProject()
    setWorkspace('graphics')
  }

  const handleOpenRecent = async (item: RecentProject) => {
    await openRecent(item)
    setWorkspace('graphics')
  }

  const handleRestoreRecovery = () => {
    try {
      const raw = localStorage.getItem('esb-banner-studio/autosave-snapshot')
      if (raw) {
        const snap = JSON.parse(raw)
        if (snap?.doc) {
          useStore.getState().loadDoc(snap.doc, { name: snap.name || 'Recovered project', path: snap.path || null })
          localStorage.removeItem('esb-banner-studio/autosave-snapshot')
          setRecoverySnapshot(null)
          setWorkspace('graphics')
        }
      }
    } catch { /* ignore */ }
  }

  const handleDiscardRecovery = () => {
    try {
      localStorage.removeItem('esb-banner-studio/autosave-snapshot')
    } catch { /* ignore */ }
    setRecoverySnapshot(null)
  }

  return (
    <div className="home-shell">
    <header className="topbar home-topbar">
      <WorkspaceSwitcher />
      <div className="spacer" />
      <div className="home-head-actions">
        <button type="button" className="home-head-btn" data-tip="Settings" aria-label="Settings" onClick={() => setShowSettings(true)}>
          <Icon name="sliders" size={15} />
        </button>
        <button type="button" className="home-head-btn" data-tip={theme === 'dark' ? 'Switch to light appearance' : 'Switch to dark appearance'} aria-label="Toggle appearance" onClick={() => useStore.getState().setTheme(theme === 'dark' ? 'light' : 'dark')}>
          <Icon name={theme === 'dark' ? 'sun' : 'moon'} size={15} />
        </button>
        {canQuit && (
          <button type="button" className="home-head-btn quit" data-tip="Quit ESB Studio (Ctrl+Q)" onClick={() => void window.esb?.quit?.()}>
            <Icon name="x" size={14} />
            <span>Quit</span>
          </button>
        )}
      </div>
    </header>
    <input ref={bgInput} type="file" accept="image/*" hidden onChange={(e) => { void pickBackground(e.target.files?.[0]); e.target.value = '' }} />
    {showSettings && (
      <Dialog title="Settings" kicker="HOME" width={440} onClose={() => setShowSettings(false)} footer={<><div className="spacer" /><button type="button" className="btn primary" onClick={() => setShowSettings(false)}>Done</button></>}>
        <div className="stack" style={{ gap: 10 }}>
          <strong>Home background</strong>
          <p className="sub">{customBg ? 'Showing your own image.' : `Showing the ${theme === 'dark' ? 'dark' : 'light'} default.`} Your image is kept on this computer and used for the {theme === 'dark' ? 'dark' : 'light'} appearance only; the other keeps its own.</p>
          <div className="row" style={{ gap: 8 }}>
            <button type="button" className="btn" onClick={() => bgInput.current?.click()}><Icon name="image" size={14} /> Choose image…</button>
            {customBg && <button type="button" className="btn" onClick={resetBackground}><Icon name="reset" size={14} /> Use default</button>}
          </div>
        </div>
      </Dialog>
    )}
    {/* the background: a soft colour field that drifts slowly; a veil in the theme's own colour keeps it quiet */}
    <div className="home-bg" aria-hidden><div className="home-bg-img" style={{ backgroundImage: `url(${customBg ?? (theme === 'dark' ? darkBgUrl : lightBgUrl)})` }} /></div>
    <main className="home-workspace" aria-label="Home dashboard">
      <div className="home-container">
        {/* Crash recovery banner if available */}
        {recoverySnapshot && (
          <div className="home-alert recovery-alert" role="alert">
            <div className="alert-content">
              <Icon name="info" size={16} />
              <span>
                <strong>Crash Recovery Available:</strong> An unsaved session (<em>{recoverySnapshot.name}</em>) from {recoverySnapshot.time} was found.
              </span>
            </div>
            <div className="alert-actions">
              <button type="button" className="btn primary compact" onClick={handleRestoreRecovery}>
                Restore Session
              </button>
              <button type="button" className="btn subtle compact" onClick={handleDiscardRecovery}>
                Discard
              </button>
            </div>
          </div>
        )}

        <header className="home-header">
          <div className="home-header-brand">
            <img src={logoUrl} alt="Energy Sector Bangladesh" className="home-brand-logo" />
            <div className="home-title-group">
              <h1 className="home-title">ESB Power Line Studio</h1>
              <p className="home-subtitle">Where ESB's energy stories are written, designed and cut</p>
            </div>
          </div>
        </header>

        <nav className="home-launch" aria-label="Workspaces">
          {([
            { id: 'editorial', icon: 'newspaper', name: 'Editorial', note: 'Link in, English story out', run: () => setWorkspace('editorial') },
            { id: 'graphics', icon: 'layers', name: 'Graphics', note: 'Banners and cards', run: () => setWorkspace('graphics') },
            { id: 'video', icon: 'video', name: 'Video', note: 'Timeline, titles and export', run: () => setWorkspace('video') },
            { id: 'open', icon: 'folder', name: 'Open project', note: 'Continue a saved project', run: () => void handleOpenProject() },
          ] as const).map((w) => (
            <button key={w.id} type="button" className="launch-tile" onClick={w.run}>
              <span className="launch-icon"><Icon name={w.icon} size={20} /></span>
              <span className="launch-name">{w.name}</span>
              <span className="launch-note">{w.note}</span>
            </button>
          ))}
        </nav>


        <div className="home-split">
        <section className="home-section" style={{ ['--s' as string]: 2 }}>
          <h2 className="section-title">New graphic</h2>
          <div className="formats-grid">
            {FORMAT_LIST.map((f) => (
              <button
                key={f.id}
                type="button"
                className="format-card"
                style={{ ['--i' as string]: FORMAT_LIST.indexOf(f) }}
                onClick={() => handleNewProject(f.id)}
                title={`Create new banner with ${f.name} format`}
              >
                <span className="format-glyph" aria-hidden><i style={{ width: Math.round(f.w >= f.h ? 28 : 28 * f.w / f.h), height: Math.round(f.w >= f.h ? 28 * f.h / f.w : 28) }} /></span>
                <div className="format-body">
                  <div className="format-head">
                    <span className="format-name">{f.name}</span>
                    <span className="format-tag mono">{f.ratio}</span>
                  </div>
                  <div className="format-dims mono">{f.w} × {f.h} px</div>
                  <p className="format-note">{f.note}</p>
                </div>
              </button>
            ))}
          </div>
        </section>
        <section className="home-section" style={{ ['--s' as string]: 1 }}>
          <h2 className="section-title">Recent projects</h2>
          {recents.length > 0 ? (
            <div className="recents-grid">
              {recents.slice(0, 4).map((item) => (
                <button
                  key={item.path}
                  type="button"
                  className="recent-card"
                  onClick={() => handleOpenRecent(item)}
                  title={`Open ${item.name} (${item.path})`}
                >
                  <div className="recent-icon">
                    <Icon name="folder" size={20} />
                  </div>
                  <div className="recent-info">
                    <span className="recent-name">{item.name}</span>
                    <span className="recent-path mono">{item.path}</span>
                  </div>
                </button>
              ))}
            </div>
          ) : (
            <div className="empty-notice"><Icon name="folder" size={22} /><span>Nothing opened yet</span><small>Projects you open or save appear here.</small></div>
          )}
        </section>
        </div>

        <footer className="home-footer">
          <span className="home-version">v{__APP_VERSION__}</span>
          <span>Made with <i className="heart" aria-label="love">♥</i> by <a className="home-credit" href="https://facebook.com/chiefhamim" target="_blank" rel="noopener noreferrer">Hamim Ruwayfi</a></span>
        </footer>
      </div>
    </main>
    </div>
  )
}
