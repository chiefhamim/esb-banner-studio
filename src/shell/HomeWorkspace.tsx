import { useState, useEffect } from 'react'
import logoUrl from '../assets/images/esb-logo.png'
import { readRecent, openProject, openRecent } from '../project'
import type { RecentProject } from '../project'
import { useShellStore } from './shellStore'
import { useStore } from '../store'
import { FORMAT_LIST } from '../core/tokens'
import type { FormatId } from '../core/types'
import { Icon } from '../ui/Icon'

export function HomeWorkspace() {
  const setWorkspace = useShellStore((s) => s.setWorkspace)
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
              <Icon name="folder" size={14} /> Open Project…
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
  )
}
