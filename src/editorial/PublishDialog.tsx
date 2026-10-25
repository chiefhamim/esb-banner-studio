// Review & publish: what goes where, in one sheet that never overflows. Left: the three checks and the story's
// numbers. Right: the banner as it will appear on the website and on Facebook. Footer: two actions only — save a
// draft, or publish (or update the article that is already live).

import { useEffect, useRef, useState } from 'react'
import { Dialog, IconButton, Switch } from '../ui/controls'
import { fmtDuration, useJobLog } from './jobLog'
import { Icon } from '../ui/Icon'
import { BannerPreviews } from './BannerPreviews'
import { ImageOptions } from './ImageOptions'
import type { Assets } from '../core/render'
import type { HeroMode } from './heroMode'
import type { EditorialDraft } from './editorialStore'

export interface PublishOutcome { ok: boolean; msg: string; url?: string; fbUrl?: string; existingSlug?: string }

export function PublishDialog(p: {
  draft: EditorialDraft
  words: number
  paragraphs: number
  slugStatus: string
  base: Assets | null
  heroMode: HeroMode
  onHeroMode: (m: HeroMode) => void
  photoUrl: string | null
  /** The article on the site this story updates, if any. */
  updating: { slug: string; url?: string } | null
  busy: boolean
  result: PublishOutcome | null
  /** The running (or last) publish job, shown as a live step list with timers. */
  jobId: number | null
  fbPage: string | null
  fbOn: boolean
  onFbOn: (v: boolean) => void
  onFbConnect: () => void
  onCopyJson: () => void
  copied: boolean
  onOpenCms: () => void
  onPublish: (status: 'PUBLISHED' | 'DRAFT') => void
  onUpdateExisting: (slug: string) => void
  onClose: () => void
}) {
  const { draft } = p
  const blocked = p.busy || !draft.headline.trim()
  const verb = p.updating ? 'Update' : 'Publish'
  const budget = (n: number, max: number) => <b className={n > max ? 'over' : ''}>{n} / {max}{n > max ? ' · over' : ''}</b>
  return (
    <Dialog
      title={p.updating ? 'Update the live article' : 'Publish to esbpowerline.com'}
      kicker={p.updating ? 'EDITING A LIVE ARTICLE' : 'LIVE CMS PUBLISHING'}
      width={940}
      onClose={p.onClose}
      footer={
        <>
          <IconButton icon={p.copied ? 'check' : 'copy'} tip={p.copied ? 'Copied' : 'Copy the CMS JSON'} tipPos="top" onClick={p.onCopyJson} />
          <IconButton icon="externalLink" tip="Open the site's CMS editor" tipPos="top" onClick={p.onOpenCms} />
          <div className="spacer" />
          <button type="button" className="btn" onClick={() => p.onPublish('DRAFT')} disabled={blocked} title="Keep it hidden from readers; visible in the CMS">
            <Icon name="check" size={14} /><span>{p.updating ? 'Save as draft' : 'Save draft'}</span>
          </button>
          <button type="button" className="btn primary" onClick={() => p.onPublish('PUBLISHED')} disabled={blocked}
            title={p.updating ? 'Change the article that is live now' : 'Publish live to esbpowerline.com'}>
            <Icon name="upload" size={14} /><span>{p.busy ? (p.updating ? 'Updating…' : 'Publishing…') : verb + (p.fbOn && p.fbPage ? ' + Facebook' : '')}</span>
          </button>
        </>
      }
    >
      <div className="pub">
        {p.updating && (
          <div className="callout"><Icon name="info" size={15} />
            <span>This story is linked to <b className="mono">/{p.updating.slug}</b> on the site. {verb} changes that article — it will not create a second one.</span>
          </div>
        )}
        <dl className="pub-stats pub-stats-row">
          <div><dt>Headline</dt><dd>{budget(draft.headline.length, 104)}</dd></div>
          <div><dt>Deck</dt><dd>{budget(draft.deck.length, 200)}</dd></div>
          <div><dt>Story</dt><dd><b>{p.words} words · {p.paragraphs} ¶</b></dd></div>
          <div><dt>Slug</dt><dd className="mono"><b>{draft.slug || 'not set'}</b>{!p.updating && p.slugStatus !== 'idle' && <i className={'pub-slug ' + p.slugStatus}>{p.slugStatus}</i>}</dd></div>
        </dl>
        <BannerPreviews base={p.base} heroMode={p.heroMode} onHeroMode={p.onHeroMode} photoUrl={p.photoUrl} caption={p.fbOn || !p.fbPage ? draft.social.facebook : undefined} pageName={p.fbPage} wide webExtra={<ImageOptions dest="web" base={p.base} />} fbExtra={p.fbPage ? <ImageOptions dest="fb" base={p.base} /> : undefined}
          fbToggle={p.fbPage ? <Switch checked={p.fbOn} onChange={p.onFbOn} label={p.fbOn ? 'Posting' : 'Off'} /> : <button type="button" className="btn xs" onClick={p.onFbConnect}><Icon name="link" size={12} /><span>Connect a Page</span></button>}
          fbNote={<p className="hint pcard-note">{p.fbPage ? <>The caption goes without a link; the article link is added as the Page&apos;s first comment (pin it from Facebook). <button type="button" className="btn-link" onClick={p.onFbConnect}>Change Page</button></> : 'Connect a Facebook Page to post the banner there as well.'}</p>} />
        {p.jobId != null && <PublishProgress id={p.jobId} />}
        {p.result && (
          <div ref={(el) => { el?.scrollIntoView({ block: 'end', behavior: 'smooth' }) }} className={'callout ' + (p.result.ok ? 'good' : 'warn')} role="status">
            <Icon name={p.result.ok ? 'check' : 'info'} size={15} />
            <div className="pub-result">
              <span>{p.result.msg}</span>
              {p.result.url && (
                <button type="button" className="btn sm" onClick={() => { for (const u of [p.result!.url, p.result!.fbUrl]) if (u) window.open(u, '_blank', 'noopener') }}>
                  <Icon name="globe" size={12} /><span>{p.result.fbUrl ? 'Open the article and the Facebook post' : 'View on esbpowerline.com'}</span>
                </button>
              )}
              {p.result.existingSlug && <button type="button" className="btn sm primary" onClick={() => p.onUpdateExisting(p.result!.existingSlug!)}><Icon name="refresh" size={12} /><span>Update that article instead</span></button>}
            </div>
          </div>
        )}
      </div>
    </Dialog>
  )
}

