// The Library tab of the source column: quotes and figures harvested from stories, searchable, each with where it came
// from, and one click to turn it into a Quote or Stats banner. The speaker registry is edited at the foot.

import { useEffect, useMemo, useState } from 'react'
import { useQuoteLibrary, installPublishHarvest, quoteBannerPatch, statBannerPatch, searchEntries } from './quoteLibrary'
import type { LibraryEntry, Speaker, EntryKind, HarvestResult } from './quoteLibrary'
import { useStore } from '../store'
import { useShellStore } from '../shell/shellStore'
import { Icon } from '../ui/Icon'
import { Panel, Seg, Select } from '../ui/controls'
import type { Opt } from '../ui/controls'

installPublishHarvest()

type KindFilter = 'all' | EntryKind
type WhoFilter = 'all' | `sp:${string}` | `org:${string}`

function host(u: string): string {
  try { return new URL(u).hostname.replace(/^www\./, '') } catch { return u }
}

/** Where an entry came from, in words: the story's headline and its published address (or why there is none). */
function provenance(e: LibraryEntry): string {
  const where = e.slug ? `/articles/${e.slug}` : e.url ? host(e.url) : e.sourceUrl ? `source: ${host(e.sourceUrl)}` : 'not published'
  return `from ${e.headline} · ${where}${e.from === 'source' ? ' · original text' : ''}`
}

function resultText(r: (HarvestResult & { trigger: 'manual' | 'published' }) | null): string | null {
  if (!r) return null
  const lead = r.trigger === 'published' ? 'Published story harvested: ' : ''
  if (r.failed) return `${lead}${r.added} added; ${r.failed} could not be stored on this computer.`
  if (!r.found) return `${lead}No quotes or figures with units in this story.`
  if (!r.added) return `${lead}Nothing new: this story's quotes and figures are already in the library.`
  const known = r.merged + r.updated
  return `${lead}${r.added} added${known ? ` · ${known} already here` : ''}.`
}

function sendToBanner(e: LibraryEntry, speakers: Speaker[]) {
  useStore.getState().setContent(e.kind === 'quote' ? quoteBannerPatch(e, speakers) : statBannerPatch(e))
  useShellStore.getState().openGraphicsFrom('editorial', null)
}

/** A text field that saves when it loses focus (or on Enter), not on every key. */
function CommitInput({ value, onCommit, label, placeholder }: { value: string; onCommit: (v: string) => void; label: string; placeholder: string }) {
  return (
    <input
      key={value}
      type="text"
      className="input ql-sp-input"
      defaultValue={value}
      aria-label={label}
      placeholder={placeholder}
      onBlur={(ev) => { const v = ev.currentTarget.value.trim(); if (v !== value) onCommit(v) }}
      onKeyDown={(ev) => { if (ev.key === 'Enter') ev.currentTarget.blur() }}
    />
  )
}

function SpeakerRegistry() {
  const speakers = useQuoteLibrary((s) => s.speakers)
  const editSpeaker = useQuoteLibrary((s) => s.editSpeaker)
  const addSpeaker = useQuoteLibrary((s) => s.addSpeaker)
  const removeSpeaker = useQuoteLibrary((s) => s.removeSpeaker)
  const [draft, setDraft] = useState({ name: '', title: '', org: '' })
  const [confirm, setConfirm] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)

  const add = async () => {
    const made = await addSpeaker(draft)
    if (made) { setDraft({ name: '', title: '', org: '' }); setNote(null) } else setNote('That name is already in the registry.')
  }

  return (
    <Panel id="ql-speakers" icon="users" title="Speakers" sub={String(speakers.length)} defaultOpen={false} persist={false}>
      <ul className="ql-sp-list">
        {speakers.map((s) => (
          <li key={s.id} className="ql-sp-row" data-speaker={s.id}>
            <CommitInput value={s.name} label="Speaker name" placeholder="Name" onCommit={(v) => { if (v) void editSpeaker(s.id, { name: v }) }} />
            {confirm === s.id ? (
              <button type="button" className="btn sm ql-confirm" onClick={() => { void removeSpeaker(s.id); setConfirm(null) }} onBlur={() => setConfirm(null)} autoFocus>Remove</button>
            ) : (
              <button type="button" className="ibtn ql-del" aria-label={`Remove ${s.name} from the registry`} data-tip="Remove from the registry" onClick={() => setConfirm(s.id)}><Icon name="trash" size={13} /></button>
            )}
            <CommitInput value={s.title} label="Speaker title" placeholder="Title" onCommit={(v) => void editSpeaker(s.id, { title: v })} />
            <CommitInput value={s.org} label="Speaker organisation" placeholder="Organisation" onCommit={(v) => void editSpeaker(s.id, { org: v })} />
          </li>
        ))}
      </ul>
      <div className="ql-sp-add">
        <input type="text" className="input ql-sp-input ql-sp-name" aria-label="New speaker name" placeholder="New speaker name" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} onKeyDown={(e) => { if (e.key === 'Enter' && draft.name.trim()) void add() }} />
        <input type="text" className="input ql-sp-input" aria-label="New speaker title" placeholder="Title" value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
        <input type="text" className="input ql-sp-input" aria-label="New speaker organisation" placeholder="Organisation" value={draft.org} onChange={(e) => setDraft({ ...draft, org: e.target.value })} />
        <button type="button" className="btn sm ql-sp-addbtn" disabled={!draft.name.trim()} onClick={() => void add()}><Icon name="plus" size={14} /><span>Add speaker</span></button>
        {note && <p className="ql-note" role="status">{note}</p>}
      </div>
    </Panel>
  )
}

