// Story → SEO: a focus keyphrase chosen from the story's own keyphrases, the Google result as it would look, the
// three fields that make it (title, description, slug) with one-click builders, and the checks that say what to fix.

import { useMemo } from 'react'
import { useEditorialStore } from './editorialStore'
import { Icon } from '../ui/Icon'
import { providerMeta } from './aiProviders'
import type { AiProviderId } from './aiProviders'
import { DESCRIPTION_MAX, analyzeSeo, buildMetaDescription, buildMetaTitle, buildSlug, effectiveDescription, effectiveTitle, suggestKeyphrases, visibleTitle } from './seo'
import type { SeoCheck } from './seo'
// the site's own app icon (esbpowerline repo app/icon.png), as Google shows it beside the result
import siteIcon from '../assets/images/site/site-icon.png'

const GROUPS: SeoCheck['group'][] = ['Keyphrase', 'Search snippet', 'Content']

export function SeoPanel({ hasImage, onCheckSlug, slugStatus, onAiSeo, aiBusy = false, aiProvider = null, onFix, fixBusy = false, onUndo, fixNote }: {
  hasImage: boolean; onCheckSlug: () => void; slugStatus: string
  /** Ask the editor's AI provider for keyphrase, tags, title, description and slug (held to the site's rules after). */
  onAiSeo?: () => void; aiBusy?: boolean; aiProvider?: AiProviderId | null
  /** Repair every failing check with the AI provider (fields and, where a check needs it, the story's wording). */
  onFix?: () => void; fixBusy?: boolean; onUndo?: () => void; fixNote?: string | null
}) {
  const aiName = aiProvider ? providerMeta(aiProvider).name : null
  const draft = useEditorialStore((s) => s.draft)
  const setDraftField = useEditorialStore((s) => s.setDraftField)
  const liveArticles = useEditorialStore((s) => s.liveArticles)
  const tags = draft.focusKeywords.split(',').map((t) => t.trim()).filter(Boolean)
  const kp = draft.focusKeyphrase

  const suggestions = useMemo(() => suggestKeyphrases(draft.headline, draft.deck, draft.body, 6), [draft.headline, draft.deck, draft.body])
  const checks = useMemo(() => analyzeSeo({
    headline: draft.headline, deck: draft.deck, body: draft.body, slug: draft.slug,
    metaTitle: draft.metaTitle, metaDescription: draft.metaDescription, keyphrase: kp, tags, hasImage, imageAlt: draft.imageAlt,
    publishedTitles: liveArticles.filter((a) => a.slug !== draft.slug).map((a) => a.title),
  }), [draft, kp, tags.join('|'), hasImage, liveArticles]) // eslint-disable-line react-hooks/exhaustive-deps
  const good = checks.filter((c) => c.status === 'good').length

  // exactly what esbpowerline.com puts in <title> and the description, cut where Google cuts them
  const title = effectiveTitle(draft)
  const desc = effectiveDescription(draft)
  const shownTitle = visibleTitle(title)
  const titleCut = shownTitle !== title
  const typedDesc = (draft.metaDescription.trim() || draft.deck.trim()).replace(/\s+/g, ' ')
  const today = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
  const bold = (text: string) => {
    if (!kp.trim()) return text
    const parts = text.split(new RegExp(`(${kp.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi'))
    return parts.map((p, i) => (i % 2 ? <b key={i}>{p}</b> : p))
  }

  return (
    <div className="ed-card-body seo">
      {onAiSeo && (
        <div className="seo-ai">
          <span className="seo-ai-text"><b>SEO by AI</b><span className="hint">{aiName ? `${aiName} writes the keyphrase, tags, title, description and slug from the story — kept within the site's limits.` : 'Add a key for the SEO provider to write these fields from the story.'}</span></span>
          <button type="button" className="btn sm ai-btn" data-provider={aiProvider ?? undefined} onClick={onAiSeo} disabled={aiBusy || !draft.headline.trim()} data-tip={aiName ? `Replace the five fields below with ${aiName}'s suggestions` : 'Open AI settings'}>
            <Icon name="sparkle" size={13} className={aiBusy ? 'spin' : ''} />
            <span>{aiBusy ? 'Writing…' : 'Write with AI'}</span>
          </button>
        </div>
      )}
      <div className="ed-field">
        <div className="ed-field-row"><label htmlFor="draft-keyphrase">Focus keyphrase</label><span className="hint">What a reader would type to find this story</span></div>
        <input id="draft-keyphrase" type="text" className="ed-input" value={kp} placeholder="e.g. Sylhet gas field" onChange={(e) => setDraftField('focusKeyphrase', e.target.value)} />
        {suggestions.length > 0 && (
          <div className="seo-suggest" aria-label="Keyphrases found in this story">
            {suggestions.map((s) => (
              <button key={s.phrase} type="button" className={'seo-chip' + (s.phrase.toLowerCase() === kp.trim().toLowerCase() ? ' on' : '')} onClick={() => setDraftField('focusKeyphrase', s.phrase)} data-tip={`Score ${s.score} — from where and how often the story uses it`}>
                {s.phrase}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="seo-serp" aria-label="Google result preview">
        <div className="seo-serp-site">
          <img className="seo-serp-fav" src={siteIcon} alt="" />
          <div><b>ESB PowerLine</b><span>esbpowerline.com › articles › {draft.slug || 'story-slug'}</span></div>
        </div>
        <div className="seo-serp-title">{shownTitle || 'Your headline'}</div>
        <div className="seo-serp-desc">{desc ? <><span className="seo-serp-date">{today} — </span>{bold(desc)}</> : 'Write a meta description — otherwise Google picks a sentence from the page.'}</div>
        <div className="seo-serp-note">{draft.metaTitle.trim() ? 'Title: your SEO title' : 'Title: the headline (no SEO title yet)'} · {draft.metaDescription.trim() ? 'description: your meta description' : 'description: the deck'} · the site adds no site name</div>
      </div>

      <div className="ed-field">
        <div className="ed-field-row">
          <label htmlFor="draft-meta-title">SEO title</label>
          <span className="seo-row-end">
            <span className={`ed-budget-counter ${titleCut ? 'over' : ''}`} title={titleCut ? 'Google will cut this title' : 'Fits in the result'}>{title.length} / 60</span>
            <button type="button" className="btn-link" onClick={() => setDraftField('metaTitle', buildMetaTitle(draft.headline, kp))}>Build from headline</button>
          </span>
        </div>
        <input id="draft-meta-title" type="text" className="ed-input" value={draft.metaTitle} placeholder={draft.headline || 'Headline'} onChange={(e) => setDraftField('metaTitle', e.target.value)} />
      </div>
      <div className="ed-field">
        <div className="ed-field-row">
          <label htmlFor="draft-meta-desc">Meta description</label>
          <span className="seo-row-end">
            <span className={`ed-budget-counter ${typedDesc.length > DESCRIPTION_MAX ? 'over' : ''}`}>{typedDesc.length} / {DESCRIPTION_MAX}</span>
            <button type="button" className="btn-link" onClick={() => setDraftField('metaDescription', buildMetaDescription(draft.deck, draft.body, kp))}>Build from story</button>
          </span>
        </div>
        <textarea id="draft-meta-desc" className="ed-input" rows={3} value={draft.metaDescription} placeholder={draft.deck || `120–${DESCRIPTION_MAX} characters that state the news`} onChange={(e) => setDraftField('metaDescription', e.target.value)} />
      </div>
      <div className="ed-field">
        <div className="ed-field-row">
          <label htmlFor="draft-slug">URL slug</label>
          <span className="seo-row-end">
            <span className={`ed-budget-counter ${draft.slug.length > 75 ? 'over' : ''}`}>{draft.slug.length} / 75</span>
            <button type="button" className="btn-link" onClick={() => setDraftField('slug', buildSlug(draft.headline, kp))}>Build from keyphrase</button>
          </span>
        </div>
        <div className="ed-slug">
          <span className="ed-slug-prefix">/articles/</span>
          <input id="draft-slug" type="text" className="ed-slug-input mono" value={draft.slug} onChange={(e) => setDraftField('slug', e.target.value.toLowerCase().replace(/\s+/g, '-'))} />
          <button type="button" className="btn sm" onClick={onCheckSlug} disabled={slugStatus === 'checking' || !draft.slug}>
            {slugStatus === 'checking' ? 'Checking…' : slugStatus === 'available' ? '✓ Available' : slugStatus === 'taken' ? 'Taken' : 'Check'}
          </button>
        </div>
      </div>

      <div className="seo-checks">
        <div className="seo-checks-head">
          <b>Checks</b>
          <span className={'seo-score' + (good === checks.length ? ' all' : '')}>{good} of {checks.length} pass</span>
          <span className="seo-bar" aria-hidden><i style={{ width: `${(good * 100) / checks.length}%` }} /></span>
        </div>
        <div className="seo-fixrow">
          <span className="hint">From Google Search Central and current newsroom practice. Each point says where it comes from.</span>
          <div className="seo-fixbtns">
            {onUndo && <button type="button" className="btn sm" onClick={onUndo} disabled={fixBusy}><Icon name="undo" size={13} /><span>Undo</span></button>}
            {onFix && (
              <button type="button" className="btn sm ai-btn" data-provider={aiProvider ?? undefined} onClick={onFix} disabled={fixBusy || good === checks.length || !draft.headline.trim()}
                data-tip={good === checks.length ? 'Every check passes' : aiName ? `${aiName} repairs each failing check; the story's facts are never changed` : 'Open AI settings'}>
                <Icon name="sparkle" size={13} className={fixBusy ? 'spin' : ''} />
                <span>{fixBusy ? 'Fixing…' : good === checks.length ? 'All fixed' : 'Fix all with AI'}</span>
              </button>
            )}
          </div>
        </div>
        {fixNote && <p className="seo-fixnote">{fixNote}</p>}
        {GROUPS.map((g) => (
          <div key={g} className="seo-group">
            <span className="seo-group-title">{g}</span>
            {checks.filter((c) => c.group === g).map((c) => (
              <div key={c.id} className={'seo-check ' + c.status} data-check={c.id} data-tip={c.why ? `${c.why} (${c.src === 'google' ? 'Google Search Central' : 'newsroom practice'})` : undefined}>
                <Icon name={c.status === 'good' ? 'check' : 'info'} size={13} />
                <span className="seo-check-label">{c.label}{c.src && <i className={'seo-src ' + c.src}>{c.src === 'google' ? 'Google' : 'Practice'}</i>}</span>
                <span className="seo-check-detail">{c.detail}</span>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}
