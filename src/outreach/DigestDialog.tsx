// Campaigns → New → "Campaign from this week's stories" (W4). The stories this app published in a date range — read
// from the publish log and the story queue, nothing invented — ticked, reordered and introduced by the editor, then
// handed to the ordinary campaign flow as a DRAFT. Nothing here sends: the new campaign still needs a list, and goes
// out only through Review & send with every check, the pacing and the approvals that path already has.
//
// The site's own list (fetchLiveArticles, the public feed) is read once when the sheet opens, only to fill a deck the
// desk did not keep; a failed read is said, never papered over. Pictures are not put in the letter: the letter's
// marks have no picture mark (digest.ts IMAGE_MARK).

import { useEffect, useMemo, useState } from 'react'
import { DEFAULT_SIGNATURE, useOutreachStore } from './outreachStore'
import { OPT_OUT_LINE } from './compose'
import { logoDataUrl, renderEmail } from './emailRender'
import { Check, DatePicker, Dialog, Field, IconButton, Seg } from '../ui/controls'
import { Icon } from '../ui/Icon'
import { readPublishLog } from '../editorial/insights'
import { useStoryQueue } from '../editorial/storyQueue'
import { fetchLiveArticles } from '../editorial/siteApi'
import { DIGEST_TITLE, assembleDigest, defaultIntro, emptyWeek, moveItem, presetRange, rangeBounds, rangeLabel, storiesInRange } from '../editorial/digest'
import type { DayRange, RangePreset, SiteLike } from '../editorial/digest'

type Preset = RangePreset | 'custom'
const PRESETS: { value: Preset; label: string }[] = [
  { value: 'week', label: 'This week' },
  { value: 'last7', label: 'Last 7 days' },
  { value: 'last30', label: 'Last 30 days' },
]

// The site's list, read at most once every five minutes however often the sheet is opened; a failed read is not kept.
let siteRead: { at: number; list: Promise<SiteLike[]> } | null = null
function siteList(): Promise<SiteLike[]> {
  if (!siteRead || Date.now() - siteRead.at > 5 * 60_000) {
    const list = fetchLiveArticles().then((r) => r.articles)
    siteRead = { at: Date.now(), list }
    void list.then((l) => { if (!l.length) siteRead = null })
  }
  return siteRead.list
}

const dayText = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { timeZone: 'Asia/Dhaka', weekday: 'short', day: 'numeric', month: 'short' })

