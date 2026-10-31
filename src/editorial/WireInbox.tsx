// The Wire branch of the Editorial intake: the source list, Check now, and the inbox of found stories. "Use this link"
// hands an item's link to the Link tab; it never fetches the article by itself.

import { useEffect, useState } from 'react'
import { Icon } from '../ui/Icon'
import { IconButton, Scrub, Switch } from '../ui/controls'
import {
  useWire, filterItems, relTime, sourceStatus, MIN_INTERVAL, MAX_INTERVAL, DEFAULT_INTERVAL,
  type WireSource, type PollReport,
} from './wire'

/** Re-render once a minute so "5 min ago" and "Retrying in …" stay true. */
function useNow(): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => { const id = window.setInterval(() => setNow(Date.now()), 30_000); return () => window.clearInterval(id) }, [])
  return now
}

function reportText(r: PollReport, now: number): string {
  if (r.polled && r.noBridge === r.polled) return 'Feeds are fetched by the desktop app. Open ESB AI Studio to check sources.'
  if (!r.polled) return r.nextAt == null ? 'No source is switched on.' : `Nothing due — next check ${r.nextAt <= now ? 'now' : relTime(r.nextAt, now)}.`
  const parts = [`Checked ${r.polled} ${r.polled === 1 ? 'source' : 'sources'}`, `${r.added} new`]
  if (r.failed) parts.push(`${r.failed} failed`)
  if (r.noBridge) parts.push(`${r.noBridge} need the desktop app`)
  return parts.join(' · ') + '.'
}

function AddSource({ first }: { first: boolean }) {
  const addSource = useWire((s) => s.addSource)
  const [url, setUrl] = useState('')
  const [name, setName] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const add = () => {
    const r = addSource({ url, name, intervalMin: DEFAULT_INTERVAL })
    if (!r.ok) { setErr(r.error); return }
    setUrl(''); setName(''); setErr(null)
  }
  return (
    <div className="ed-wire-add">
      <div className="ed-wire-add-row">
        <input type="url" className="input ed-wire-url" placeholder="Feed address (RSS, Atom or sitemap)" aria-label="Feed address" value={url} spellCheck={false}
          onChange={(e) => { setUrl(e.target.value); setErr(null) }} onKeyDown={(e) => e.key === 'Enter' && add()} />
        <input type="text" className="input ed-wire-name" placeholder="Name (optional)" aria-label="Source name" value={name}
          onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add()} />
        <button type="button" className={'btn' + (first ? ' primary' : '')} onClick={add} disabled={!url.trim()}>
          <Icon name="plus" size={14} /><span>Add source</span>
        </button>
      </div>
      {err && <p className="ed-wire-err" role="alert">{err}</p>}
    </div>
  )
}

function SourceRow({ s, now }: { s: WireSource; now: number }) {
  const update = useWire((st) => st.updateSource)
  const remove = useWire((st) => st.removeSource)
  const [url, setUrl] = useState(s.url)
  const [name, setName] = useState(s.name)
  const st = sourceStatus(s, now)
  return (
    <li className={'ed-wire-src' + (s.enabled ? '' : ' off')} data-source={s.id}>
      <div className="ed-wire-src-fields">
        <input type="text" className="input ed-wire-name" aria-label="Source name" placeholder="Name" value={name}
          onChange={(e) => setName(e.target.value)} onBlur={() => name !== s.name && update(s.id, { name })}
          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} />
        <input type="url" className="input ed-wire-url" aria-label="Feed address" value={url} spellCheck={false}
          onChange={(e) => setUrl(e.target.value)} onBlur={() => { if (url !== s.url) { update(s.id, { url }); setUrl(useWire.getState().sources.find((x) => x.id === s.id)?.url ?? s.url) } }}
          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} />
      </div>
      <div className="ed-wire-src-ctl">
        <Scrub className="ed-wire-interval" label="Every" unit="min" value={s.intervalMin} min={MIN_INTERVAL} max={MAX_INTERVAL} step={5} decimals={0}
          title="Minutes between checks (15 to 360)" onChange={(v) => update(s.id, { intervalMin: v })} />
        <Switch checked={s.enabled} onChange={(v) => update(s.id, { enabled: v })} label="On" />
        <IconButton icon="trash" tip="Remove source" onClick={() => remove(s.id)} />
      </div>
      <p className={'ed-wire-src-status ' + st.tone}>{st.text}</p>
    </li>
  )
}

