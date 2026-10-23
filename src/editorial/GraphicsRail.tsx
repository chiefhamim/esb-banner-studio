// Outputs panel for the Editorial desk: the story as it will appear on each channel — the banner (Graphics' own
// document), the esbpowerline.com article page, and the Facebook post. Everything here edits the same document
// Graphics uses; the live link keeps headline, credit and caption in step with the draft both ways.

import { useMemo, useState } from 'react'
import { useWidth } from '../ui/useWidth'
import { useBannerImage } from './useBannerImage'
import { useHeroMode } from './heroMode'
import type { CSSProperties } from 'react'
import { useStore } from '../store'
import { useEditorialStore } from './editorialStore'
import { useShellStore } from '../shell/shellStore'
import { BannerCanvas, FacebookMock } from '../components/PreviewPanel'
import { FormatPicker } from '../components/FormatPicker'
import { Icon } from '../ui/Icon'
import { Field, Seg, Select, Switch } from '../ui/controls'
import { CATEGORIES, FORMATS, getFormat } from '../core/tokens'
import { LABEL_PRESETS, defaultCaption, suggestHighlight } from '../core/newsroom'
import type { LabelPresetId } from '../core/newsroom'
import type { Assets } from '../core/render'
import { DEFAULT_SETTINGS, copyToClipboard, runExport, humanBytes } from '../export'
import { syncArticlePhotosToBanner } from './automation'
import { SitePreview, SITE_THEMES } from './SitePreview'
import type { SiteDevice, SiteTheme } from './SitePreview'

const labelOptions = [
  { value: 'none', label: 'No label' },
  ...(Object.keys(LABEL_PRESETS) as LabelPresetId[]).map((id) => ({ value: id as string, label: LABEL_PRESETS[id].name })),
]

export type OutputTab = 'banner' | 'article' | 'facebook'

