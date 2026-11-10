// Welcome screen (Help → Welcome screen): the five desks in the order a story travels through them, each a click away,
// then the ways back into earlier work. Everything said here is what the desk really does today.
import { useState, useEffect } from 'react'
import logoUrl from '../assets/images/esb-logo.png'
import { readRecent, openProject, openRecent } from '../project'
import type { RecentProject } from '../project'
import { useShellStore } from '../shell/shellStore'
import type { WorkspaceId } from '../shell/shellStore'
import { DESKS } from '../shell/WorkspaceRail'
import { Dialog } from './controls'
import { Icon } from './Icon'

/** What each desk does, in a line — the pipeline from a headline to every channel. */
export const DESK_LINES: Record<string, { step: string; line: string }> = {
  news: { step: 'Find', line: 'Energy headlines from the portals and the official press wings, checked every few minutes.' },
  editorial: { step: 'Write', line: 'A link, text or PDF in; a checked English story with SEO and captions out, published to the site.' },
  graphics: { step: 'Design', line: 'The story’s banner in every newsroom format, fully editable, exported or posted.' },
  video: { step: 'Cut', line: 'A timeline for footage, titles, captions and sound — from the story or from scratch.' },
  outreach: { step: 'Send', line: 'Letters and campaigns from your own mail account, paced, checked and tracked.' },
}

export function WelcomeModal({ onClose }: { onClose: () => void }) {
  const setWorkspace = useShellStore((s) => s.setWorkspace)
  const [recents, setRecents] = useState<RecentProject[]>([])
  useEffect(() => { setRecents(readRecent()) }, [])

  const go = (id: WorkspaceId) => { setWorkspace(id); onClose() }
  const openProj = async () => { await openProject(); go('graphics') }
  const openRecentItem = async (r: RecentProject) => { await openRecent(r); go('graphics') }

  return (
    <Dialog title="Welcome to ESB AI Studio" kicker="ESB POWER LINE NEWSROOM" onClose={onClose} width={760}>
      <div className="wl2">
        <header className="wl2-hero">
          <span className="logo-wrap"><img src={logoUrl} alt="ESB Power Line" /></span>
          <div>
            <h3>From a headline to every channel</h3>
            <p>Five desks, one story: find it, write it, design it, cut it, send it. Each desk hands its work to the next.</p>
          </div>
        </header>

        <ol className="wl2-desks">
          {DESKS.map((d, i) => (
            <li key={d.id}>
              <button type="button" className="wl2-desk" onClick={() => go(d.id)}>
                <span className="wl2-n">{i + 1}</span>
                <span className="wl2-ic"><Icon name={d.icon} size={18} /></span>
                <span className="wl2-t"><b>{d.label}</b><small>{DESK_LINES[d.id]?.step}</small></span>
                <span className="wl2-line">{DESK_LINES[d.id]?.line}</span>
                <Icon name="chevRight" size={15} className="wl2-go" />
              </button>
            </li>
          ))}
        </ol>

        <footer className="wl2-foot">
          <button type="button" className="btn" onClick={() => void openProj()}><Icon name="folder" size={15} /><span>Open a banner project</span></button>
          {recents.slice(0, 3).map((r) => (
            <button key={r.path} type="button" className="btn subtle wl2-recent" onClick={() => void openRecentItem(r)} data-tip={r.path}>
              <Icon name="clock" size={14} /><span>{r.name}</span>
            </button>
          ))}
        </footer>
      </div>
    </Dialog>
  )
}