/** Each destination step with its own timer: it ticks while the step runs and freezes when the step has arrived. */
function PublishProgress({ id }: { id: number }) {
  const job = useJobLog((s) => s.jobs.find((j) => j.id === id))
  const [, tick] = useState(0)
  const boxRef = useRef<HTMLDivElement>(null)
  const running = !!job && !job.end
  const count = job?.steps.length ?? 0
  // keep the newest step in view as the publish moves on (the sheet scrolls; the list can be below the fold)
  useEffect(() => { boxRef.current?.scrollIntoView({ block: 'end', behavior: 'smooth' }) }, [count, job?.end])
  useEffect(() => {
    if (!running) return
    const t = setInterval(() => tick((n) => n + 1), 100)
    return () => clearInterval(t)
  }, [running])
  if (!job) return null
  const now = Date.now()
  return (
    <div className="pp" aria-live="polite" ref={boxRef}>
      <div className="pp-head"><span className="kicker">PROGRESS</span><span className="pp-total">{fmtDuration((job.end ?? now) - job.start)}</span></div>
      <ol className="pp-steps">
        {job.steps.map((st, i) => {
          const live = !st.end
          const last = i === job.steps.length - 1
          const bad = !!job.error && last && !live
          return (
            <li key={i} className={live ? 'live' : bad ? 'bad' : 'done'}>
              <span className="pp-mark">{live ? <span className="pulse-dot" /> : <Icon name={bad ? 'info' : 'check'} size={11} strokeWidth={2.6} />}</span>
              <span className="pp-label">{st.label}</span>
              <span className="pp-time">{fmtDuration((st.end ?? now) - st.start)}</span>
            </li>
          )
        })}
      </ol>
    </div>
  )
}
