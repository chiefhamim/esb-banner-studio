import { useShellStore } from './shellStore'
import type { WorkspaceId } from './shellStore'
import { Icon } from '../ui/Icon'
import type { IconName } from '../ui/Icon'
import { useSlidingThumb } from '../ui/controls'

interface WorkspaceItem { id: WorkspaceId; label: string; icon: IconName; title: string }

// Home stands on its own; the three working desks sit together in one segmented control
const HOME: WorkspaceItem = { id: 'home', label: 'Home', icon: 'home', title: 'Home — projects and recent work' }
const DESKS: WorkspaceItem[] = [
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
  const { wrap, thumb } = useSlidingThumb(current, 'workspace-switch')
  return (
    <div className="ws-wrap">
      {/* the Home icon's hover sheen — same moving gradient and colours as the "Studio" word on the Home screen */}
      <svg width="0" height="0" style={{ position: 'absolute' }} aria-hidden focusable="false">
        <defs>
          <linearGradient id="ws-home-ig" gradientUnits="userSpaceOnUse" x1="-24" y1="0" x2="0" y2="24" spreadMethod="reflect">
            <stop offset="0" stopColor="#0aa37a" /><stop offset=".5" stopColor="#1fd3a8" /><stop offset="1" stopColor="#3b82f6" />
            <animate attributeName="x1" values="-24;0;-24" dur="6s" repeatCount="indefinite" calcMode="spline" keyTimes="0;.5;1" keySplines=".45 0 .55 1;.45 0 .55 1" />
            <animate attributeName="x2" values="0;24;0" dur="6s" repeatCount="indefinite" calcMode="spline" keyTimes="0;.5;1" keySplines=".45 0 .55 1;.45 0 .55 1" />
          </linearGradient>
        </defs>
      </svg>
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
