import { useState, useEffect, useRef } from 'react'
import lightBgUrl from '../assets/images/home/home-light.jpg'
import darkBgUrl from '../assets/images/home/home-dark-gradient.jpg'
import markLight from '../assets/images/home/esb-mark-light.png'
import markDark from '../assets/images/home/esb-mark-dark.png'
import { readRecent, openProject, openRecent } from '../project'
import type { RecentProject } from '../project'
import { useShellStore } from './shellStore'
import { useStore } from '../store'
import { FORMAT_LIST } from '../core/tokens'

// the sizes the desk reaches for every day; the others (Facebook Classic, lower third, title and end cards) stay in the
// Graphics format picker
const HOME_FORMATS = ['fb45', 'story', 'sq', 'web', 'yt'].map((id) => FORMAT_LIST.find((f) => f.id === id)!)
import type { FormatId } from '../core/types'
import { Icon } from '../ui/Icon'
import { Dialog } from '../ui/controls'

const HOME_BG_POS_KEY = 'esb-banner-studio/home-bg-pos'
type BgPos = { x: number; y: number; s: number }
const BG_POS_0: BgPos = { x: 0, y: 0, s: 1 }
const clampPos = (p: BgPos): BgPos => {
  // The picture is 6% larger than the screen on every side, and its slow drift moves it up to 3.4% either way; an offset may only use what is left, or a strip
  // of the page shows along the edge at the extremes of the drift.
  const s = Math.min(3, Math.max(1, p.s)), lim = (s - 1) * 50 + 2.5
  return { s, x: Math.min(lim, Math.max(-lim, p.x)), y: Math.min(lim, Math.max(-lim, p.y)) }
}
// only an image this app itself wrote (a JPEG data URL) is ever placed in a CSS url(); anything else in storage is ignored
const SAFE_BG = /^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/
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
    const read = (t: 'light' | 'dark') => { try { const v = localStorage.getItem(HOME_BG_KEY(t)); return v && SAFE_BG.test(v) ? v : null } catch { return null } }
    return { light: read('light'), dark: read('dark') }
  })
  const customBg = customBgs[theme]
  const bgInput = useRef<HTMLInputElement>(null)
  const [showSettings, setShowSettings] = useState(false)
  // The picture can be dragged and zoomed by hand (per theme), so a light patch of it can be put exactly where the logo sits.
  const [bgPos, setBgPos] = useState<Record<'light' | 'dark', BgPos>>(() => {
    try {
      const v = JSON.parse(localStorage.getItem(HOME_BG_POS_KEY) || 'null')
      const ok = (p: unknown): BgPos => { const q = p as Partial<BgPos> | null; return q && [q.x, q.y, q.s].every((n) => typeof n === 'number' && Number.isFinite(n)) ? clampPos(q as BgPos) : BG_POS_0 }
      if (v && typeof v === 'object') return { light: ok(v.light), dark: ok(v.dark) }
    } catch { /* ignore */ }
    return { light: BG_POS_0, dark: BG_POS_0 }
  })
  const [moving, setMoving] = useState(false)
  const dragRef = useRef<{ px: number; py: number; x: number; y: number } | null>(null)
  const pos = bgPos[theme]
  const setPos = (p: BgPos) => setBgPos((b) => {
    const next = { ...b, [theme]: clampPos(p) }
    try { localStorage.setItem(HOME_BG_POS_KEY, JSON.stringify(next)) } catch { /* ignore */ }
    return next
  })
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
      <div className="home-head-actions">
        <button type="button" className="home-head-btn" data-tip="Settings" aria-label="Settings" onClick={() => setShowSettings(true)}>
          <Icon name="sliders" size={15} />
        </button>
        <button type="button" className="home-head-btn" data-tip={theme === 'dark' ? 'Switch to light appearance' : 'Switch to dark appearance'} aria-label="Toggle appearance" onClick={() => useStore.getState().setTheme(theme === 'dark' ? 'light' : 'dark')}>
          <Icon name={theme === 'dark' ? 'sun' : 'moon'} size={15} />
        </button>
        {canQuit && <i className="home-head-sep" aria-hidden />}
        {canQuit && (
          <button type="button" className="home-head-btn quit" data-tip="Quit ESB AI Studio (Ctrl+Q)" onClick={() => void window.esb?.quit?.()}>
            <Icon name="x" size={14} />
            <span>Quit</span>
          </button>
        )}
        <span className="home-fold" aria-hidden><Icon name="more" size={18} /></span>
      </div>
    </header>
    <input ref={bgInput} type="file" accept="image/*" hidden onChange={(e) => { void pickBackground(e.target.files?.[0]); e.target.value = '' }} />
    {showSettings && (
      <Dialog title="Settings" kicker="HOME" width={440} onClose={() => setShowSettings(false)} footer={<><div className="spacer" /><button type="button" className="btn primary" onClick={() => setShowSettings(false)}>Done</button></>}>
        <div className="stack" style={{ gap: 10 }}>
          <strong>Home background</strong>
          <p className="sub">{customBg ? 'Showing your own image.' : `Showing the ${theme === 'dark' ? 'dark' : 'light'} default.`} Your image is kept on this computer and used for the {theme === 'dark' ? 'dark' : 'light'} appearance only; the other keeps its own.</p>
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            <button type="button" className="btn" onClick={() => { setShowSettings(false); setMoving(true) }}><Icon name="hand" size={14} /> Move background</button>
            <button type="button" className="btn" onClick={() => bgInput.current?.click()}><Icon name="image" size={14} /> Choose image</button>
            {customBg && <button type="button" className="btn" onClick={resetBackground}><Icon name="reset" size={14} /> Use default</button>}
          </div>
        </div>
      </Dialog>
    )}
    {/* the background: a soft colour field that drifts slowly; a veil in the theme's own colour keeps it quiet */}
    <div className={'home-bg' + (moving ? ' moving' : '')} aria-hidden>
      <div className="home-bg-pos" style={{ transform: `translate(${pos.x}%, ${pos.y}%) scale(${pos.s})` }}>
        <div className="home-bg-img" style={{ backgroundImage: `url("${customBg ?? (theme === 'dark' ? darkBgUrl : lightBgUrl)}")` }} />
      </div>
    </div>
    {moving && (
      <div
        className="home-move-layer"
        onPointerDown={(e) => { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); dragRef.current = { px: e.clientX, py: e.clientY, x: pos.x, y: pos.y } }}
        onPointerMove={(e) => { const d = dragRef.current; if (!d) return; const r = e.currentTarget.getBoundingClientRect(); setPos({ ...pos, x: d.x + ((e.clientX - d.px) / r.width) * 100, y: d.y + ((e.clientY - d.py) / r.height) * 100 }) }}
        onPointerUp={() => { dragRef.current = null }}
        onWheel={(e) => setPos({ ...pos, s: pos.s * (e.deltaY < 0 ? 1.06 : 1 / 1.06) })}
      >
        <div className="home-move-bar" onPointerDown={(e) => e.stopPropagation()} onWheel={(e) => e.stopPropagation()}>
          <span>Drag to move the background · scroll to zoom</span>
          <button type="button" className="btn" onClick={() => setPos(BG_POS_0)}>Reset</button>
          <button type="button" className="btn primary" onClick={() => setMoving(false)}>Done</button>
        </div>
      </div>
    )}
    <main className="home-workspace" aria-label="Home dashboard">
      <div className="home-container">
        <header className="home-header">
          <div className="home-header-brand">
            <div className="home-title-group">
              <h1 className="home-title" aria-label="ESB PowerLine AI Studio"><img className="home-mark home-mark-light" src={markLight} alt="" aria-hidden draggable={false} /><img className="home-mark home-mark-dark" src={markDark} alt="" aria-hidden draggable={false} /> <span className="home-ai">Ai</span> <span className="home-title-accent">Studio</span></h1>
              <p className="home-subtitle">Where stories are written, imagination is designed and reality is cut</p>
            </div>
          </div>
        </header>

        <svg className="home-defs" aria-hidden focusable="false">
          <defs>
            {([['1', '#0aa37a', '#1fd3a8', '#3b82f6'], ['2', '#3b82f6', '#7c5cff', '#d946ef'], ['3', '#ff7a1a', '#ff3b6b', '#b24bf3']] as const).map(([n, c1, c2, c3]) => (
              <linearGradient key={n} id={`home-ig-${n}`} gradientUnits="userSpaceOnUse" x1="-24" y1="0" x2="0" y2="24" spreadMethod="reflect">
                <stop offset="0" stopColor={c1} /><stop offset=".5" stopColor={c2} /><stop offset="1" stopColor={c3} />
                <animate attributeName="x1" values="-24;0;-24" dur="6s" repeatCount="indefinite" calcMode="spline" keyTimes="0;.5;1" keySplines=".45 0 .55 1;.45 0 .55 1" />
                <animate attributeName="x2" values="0;24;0" dur="6s" repeatCount="indefinite" calcMode="spline" keyTimes="0;.5;1" keySplines=".45 0 .55 1;.45 0 .55 1" />
              </linearGradient>
            ))}
          </defs>
        </svg>
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
            {HOME_FORMATS.map((f) => (
              <button
                key={f.id}
                type="button"
                className="format-card"
                style={{ ['--i' as string]: HOME_FORMATS.indexOf(f) }}
                onClick={() => handleNewProject(f.id)}
                title={`Create new banner with ${f.name} format`}
              >
                <span className="format-glyph" aria-hidden><i style={{ width: Math.round(f.w >= f.h ? 34 : 34 * f.w / f.h), height: Math.round(f.w >= f.h ? 34 * f.h / f.w : 34) }} /></span>
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
          {recents.length > 0 || recoverySnapshot ? (
            <div className="recents-grid">
              {recoverySnapshot && (
                <div className="recent-card recovery-card" role="group" aria-label="Unsaved session found">
                  <div className="recent-icon"><Icon name="refresh" size={18} /></div>
                  <div className="recent-info">
                    <span className="recent-name">Unsaved session</span>
                    <span className="recent-path">{recoverySnapshot.name} · {recoverySnapshot.time}</span>
                  </div>
                  <div className="recovery-actions">
                    <button type="button" className="btn primary compact" onClick={handleRestoreRecovery}>Restore</button>
                    <button type="button" className="ibtn" data-tip="Discard the unsaved session" aria-label="Discard the unsaved session" onClick={handleDiscardRecovery}><Icon name="trash" size={15} /></button>
                  </div>
                </div>
              )}
              {recents.slice(0, recoverySnapshot ? 1 : 2).map((item) => (
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
              {(recoverySnapshot ? 1 : 0) + Math.min(recents.length, recoverySnapshot ? 1 : 2) < 2 && (
                <button type="button" className="recent-card recent-empty" onClick={() => void handleOpenProject()}>
                  <div className="recent-icon"><Icon name="folder" size={20} /></div>
                  <div className="recent-info"><span className="recent-name">Open a project…</span><span className="recent-path">Browse for a saved project</span></div>
                </button>
              )}
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
