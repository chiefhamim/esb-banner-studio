import { useState, useEffect } from 'react'
import logoUrl from '../assets/images/esb-logo.png'
import { readRecent, openProject, openRecent } from '../project'
import type { RecentProject } from '../project'
import { useShellStore } from '../shell/shellStore'
import { useStore } from '../store'
import { FORMAT_LIST } from '../core/tokens'
import type { FormatId } from '../core/types'
import { Dialog } from './controls'
import { Icon } from './Icon'

interface WelcomeModalProps {
  onClose: () => void
}

export function WelcomeModal({ onClose }: WelcomeModalProps) {
  const setWorkspace = useShellStore((s) => s.setWorkspace)
  const [recents, setRecents] = useState<RecentProject[]>([])

  useEffect(() => {
    setRecents(readRecent())
  }, [])

  const handleNewBanner = (fmt?: FormatId) => {
    useStore.getState().newBanner(false)
    if (fmt) useStore.getState().setFormat(fmt)
    setWorkspace('graphics')
    onClose()
  }

  const handleNewVideo = () => {
    setWorkspace('video')
    onClose()
  }

  const handleEditorial = () => {
    setWorkspace('editorial')
    onClose()
  }

  const handleOpenProj = async () => {
    await openProject()
    setWorkspace('graphics')
    onClose()
  }

  const handleOpenRecentItem = async (r: RecentProject) => {
    await openRecent(r)
    setWorkspace('graphics')
    onClose()
  }

  return (
    <Dialog title="Welcome to ESB PowerLine Studio" kicker="NEWSROOM PRODUCTION WORKSTATION" onClose={onClose} width={820}>
      <div className="welcome-modal-content">
        <div className="welcome-hero-banner">
          <img src={logoUrl} alt="Energy Sector Bangladesh" className="welcome-hero-logo" />
          <div className="welcome-hero-text">
            <h3>Editorial Desk · Graphics Banner · Video Production</h3>
            <p>High-resolution newsroom graphics and multi-track broadcast production workstation.</p>
          </div>
        </div>

        <div className="welcome-grid">
          {/* Column 1: Start New Project */}
          <div className="welcome-col">
            <h4 className="welcome-col-title">Create New</h4>
            <div className="welcome-action-list">
              <button type="button" className="welcome-action-btn" onClick={() => handleNewBanner('fb45')}>
                <div className="wab-icon" style={{ background: 'var(--accent)', color: 'var(--on-accent)' }}>
                  <Icon name="image" size={18} />
                </div>
                <div className="wab-info">
                  <span className="wab-title">News Banner</span>
                  <span className="wab-desc">1080 × 1350 Facebook / Social news card</span>
                </div>
              </button>

              <button type="button" className="welcome-action-btn" onClick={handleNewVideo}>
                <div className="wab-icon" style={{ background: '#0e75dd', color: '#fff' }}>
                  <Icon name="video" size={18} />
                </div>
                <div className="wab-info">
                  <span className="wab-title">Video Studio</span>
                  <span className="wab-desc">Timeline editing with lower thirds &amp; captions</span>
                </div>
              </button>

              <button type="button" className="welcome-action-btn" onClick={handleEditorial}>
                <div className="wab-icon" style={{ background: '#1f7a45', color: '#fff' }}>
                  <Icon name="newspaper" size={18} />
                </div>
                <div className="wab-info">
                  <span className="wab-title">Editorial Desk</span>
                  <span className="wab-desc">Fact verification &amp; Bengali article ingestion</span>
                </div>
              </button>

              <button type="button" className="welcome-action-btn" onClick={handleOpenProj}>
                <div className="wab-icon" style={{ background: 'var(--surface-sunken)', color: 'var(--text-primary)', border: '1px solid var(--border-default)' }}>
                  <Icon name="folder" size={18} />
                </div>
                <div className="wab-info">
                  <span className="wab-title">Open Project</span>
                  <span className="wab-desc">Load .esb or project.json from disk</span>
                </div>
              </button>
            </div>
          </div>

          {/* Column 2: Quick Templates or Recents */}
          <div className="welcome-col">
            <h4 className="welcome-col-title">Quick Templates</h4>
            <div className="welcome-templates-grid">
              {FORMAT_LIST.slice(0, 4).map((f) => (
                <button
                  key={f.id}
                  type="button"
                  className="welcome-tpl-card"
                  onClick={() => handleNewBanner(f.id)}
                >
                  <div className="wtc-name">{f.name}</div>
                  <div className="wtc-ratio mono">{f.ratio}</div>
                  <div className="wtc-dims mono">{f.w} × {f.h} px</div>
                </button>
              ))}
            </div>

            {recents.length > 0 && (
              <>
                <h4 className="welcome-col-title" style={{ marginTop: '16px' }}>Recent Projects</h4>
                <div className="welcome-recents-list">
                  {recents.slice(0, 3).map((r) => (
                    <button
                      key={r.path}
                      type="button"
                      className="welcome-recent-item"
                      onClick={() => handleOpenRecentItem(r)}
                    >
                      <Icon name="filePlus" size={14} />
                      <span className="wri-name">{r.name}</span>
                      <span className="wri-path mono">{r.path}</span>
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </Dialog>
  )
}
