import { useState, useEffect, useRef } from 'react'
import { WorkspaceSwitcher } from './WorkspaceRail'
import logoUrl from '../assets/images/esb-logo.png'
import auroraUrl from '../assets/images/home/home-aurora.jpg'
import { readRecent, openProject, openRecent } from '../project'
import type { RecentProject } from '../project'
import { useShellStore } from './shellStore'
import { useStore } from '../store'
import { FORMAT_LIST } from '../core/tokens'
import type { FormatId } from '../core/types'
import { Icon } from '../ui/Icon'

const HOME_BG_KEY = 'esb-banner-studio/home-bg'

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

  const handleNewVideo = () => {
    setWorkspace('video')
  }

  // The editor can put any image of their own behind Home. It is scaled to 1600 px and kept in this machine's local
  // storage as a JPEG (a few hundred KB), so it survives restarts without copying files anywhere.
  const [customBg, setCustomBg] = useState<string | null>(() => { try { return localStorage.getItem(HOME_BG_KEY) } catch { return null } })
  const bgInput = useRef<HTMLInputElement>(null)
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
      try { localStorage.setItem(HOME_BG_KEY, data) } catch { /* storage full: still show it for this session */ }
      setCustomBg(data)
    } catch {
      /* not a decodable image: keep the current background */
    } finally {
      URL.revokeObjectURL(url)
    }
  }
  const resetBackground = () => {
    try { localStorage.removeItem(HOME_BG_KEY) } catch { /* ignore */ }
    setCustomBg(null)
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
        <input ref={bgInput} type="file" accept="image/*" hidden onChange={(e) => { void pickBackground(e.target.files?.[0]); e.target.value = '' }} />
        <button type="button" className="home-head-btn" data-tip="Choose a background image for Home" aria-label="Choose background" onClick={() => bgInput.current?.click()}>
          <Icon name="image" size={15} />
          <span className="home-head-label">Background</span>
        </button>
        {customBg && (
          <button type="button" className="home-head-btn" data-tip="Back to the default background" aria-label="Default background" onClick={resetBackground}>
            <Icon name="reset" size={14} />
          </button>
        )}
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
    {/* the background: a soft colour field that drifts slowly; a veil in the theme's own colour keeps it quiet */}
    <div className="home-bg" aria-hidden><div className="home-bg-img" style={{ backgroundImage: `url(${customBg ?? auroraUrl})` }} /></div>
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
              <h1 className="home-title">ESB PowerLine Studio</h1>
              <p className="home-subtitle">Energy Sector Bangladesh · Newsroom Production Workstation</p>
            </div>
          </div>
          <div className="home-quick-actions">
            <button type="button" className="btn primary" onClick={() => handleNewProject()}>
              <Icon name="filePlus" size={14} /> New Graphic
            </button>
            <button type="button" className="btn secondary" onClick={handleNewVideo}>
              <Icon name="video" size={14} /> New Video
            </button>
            <button type="button" className="btn secondary" onClick={handleOpenProject}>
              <Icon name="folder" size={14} /> Open Project
            </button>
            <button type="button" className="btn subtle" onClick={() => setWorkspace('graphics')}>
              Graphics Studio →
            </button>
          </div>
        </header>

        <section className="home-section">
          <h2 className="section-title">Recent Projects</h2>
          {recents.length > 0 ? (
            <div className="recents-grid">
              {recents.map((item) => (
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
            <p className="empty-notice">No recent projects recorded on this workstation.</p>
          )}
        </section>

        <section className="home-section">
          <h2 className="section-title">Production Formats</h2>
          <div className="formats-grid">
            {FORMAT_LIST.map((f) => (
              <button
                key={f.id}
                type="button"
                className="format-card"
                onClick={() => handleNewProject(f.id)}
                title={`Create new banner with ${f.name} format`}
              >
                <div className="format-head">
                  <span className="format-name">{f.name}</span>
                  <span className="format-tag mono">{f.ratio}</span>
                </div>
                <div className="format-dims mono">{f.w} × {f.h} px</div>
                <p className="format-note">{f.note}</p>
              </button>
            ))}
          </div>
        </section>

        <footer className="home-footer">
          <span className="mono status-badge">OFFLINE WORKSTATION</span>
          <span className="footer-meta">ESB Studio · Zero external network disclosure · Local offline storage</span>
        </footer>
      </div>
    </main>
    </div>
  )
}
