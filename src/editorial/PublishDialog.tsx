// Review & publish: sleek by default. One line says what this is (a new article, or an update of a live one) and the
// story's numbers; two containers show where the banner goes (the website, Facebook), each with its picture settings
// folded into one line; the footer has the two actions. The step-by-step progress and the result appear below only once a
// publish starts, and the sheet scrolls to follow them.

import { useEffect, useRef, useState } from 'react'
import { Dialog, IconButton, Switch } from '../ui/controls'
import { fmtDuration, useJobLog } from './jobLog'
import { Icon } from '../ui/Icon'
import { BannerPreviews } from './BannerPreviews'
import { ImageOptions } from './ImageOptions'
import { PressCountdown, type PressItem } from './PressCountdown'
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
  /** Add the article link as the post's first comment. */
  fbLink: boolean
  onFbLink: (v: boolean) => void
  onFbOn: (v: boolean) => void
  onFbConnect: () => void
  onCopyJson: () => void
  copied: boolean
  onOpenCms: () => void
  onPublish: (status: 'PUBLISHED' | 'DRAFT') => void
  onUpdateExisting: (slug: string) => void
  onBackToNews?: () => void
  onClose: () => void
}) {
  const { draft } = p
  const blocked = p.busy || !draft.headline.trim()
  const verb = p.updating ? 'Update' : 'Publish'
  const publishedDone = !!(p.result?.ok && p.result.url && !p.busy)
  // Publish arms the "Going to press" countdown (PressCountdown); the send fires only when it reaches zero.
  // Automated tests set window.__esbNoArm to publish at once (the countdown is a human affordance).
  const ARM_MS = (window as unknown as { __esbNoArm?: boolean }).__esbNoArm ? 0 : 5000
  const [armed, setArmed] = useState(false)
  const pressItems: PressItem[] = [
    { label: 'The story', sub: draft.headline.trim() || 'Untitled story' },
    { label: 'Banner', sub: p.fbOn && p.fbPage ? 'Website 16:9 · Facebook 4:5' : 'Website 16:9' },
    { label: 'esbpowerline.com', sub: p.updating ? 'Updates the live article' : 'A new article' },
    ...(p.fbOn && p.fbPage ? [{ label: 'Facebook Page', sub: p.fbPage + (p.fbLink ? ' · link as first comment' : '') }] : []),
  ]
  const budget = (n: number, max: number) => <b className={n > max ? 'over' : ''}>{n}/{max}{n > max ? ' · over' : ''}</b>
  return (
    <Dialog
      title={p.updating ? 'Update the live article' : 'Publish to esbpowerline.com'}
      kicker={p.updating ? 'EDITING A LIVE ARTICLE' : 'LIVE CMS PUBLISHING'}
      width={860}
      onClose={p.onClose}
      footer={
        <>
          <IconButton icon={p.copied ? 'check' : 'copy'} tip={p.copied ? 'Copied' : 'Copy the CMS JSON'} tipPos="top" onClick={p.onCopyJson} />
          <IconButton icon="externalLink" tip="Open the site's CMS editor" tipPos="top" onClick={p.onOpenCms} />
          <div className="spacer" />
          <button type="button" className="btn" onClick={() => p.onPublish('DRAFT')} disabled={blocked} title="Keep it hidden from readers; visible in the CMS">
            <Icon name="check" size={14} /><span>{p.updating ? 'Save as draft' : 'Save draft'}</span>
          </button>
          {publishedDone && p.onBackToNews ? (
            <button type="button" className="btn primary" onClick={p.onBackToNews}>
              <span>Back to News</span>
            </button>
          ) : (
            (
            <button type="button" className="btn primary" onClick={() => setArmed(true)} disabled={blocked || armed}
              title={p.updating ? 'Change the article that is live now — a 5-second countdown you can stop' : 'Publish live to esbpowerline.com — a 5-second countdown you can stop'}>
              <Icon name="upload" size={14} /><span>{p.busy ? (p.updating ? 'Updating' : 'Publishing') : verb + (p.fbOn && p.fbPage ? ' + Facebook' : '')}</span>
            </button>
            )
          )}
        </>
      }
    >
      {armed && <PressCountdown ms={ARM_MS} items={pressItems} verb={verb} sub={p.fbOn && p.fbPage ? 'Website and Facebook' : 'esbpowerline.com'} onFire={() => p.onPublish('PUBLISHED')} onCancel={() => setArmed(false)} />}
      <div className="pub">
        <div className="pub-top">
          <div className={'pub-link' + (p.updating ? ' live' : '')}>
            <Icon name={p.updating ? 'refresh' : 'link'} size={14} />
            <span>
              <b>{p.updating ? 'Live article' : 'New article'}</b>
              <i>esbpowerline.com/articles/{p.updating?.slug ?? (draft.slug || 'not-set')}</i>
              {!p.updating && p.slugStatus !== 'idle' && <em className={'pub-slug ' + p.slugStatus}>{p.slugStatus}</em>}
            </span>
          </div>
          <div className="pub-meta">
            <span>Headline {budget(draft.headline.length, 104)}</span>
            <span>Deck {budget(draft.deck.length, 200)}</span>
            <span><b>{p.words}</b> words</span>
          </div>
        </div>
        <BannerPreviews base={p.base} heroMode={p.heroMode} onHeroMode={p.onHeroMode} photoUrl={p.photoUrl} caption={p.fbOn || !p.fbPage ? draft.social.facebook : undefined} pageName={p.fbPage} wide webExtra={<ImageOptions dest="web" base={p.base} />} fbExtra={p.fbPage ? <ImageOptions dest="fb" base={p.base} /> : undefined}
          fbToggle={p.fbPage ? <Switch checked={p.fbOn} onChange={p.onFbOn} label={p.fbOn ? 'Posting' : 'Off'} /> : <button type="button" className="btn xs" onClick={p.onFbConnect}><Icon name="link" size={12} /><span>Connect a Page</span></button>}
          fbNote={p.fbPage ? <div className="pcard-note"><Switch checked={p.fbLink} onChange={p.onFbLink} label="Add the article link as the first comment" /><button type="button" className="btn-link" onClick={p.onFbConnect}>Change Page</button></div> : <p className="hint pcard-note">Connect a Facebook Page to post the banner there as well.</p>} />
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
              {p.result.existingSlug &&<button type="button" className="btn sm primary" onClick={() => p.onUpdateExisting(p.result!.existingSlug!)}><Icon name="refresh" size={12} /><span>Update that article instead</span></button>}
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
