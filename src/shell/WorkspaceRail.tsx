import { useShellStore } from './shellStore'
import type { WorkspaceId } from './shellStore'
import { Icon } from '../ui/Icon'
import type { IconName } from '../ui/Icon'
import { useSlidingThumb } from '../ui/controls'

interface WorkspaceItem { id: WorkspaceId; label: string; icon: IconName; title: string }

// Only workspaces that are implemented appear here
const WORKSPACES: WorkspaceItem[] = [
  { id: 'home', label: 'Home', icon: 'home', title: 'Home — projects and recent work' },
  { id: 'editorial', label: 'Editorial', icon: 'newspaper', title: 'Editorial — source, translation, CMS' },
  { id: 'graphics', label: 'Graphics', icon: 'layers', title: 'Graphics — banners and social images' },
  { id: 'video', label: 'Video', icon: 'video', title: 'Video — timeline editor' },
]

/**
 * The workspace switcher: one segmented control at the start of every workspace's header, so "where am I" is always
 * answered in the same place, in the same words, with the same sliding highlight. It replaced a 56 px icon rail down
 * the left edge, which spent a column of the window on four buttons and looked unlike the rest of the chrome.
 */
export function WorkspaceSwitcher() {
  const current = useShellStore((s) => s.workspace)
  const setWorkspace = useShellStore((s) => s.setWorkspace)
  const { wrap, thumb } = useSlidingThumb(current)
  return (
    <nav ref={wrap} className="seg-ctl ws-switch" aria-label="Workspaces">
      {thumb}
      {WORKSPACES.map((w) => {
        const on = current === w.id
        return (
          <button
            key={w.id}
            type="button"
            className={'ws-btn' + (on ? ' on' : '') + (w.id === 'home' ? ' ws-home' : '')}
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
  )
}