export function DigestDialog({ onClose }: { onClose: () => void }) {
  const s = useOutreachStore()
  const queue = useStoryQueue((q) => q.stories)
  const [preset, setPreset] = useState<Preset>('last7')
  const [range, setRange] = useState<DayRange>(() => presetRange('last7', Date.now()))
  const [site, setSite] = useState<{ state: 'reading' | 'ok' | 'failed'; list: SiteLike[] }>({ state: 'reading', list: [] })
  // the editor's order and unticked stories, for one set of stories (`key`): a different set starts over
  const [picked, setPicked] = useState<{ key: string; order: string[]; off: Set<string> }>({ key: '', order: [], off: new Set() })
  const [intro, setIntro] = useState<string | null>(null) // null = the default intro for the range, until the editor types
  const [logo, setLogo] = useState<string | null>(null) // null until read
  const [busy, setBusy] = useState(false)

  useEffect(() => { void logoDataUrl().then(setLogo) }, [])
  useEffect(() => {
    let live = true
    void siteList().then((list) => { if (live) setSite({ state: list.length ? 'ok' : 'failed', list }) })
    return () => { live = false }
  }, [])

  // the publish log as it stands when the sheet opens (it only grows by publishing, which this sheet does not do)
  const [log] = useState(readPublishLog)
  const found = useMemo(() => storiesInRange(log, queue, range, site.list), [log, queue, range, site.list])
  const slugKey = found.map((x) => x.slug).join('\n')
  // a new set of stories starts newest first with everything ticked; decks arriving from the site keep the editor's order
  const pickedNow = picked.key === slugKey ? picked : { key: slugKey, order: found.map((x) => x.slug), off: new Set<string>() }
  const { order, off } = pickedNow

  const bySlug = useMemo(() => new Map(found.map((x) => [x.slug, x])), [found])
  const rows = order.map((slug) => bySlug.get(slug)).filter((x): x is NonNullable<typeof x> => !!x)
  const chosen = rows.filter((x) => !off.has(x.slug))
  const validRange = !!rangeBounds(range)
  const label = rangeLabel(range)
  const title = `${DIGEST_TITLE} — ${label}`
  const introText = intro ?? defaultIntro(range)
  const letter = assembleDigest(chosen, { intro: introText, title, lang: 'en' })
  // the signature the new campaign will carry (newCampaign gives every campaign the default one)
  const signature = s.signatures.find((x) => x.id === DEFAULT_SIGNATURE.id)?.text ?? ''
  // a string build, cheap; the frame reloads only when the string changes
  const html = renderEmail({
    body: letter.body, signature, optOut: OPT_OUT_LINE.en, lang: 'en', letterhead: true, logoSrc: logo ?? '',
    footerLine: s.footerLine, fontFamily: s.fontFamily, headerBg: s.headerBg, footerBg: s.footerBg, stripeColors: s.stripeColors,
  }).html

  const pick = (p: Preset) => { if (p === 'custom') return; setPreset(p); setRange(presetRange(p, Date.now())) }
  const setDay = (end: 'from' | 'to', day: string) => { setPreset('custom'); setRange((r) => ({ ...r, [end]: day })) }
  const toggle = (slug: string, on: boolean) => { const n = new Set(off); if (on) n.delete(slug); else n.add(slug); setPicked({ ...pickedNow, off: n }) }
  const move = (i: number, d: number) => setPicked({ ...pickedNow, order: moveItem(order, i, d) })
  const idle = s.run === 'idle'

  const create = async () => {
    if (!chosen.length || busy) return
    setBusy(true)
    try {
      await s.createCampaign({ name: title, kind: 'list', blueprint: 'blank', lang: 'en', subject: letter.subject, body: letter.body, letterhead: true, scheduledAt: null })
      s.addLog('info', `Draft "${title}" made from ${chosen.length} stor${chosen.length === 1 ? 'y' : 'ies'} — pick its list, then Review & send`)
      onClose()
    } finally { setBusy(false) }
  }

  return (
    <Dialog title="Campaign from this week's stories" kicker="OUTREACH · DIGEST" width={960} onClose={onClose} footer={<>
      <span className="or-dg-count">{rows.length ? `${chosen.length} of ${rows.length} stories in the letter` : ''}</span>
      <div className="spacer" />
      <button type="button" className="btn" onClick={onClose}>Cancel</button>
      <button type="button" className="btn primary or-dg-create" disabled={!chosen.length || !validRange || !idle || busy} onClick={() => void create()}>Create draft campaign</button>
    </>}>
      <div className="or-dg">
        <div className="or-dg-col">
          <div className="or-dg-range">
            <Seg<Preset> className="or-dg-seg" value={preset} options={PRESETS} onChange={pick} />
            <div className="or-dg-dates">
              <DatePicker value={range.from} onChange={(d) => setDay('from', d)} />
              <span>to</span>
              <DatePicker value={range.to} onChange={(d) => setDay('to', d)} />
            </div>
          </div>
          {!validRange ? <p className="hint bad">{emptyWeek(range)}</p> : !rows.length ? (
            <div className="or-empty or-dg-empty"><Icon name="newspaper" size={22} /><b>No published stories</b><p>{emptyWeek(range)}</p></div>
          ) : (
            <div className="or-dg-list" role="list" aria-label="Stories in the digest">
              {rows.map((x, i) => (
                <div key={x.slug} role="listitem" className={'or-dg-row' + (off.has(x.slug) ? ' off' : '')}>
                  <Check checked={!off.has(x.slug)} onChange={(v) => toggle(x.slug, v)} label={x.headline}
                    hint={<>{dayText(x.publishedAt)}{x.source === 'queue' ? ' · from the story queue' : ''}{x.deck ? <span className="or-dg-deck">{x.deck}</span> : <span className="or-dg-deck none">No deck kept for this story</span>}</>} />
                  <div className="or-dg-move">
                    <IconButton icon="chevUp" tip="Move up" disabled={i === 0} onClick={() => move(i, -1)} />
                    <IconButton icon="chevDown" tip="Move down" disabled={i === rows.length - 1} onClick={() => move(i, 1)} />
                  </div>
                </div>
              ))}
            </div>
          )}
          <Field label="Intro — the letter's first paragraph, in your words">
            <textarea className="input or-dg-intro" rows={3} value={introText} onChange={(e) => setIntro(e.target.value)} aria-label="Intro" />
          </Field>
          <p className="hint">
            {site.state === 'reading' ? 'Reading the site’s list for decks the desk did not keep.'
              : site.state === 'failed' ? 'The site’s list could not be read: a story whose deck the desk did not keep goes without one.'
              : 'Decks come from the desk’s own copy, else the site’s list.'}
            {' '}Pictures are left out: letters have no picture mark.
          </p>
        </div>
        <div className="or-dg-col or-dg-preview">
          <div className="or-dg-subject"><span>Subject</span><b>{letter.subject}</b></div>
          {/* a fresh frame when the logo or the site's decks arrive: Chromium can drop a srcdoc change made while the
              frame's first document is still loading, which left the preview without them */}
          <iframe key={`${logo !== null}-${site.state}`} className="or-frame" title="Digest preview" sandbox="" srcDoc={html} />
          <p className="hint">A draft: after Create it needs a list, and goes out only through Review & send.</p>
        </div>
      </div>
    </Dialog>
  )
}
