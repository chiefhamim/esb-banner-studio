// The Editorial desk's right side, worked out from what an editor does next: see where the story stands, see the banner it will
// go out with, clear what is left, choose where it goes, and publish. Everything here is read from the draft — nothing is a
// placeholder — and every open item takes you to where it is fixed.

import { useEffect, useMemo, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import { Icon } from '../ui/Icon'
import { Panel, Switch } from '../ui/controls'
import { useEditorialStore } from './editorialStore'
import { BannerHero } from './BannerThumb'
import { analyzeSeo } from './seo'
import { buildReadiness, triage } from './readiness'
import { useIgnoredChecks } from './ignoredChecks'
import type { ReadyCheck, ReadyFix } from './readiness'
import { canUploadToSite } from './siteConnect'
import { getFormat } from '../core/tokens'
import { verifyFacebook } from './facebook'
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
  /** The story these checks belong to; what is ignored is remembered per story. */
  storyId: string
  base: Assets | null
  cat: Category
  words: number
  readTime: number
  hasImage: boolean
  tagCount: number
  linked: { slug: string; url?: string } | null
  fbCfg: { pageName?: string; pageId: string; token: string } | null
  fbOn: boolean
  onFbOn: (v: boolean) => void
  fbLink: boolean
  onFbLink: (v: boolean) => void
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

  // the Facebook Page, checked against Facebook itself: the name it answers with, or why it does not
  const [fb, setFb] = useState<{ s: 'idle' | 'checking' | 'ok' | 'bad'; name?: string; err?: string }>({ s: 'idle' })
  const [fbLogoBad, setFbLogoBad] = useState(false)
  const fbId = p.fbCfg?.pageId
  const fbToken = p.fbCfg?.token
  useEffect(() => {
    if (!fbId || !fbToken) { setFb({ s: 'idle' }); return }
    let live = true
    setFb({ s: 'checking' }); setFbLogoBad(false)
    void verifyFacebook(fbId, fbToken).then((r) => { if (live) setFb(r.ok ? { s: 'ok', name: r.name } : { s: 'bad', err: r.error }) })
    return () => { live = false }
  }, [fbId, fbToken])
  const recheckFb = () => { if (!fbId || !fbToken) return; setFb({ s: 'checking' }); void verifyFacebook(fbId, fbToken, true).then((r) => setFb(r.ok ? { s: 'ok', name: r.name } : { s: 'bad', err: r.error })) }

  const ignoredIds = useIgnoredChecks((s) => s.byStory[p.storyId])
  const ignore = useIgnoredChecks((s) => s.ignore)
  const restore = useIgnoredChecks((s) => s.restore)
  const t = useMemo(() => triage(ready, new Set(ignoredIds ?? [])), [ready, ignoredIds])
  const open = t.open
  const title = t.state === 'ready' ? 'Ready to publish' : t.state === 'review' ? `${t.warnings} to check first` : `${t.blockers} required to fix`
  const sub = p.linked ? 'Live on esbpowerline.com · Publish updates it' : `${p.cat.name} · ${p.words} words · ${p.readTime} min read`
  const rank = (c: ReadyCheck) => (c.group === 'Required' ? 0 : 2) + (c.status === 'bad' ? 0 : 1)
  const todo = open.slice().sort((a, b) => rank(a) - rank(b))
  const passed = t.passed
  const [showPassed, setShowPassed] = useState(false)
  const [showIgnored, setShowIgnored] = useState(false)

  return (
    <>
      <div className="scroll es-scroll">
        <section className={'es-status ' + t.state} style={{ ['--cat' as string]: p.cat.accent } as CSSProperties}>
          <Ring done={t.done} total={ready.total} state={t.state} />
          <div className="es-status-t"><h3>{title}</h3><p>{sub}{t.ignored.length > 0 && ` · ${t.ignored.length} ignored`}</p></div>
        </section>

        {/* 1 · describe the story */}
        <Panel id="ed-organize" icon="folder" title="Details" defaultOpen={false} persist={false}
          actions={<span className="es-sum">{p.cat.name.split(' ')[0]} · {p.tagCount} tag{p.tagCount === 1 ? '' : 's'}</span>}>{p.details}</Panel>

        {/* 2 · the picture that goes with it */}
        <Panel id="ed-image" icon="image" title="Banner" accordion={false} persist={false}>
          <BannerHero base={p.base} onToast={p.onToast} />
          <details className="ed-more es-more"><summary>Banner settings</summary>{p.banner}</details>
        </Panel>

        {/* 3 · clear what is left */}
        <Panel id="ed-side-publish" icon="check" title="Before you publish" persist={false}
          actions={<><span className={'es-count ' + t.state}>{open.length ? `${open.length} open` : t.ignored.length ? `${t.ignored.length} ignored` : 'All clear'}</span></>}>
          <div className="es-todo">
            {open.length > 1 && <div className="es-todo-head"><span>{open.length} open</span><button type="button" className="btn-link" onClick={() => ignore(p.storyId, open.map((c) => c.id))}>Ignore all</button></div>}
            {todo.length === 0 ? (
              <div className="es-clear"><span><Icon name="check" size={14} /></span><div><b>{t.ignored.length ? 'Checklist set aside' : 'Nothing left to fix'}</b><p>{t.ignored.length ? `${t.passed.length} pass, ${t.ignored.length} ignored.` : `All ${ready.total} checks pass.`}</p></div></div>
            ) : (
              <ul>
                {todo.map((c) => (
                  <li key={c.id} className={c.status}>
                    <i className="es-dot" aria-hidden />
                    <div className="es-todo-t"><b><span className="es-lbl">{c.label}</span>{c.group === 'Required' && <em>Required</em>}</b><span>{c.detail}</span></div>
                    {c.fix && <button type="button" className="btn xs" onClick={() => p.onFix(c.fix!)}>{ACTION[c.fix]}</button>}
                    <button type="button" className="ibtn es-ign" aria-label={`Ignore ${c.label}`} data-tip="Ignore this check" onClick={() => ignore(p.storyId, [c.id])}><Icon name="eyeOff" size={14} /></button>
                  </li>
                ))}
              </ul>
            )}
            {t.ignored.length > 0 && (
              <>
                <button type="button" className="es-passed ign" aria-expanded={showIgnored} onClick={() => setShowIgnored((v) => !v)}>
                  <Icon name="eyeOff" size={13} /><span>{t.ignored.length} ignored</span><Icon name="chevDown" size={13} className="es-passed-chev" />
                </button>
                {showIgnored && (
                  <ul className="es-ignored">
                    {t.ignored.map((c) => <li key={c.id}><div className="es-todo-t"><b>{c.label}</b><span>{c.detail}</span></div><button type="button" className="btn xs ghost" onClick={() => restore(p.storyId, [c.id])}>Restore</button></li>)}
                    {t.ignored.length > 1 && <li className="all"><button type="button" className="btn-link" onClick={() => restore(p.storyId)}>Restore all</button></li>}
                  </ul>
                )}
              </>
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

        {/* 4 · choose where it goes */}
        <Panel id="ed-side-send" icon="upload" title="Send to" defaultOpen={false} persist={false}
          actions={<span className="es-dots"><i className={site.connected ? 'on' : ''} title="Website" /><i className={fb.s === 'ok' && p.fbOn ? 'on' : ''} title="Facebook" /></span>}>
          <div className="es-dest">
            <img className="es-dest-logo" src={siteIcon} alt="" />
            <div className="es-dest-t"><b>Website</b><span>esbpowerline.com · {p.linked ? 'updates the live article' : 'new article'}</span></div>
            <span className={'es-pill ' + (site.connected ? 'ok' : 'bad')}><i />{site.connected ? `Online${site.latencyMs ? ' · ' + site.latencyMs + ' ms' : ''}` : 'Offline'}</span>
          </div>
          <div className="es-dest">
            {p.fbCfg && !fbLogoBad
              ? <img className="es-dest-logo round" src={`https://graph.facebook.com/${p.fbCfg.pageId}/picture?type=square`} alt="" title={fb.name || p.fbCfg.pageName || 'Facebook Page'} onError={() => setFbLogoBad(true)} />
              : <span className="es-dest-logo fb" aria-hidden>f</span>}
            <div className="es-dest-t"><b>Facebook</b><span>{!p.fbCfg ? 'Connect a Page to post the banner' : fb.s === 'bad' ? fb.err : `${getFormat('fb45').ratio} banner with the caption`}</span></div>
            {p.fbCfg
              ? <button type="button" className={'es-pill btn-pill ' + (fb.s === 'ok' ? 'ok' : fb.s === 'bad' ? 'bad' : 'wait')} onClick={recheckFb} data-tip="Check the connection again"><i />{fb.s === 'ok' ? 'Connected' : fb.s === 'bad' ? 'Needs attention' : 'Checking…'}</button>
              : <span className="es-pill off"><i />Not connected</span>}
          </div>
          <div className="es-post">
            {p.fbCfg ? (
              <>
                <Switch checked={p.fbOn} onChange={p.onFbOn} label="Post the banner when I publish" />
                <div className={p.fbOn ? '' : 'es-sub-off'}><Switch checked={p.fbLink} onChange={p.onFbLink} label="Add the article link as the first comment" /></div>
              </>
            ) : (
              <button type="button" className="btn sm" onClick={p.onConnectFb}><Icon name="link" size={13} /><span>Connect the Facebook Page</span></button>
            )}
          </div>
          <p className="es-note">You confirm the details, images and captions in the next step. Nothing is sent before that.</p>
        </Panel>
      </div>

      <footer className="es-foot">
        <p className={'es-foot-line ' + t.state}>
          {t.state === 'blocked' ? <><b>{t.blockers} required</b> to fix before it can go out.</> : t.state === 'review' ? <><b>{t.warnings} to check</b> — you can still publish.</> : <><b>{t.ignored.length ? 'Ready.' : 'Everything checks out.'}</b>{t.ignored.length > 0 && ` ${t.ignored.length} check${t.ignored.length === 1 ? '' : 's'} ignored.`}</>}
          {t.state !== 'ready' && <button type="button" className="btn-link" onClick={() => { const f = open[0]?.fix; if (f) p.onFix(f); else openPanel('ed-side-publish') }}>Go to the first</button>}
        </p>
        <button type="button" className="btn primary es-publish" onClick={p.onPublish} disabled={!draft.headline.trim()}>
          <Icon name="upload" size={15} />
          <span>{p.linked ? 'Review & update' : 'Review & publish'}</span>
        </button>
      </footer>
    </>
  )
}
