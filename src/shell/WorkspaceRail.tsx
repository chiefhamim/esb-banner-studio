import { useShellStore } from './shellStore'
import type { WorkspaceId } from './shellStore'
import { Icon } from '../ui/Icon'
import type { IconName } from '../ui/Icon'

interface RailItem {
  id: WorkspaceId
  label: string
  icon: IconName
  title: string
}

// Only workspaces that are implemented appear on the rail
const WORKSPACES: RailItem[] = [
  { id: 'home', label: 'Home', icon: 'home', title: 'Home · Studio Hub' },
  { id: 'editorial', label: 'Editorial', icon: 'newspaper', title: 'Editorial · Newsroom Fact Desk' },
  { id: 'graphics', label: 'Graphics', icon: 'layers', title: 'Graphics · News Banner Studio' },
  { id: 'video', label: 'Video', icon: 'video', title: 'Video · Video Timeline Editor' },
]

export function WorkspaceRail() {
  const current = useShellStore((s) => s.workspace)
  const setWorkspace = useShellStore((s) => s.setWorkspace)

  return (
    <nav className="workspace-rail" aria-label="Studio workspaces">
      <div className="rail-top">
        {WORKSPACES.map((w) => {
          const active = current === w.id
          return (
            <button
              key={w.id}
              type="button"
              className={`rail-btn ${active ? 'active' : ''}`}
              title={w.title}
              onClick={() => setWorkspace(w.id)}
              aria-current={active ? 'page' : undefined}
            >
              <Icon name={w.icon} size={19} strokeWidth={1.8} />
              <span className="rail-label">{w.label}</span>
            </button>
          )
        })}
      </div>
    </nav>
  )
}