function Row({ e, speakers }: { e: LibraryEntry; speakers: Speaker[] }) {
  const remove = useQuoteLibrary((s) => s.remove)
  const [confirm, setConfirm] = useState(false)
  const quote = e.kind === 'quote'
  const who = quote ? [e.speaker, e.speakerTitle].filter(Boolean).join(', ') : ''
  return (
    <li className={'ql-row ' + e.kind} data-entry={e.id} data-kind={e.kind}>
      {quote
        ? <p className="ql-text">“{e.text}”</p>
        : <p className="ql-fig"><span className="ql-num">{e.text}</span><span className="ql-sentence">{e.sentence}</span></p>}
      {quote && <p className={'ql-who' + (who ? '' : ' unknown')}>{who ? `— ${who}` : 'Speaker not named in the story'}</p>}
      <p className="ql-prov" title={e.url || e.sourceUrl || undefined}>{provenance(e)}</p>
      <div className="ql-actions">
        <button type="button" className="btn sm ql-use" onClick={() => sendToBanner(e, speakers)}>
          <Icon name={quote ? 'quote' : 'chart'} size={14} /><span>{quote ? 'Use as quote banner' : 'Use as stat banner'}</span>
        </button>
        {confirm ? (
          <button type="button" className="btn sm ql-confirm" onClick={() => { void remove(e.id); setConfirm(false) }} onBlur={() => setConfirm(false)} autoFocus>Remove</button>
        ) : (
          <button type="button" className="ibtn ql-del" aria-label="Remove from the library" data-tip="Remove from the library" onClick={() => setConfirm(true)}><Icon name="trash" size={13} /></button>
        )}
      </div>
    </li>
  )
}

export function QuoteLibraryPanel() {
  const loaded = useQuoteLibrary((s) => s.loaded)
  const busy = useQuoteLibrary((s) => s.busy)
  const entries = useQuoteLibrary((s) => s.entries)
  const speakers = useQuoteLibrary((s) => s.speakers)
  const last = useQuoteLibrary((s) => s.last)
  const load = useQuoteLibrary((s) => s.load)
  const harvestActive = useQuoteLibrary((s) => s.harvestActive)
  const [query, setQuery] = useState('')
  const [kind, setKind] = useState<KindFilter>('all')
  const [who, setWho] = useState<WhoFilter>('all')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => { void load() }, [load])

  const whoOptions = useMemo<Opt<WhoFilter>[]>(() => {
    const orgs = [...new Set([...speakers.map((s) => s.org), ...entries.map((e) => e.org ?? '')].filter(Boolean))].sort((a, b) => a.localeCompare(b))
    const people = speakers.filter((s) => s.name !== s.org).sort((a, b) => a.name.localeCompare(b.name))
    return [
      { value: 'all', label: 'All speakers & orgs' },
      ...orgs.map((o): Opt<WhoFilter> => ({ value: `org:${o}`, label: o, hint: 'Org' })),
      ...people.map((s): Opt<WhoFilter> => ({ value: `sp:${s.id}`, label: s.name, hint: s.title || undefined })),
    ]
  }, [speakers, entries])
  const whoValue: WhoFilter = whoOptions.some((o) => o.value === who) ? who : 'all'

  const shown = useMemo(() => searchEntries(entries, query, {
    kind: kind === 'all' ? undefined : kind,
    speaker: whoValue.startsWith('sp:') ? whoValue.slice(3) : undefined,
    org: whoValue.startsWith('org:') ? whoValue.slice(4) : undefined,
  }, speakers), [entries, query, kind, whoValue, speakers])

  const harvest = async () => {
    setError(null)
    try { await harvestActive() } catch (err) { setError(err instanceof Error ? err.message : 'The harvest did not finish.') }
  }
  const message = error ?? resultText(last)
  const harvestBtn = (
    <button type="button" className="btn sm ql-harvest" onClick={() => void harvest()} disabled={busy || !loaded}>
      <Icon name="plus" size={14} /><span>{busy ? 'Harvesting' : 'Harvest from this story'}</span>
    </button>
  )

  return (
    <div className="ql">
      {!loaded ? (
        <p className="ql-empty">Opening the library</p>
      ) : !entries.length ? (
        <div className="ql-start">
          <p className="ql-empty-title">Nothing harvested yet</p>
          <p className="ql-empty">Quotes with their speakers and figures with their units are kept here from every story you harvest or publish, each with the story it came from.</p>
          {harvestBtn}
        </div>
      ) : (
        <div className="ql-bar">
          {harvestBtn}
          <span className="ql-count">{entries.length} saved</span>
        </div>
      )}
      {message && <p className={'ql-note' + (error || last?.failed ? ' bad' : '')} role="status">{message}</p>}

      {entries.length > 0 && (
        <>
          <label className="ql-search">
            <Icon name="search" size={14} />
            <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search quotes, figures, speakers" aria-label="Search the library" />
          </label>
          <div className="ql-filters">
            <Seg<KindFilter> value={kind} onChange={setKind} className="ql-kind" options={[{ value: 'all', label: 'All' }, { value: 'quote', label: 'Quotes' }, { value: 'stat', label: 'Stats' }]} />
            <Select<WhoFilter> value={whoValue} options={whoOptions} onChange={setWho} className="ql-who-filter" title="Filter by speaker or organisation" />
          </div>
          <ul className="ql-list">
            {shown.map((e) => <Row key={e.id} e={e} speakers={speakers} />)}
            {!shown.length && <li className="ql-empty">Nothing in the library matches.</li>}
          </ul>
        </>
      )}

      {loaded && <SpeakerRegistry />}
    </div>
  )
}
