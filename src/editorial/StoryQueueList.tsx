// The story queue as a list: every story on the desk, newest edit first, with its status, its source and when it
// was last touched. Picking one swaps it into the editor (and the banner); the current story is saved first.

import { useEffect, useState } from 'react'
import { useStoryQueue, storyTitle, STATUS_LABEL, STORY_STATUSES } from './storyQueue'
import type { StoryItem, StoryStatus } from './storyQueue'
import { Icon } from '../ui/Icon'
import { Select } from '../ui/controls'

function ago(t: number, now: number): string {
  const s = Math.max(0, Math.round((now - t) / 1000))
  if (s < 60) return 'just now'
  const m = Math.round(s / 60)
  if (m < 60) return `${m} min ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h} h ago`
  return new Date(t).toLocaleDateString([], { day: 'numeric', month: 'short' })
}

function host(item: StoryItem): string {
  const url = item.snapshot.source?.url
  if (!url) return 'No source yet'
  if (url === 'pasted-text') return 'Pasted text'
  try { return new URL(url).hostname.replace(/^www\./, '') } catch { return 'Source' }
}

const FILTERS: { value: 'all' | StoryStatus; label: string }[] = [{ value: 'all', label: 'All stories' }, ...STORY_STATUSES.map((s) => ({ value: s, label: STATUS_LABEL[s] }))]

export function StoryQueueList({ onPicked, compact = false }: { onPicked?: () => void; compact?: boolean }) {
  const stories = useStoryQueue((s) => s.stories)
  const activeId = useStoryQueue((s) => s.activeId)
  const switchTo = useStoryQueue((s) => s.switchTo)
  const remove = useStoryQueue((s) => s.remove)
  const setStatus = useStoryQueue((s) => s.setStatus)
  const [filter, setFilter] = useState<'all' | StoryStatus>('all')
  const [confirm, setConfirm] = useState<string | null>(null)
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 30000); return () => clearInterval(t) }, [])

  const shown = stories.filter((s) => filter === 'all' || s.status === filter)
  const counts = STORY_STATUSES.map((s) => [s, stories.filter((x) => x.status === s).length] as const).filter(([, n]) => n > 0)

  if (!stories.length) return <p className="sq-empty">Stories you open are kept here, each with its draft and checklist, so several can be in progress at once.</p>

  return (
    <div className={'sq' + (compact ? ' compact' : '')}>
      {!compact && (
        <div className="sq-bar">
          <Select<'all' | StoryStatus> value={filter} options={FILTERS} onChange={setFilter} className="sq-filter" />
          <span className="sq-counts">{counts.map(([s, n]) => <span key={s} className={'sq-dot ' + s} title={`${n} ${STATUS_LABEL[s].toLowerCase()}`}>{n}</span>)}</span>
        </div>
      )}
      <ul className="sq-list">
        {shown.map((s) => {
          const on = s.id === activeId
          return (
            <li key={s.id} className={'sq-row' + (on ? ' on' : '')} data-story={s.id}>
              <button type="button" className="sq-main" onClick={() => { switchTo(s.id); onPicked?.() }} aria-current={on ? 'true' : undefined} title={on ? 'Open in the editor' : 'Switch to this story'}>
                <span className="sq-title">{storyTitle(s.snapshot)}</span>
              </button>
              <div className="sq-foot">
                {compact
                  ? <span className={'sq-status ' + s.status}>{STATUS_LABEL[s.status]}</span>
                  : <Select<StoryStatus> value={s.status} options={STORY_STATUSES.map((v) => ({ value: v, label: STATUS_LABEL[v] }))} onChange={(v) => setStatus(s.id, v)} className={'sq-status-select ' + s.status} title="Story status" />}
                <span className="sq-meta">{host(s)} · {ago(s.updatedAt, now)}</span>
                {confirm === s.id ? (
                  <button type="button" className="btn sm sq-confirm" onClick={() => { remove(s.id); setConfirm(null) }} onBlur={() => setConfirm(null)} autoFocus>Remove</button>
                ) : (
                  <button type="button" className="ibtn sq-del" aria-label="Remove from the queue" data-tip="Remove from the queue" onClick={() => setConfirm(s.id)}><Icon name="trash" size={13} /></button>
                )}
              </div>
            </li>
          )
        })}
        {!shown.length && <li className="sq-empty">No stories with this status.</li>}
      </ul>
    </div>
  )
}