export function OutputsPanel({ base, onToast }: { base: Assets; onToast: (msg: string) => void }) {
  const format = useStore((s) => s.format)
  const setFormat = useStore((s) => s.setFormat)
  const content = useStore((s) => s.doc.content)
  const slot0 = useStore((s) => s.doc.photos.slots[s.format][0])
  const images = useStore((s) => s.images)
  const source = useEditorialStore((s) => s.source)
  const draft = useEditorialStore((s) => s.draft)
  const staffSession = useEditorialStore((s) => s.staffSession)
  const bannerLink = useEditorialStore((s) => s.bannerLink)
  const setBannerLink = useEditorialStore((s) => s.setBannerLink)
  const applyDraftToBanner = useEditorialStore((s) => s.applyDraftToBanner)
  const liveArticles = useEditorialStore((s) => s.liveArticles)

  const [tab, setTab] = useState<OutputTab>(() => {
    try { const v = localStorage.getItem('esb-banner-studio/editorial/output'); return v === 'article' || v === 'facebook' ? v : 'banner' } catch { return 'banner' }
  })
  const pick = (t: OutputTab) => { setTab(t); try { localStorage.setItem('esb-banner-studio/editorial/output', t) } catch { /* ignore */ } }
  const [device, setDevice] = useState<SiteDevice>('mobile')
  const [theme, setTheme] = useState<SiteTheme>('white')
  const [hostRef, hostW] = useWidth<HTMLDivElement>(300)
  const [previewDate] = useState(() => new Date())
  const [busy, setBusy] = useState<null | 'export' | 'copy'>(null)
  const [heroMode, setHeroMode] = useHeroMode()
  const webBanner = useBannerImage(tab === 'article' && heroMode === 'banner' ? base : null, 'web')

  const fmt = getFormat(format)
  const ratio = FORMATS[format].w / FORMATS[format].h
  // the banner fills the panel's width, but never taller than most of a laptop screen
  const stageW = Math.max(160, Math.min(hostW, 520 * ratio))

  const cat = CATEGORIES.find((c) => c.id === content.categoryId) || CATEGORIES[0]
  const related = useMemo(
    () => liveArticles
      .filter((a) => a.category === cat.name && a.slug !== draft.slug)
      .slice(0, 4)
      .map((a) => ({ slug: a.slug, title: a.title, excerpt: a.description, category: a.category, imageUrl: a.imageUrl, date: a.publishedAt })),
    [liveArticles, cat.name, draft.slug],
  )
  const slotImage = slot0?.src ? images.find((i) => i.id === slot0.src) : undefined
  const generatedCaption = useMemo(() => defaultCaption({ ...content }), [content])
  const caption = content.caption ?? generatedCaption
  const wordCount = draft.body.trim() ? draft.body.trim().split(/\s+/).length : 0

  const exportPng = async () => {
    setBusy('export')
    try {
      const res = await runExport(
        useStore.getState().doc,
        base,
        { ...DEFAULT_SETTINGS, formats: [format], scales: [1], type: 'png', zip: false, saveProject: false, dir: null, openAfter: false },
        () => {},
      )
      onToast(res.saved.length ? `Exported ${fmt.short} banner · ${humanBytes(res.bytes)}` : 'Export finished')
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Export failed'
      if (!/cancel/i.test(msg)) onToast(msg)
    } finally {
      setBusy(null)
    }
  }

  const copyImage = async () => {
    setBusy('copy')
    try {
      await copyToClipboard(useStore.getState().doc, format, base)
      onToast('Banner image copied — paste it straight into Facebook')
    } catch {
      onToast('The browser blocked image copy. Use Export instead.')
    } finally {
      setBusy(null)
    }
  }

  const sendToBanner = () => {
    applyDraftToBanner()
    if (source?.images && source.images.length > 0) void syncArticlePhotosToBanner(source.images)
    onToast('Banner updated from the draft')
  }

  return (
    <div className="ed-outputs" style={{ ['--cat' as string]: cat.accent } as CSSProperties}>
      <Seg<OutputTab>
        className="block ed-outputs-tabs"
        value={tab}
        onChange={pick}
        options={[
          { value: 'banner', icon: 'image', label: 'Banner' },
          { value: 'article', icon: 'globe', label: 'Web article' },
          { value: 'facebook', icon: 'externalLink', label: 'Facebook' },
        ]}
      />

      <div className="ed-outputs-link">
        <button
          type="button"
          className={'ed-link-pill' + (bannerLink ? ' on' : '')}
          onClick={() => { setBannerLink(!bannerLink); onToast(bannerLink ? 'Live link paused' : 'Live link on — headline, credit and caption stay in step') }}
          title={bannerLink ? 'Draft and banner stay in step. Click to pause.' : 'Paused. Click to resume live sync.'}
          aria-pressed={bannerLink}
        >
          <Icon name="link" size={11} />
          <span>{bannerLink ? 'Live link' : 'Link paused'}</span>
        </button>
        <button type="button" className="btn xs ghost" onClick={sendToBanner} title="Push headline, desk and story photos to the banner now">
          <Icon name="refresh" size={11} />
          <span>Send to Banner</span>
        </button>
        <button type="button" className="btn xs ghost" onClick={() => useShellStore.getState().openGraphicsFrom('editorial', null)} title="Open the full banner in Graphics">
          <span>Graphics</span>
          <Icon name="chevRight" size={12} />
        </button>
      </div>

      <div ref={hostRef} className="ed-outputs-stage">
        {tab === 'banner' && (
          <>
            <FormatPicker value={format} onChange={setFormat} />
            <div className="ed-outputs-canvas" style={{ width: stageW }}>
              <BannerCanvas base={base} cssWidth={Math.round(stageW)} interactive />
            </div>
            <div className="ed-outputs-meta">
              <span>{fmt.name} · {FORMATS[format].w}×{FORMATS[format].h}</span>
              {slotImage ? <span className="ed-rail-flag ok">Photo set</span> : <span className="ed-rail-flag warn">No photo yet</span>}
            </div>
          </>
        )}

        {tab === 'article' && (
          <>
            <div className="ed-outputs-row">
              <Seg<SiteDevice> value={device} onChange={setDevice} options={[{ value: 'desktop', label: 'Desktop' }, { value: 'tablet', label: 'Tablet' }, { value: 'mobile', label: 'Phone' }]} />
              <Seg<SiteTheme> value={theme} onChange={setTheme} options={SITE_THEMES.map((t) => ({ value: t.id, label: t.label }))} />
              <Seg<'banner' | 'photo'> value={heroMode} onChange={setHeroMode} options={[{ value: 'banner', label: 'Hero: Web banner' }, { value: 'photo', label: 'Hero: photo' }]} />
            </div>
            <SitePreview
              theme={theme}
              device={device}
              availableWidth={Math.max(240, hostW)}
              title={draft.headline}
              excerpt={draft.deck}
              slug={draft.slug}
              category={cat.name}
              author={staffSession?.name || draft.byline || 'ESB PowerLine'}
              date={previewDate}
              readTime={Math.max(1, Math.ceil(wordCount / 200))}
              heroUrl={heroMode === 'banner' ? webBanner : slotImage?.url || null}
              heroCredit={draft.credit || 'ESB PowerLine'}
              paragraphs={draft.body.split(/\n{2,}/).map((t) => t.trim()).filter(Boolean)}
              tags={draft.focusKeywords.split(',').map((t) => t.trim()).filter(Boolean)}
              related={related}
            />
            <div className="ed-outputs-meta">
              <span className="mono">/articles/{draft.slug || 'story-slug'}</span>
            </div>
          </>
        )}

        {tab === 'facebook' && (
          // the phone mock is drawn at 414 px; CSS zoom scales it to the panel like the floating preview window does
          <div className="ed-outputs-fb" style={{ zoom: Math.min(1, hostW / 430) }}>
            <FacebookMock base={base} device="phone" dark={false} />
          </div>
        )}
      </div>

      {tab === 'banner' && (
        <div className="ed-outputs-fields">
          <Field label="Highlighted figure">
            <div className="row">
              <input type="text" className="input" placeholder="e.g. Tk 592 crore" value={content.highlight} onChange={(e) => useStore.getState().setContent({ highlight: e.target.value })} />
              <button type="button" className="btn sm" onClick={() => useStore.getState().setContent({ highlight: suggestHighlight(draft.headline || content.headline) })}>Auto</button>
            </div>
          </Field>
          <Field label="News label">
            <Select value={content.label as string} options={labelOptions} onChange={(v) => useStore.getState().setContent({ label: v as typeof content.label })} />
          </Field>
          <Switch
            checked={!!content.headlineBg}
            onChange={(checked) => useStore.getState().setContent({ headlineBg: checked, headlineBgAlpha: checked ? 0.78 : 0 })}
            label="Translucent headline backdrop"
          />
          <div className="ed-outputs-actions">
            <button type="button" className="btn primary" onClick={() => void exportPng()} disabled={busy !== null}>
              <Icon name="download" size={14} />
              <span>{busy === 'export' ? 'Exporting…' : 'Export PNG'}</span>
            </button>
            <button type="button" className="btn" onClick={() => void copyImage()} disabled={busy !== null} title="Copy the banner image to the clipboard">
              <Icon name="copy" size={14} />
              <span>Copy image</span>
            </button>
          </div>
        </div>
      )}

      {tab === 'facebook' && (
        <div className="ed-outputs-fields">
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <label className="field-label" htmlFor="ed-rail-caption">Post caption</label>
            {content.caption !== null && (
              <button type="button" className="btn-link" onClick={() => useStore.getState().setContent({ caption: null })}>Reset to auto</button>
            )}
          </div>
          <textarea id="ed-rail-caption" className="input" rows={4} value={caption} onChange={(e) => useStore.getState().setContent({ caption: e.target.value })} />
          <div className="ed-outputs-actions">
            <button type="button" className="btn primary" onClick={() => { void navigator.clipboard.writeText(caption); onToast('Caption copied') }}>
              <Icon name="copy" size={14} />
              <span>Copy caption</span>
            </button>
            <button type="button" className="btn" onClick={() => void copyImage()} disabled={busy !== null}>
              <Icon name="image" size={14} />
              <span>Copy image</span>
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
