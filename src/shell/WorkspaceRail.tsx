import { useShellStore } from './shellStore'
import type { WorkspaceId } from './shellStore'
import { Icon } from '../ui/Icon'
import type { IconName } from '../ui/Icon'
import { useSlidingThumb } from '../ui/controls'
import { useSyncExternalStore } from 'react'
import { AccountButton } from './AccountButton'

interface WorkspaceItem { id: WorkspaceId; label: string; icon: IconName; title: string }

// Home stands on its own; the three working desks sit together in one segmented control
const HOME: WorkspaceItem = { id: 'home', label: 'Home', icon: 'home', title: 'Home — projects and recent work' }
export const DESKS: WorkspaceItem[] = [
  { id: 'news', label: 'News', icon: 'inbox', title: 'News — EnergyWatch headlines from the portals' },
  { id: 'editorial', label: 'Editorial', icon: 'newspaper', title: 'Editorial — source, translation, CMS' },
  { id: 'graphics', label: 'Graphics', icon: 'layers', title: 'Graphics — banners and social images' },
  { id: 'video', label: 'Video', icon: 'video', title: 'Video — timeline editor' },
  { id: 'outreach', label: 'Outreach', icon: 'send', title: 'Outreach — promotional campaigns, directory & tracking' },
]

/**
 * The workspace switcher, at the start of every workspace's header: Home as its own button, then Editorial · Graphics ·
 * Video as one segmented control with a sliding highlight. Home is a place you go back to, not a fourth desk, so it is
 * not one of the segments. (This replaced a 56 px icon rail down the left edge.)
 */
export function WorkspaceSwitcher() {
  const current = useShellStore((s) => s.workspace)
  const setWorkspace = useShellStore((s) => s.setWorkspace)
  // live = this header shows the desk that is really open (a parked desk's header can trail by a commit when revealed)
  const { wrap, thumb } = useSlidingThumb(current, 'workspace-switch', () => current === useShellStore.getState().workspace)
  return (
    <div className="ws-wrap">
      <button
        type="button"
        className={'ws-home-btn' + (current === 'home' ? ' on' : '')}
        data-ws="home"
        data-tip={HOME.title}
        aria-label={HOME.label}
        aria-current={current === 'home' ? 'page' : undefined}
        onClick={() => setWorkspace('home')}
      >
        <Icon name={HOME.icon} size={15} />
      </button>
      <nav ref={wrap} className="seg-ctl ws-switch" aria-label="Workspaces">
        {thumb}
        {DESKS.map((w) => {
          const on = current === w.id
          return (
            <button
              key={w.id}
              type="button"
              className={'ws-btn' + (on ? ' on' : '')}
              data-ws={w.id}
              data-tip={w.title}
              aria-label={w.label}
              aria-current={on ? 'page' : undefined}
              onClick={() => setWorkspace(w.id)}
            >
              <Icon name={w.icon} size={15} />
              <span className="ws-label">{w.label}</span>
            </button>
          )
        })}
      </nav>
    </div>
  )
}


// ---------------------------------------------------------------- where the desks live: across the top (default) or down the left
export type DeskNav = 'top' | 'left'
const NAV_KEY = 'esb-banner-studio/desk-nav'
const navSubs = new Set<() => void>()
function readNav(): DeskNav { try { return localStorage.getItem(NAV_KEY) === 'left' ? 'left' : 'top' } catch { return 'top' } }
export function setDeskNav(v: DeskNav) { try { localStorage.setItem(NAV_KEY, v) } catch { /* ignore */ } navSubs.forEach((f) => f()) }
export function useDeskNav(): DeskNav {
  return useSyncExternalStore((f) => { navSubs.add(f); return () => { navSubs.delete(f) } }, readNav)
}

const DESK_INK = [['news', '#0d9488', '#14b8a6', '#0284c7'], ['editorial', '#0aa37a', '#1fd3a8', '#3b82f6'], ['graphics', '#3b82f6', '#7c5cff', '#d946ef'], ['video', '#ff7a1a', '#ff3b6b', '#b24bf3'], ['outreach', '#0284c7', '#38bdf8', '#818cf8']] as const

/** The desks as a column down the left edge: icon over name, the chosen one on a raised chip that glides between them. */
export function DeskRail() {
  const current = useShellStore((s) => s.workspace)
  const setWorkspace = useShellStore((s) => s.setWorkspace)
  return (
    <nav className="desk-rail" aria-label="Desks">
      {/* the same colours the desk's icon takes on Home when hovered */}
      <svg className="desk-rail-defs" aria-hidden focusable="false"><defs>
        {DESK_INK.map(([id, a, b, c]) => (
          <linearGradient key={id} id={`rail-ig-${id}`} gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="24" y2="24">
            <stop offset="0" stopColor={a} /><stop offset=".5" stopColor={b} /><stop offset="1" stopColor={c} />
          </linearGradient>
        ))}
      </defs></svg>
      {/* Home sits in a band as tall as the desk's header, on the header's own line, so menus and rail read as one row */}
      <div className="desk-rail-head">
        <button type="button" className="ws-home-btn desk-rail-home" data-tip={HOME.title} data-tip-pos="right" aria-label={HOME.label} onClick={() => setWorkspace(HOME.id)}><Icon name={HOME.icon} size={19} /></button>
      </div>
      <div className="desk-rail-desks">
        {DESKS.map((w) => {
          const on = current === w.id
          return (
            <button key={w.id} type="button" data-desk={w.id} className={'desk-rail-btn' + (on ? ' on' : '')} data-tip={w.title} data-tip-pos="right" aria-label={w.label} aria-current={on ? 'page' : undefined} onClick={() => setWorkspace(w.id)}>
              <Icon name={w.icon} size={19} />
              <span>{w.label}</span>
            </button>
          )
        })}
      </div>
      {/* desks down the left: the account lives at the foot of the rail instead of in each desk's header */}
      <div className="desk-rail-foot"><AccountButton /></div>
    </nav>
  )
}