export function WireInbox({ onUse }: { onUse: (url: string) => void }) {
  const sources = useWire((s) => s.sources)
  const items = useWire((s) => s.items)
  const polling = useWire((s) => s.polling)
  const dismiss = useWire((s) => s.dismiss)
  const pollDue = useWire((s) => s.pollDue)
  const now = useNow()
  const [q, setQ] = useState('')
  const [note, setNote] = useState<string | null>(null)
  const [sourcesOpen, setSourcesOpen] = useState(false)
  const shown = filterItems(items, q)
  const retrying = sources.filter((s) => s.enabled && s.failures > 0).length

  const checkNow = async () => {
    setNote(null)
    const r = await pollDue(Date.now())
    setNote(r ? reportText(r, Date.now()) : 'A check is already running.')
  }

  if (!sources.length) {
    return (
      <div className="ed-intake-body ed-wire">
        <div className="ed-wire-empty">
          <b>No sources yet</b>
          <p className="hint">Add the RSS, Atom or news sitemap address of a site you follow. New stories are listed here; nothing is fetched until a source is due.</p>
        </div>
        <AddSource first />
      </div>
    )
  }

  return (
    <div className="ed-intake-body ed-wire">
      <div className="ed-intake-url ed-feed-filter-row">
        <input type="text" className="input ed-url-input" placeholder="Filter stories…" aria-label="Filter wire stories" value={q} onChange={(e) => setQ(e.target.value)} />
        <button type="button" className="btn ed-wire-check" onClick={() => void checkNow()} disabled={polling}>
          <Icon name="refresh" size={13} className={polling ? 'spin' : undefined} />
          <span>{polling ? 'Checking' : 'Check now'}</span>
        </button>
      </div>
      {note && <p className="ed-wire-note" role="status">{note}</p>}

      <details className="ed-wire-sources" open={sourcesOpen} onToggle={(e) => setSourcesOpen((e.target as HTMLDetailsElement).open)}>
        <summary className="ed-wire-head">
          <Icon name="chevRight" size={13} className="ed-wire-chev" />
          <b>Sources</b>
          <span>{sources.filter((s) => s.enabled).length} of {sources.length} on</span>
          {retrying > 0 && <span className="ed-wire-head-warn">{retrying} retrying</span>}
        </summary>
        <ul className="ed-wire-src-list">{sources.map((s) => <SourceRow key={`${s.id}|${s.url}|${s.name}`} s={s} now={now} />)}</ul>
        <AddSource first={false} />
      </details>

      <div className="ed-feed-list ed-wire-list">
        {shown.length === 0 ? (
          <p className="hint ed-feed-empty">{items.length ? 'No stories match that filter.' : 'No stories yet. Check now polls every source that is due.'}</p>
        ) : shown.map((it) => (
          <div key={it.id} className="ed-feed-item ed-wire-item" data-link={it.link}>
            <div className="ed-feed-text">
              <b title={it.title}>{it.title}</b>
              <span><i className="ed-wire-srcname">{it.source}</i>{it.date ? relTime(Math.min(Date.parse(it.date), now), now) : `found ${relTime(Math.min(it.fetchedAt, now), now)}`}</span>
            </div>
            <div className="ed-wire-item-act">
              <button type="button" className="btn sm" onClick={() => onUse(it.link)}>Use this link</button>
              <IconButton icon="x" tip="Dismiss" onClick={() => dismiss(it.id)} />
            </div>
          </div>
        ))}
      </div>

    </div>
  )
}
