// The Editorial desk's right side, worked out from what an editor does next: see where the story stands, see the banner it will
// go out with, clear what is left, choose where it goes, and publish. Everything here is read from the draft — nothing is a
// placeholder — and every open item takes you to where it is fixed.

import { useMemo, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import { Icon } from '../ui/Icon'
import { Panel, Switch } from '../ui/controls'
import { useEditorialStore } from './editorialStore'
import { BannerHero } from './BannerThumb'
import { analyzeSeo } from './seo'
import { buildReadiness } from './readiness'
import type { ReadyCheck, ReadyFix } from './readiness'
import { canUploadToSite } from './siteConnect'
import type { Assets } from '../core/render'
import type { Category } from '../core/tokens'
import siteIcon from '../assets/images/site/site-icon.png'

/** What the button on an open item says: the thing you will do there. */
const ACTION: Record<ReadyFix, string> = { headline: 'Edit', deck: 'Edit', body: 'Open editor', facts: 'Review', seo: 'Open SEO', photo: 'Add photo', tags: 'Add tags', 'sign-in': 'Sign in', site: 'Check', bengali: 'Translate' }
const openPanel = (id: string) => window.dispatchEvent(new CustomEvent('esb:open-panel', { detail: id }))

function Ring({ done, total, state }: { done: number; total: number; state: string }) {
  const r = 19, c = 2 * Math.PI * r
  return (
    <svg className={'es-ring ' + state} width="52" height="52" viewBox="0 0 52 52" aria-hidden>
      <circle className="es-ring-bg" cx="26" cy="26" r={r} />
      <circle className="es-ring-fg" cx="26" cy="26" r={r} strokeDasharray={c} strokeDashoffset={c * (1 - (total ? done / total : 0))} transform="rotate(-90 26 26)" />
      <text x="26" y="30.5" textAnchor="middle">{done}/{total}</text>
    </svg>
  )
}

export function EditorialSide(p: {
  base: Assets | null
  cat: Category
  words: number
  readTime: number
  hasImage: boolean
  tagCount: number
  linked: { slug: string; url?: string } | null
  fbCfg: { pageName?: string; pageId: string } | null
  fbOn: boolean
  onFbOn: (v: boolean) => void
  onConnectFb: () => void
  onPublish: () => void
  onFix: (fix: ReadyFix) => void
  last: ReactNode
  banner: ReactNode
  details: ReactNode
  onToast: (m: string) => void
}) {
  const draft = useEditorialStore((s) => s.draft)
  const discrepancies = useEditorialStore((s) => s.discrepancies)
  const staff = useEditorialStore((s) => s.staffSession)
  const site = useEditorialStore((s) => s.siteStatus)
  const live = useEditorialStore((s) => s.liveArticles)

  const seo = useMemo(() => analyzeSeo({
    headline: draft.headline, deck: draft.deck, body: draft.body, slug: draft.slug, metaTitle: draft.metaTitle, metaDescription: draft.metaDescription,
    keyphrase: draft.focusKeyphrase, tags: draft.focusKeywords.split(',').map((t) => t.trim()).filter(Boolean), hasImage: p.hasImage, imageAlt: draft.imageAlt,
    publishedTitles: live.filter((a) => a.slug !== draft.slug).map((a) => a.title),
  }), [draft, p.hasImage, live])

  const ready = useMemo(() => buildReadiness({
    headline: draft.headline, deck: draft.deck, body: draft.body, words: p.words, hasImage: p.hasImage, imageAlt: draft.imageAlt, tagCount: p.tagCount,
    unverified: discrepancies.length, seo, signedIn: !!staff, siteOnline: site.connected, canUpload: canUploadToSite(),
  }), [draft, p.words, p.hasImage, p.tagCount, discrepancies.length, seo, staff, site.connected])

  const open = ready.checks.filter((c) => c.status !== 'ok')
  const title = ready.state === 'ready' ? 'Ready to publish' : ready.state === 'review' ? `${ready.warnings} to check first` : `${ready.blockers} required to fix`
  const sub = p.linked ? 'Live on esbpowerline.com · Publish updates it' : `${p.cat.name} · ${p.words} words · ${p.readTime} min read`
  const rank = (c: ReadyCheck) => (c.group === 'Required' ? 0 : 2) + (c.status === 'bad' ? 0 : 1)
  const todo = open.slice().sort((a, b) => rank(a) - rank(b))
  const passed = ready.checks.filter((c) => c.status === 'ok')
  const [showPassed, setShowPassed] = useState(false)

  return (
    <>
      <div className="scroll es-scroll">
        <section className={'es-status ' + ready.state} style={{ ['--cat' as string]: p.cat.accent } as CSSProperties}>
          <Ring done={ready.ok} total={ready.total} state={ready.state} />
          <div className="es-status-t"><h3>{title}</h3><p>{sub}</p></div>
        </section>

        <BannerHero base={p.base} onToast={p.onToast} />

        <Panel id="ed-side-publish" icon="check" title="Before you publish" persist={false}
          actions={<span className={'es-count ' + ready.state}>{open.length ? `${open.length} open` : 'All clear'}</span>}>
          <div className="es-todo">
            {todo.length === 0 ? (
              <div className="es-clear"><span><Icon name="check" size={14} /></span><div><b>Nothing left to fix</b><p>All {ready.total} checks pass.</p></div></div>
            ) : (
              <ul>
                {todo.map((c) => (
                  <li key={c.id} className={c.status}>
                    <i className="es-dot" aria-hidden />
                    <div className="es-todo-t"><b>{c.label}{c.group === 'Required' && <em>Required</em>}</b><span>{c.detail}</span></div>
                    {c.fix && <button type="button" className="btn xs" onClick={() => p.onFix(c.fix!)}>{ACTION[c.fix]}</button>}
                  </li>
                ))}
              </ul>
            )}
            {passed.length > 0 && (
              <>
                <button type="button" className="es-passed" aria-expanded={showPassed} onClick={() => setShowPassed((v) => !v)}>
                  <Icon name="check" size={13} /><span>{passed.length} check{passed.length === 1 ? '' : 's'} passed</span><Icon name="chevDown" size={13} className="es-passed-chev" />
                </button>
                {showPassed && <div className="es-chips">{passed.map((c) => <span key={c.id} title={c.detail}><Icon name="check" size={10} />{c.label}</span>)}</div>}
              </>
            )}
          </div>
          {p.last}
        </Panel>

        <Panel id="ed-side-send" icon="upload" title="Send to" defaultOpen={false} persist={false}
          actions={<span className="es-dots"><i className={site.connected ? 'on' : ''} title="Website" /><i className={p.fbCfg && p.fbOn ? 'on' : ''} title="Facebook" /></span>}>
          <div className="es-dest">
            <img className="es-dest-logo" src={siteIcon} alt="" />
            <div className="es-dest-t"><b>esbpowerline.com</b><span>{p.linked ? 'Updates the live article' : 'Publishes a new article'}</span></div>
            <span className={'es-pill ' + (site.connected ? 'ok' : 'bad')}><i />{site.connected ? 'Online' : 'Offline'}</span>
            {p.linked?.url && <a className="ibtn" href={p.linked.url} target="_blank" rel="noopener noreferrer" aria-label="View the live article" data-tip="View live"><Icon name="externalLink" size={14} /></a>}
          </div>
          <div className="es-dest">
            <span className="es-dest-logo fb" aria-hidden>f</span>
            <div className="es-dest-t"><b>{p.fbCfg ? p.fbCfg.pageName || 'Facebook Page' : 'Facebook Page'}</b><span>{p.fbCfg ? 'Posts the 4:5 banner with the caption' : 'Not connected'}</span></div>
            {p.fbCfg
              ? <Switch checked={p.fbOn} onChange={p.onFbOn} label={<span className="vh">Post to Facebook</span>} />
              : <button type="button" className="btn sm" onClick={p.onConnectFb}>Connect</button>}
          </div>
          <p className="es-note">You confirm the details, images and captions in the next step. Nothing is sent before that.</p>
        </Panel>

        <Panel id="ed-image" icon="image" title="Banner settings" defaultOpen={false} persist={false}>{p.banner}</Panel>
        <Panel id="ed-organize" icon="folder" title="Details" sub={p.cat.name} defaultOpen={false} persist={false}>{p.details}</Panel>
      </div>

      <footer className="es-foot">
        <p className={'es-foot-line ' + ready.state}>
          {ready.state === 'blocked' ? <><b>{ready.blockers} required</b> to fix before it can go out.</> : ready.state === 'review' ? <><b>{ready.warnings} to check</b> — you can still publish.</> : <><b>Everything checks out.</b></>}
          {ready.state !== 'ready' && <button type="button" className="btn-link" onClick={() => { const f = open[0]?.fix; if (f) p.onFix(f); else openPanel('ed-side-publish') }}>Go to the first</button>}
        </p>
        <button type="button" className="btn primary es-publish" onClick={p.onPublish} disabled={!draft.headline.trim()}>
          <Icon name="upload" size={15} />
          <span>{p.linked ? 'Review & update' : 'Review & publish'}</span>
        </button>
      </footer>
    </>
  )
}
