import { useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { COLLAGES } from '../core/collage'
import { FONTS } from '../core/fonts'
import type { FontId } from '../core/fonts'
import { QUOTE_PRESETS, STAT_PRESETS, cardDesign, dateParts, headlineSize } from '../core/templates'
import { CATEGORIES, getFormat, OPTIMAL_IMAGE_SPACES } from '../core/tokens'
import type { Category } from '../core/tokens'
import type { Backdrop, CardDesign, CardType, El, Override, PhotosEl, Shadow, Stroke, TextEl } from '../core/types'
import { LABEL_PRESETS, suggestHighlight, generatePlatformCaption, SECTOR_IMAGE_SUGGESTIONS } from '../core/newsroom'
import type { LabelPresetId, SocialPlatform, ParsedArticle } from '../core/newsroom'
import { balanceHeadlineBreaks } from '../editorial/translator'
import { automateNewsFromUrl, importImageToBanner } from '../editorial/automation'
import { useShellStore } from '../shell/shellStore'
import { renderToCanvas, slotRects } from '../core/render'
import { loadBaseAssets } from '../core/assets'
import { imageAssets, useStore } from '../store'
import { ColorField, DatePicker, Field, IconButton, Panel, Scrub, Select, Seg, Slider, Switch, Toggle } from '../ui/controls'
import { ELEMENT_DEFS, ELEMENT_SECTIONS } from '../core/elements'
import { Icon, KIND_ICON } from '../ui/Icon'
import { PhotoEditor } from './PhotoEditor'

const CONTENT_DRIVEN = new Set(['headline', 'date-num', 'date-month', 'date-weekday', 'speaker-name', 'speaker-title', 'stat-label', 'stat-delta', 'stat-note'])
const isoOf = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

/** The category's own line icon (the same artwork that sits in the banner's chip). */
function CatIcon({ cat }: { cat: Category }) {
  return (
    <svg viewBox="0 0 26 26" width="19" height="19" fill="none" stroke="currentColor" strokeWidth="2.06" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {cat.icon.map((p, i) => <path key={i} d={p.d} />)}
    </svg>
  )
}

// ================================================================== Story
/** Quote / Stats card design. Presets are starting combinations; the rows under them are independent choices that mix
 *  freely (picture × background × typeface × alignment × accent × order × colour × size), so any look can be built. */
function CardArt({ kind, d }: { kind: 'quote' | 'stat'; d: CardDesign }) {
  return (
    <span className={`card-look-art bg-${d.bg} al-${d.align} mk-${d.mark} od-${d.order} ${d.photo ? 'ph' : 'noph'}`} aria-hidden>
      {d.photo && <i className="a-photo" />}
      <span className="a-block">
        {kind === 'quote' ? <>
          {d.mark === 'mark' && <i className="a-mark">“</i>}
          {d.order === 'alt' && <i className="a-name" />}
          <i className="a-l1" /><i className="a-l2" />
          {d.mark === 'rule' && <i className="a-rule" />}
          {d.order !== 'alt' && <i className="a-name" />}
        </> : d.order === 'split' ? <span className="a-split"><b className="a-num">42</b><i className="a-div" /><span><i className="a-l1" /><i className="a-l2" /></span></span> : <>
          {d.order !== 'alt' && <i className="a-label" />}
          <b className={'a-num' + (d.order === 'alt' ? ' big' : '')}>42</b>
          {d.order === 'alt' && <i className="a-label" />}
          {d.mark === 'rule' && <i className="a-rule" />}
          <i className="a-trend" />
        </>}
      </span>
    </span>
  )
}

const BG_SWATCHES: { id: CardDesign['bg']; name: string }[] = [
  { id: 'tint', name: 'Desk tint' }, { id: 'paper', name: 'Paper' }, { id: 'ink', name: 'Ink (dark)' }, { id: 'accent', name: 'Desk colour' }, { id: 'gradient', name: 'Gradient' },
]

function CardStylePanel({ kind }: { kind: 'quote' | 'stat' }) {
  const content = useStore((s) => s.doc.content)
  const setContent = useStore((s) => s.setContent)
  const presets = kind === 'quote' ? QUOTE_PRESETS : STAT_PRESETS
  const presetId = (kind === 'quote' ? content.quoteStyle : content.statStyle) ?? 'classic'
  const own = (kind === 'quote' ? content.quoteDesign : content.statDesign) ?? {}
  const d = cardDesign(content, kind)
  const base = (presets.find((p) => p.id === presetId) ?? presets[0]).d
  const custom = (Object.keys(own) as (keyof CardDesign)[]).some((k) => own[k] !== base[k])
  const scale = content.cardScale ?? 1
  const set = <K extends keyof CardDesign>(key: K, v: CardDesign[K] | undefined) => {
    const next: Partial<CardDesign> = { ...own, [key]: v }
    if (v === undefined || next[key] === base[key]) delete next[key]
    setContent(kind === 'quote' ? { quoteDesign: next } : { statDesign: next })
  }
  const pick = (id: string) => setContent(kind === 'quote' ? { quoteStyle: id, quoteDesign: {} } : { statStyle: id, statDesign: {} })
  const presetName = presets.find((p) => p.id === presetId)?.name ?? 'Classic'
  const cat = CATEGORIES.find((x) => x.id === content.categoryId) ?? CATEGORIES[0]
  const defaultBg = { tint: cat.band, paper: '#f7f5ef', ink: '#0e1420', accent: cat.accent, gradient: cat.accent }[d.bg]
  // the text colour actually in use: white on a dark background (a picked one or Ink / Gradient), ink otherwise
  const darkBg = d.bgColor ? (() => { const n = parseInt(d.bgColor.replace('#', '').slice(0, 6), 16); const l = (0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)) / 255; return l < 0.55 })() : d.bg === 'ink' || d.bg === 'gradient'
  const defaultInk = darkBg ? '#ffffff' : '#0b0f19'
  const format = useStore((s) => s.format)
  const boxOv = useStore((s) => s.doc.overrides[`${format}:card-box`]) ?? {}
  const setOverride = useStore((s) => s.setOverride)
  const clearOverrideFields = useStore((s) => s.clearOverrideFields)

  return (
    <Panel title={kind === 'quote' ? 'Quote design' : 'Stats design'} sub={custom ? `${presetName} · custom` : presetName} icon="palette">
      <div className="card-looks" role="radiogroup" aria-label="Start from a preset">
        {presets.map((p) => (
          <button key={p.id} type="button" role="radio" aria-checked={presetId === p.id} className={'card-look ' + kind + (presetId === p.id ? ' on' : '') + (presetId === p.id && custom ? ' edited' : '')} onClick={() => pick(p.id)} data-tip={presetId === p.id && custom ? 'Click to drop your changes and go back to this preset' : undefined}>
            <CardArt kind={kind} d={p.d} />
            <b>{p.name}</b>
            <small>{p.note}</small>
          </button>
        ))}
      </div>

      <div className="card-design">
        <Field label="Picture">
          <Seg<'on' | 'off'> className="block" value={d.photo ? 'on' : 'off'} onChange={(v) => set('photo', v === 'on')}
            options={[{ value: 'on', icon: 'image', label: 'With photo' }, { value: 'off', icon: 'text', label: 'Text only' }]} />
        </Field>
        <Field label="Background">
          <div className="card-swatches" role="radiogroup" aria-label="Background">
            {BG_SWATCHES.map((b) => (
              <button key={b.id} type="button" role="radio" aria-checked={d.bg === b.id} aria-label={b.name} data-tip={b.name} className={'card-swatch sw-' + b.id + (d.bg === b.id ? ' on' : '')} onClick={() => set('bg', b.id)} />
            ))}
          </div>
        </Field>
        <Field label="Typeface">
          <Seg<CardDesign['face']> className="block card-faces" value={d.face} onChange={(v) => set('face', v)}
            options={[{ value: 'serif', label: 'Serif' }, { value: 'sans', label: 'Sans' }, { value: 'condensed', label: 'Narrow' }, { value: 'grotesk', label: 'Grotesk' }]} />
        </Field>
        {d.order !== 'split' && (
          <Field label="Alignment">
            <Seg<'left' | 'center' | 'right'> className="block" value={d.align} onChange={(v) => set('align', v)}
              options={[{ value: 'left', icon: 'alignTextLeft', label: 'Left' }, { value: 'center', icon: 'alignTextCenter', label: 'Centre' }, { value: 'right', icon: 'alignTextRight', label: 'Right' }]} />
          </Field>
        )}
        <Field label="Accent">
          <Seg<CardDesign['mark']> className="block" value={kind === 'stat' && d.mark === 'mark' ? 'none' : d.mark} onChange={(v) => set('mark', v)}
            options={[{ value: 'none', label: 'None' }, ...(kind === 'quote' ? [{ value: 'mark' as const, label: 'Mark' }] : []), { value: 'rule', label: 'Rule' }, { value: 'bar', label: 'Bar' }, { value: 'frame', label: 'Frame' }]} />
        </Field>
        <Field label="Order">
          {kind === 'quote'
            ? <Seg<CardDesign['order']> className="block" value={d.order === 'split' ? 'main' : d.order} onChange={(v) => set('order', v)} options={[{ value: 'main', label: 'Quote first' }, { value: 'alt', label: 'Speaker first' }]} />
            : <Seg<CardDesign['order']> className="block" value={d.order} onChange={(v) => set('order', v)} options={[{ value: 'main', label: 'Label first' }, { value: 'alt', label: 'Number first' }, { value: 'split', label: 'Split' }]} />}
        </Field>
        <Field label={kind === 'quote' ? 'Speaker name colour' : 'Number colour'}>
          <Seg<CardDesign['emph']> className="block" value={d.emph} onChange={(v) => set('emph', v)} options={[{ value: 'accent', label: 'Desk colour' }, { value: 'ink', label: 'Text colour' }]} />
        </Field>
        <Field label={`Text size · ${Math.round(scale * 100)} %`}>
          <Slider value={Math.round(scale * 100)} min={80} max={130} step={5} onChange={(v) => setContent({ cardScale: v / 100 })} />
        </Field>

        <div className="card-colours">
          <span className="card-sub">Colours <small>pick any colour; reset returns to the design's own</small></span>
          <ColorField label="Card background" value={d.bgColor ?? defaultBg} onChange={(v) => set('bgColor', v)} onReset={d.bgColor ? () => set('bgColor', undefined) : undefined} />
          <ColorField label="Text" value={d.inkColor ?? defaultInk} onChange={(v) => set('inkColor', v)} onReset={d.inkColor ? () => set('inkColor', undefined) : undefined} />
          <ColorField label={kind === 'quote' ? 'Speaker name' : 'Number'} value={d.hiColor ?? cat.accent} onChange={(v) => set('hiColor', v)} onReset={d.hiColor ? () => set('hiColor', undefined) : undefined} />
          <ColorField label="Accents (mark, rule, bar, frame)" value={d.accentColor ?? cat.accent} onChange={(v) => set('accentColor', v)} onReset={d.accentColor ? () => set('accentColor', undefined) : undefined} />
          <ColorField label="Header background" value={d.headerColor ?? '#fdfbdc'} onChange={(v) => set('headerColor', v)} onReset={d.headerColor ? () => set('headerColor', undefined) : undefined} />
          <ColorField label="Footer background" value={d.footerColor ?? cat.footer} onChange={(v) => set('footerColor', v)} onReset={d.footerColor ? () => set('footerColor', undefined) : undefined} />
        </div>

        <div className="card-colours">
          <span className="card-sub">Text box <small>drag the words on the banner to move it, its corners to resize</small></span>
          <ColorField label="Box fill" value={typeof boxOv.fill === 'string' && boxOv.fill !== 'rgba(0,0,0,0)' ? boxOv.fill : '#ffffff'} onChange={(v) => setOverride('card-box', { fill: v })} onReset={boxOv.fill ? () => clearOverrideFields('card-box', ['fill']) : undefined} />
          {(boxOv.dx || boxOv.dy || boxOv.w != null || boxOv.h != null) && (
            <button type="button" className="btn sm" onClick={() => clearOverrideFields('card-box', ['dx', 'dy', 'w', 'h'])}><Icon name="reset" size={14} /><span>Reset size &amp; position</span></button>
          )}
        </div>
        {kind === 'quote' && d.mark !== 'mark' && (
          <Switch checked={content.quoteMarks !== false} onChange={(v) => setContent({ quoteMarks: v })} label="Quotation marks around the statement" />
        )}
        {kind === 'stat' && (
          <Field label="Trend colour">
            <Seg<'auto' | 'up' | 'down' | 'none'> className="block" value={content.statTrend ?? 'auto'} onChange={(v) => setContent({ statTrend: v })}
              options={[{ value: 'auto', label: 'Auto' }, { value: 'up', label: 'Up' }, { value: 'down', label: 'Down' }, { value: 'none', label: 'Plain' }]} />
          </Field>
        )}
        {custom && <button type="button" className="btn sm ghost card-reset" onClick={() => pick(presetId)}><Icon name="reset" size={14} /><span>Back to {presetName}</span></button>}
      </div>
      <p className="hint">Drag the header or footer on the banner to move it as one block; double-click to pick a single element inside it.</p>
    </Panel>
  )
}

export function StoryPanel() {
  const content = useStore((s) => s.doc.content)
  const format = useStore((s) => s.format)
  const setContent = useStore((s) => s.setContent)
  const area = useRef<HTMLTextAreaElement>(null)
  const parts = dateParts(content.date)
  const len = content.headline.trim().length
  const cat = CATEGORIES.find((c) => c.id === content.categoryId)

  const [urlInput, setUrlInput] = useState('')
  const [loadingUrl, setLoadingUrl] = useState(false)
  const [platform, setPlatform] = useState<SocialPlatform>('facebook')
  const [articleResult, setArticleResult] = useState<ParsedArticle | null>(null)

  useEffect(() => {
    const onFocus = (e: Event) => {
      const what = (e as CustomEvent).detail
      if (what === 'headline') { area.current?.focus(); area.current?.select() }
    }
    window.addEventListener('esb:focus', onFocus)
    return () => window.removeEventListener('esb:focus', onFocus)
  }, [])

  const shiftDay = (n: number) => {
    const [y, m, d] = content.date.split('-').map(Number)
    setContent({ date: isoOf(new Date(y, m - 1, d + n)) })
  }
  const useSelection = () => {
    const el = area.current
    if (!el) return
    const sel = content.headline.slice(el.selectionStart, el.selectionEnd).trim()
    if (sel) setContent({ highlight: sel })
  }
  const found = !content.highlight.trim() || content.headline.toLowerCase().includes(content.highlight.trim().toLowerCase())
  const activeCaption = content.caption ?? generatePlatformCaption(platform, content)

  const applyPhoto = async (imgUrl: string) => {
    try {
      useStore.getState().setNotice('Loading selected photo…')
      const ok = await importImageToBanner(imgUrl, 'selected-photo.jpg', { slotIndex: 0 })
      if (ok) {
        useStore.getState().setNotice('Photo applied to banner!')
      } else {
        useStore.getState().setNotice('Could not decode selected photo.')
      }
    } catch (e) {
      useStore.getState().setNotice('Could not load photo: ' + (e as Error).message)
    }
  }

  const handleImportUrl = async () => {
    const raw = urlInput.trim()
    if (!raw) return
    setLoadingUrl(true)
    try {
      const res = await automateNewsFromUrl(raw, (msg) => useStore.getState().setNotice(msg))
      setArticleResult({
        headline: res.englishHeadline,
        rawHeadline: res.originalTitle,
        date: res.date,
        imageUrl: res.images[0]?.src,
        images: res.images.map((img) => img.src),
        suggestedImages: SECTOR_IMAGE_SUGGESTIONS[res.categoryId] ?? [],
        categoryId: res.categoryId,
        description: res.deck,
        author: res.byline,
      })
      useStore.getState().setNotice(`Auto-generated news for: “${res.englishHeadline.slice(0, 36)}…”`)
    } catch (err) {
      useStore.getState().setNotice(`Could not import article: ${(err as Error).message}`)
    } finally {
      setLoadingUrl(false)
    }
  }

  const copyCaption = async () => {
    try {
      await navigator.clipboard.writeText(activeCaption)
      useStore.getState().setNotice(`${platform.toUpperCase()} caption copied to clipboard.`)
    } catch {
      useStore.getState().setNotice('Could not copy the caption.')
    }
  }

  const copyImageAndCaption = async () => {
    try {
      await navigator.clipboard.writeText(activeCaption)
      const curScene = useStore.getState().scene()
      const assets = await loadBaseAssets()
      const cvs = renderToCanvas(curScene, { ...assets, ...imageAssets })
      cvs.toBlob(async (blob) => {
        if (blob && navigator.clipboard.write) {
          try {
            await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
            useStore.getState().setNotice('Copied banner image & caption to clipboard!')
            return
          } catch {}
        }
        useStore.getState().setNotice('Caption copied to clipboard!')
      }, 'image/png')
    } catch {
      useStore.getState().setNotice('Could not copy.')
    }
  }

  const cardType: CardType = content.cardType ?? 'standard'

  return (
    <>
      <Seg<CardType>
        className="block card-type-seg"
        value={cardType}
        onChange={(t) => setContent({ cardType: t })}
        options={[
          { value: 'standard', icon: 'newspaper', label: 'News Banner' },
          { value: 'quote', icon: 'quote', label: 'Quote Card' },
          { value: 'stat', icon: 'chart', label: 'Stats Card' },
        ]}
      />

      <div className="url-importer">
        <div className="row" style={{ gap: 6 }}>
          <input
            type="url"
            className="input sm"
            placeholder="Paste a news link…"
            value={urlInput}
            onChange={(e) => setUrlInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleImportUrl()}
          />
          <button className="btn sm primary" onClick={handleImportUrl} disabled={loadingUrl || !urlInput.trim()}>
            {loadingUrl ? 'Processing…' : 'Fetch & Translate'}
          </button>
        </div>
        <p className="hint">Processes news in natural English, extracts photos, suggests relevant images & sets desk category.</p>

        {articleResult && (
          <div className="article-studio-preview">
            <div className="asp-header">
              <span className="asp-tag"><Icon name="check" size={12} /> English processed</span>
              <small>{articleResult.images.length} article photos found</small>
              <button type="button" className="asp-close" onClick={() => setArticleResult(null)} aria-label="Dismiss" data-tip="Dismiss"><Icon name="x" size={13} /></button>
            </div>
            {articleResult.rawHeadline && articleResult.rawHeadline !== articleResult.headline && (
              <div className="asp-orig">Original: <i>{articleResult.rawHeadline}</i></div>
            )}
            <div className="asp-head-eng">
              <b>{articleResult.headline}</b>
            </div>

            {articleResult.images.length > 0 && (
              <div className="asp-media-section">
                <label>Photos from this article (click to use):</label>
                <div className="asp-thumbs">
                  {articleResult.images.map((img, i) => (
                    <button key={i} type="button" className="asp-thumb" onClick={() => applyPhoto(img)} title="Click to use on banner">
                      <img src={img} alt="" />
                    </button>
                  ))}
                </div>
              </div>
            )}

            {articleResult.suggestedImages.length > 0 && (
              <div className="asp-media-section">
                <label>Suggested relevant sector photos:</label>
                <div className="asp-thumbs">
                  {articleResult.suggestedImages.map((s, i) => (
                    <button key={i} type="button" className="asp-thumb suggested" onClick={() => applyPhoto(s.url)} title={s.title + ' — ' + s.note}>
                      <img src={s.url} alt="" />
                      <span className="asp-thumb-lbl">{s.note}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="asp-actions">
              <button
                type="button"
                className="btn sm secondary"
                onClick={() => useShellStore.getState().setWorkspace('editorial')}
                title="Review source facts, verify numbers, and copy multi-platform social captions in Editorial Desk"
              >
                <Icon name="newspaper" size={13} /> Open in Editorial Desk →
              </button>
            </div>
          </div>
        )}
      </div>

      <Panel title="Category" focusKey="category" sub="10 desks" icon="palette" actions={<span className="chip-note" style={{ ['--c' as string]: cat?.accent }} title={cat?.name}>{cat?.id}</span>}>
        <div className="cat-grid">
          {CATEGORIES.map((c) => (
            <button key={c.id} className={'cat' + (c.id === content.categoryId ? ' on' : '')} style={{ ['--c' as string]: c.accent }} onClick={() => setContent({ categoryId: c.id })} title={c.name} aria-pressed={c.id === content.categoryId}>
              <span className="cat-ico"><CatIcon cat={c} /></span>
              <span className="cat-txt"><em>{c.id}</em><b>{c.name}</b></span>
            </button>
          ))}
        </div>
      </Panel>

      <Panel defaultOpen={false} title="Date" focusKey="date" sub="Shown on the banner" icon="calendar">
        <div className="row">
          <IconButton icon="chevRight" tip="Previous day" className="flip" onClick={() => shiftDay(-1)} />
          <DatePicker value={content.date} onChange={(d) => setContent({ date: d })} />
          <IconButton icon="chevRight" tip="Next day" onClick={() => shiftDay(1)} />
        </div>
        <p className="hint">Banner shows <b>{parts.num}</b> · {parts.monthYear} · {parts.weekday}</p>
      </Panel>

      {cardType === 'quote' && <CardStylePanel kind="quote" />}
      {cardType === 'quote' && (
        <Panel defaultOpen={false} title="Quote Statement" focusKey="headline" sub="Speaker & Quote" icon="quote">
          <Field label="Quote Statement">
            <textarea
              rows={4}
              className="input"
              value={content.quoteText || content.headline}
              placeholder="“Type or paste the official statement or quote here…”"
              onChange={(e) => setContent({ quoteText: e.target.value, headline: e.target.value })}
            />
          </Field>
          <Field label="Speaker Name">
            <input
              type="text"
              className="input"
              value={content.speakerName ?? ''}
              placeholder="e.g. Muhammad Fouzul Kabir Khan"
              onChange={(e) => setContent({ speakerName: e.target.value })}
            />
          </Field>
          <Field label="Speaker Designation / Title">
            <input
              type="text"
              className="input"
              value={content.speakerTitle ?? ''}
              placeholder="e.g. Adviser, Ministry of Power, Energy & Mineral Resources"
              onChange={(e) => setContent({ speakerTitle: e.target.value })}
            />
          </Field>
          <p className="hint">Rendered with editorial serif quotation marks and speaker attribution.</p>
        </Panel>
      )}

      {cardType === 'stat' && <CardStylePanel kind="stat" />}
      {cardType === 'stat' && (
        <Panel defaultOpen={false} title="Stats" focusKey="headline" sub="Number, label, trend & source" icon="chart">
          <Field label="Key Number / Metric">
            <input
              type="text"
              className="input"
              value={content.statNumber ?? ''}
              placeholder="e.g. 16,470 MW, 800 MMCFD, or $1.2B"
              onChange={(e) => setContent({ statNumber: e.target.value })}
            />
          </Field>
          <Field label="Metric Label / Title">
            <input
              type="text"
              className="input"
              value={content.statLabel ?? ''}
              placeholder="e.g. PEAK ELECTRICITY DEMAND"
              onChange={(e) => setContent({ statLabel: e.target.value })}
            />
          </Field>
          <Field label="Trend / Delta Badge">
            <input
              type="text"
              className="input"
              value={content.statDelta ?? ''}
              placeholder="e.g. ▲ +1,240 MW (All-time Record)"
              onChange={(e) => setContent({ statDelta: e.target.value })}
            />
          </Field>
          <Field label="Context Note / Source">
            <input
              type="text"
              className="input"
              value={content.statNote ?? ''}
              placeholder="e.g. Source: Bangladesh Power Development Board (BPDB)"
              onChange={(e) => setContent({ statNote: e.target.value })}
            />
          </Field>
          <p className="hint">Features high-impact typography with bold numbers, delta indicators, and data source.</p>
        </Panel>
      )}

      {cardType === 'standard' && (
        <Panel defaultOpen={false} title="Headline" focusKey="headline" sub="Auto-sized" icon="newspaper" actions={<span className={'count' + (len > 90 ? ' bad' : len > 70 ? ' warn' : '')}>{len} / 90</span>}>
          <textarea ref={area} rows={4} className="input" value={content.headline} placeholder="Type the exact article title…" onChange={(e) => setContent({ headline: e.target.value })} />
          <div className="row" style={{ marginTop: 6, marginBottom: 8, gap: 6 }}>
            <button
              type="button"
              className="btn sm"
              title="Auto-balance headline across 2 lines at punctuation or natural word break"
              onClick={() => setContent({ headline: balanceHeadlineBreaks(content.headline) })}
            >
              <Icon name="type" size={12} /> Auto-Balance Lines
            </button>
            {content.headline.includes('\n') && (
              <button
                type="button"
                className="btn sm ghost"
                title="Remove line breaks into a single line"
                onClick={() => setContent({ headline: content.headline.replace(/\r?\n+/g, ' ') })}
              >
                Clear Breaks
              </button>
            )}
            {content.headline.includes('\n') && (
              <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--accent)', alignSelf: 'center', fontWeight: 600 }}>
                2 lines active
              </span>
            )}
          </div>
          <div className={'meter' + (len > 90 ? ' bad' : len > 70 ? ' warn' : '')}><i style={{ width: Math.min(100, (len / 90) * 100) + '%' }} /></div>
          <p className={'hint' + (len > 90 ? ' bad' : '')}>
            {len > 90 ? 'Over 90 characters — the brand guideline says to shorten the title.' : `Auto size: ${headlineSize(format, len)} px for ${getFormat(format).name} (${len > 70 ? '71–90' : '1–70'} characters)`}
          </p>
          <Field label="Highlighted phrase (Web panel)">
            <input type="text" className="input" value={content.highlight} placeholder="Phrase to highlight" onChange={(e) => setContent({ highlight: e.target.value })} />
            <div className="row">
              <button className="btn sm" onClick={() => setContent({ highlight: suggestHighlight(content.headline) })} disabled={!content.headline.trim()} title="Picks the amount or figure in the headline"><Icon name="sparkle" size={13} />Suggest</button>
              <button className="btn sm" onClick={useSelection} title="Select words in the headline box, then click">Use selection</button>
              {content.highlight && <button className="btn sm ghost" onClick={() => setContent({ highlight: '' })}>Clear</button>}
            </div>
          </Field>
          {!found && <p className="hint bad">That phrase isn’t in the headline, so nothing is highlighted.</p>}
          <div className="stack">
            <Switch checked={content.highlightOnSocial} onChange={(v) => setContent({ highlightOnSocial: v })} label="Highlight on Facebook banner too" />
            {getFormat(format).family === 'stack' && <Switch checked={content.showLinkPill} onChange={(v) => setContent({ showLinkPill: v })} label="Show “NEWS LINK IN COMMENT” pill" />}
            <Switch
              checked={Boolean(content.headlineBg)}
              onChange={(v) => {
                setContent({
                  headlineBg: v,
                  bandOpacity: v && (content.bandOpacity ?? 1) === 1 ? 0 : (!v && content.bandOpacity === 0 ? 1 : content.bandOpacity),
                })
              }}
              label="Translucent glass headline (float anywhere on photo)"
            />
          </div>
          {content.headlineBg && (
            <div className="translucent-headline-box" style={{ marginTop: 10, padding: '10px 12px', borderRadius: 10, background: 'var(--bg-2)', border: '1px solid var(--line)' }}>
              <div className="grid2">
                <Scrub
                  label="Glass Opacity"
                  value={Math.round((content.headlineBgAlpha ?? 0.76) * 100)}
                  min={15}
                  max={98}
                  decimals={0}
                  unit="%"
                  onChange={(v) => setContent({ headlineBgAlpha: v / 100 })}
                />
                <ColorField
                  label="Glass Tint"
                  value={content.headlineBgColor ?? '#0b0f19'}
                  onChange={(c) => setContent({ headlineBgColor: c })}
                />
              </div>
              <Scrub
                label="Headline Band Opacity (0% = Full-Bleed Photo)"
                value={Math.round((content.bandOpacity ?? 0) * 100)}
                min={0}
                max={100}
                decimals={0}
                unit="%"
                onChange={(v) => setContent({ bandOpacity: v / 100 })}
              />
              <Field label="Quick Canvas Position (or drag directly on preview)">
                <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                  <button
                    type="button"
                    className="btn sm"
                    onClick={() => useStore.getState().setOverride('headline', { dx: 0, dy: -560 })}
                  >
                    Top Overlay
                  </button>
                  <button
                    type="button"
                    className="btn sm"
                    onClick={() => useStore.getState().setOverride('headline', { dx: 0, dy: -310 })}
                  >
                    Center Overlay
                  </button>
                  <button
                    type="button"
                    className="btn sm"
                    onClick={() => useStore.getState().setOverride('headline', { dx: 0, dy: -90 })}
                  >
                    Lower-Third
                  </button>
                  <button
                    type="button"
                    className="btn sm ghost"
                    onClick={() => useStore.getState().clearOverrideFields('headline', ['dx', 'dy'])}
                  >
                    Default Band
                  </button>
                </div>
              </Field>
            </div>
          )}
        </Panel>
      )}

      <Panel defaultOpen={false} title="Label pill" focusKey="label" sub="Tag on the photo" icon="sparkle"
        actions={content.label !== 'none' ? <span className="chip-note" style={{ ['--c' as string]: content.label === 'custom' ? content.labelColor : LABEL_PRESETS[content.label].bg }}>{(content.labelText.trim() || (content.label === 'custom' ? 'LABEL' : LABEL_PRESETS[content.label].text)).toUpperCase()}</span> : undefined}>
        <div className="label-presets">
          <button type="button" className={'lp lp-none' + (content.label === 'none' ? ' on' : '')} onClick={() => setContent({ label: 'none' })}>None</button>
          {(Object.keys(LABEL_PRESETS) as LabelPresetId[]).map((id) => {
            const p = LABEL_PRESETS[id]
            return (
              <button key={id} type="button" className={'lp' + (content.label === id ? ' on' : '')} style={{ ['--lp' as string]: p.bg, ['--lpb' as string]: p.border }} onClick={() => setContent({ label: id })} title={p.name}>
                <Icon name={p.icon === 'trending' ? 'trendingUp' : p.icon} size={12} strokeWidth={2.2} />{p.text}
              </button>
            )
          })}
          <button type="button" className={'lp lp-custom' + (content.label === 'custom' ? ' on' : '')} style={{ ['--lp' as string]: content.labelColor, ['--lpb' as string]: content.labelColor }} onClick={() => setContent({ label: 'custom' })}>Custom</button>
        </div>
        {content.label !== 'none' && (
          <>
            <Field label="Text">
              <input type="text" className="input" value={content.labelText} placeholder={content.label === 'custom' ? 'LABEL' : LABEL_PRESETS[content.label as LabelPresetId]?.text} onChange={(e) => setContent({ labelText: e.target.value })} />
            </Field>
            <Field label="Position">
              <Select value={content.labelPos} onChange={(v) => setContent({ labelPos: v as typeof content.labelPos })} options={[
                { value: 'tl', label: 'Photo — top left' }, { value: 'tr', label: 'Photo — top right' }, { value: 'bl', label: 'Photo — bottom left' }, { value: 'br', label: 'Photo — bottom right' }, { value: 'hc', label: 'Header — centre' },
              ]} />
            </Field>
            <Scrub label="Size" value={Math.round(content.labelScale * 100)} min={40} max={300} decimals={0} unit="%" onChange={(v) => setContent({ labelScale: v / 100 })} />
            {content.label === 'custom' && <ColorField label="Colour" value={content.labelColor} onChange={(c) => setContent({ labelColor: c })} />}
            <p className="hint">Styled exactly like the pills on esbpowerline.com. The pill is three layers (shape, icon, text) you can also move and restyle.</p>
          </>
        )}
      </Panel>

      <Panel defaultOpen={false} title="Photo credit" focusKey="credit" sub="Printed on the picture" icon="image"
        actions={content.credit.trim() ? <span className="count" title={content.credit.trim()}>{content.credit.trim().slice(0, 16)}</span> : undefined}>
        <input type="text" className="input" value={content.credit} placeholder="e.g. Photo: PID" onChange={(e) => setContent({ credit: e.target.value })} />
        <Field label="Placement">
          <Select value={content.creditPos} onChange={(v) => setContent({ creditPos: v as typeof content.creditPos })} options={[
            { value: 'bl', label: 'Bottom left' }, { value: 'br', label: 'Bottom right' }, { value: 'tl', label: 'Top left' }, { value: 'tr', label: 'Top right' },
          ]} />
        </Field>
        <Field label="Font">
          <Select value={content.creditFont} options={FONTS.map((f) => ({ value: f.id, label: f.name, hint: f.note }))} onChange={(v) => setContent({ creditFont: v as FontId })} />
        </Field>
        <div className="grid2">
          <Scrub label="Size" value={content.creditSize} min={10} max={80} decimals={0} unit="px" onChange={(v) => setContent({ creditSize: v })} />
          <ColorField label="Colour" value={content.creditColor} onChange={(c) => setContent({ creditColor: c })} />
        </div>
        <Switch checked={content.creditChip} onChange={(v) => setContent({ creditChip: v })} label="Dark pill behind the text" />
        <p className="hint">Appears on every format. It is also a normal layer — select it to drag, resize or restyle it anywhere.</p>
      </Panel>

      <Panel defaultOpen={false} title="Post caption" sub="Social media publishing" icon="newspaper">
        <div className="caption-platform-tabs">
          {(['facebook', 'linkedin', 'twitter', 'telegram'] as SocialPlatform[]).map((p) => (
            <button
              key={p}
              type="button"
              className={'cpt-tab' + (platform === p ? ' on' : '')}
              onClick={() => setPlatform(p)}
            >
              {p === 'facebook' ? 'Facebook' : p === 'linkedin' ? 'LinkedIn' : p === 'twitter' ? 'X / Twitter' : 'Telegram'}
            </button>
          ))}
        </div>
        <textarea className="input" rows={7} value={activeCaption} onChange={(e) => setContent({ caption: e.target.value })} />
        <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
          <button className="btn sm primary" onClick={copyCaption}><Icon name="copy" size={13} />Copy caption</button>
          <button className="btn sm" onClick={copyImageAndCaption} title="Copies both banner image and post text"><Icon name="copy" size={13} />Copy Image + Post</button>
          <button className="btn sm ghost" disabled={content.caption === null} onClick={() => setContent({ caption: null })}><Icon name="reset" size={13} />Reset text</button>
          <span className="count" style={{ marginLeft: 'auto' }}>{activeCaption.length}</span>
        </div>
        <p className="hint">Formatted for {platform === 'facebook' ? 'Facebook Feed' : platform === 'linkedin' ? 'LinkedIn' : platform === 'twitter' ? 'X (Twitter)' : 'Telegram'} with verified industry tags.</p>
      </Panel>
    </>
  )
}

// ================================================================== Photos
export function PhotosPanel({ addPhotos }: { addPhotos: () => void }) {
  const photos = useStore((s) => s.doc.photos)
  const format = useStore((s) => s.format)
  const images = useStore((s) => s.images)
  const selectedSlot = useStore((s) => s.selectedSlot)
  const select = useStore((s) => s.select)
  const selectSlot = useStore((s) => s.selectSlot)
  const st = useStore.getState
  const slots = photos.slots[format]
  const cur = slots[selectedSlot]
  const photoId = 'photos'
  /** zoom that shows the whole photo inside the slot (cover zoom = 1) */
  const containZoom = (i: number) => {
    const pe = st().scene().elements.find((e): e is PhotosEl => e.kind === 'photos')
    const sl = pe?.slots[i]
    const img = sl?.src ? imageAssets[sl.src] : null
    if (!pe || !img) return 1
    const r = slotRects(pe)[i]
    return Math.min(r.w / img.width, r.h / img.height) / Math.max(r.w / img.width, r.h / img.height)
  }

  const opt = OPTIMAL_IMAGE_SPACES[format]
  const fmt = getFormat(format)

  return (
    <>
      <Panel defaultOpen={false} title="Optimal image dimensions" icon="image" sub={fmt.name}>
        <div className="opt-space-card">
          <div className="opt-space-hero">
            <b>{opt.w} × {opt.h} px</b>
            <span className="opt-badge">{opt.ratioStr}</span>
          </div>
          <p className="opt-desc">
            After deducting the header and footer/headline elements from the {fmt.w}×{fmt.h} template, the body photo space is exactly <b>{opt.w} × {opt.h} px</b>.
          </p>
          <div className="opt-math-line">
            <Icon name="info" size={12} />
            <span>{opt.shortDeduction}</span>
          </div>
        </div>
      </Panel>

      <Panel title="Photo library" persist={false} sub={images.length ? `${images.length} photo${images.length === 1 ? '' : 's'}` : undefined} icon="image" actions={<button className="btn sm primary" onClick={addPhotos}><Icon name="plus" size={13} />Add</button>}>
        {images.length === 0 ? (
          <div className="dropzone" onClick={addPhotos}>
            <Icon name="image" size={22} />
            <b>Add photos</b>
            <span>Click, drop files on the banner, or paste (Ctrl+V). Photos fill the collage slots in order.</span>
          </div>
        ) : (
          <div className="thumbs">
            {images.map((im) => {
              const used = slots.some((s) => s.src === im.id)
              return (
                <div key={im.id} className={'thumb' + (used ? ' used' : '')} title={`${im.name} · ${im.w}×${im.h}\nClick: place in slot ${selectedSlot + 1}`} onClick={() => st().assignImage(selectedSlot, im.id)}>
                  <img src={im.url} alt={im.name} />
                  <div className="thumb-actions">
                    <button title="Add as free layer" onClick={(e) => { e.stopPropagation(); st().addImageLayer(im.id) }}><Icon name="layers" size={12} /></button>
                    <button title="Remove from library" onClick={(e) => { e.stopPropagation(); st().removeImage(im.id) }}><Icon name="x" size={12} /></button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </Panel>

      <Panel defaultOpen={false} title="Collage" icon="photos">
        <div className="collages">
          {COLLAGES.map((c) => {
            const rects = c.layout(100, 70, 5)
            return (
              <button key={c.id} className={'collage-btn' + (photos.collage === c.id ? ' on' : '')} title={c.name} onClick={() => st().setCollage(c.id)}>
                <svg viewBox="0 0 100 70" className="collage">{rects.map((r, i) => <rect key={i} x={r.x} y={r.y} width={r.w} height={r.h} rx="3" />)}</svg>
              </button>
            )
          })}
        </div>
        <div className="grid2">
          <Scrub label="Gap" value={photos.gap} min={0} max={60} unit="px" decimals={0} onChange={(v) => st().setGap(v)} />
          <ColorField label="Colour" value={photos.gapColor} onChange={(c) => st().setGapColor(c)} />
        </div>
      </Panel>

      <Panel defaultOpen={false} title="Slots & framing" icon="sliders">
        <div className="slots">
          {slots.map((s, i) => {
            const im = s.src ? images.find((x) => x.id === s.src) : null
            return (
              <div key={i} className={'slot' + (i === selectedSlot ? ' on' : '')} onClick={() => { selectSlot(i); select(photoId) }}>
                <div className="slot-img">{im ? <img src={im.url} alt="" /> : <span>{i + 1}</span>}</div>
                <div className="slot-meta"><b>Slot {i + 1}</b><small>{im ? im.name : 'empty'}</small></div>
                <div className="slot-actions">
                  <IconButton icon="chevUp" tip="Swap with previous" size={13} disabled={i === 0} onClick={(e) => { e.stopPropagation(); st().swapSlots(i, i - 1); selectSlot(i - 1) }} />
                  <IconButton icon="chevDown" tip="Swap with next" size={13} disabled={i === slots.length - 1} onClick={(e) => { e.stopPropagation(); st().swapSlots(i, i + 1); selectSlot(i + 1) }} />
                  <IconButton icon="x" tip="Clear slot" size={13} disabled={!s.src} onClick={(e) => { e.stopPropagation(); st().assignImage(i, null) }} />
                </div>
              </div>
            )
          })}
        </div>
        {cur?.src ? (
          <div className="frame-controls">
            <Field label={`Zoom · ${cur.zoom.toFixed(2)}×`}><Slider value={Math.log(cur.zoom)} min={Math.log(0.1)} max={Math.log(6)} step={0.01} onChange={(v) => st().setSlot(selectedSlot, { zoom: Math.exp(v) })} /></Field>
            <div className="row">
              <button className="btn sm" onClick={() => st().setSlot(selectedSlot, { zoom: 1, panX: 0, panY: 0 })} title="Fill the whole slot (crops the edges)">Fill</button>
              <button className="btn sm" onClick={() => st().setSlot(selectedSlot, { zoom: containZoom(selectedSlot), panX: 0, panY: 0 })} title="Show the whole photo, nothing cropped">Fit whole photo</button>
            </div>
            <Field label="Behind a zoomed-out photo">
              <Select value={photos.backdrop ?? 'blur'} onChange={(v) => st().setBackdrop(v as Backdrop)} options={[
                { value: 'blur', label: 'Blurred copy of the photo' }, { value: 'black', label: 'Black' }, { value: 'white', label: 'White' }, { value: 'tint', label: 'Category tint' },
              ]} />
            </Field>
            <Field label="Horizontal"><Slider value={cur.panX} min={-1} max={1} step={0.01} onChange={(v) => st().setSlot(selectedSlot, { panX: v })} /></Field>
            <Field label="Vertical"><Slider value={cur.panY} min={-1} max={1} step={0.01} onChange={(v) => st().setSlot(selectedSlot, { panY: v })} /></Field>
            <div className="row">
              <button className="btn sm" onClick={() => st().setSlot(selectedSlot, { zoom: 1, panX: 0, panY: 0 })}><Icon name="reset" size={13} />Reset framing</button>
              <button className="btn sm" onClick={() => st().syncSlotFraming(selectedSlot)} title="Copy this slot's zoom and pan to all 5 banner formats"><Icon name="copy" size={13} />Use on all formats</button>
            </div>
            <p className="hint">On the banner: drag a photo to pan, scroll to zoom. Framing is saved separately for Facebook and Web.</p>

            <PhotoEditor slot={selectedSlot} />
          </div>
        ) : <p className="hint">Select a slot, then click a photo above to place it.</p>}
      </Panel>
    </>
  )
}

// ================================================================== Inspector
const round = (v: number, d = 1) => Math.round(v * 10 ** d) / 10 ** d
const WEIGHTS = [{ value: 500, label: 'Medium' }, { value: 700, label: 'Bold' }, { value: 800, label: 'ExtraBold' }]
const DEFAULT_SHADOW: Shadow = { x: 0, y: 8, blur: 24, color: '#000000', alpha: 0.35 }
const DEFAULT_STROKE: Stroke = { color: '#ffffff', width: 4 }

function AlignBar({ many }: { many: boolean }) {
  const st = useStore.getState
  return (
    <div className="align-bar">
      <IconButton icon="alignLeft" tip={many ? 'Align left edges' : 'Align to canvas left'} onClick={() => st().alignSelected('left')} />
      <IconButton icon="alignHCenter" tip={many ? 'Align horizontal centres' : 'Centre on canvas'} onClick={() => st().alignSelected('hcenter')} />
      <IconButton icon="alignRight" tip={many ? 'Align right edges' : 'Align to canvas right'} onClick={() => st().alignSelected('right')} />
      <i className="vr" />
      <IconButton icon="alignTop" tip={many ? 'Align top edges' : 'Align to canvas top'} onClick={() => st().alignSelected('top')} />
      <IconButton icon="alignVCenter" tip={many ? 'Align vertical centres' : 'Middle on canvas'} onClick={() => st().alignSelected('vcenter')} />
      <IconButton icon="alignBottom" tip={many ? 'Align bottom edges' : 'Align to canvas bottom'} onClick={() => st().alignSelected('bottom')} />
      <i className="vr" />
      <IconButton icon="distH" tip="Distribute horizontally (3+ layers)" disabled={!many} onClick={() => st().distributeSelected('x')} />
      <IconButton icon="distV" tip="Distribute vertically (3+ layers)" disabled={!many} onClick={() => st().distributeSelected('y')} />
    </div>
  )
}

function ArrangeBar({ id }: { id: string }) {
  const st = useStore.getState
  return (
    <div className="align-bar">
      <IconButton icon="front" tip="Bring to front (Ctrl+Shift+])" onClick={() => st().moveLayer(id, 'front')} />
      <IconButton icon="forward" tip="Bring forward (Ctrl+])" onClick={() => st().moveLayer(id, 'up')} />
      <IconButton icon="backward" tip="Send backward (Ctrl+[)" onClick={() => st().moveLayer(id, 'down')} />
      <IconButton icon="back" tip="Send to back (Ctrl+Shift+[)" onClick={() => st().moveLayer(id, 'back')} />
    </div>
  )
}

export function Inspector() {
  const doc = useStore((s) => s.doc)
  const format = useStore((s) => s.format)
  const selectedIds = useStore((s) => s.selectedIds)
  const scene = useStore((s) => s.scene)
  const st = useStore.getState
  const els = useMemo(() => scene().elements, [scene, doc, format])
  const sel = selectedIds.map((id) => els.find((e) => e.id === id)).filter((e): e is El => !!e)
  const el = sel.length === 1 ? sel[0] : null
  const [ratio, setRatio] = useState(true)

  if (!sel.length) {
    return (
      <Panel accordion={false} title="Inspector" icon="sliders">
        <div className="empty">
          <Icon name="select" size={22} />
          <b>Nothing selected</b>
          <span>Click an element on the banner to edit it. Shift-click or drag a box to select several.</span>
        </div>
      </Panel>
    )
  }

  if (!el) {
    return (
      <Panel accordion={false} title={`${sel.length} layers`} icon="layers" actions={<>
        <IconButton icon="copy" tip="Duplicate (Ctrl+D)" onClick={() => st().duplicateSelected()} />
        <IconButton icon="trash" tip="Delete / hide (Del)" onClick={() => st().deleteSelected()} />
      </>}>
        <Field label="Align & distribute"><AlignBar many /></Field>
        <p className="hint">Alignment is relative to the selection’s bounds. Drag any selected layer to move them together; Shift locks the axis.</p>
      </Panel>
    )
  }

  const key = `${format}:${el.id}`
  const o: Override = doc.overrides[key] ?? {}
  const isExtra = el.id.startsWith('x-')
  const set = (p: Partial<Override>) => st().setOverride(el.id, p)
  const place = (t: { x?: number; y?: number; w?: number; h?: number }) => st().placeElement(el.id, t)
  const text = el.kind === 'text' ? (el as TextEl) : null
  const aspect = el.h > 0 ? el.w / el.h : 1
  const canStyleFx = el.kind === 'rect' || el.kind === 'text' || el.kind === 'icon' || el.kind === 'image'
  const canStroke = el.kind === 'rect' || el.kind === 'text' || el.kind === 'image'
  const clear = (fields: (keyof Override)[]) => st().clearOverrideFields(el.id, fields)
  const hasTransformOv = o.dx !== undefined || o.dy !== undefined || o.w !== undefined || o.h !== undefined
  const hasAppOv = o.opacity !== undefined || o.fill !== undefined || o.radius !== undefined || (el.kind === 'icon' && o.color !== undefined)
  const hasCharOv = o.font !== undefined || o.weight !== undefined || o.size !== undefined || o.ls !== undefined || o.lh !== undefined || o.align !== undefined || o.color !== undefined
  const hasFxOv = o.shadow !== undefined || o.stroke !== undefined

  return (
    <>
      <Panel accordion={false} title={el.name} icon={KIND_ICON[el.kind]} id="insp-main">
        <div className="insp-actions">
          <IconButton icon={el.visible ? 'eye' : 'eyeOff'} tip={el.visible ? 'Hide' : 'Show'} onClick={() => set({ visible: !el.visible })} />
          <IconButton icon={el.locked ? 'lock' : 'unlock'} tip={el.locked ? 'Unlock' : 'Lock (protects it from accidental moves)'} active={el.locked} onClick={() => set({ locked: !el.locked })} />
          <IconButton icon="copy" tip="Duplicate (Ctrl+D)" disabled={el.kind === 'photos'} onClick={() => st().duplicateSelected()} />
          <IconButton icon="reset" tip={isExtra ? 'Reset this layer’s moves and styling' : 'Reset this layer to the template'} disabled={!doc.overrides[key]} onClick={() => st().resetOverride(el.id)} />
          <IconButton icon="trash" tip={isExtra ? 'Delete layer (Del)' : 'Hide template element (Del)'} onClick={() => st().deleteSelected()} />
        </div>
        <AlignBar many={false} />
      </Panel>

      {el.kind === 'watermark' && (
        <Panel accordion={false} title="Icon" sub="Drag · resize corners" icon="watermark" id="insp-icon">
          <div className="grid2">
            <Scrub label="Size" value={el.size} min={40} max={3000} decimals={0} unit="px" onChange={(v) => set({ iconSize: v })} />
            <Scrub label="Stroke" value={el.strokeWidth} min={1} max={400} decimals={0} unit="px" onChange={(v) => set({ iconStroke: v })} />
            <Scrub label="X" value={el.ox} decimals={0} onChange={(v) => set({ iconDx: v - (el.ox - (o.iconDx ?? 0)) })} />
            <Scrub label="Y" value={el.oy} decimals={0} onChange={(v) => set({ iconDy: v - (el.oy - (o.iconDy ?? 0)) })} />
          </div>
          <Field label={`Blur · ${Math.round(el.blur ?? 0)} px`}><Slider value={el.blur ?? 0} min={0} max={120} step={1} onChange={(v) => set({ blur: v })} /></Field>
          <Field label={`Icon opacity · ${Math.round(el.maxOpacity * 100)}%`}><Slider value={Math.round(el.maxOpacity * 100)} min={0} max={100} onChange={(v) => set({ iconOpacity: v / 100 })} /></Field>
          <ColorField label="Colour" value={el.color} onChange={(c) => set({ color: c })} onReset={o.color !== undefined ? () => clear(['color']) : undefined} />
          <div className="row"><button className="btn sm ghost" onClick={() => st().resetOverride(el.id)}><Icon name="reset" size={13} />Reset icon</button></div>
        </Panel>
      )}

      <Panel accordion={false} title={el.kind === 'watermark' ? 'Clip area' : 'Transform'} icon="fit" id="insp-transform"
        actions={hasTransformOv ? <IconButton icon="reset" tip="Reset position & size to default" size={13} onClick={() => clear(['dx', 'dy', 'w', 'h'])} /> : undefined}>
        <div className="grid2">
          <Scrub label="X" value={el.x} onChange={(v) => place({ x: v })} />
          <Scrub label="Y" value={el.y} onChange={(v) => place({ y: v })} />
          <Scrub label="W" value={el.w} min={4} onChange={(v) => (ratio && el.kind !== 'text' ? place({ w: v, h: v / aspect }) : place({ w: v }))} />
          {el.kind === 'text' || el.kind === 'icon'
            ? <Scrub label="H" value={el.h} onChange={() => {}} className="readonly" title="Height follows the content" />
            : <Scrub label="H" value={el.h} min={4} onChange={(v) => (ratio ? place({ w: v * aspect, h: v }) : place({ h: v }))} />}
        </div>
        {el.kind !== 'text' && el.kind !== 'icon' && (
          <label className="switch inline"><input type="checkbox" aria-label="Keep proportions" checked={ratio} onChange={(e) => setRatio(e.target.checked)} /><i /><span><Icon name="link" size={12} /> Keep proportions</span></label>
        )}
        <ArrangeBar id={el.id} />
      </Panel>

      <Panel accordion={false} title="Appearance" icon="droplet" id="insp-appearance"
        actions={hasAppOv ? <IconButton icon="reset" tip="Reset appearance to default" size={13} onClick={() => clear(['opacity', 'fill', 'radius', ...(el.kind === 'icon' ? ['color' as const] : [])])} /> : undefined}>
        <Field label={`Opacity · ${Math.round(el.opacity * 100)}%`}><Slider value={Math.round(el.opacity * 100)} min={0} max={100} onChange={(v) => set({ opacity: v / 100 })} /></Field>
        {el.kind === 'rect' && typeof el.fill === 'string' && (
          <div className="grid2">
            <ColorField label="Fill" value={el.fill} onChange={(c) => set({ fill: c })} onReset={o.fill !== undefined ? () => clear(['fill']) : undefined} />
            <Scrub label="Radius" value={el.radius} min={0} onChange={(v) => set({ radius: v })} decimals={0} />
          </div>
        )}
        {el.kind === 'rect' && typeof el.fill !== 'string' && (
          <div className="row"><span className="muted">Gradient fill (template)</span><button className="btn sm" onClick={() => set({ fill: '#e8f5ee' })}>Replace with solid</button></div>
        )}
        {el.kind === 'icon' && el.ink && <ColorField label="Colour" value={el.ink} onChange={(c) => set({ color: c })} onReset={o.color !== undefined ? () => clear(['color']) : undefined} />}
      </Panel>

      {text && (
        <Panel accordion={false} title="Character" icon="type" id="insp-char"
          actions={hasCharOv ? <IconButton icon="reset" tip="Reset character styling to default" size={13} onClick={() => clear(['font', 'weight', 'size', 'ls', 'lh', 'align', 'color'])} /> : undefined}>
          <Field label="Font">
            <Select value={text.font ?? 'inter'} options={FONTS.map((f) => ({ value: f.id, label: f.name, hint: f.note }))} onChange={(v) => set({ font: v as FontId })} title="Font family" />
          </Field>
          <div className="grid2">
            <Select value={text.weight} options={WEIGHTS} onChange={(v) => set({ weight: v as 500 | 700 | 800 })} title="Font weight" />
            <Scrub label="Size" value={text.size} min={6} max={600} decimals={1} unit="px" onChange={(v) => set({ size: v })} />
            <Scrub label="Track" value={text.ls} step={0.1} decimals={1} unit="px" onChange={(v) => set({ ls: v })} />
            <Scrub label="Lead" value={text.lh ?? 121} min={60} max={300} decimals={0} unit="%" onChange={(v) => set({ lh: v })} title="Line height" />
          </div>
          <Seg className="block" value={text.align} onChange={(a) => st().setAlignText(el.id, a)} options={[
            { value: 'left', icon: 'alignTextLeft', label: 'Left' }, { value: 'center', icon: 'alignTextCenter', label: 'Centre' }, { value: 'right', icon: 'alignTextRight', label: 'Right' },
          ]} />
          <ColorField label="Colour" value={text.color} onChange={(c) => set({ color: c })} onReset={o.color !== undefined ? () => clear(['color']) : undefined} />
          {!CONTENT_DRIVEN.has(el.id) && (
            <Field label="Text"><textarea className="input" rows={2} value={text.text} onChange={(e) => set({ text: e.target.value })} /></Field>
          )}
          {el.id === 'headline' && o.size != null && <button className="btn sm" onClick={() => st().clearOverrideFields(el.id, ['size'])}><Icon name="reset" size={13} />Back to auto size</button>}
          {CONTENT_DRIVEN.has(el.id) && <p className="hint">Wording comes from the Story panel (double-click the text to jump there).</p>}
          <p className="hint">Tip: drag a label (Size, Track…) sideways to scrub the value. Shift = ×10, Alt = fine.</p>
        </Panel>
      )}

      {canStyleFx && (
        <Panel accordion={false} title="Effects" icon="sparkle" id="insp-fx" defaultOpen={false}
          actions={hasFxOv ? <IconButton icon="reset" tip="Reset effects to default" size={13} onClick={() => clear(['shadow', 'stroke'])} /> : undefined}>
          <Switch checked={!!el.dropShadow} onChange={(on) => set({ shadow: on ? DEFAULT_SHADOW : undefined })} label="Drop shadow" />
          {el.dropShadow && (
            <div className="grid2 sub">
              <Scrub label="X" value={el.dropShadow.x} decimals={0} onChange={(v) => set({ shadow: { ...el.dropShadow!, x: v } })} />
              <Scrub label="Y" value={el.dropShadow.y} decimals={0} onChange={(v) => set({ shadow: { ...el.dropShadow!, y: v } })} />
              <Scrub label="Blur" value={el.dropShadow.blur} min={0} decimals={0} onChange={(v) => set({ shadow: { ...el.dropShadow!, blur: v } })} />
              <Scrub label="Alpha" value={el.dropShadow.alpha * 100} min={0} max={100} decimals={0} unit="%" onChange={(v) => set({ shadow: { ...el.dropShadow!, alpha: v / 100 } })} />
              <ColorField label="Colour" value={el.dropShadow.color} onChange={(c) => set({ shadow: { ...el.dropShadow!, color: c } })} />
            </div>
          )}
          {canStroke && (
            <>
              <Switch checked={!!el.stroke} onChange={(on) => set({ stroke: on ? DEFAULT_STROKE : undefined })} label={el.kind === 'text' ? 'Outline' : 'Border'} />
              {el.stroke && (
                <div className="grid2 sub">
                  <Scrub label="Width" value={el.stroke.width} min={0.5} decimals={1} unit="px" onChange={(v) => set({ stroke: { ...el.stroke!, width: v } })} />
                  <ColorField label="Colour" value={el.stroke.color} onChange={(c) => set({ stroke: { ...el.stroke!, color: c } })} />
                </div>
              )}
            </>
          )}
        </Panel>
      )}
    </>
  )
}

// ================================================================== Dock: Elements + Layers
function useSceneEls() {
  const doc = useStore((s) => s.doc)
  const format = useStore((s) => s.format)
  const scene = useStore((s) => s.scene)
  return useMemo(() => scene().elements, [scene, doc, format])
}

/** Every part of the banner as a plain on/off switch. One switch can drive several template layers (the date is four). */
function ElementsList() {
  const els = useSceneEls()
  const selectedIds = useStore((s) => s.selectedIds)
  const st = useStore.getState
  const custom = useMemo(() => els.filter((e) => e.id.startsWith('x-')), [els])
  const rows = useMemo(() => ELEMENT_DEFS.map((d) => {
    const items = els.filter((e) => d.match(e.id) && !e.id.startsWith('x-'))
    return { d, ids: items.map((e) => e.id), on: items.some((e) => e.visible), present: items.length > 0 }
  }), [els])

  return (
    <>
      {ELEMENT_SECTIONS.map((sec) => {
        const mine = rows.filter((r) => r.d.section === sec)
        const live = mine.filter((r) => r.present)
        const onCount = live.filter((r) => r.on).length
        const allIds = live.flatMap((r) => r.ids)
        return (
          <div key={sec} role="group" aria-label={sec}>
            <div className="el-group">
              <span>{sec}</span><em>{onCount} of {live.length}</em>
              <Toggle small checked={onCount > 0} label={onCount > 0 ? `Hide all of ${sec}` : `Show all of ${sec}`} onChange={() => st().setVisible(allIds, onCount === 0)} />
            </div>
            {mine.map((r) => {
              const picked = r.ids.some((id) => selectedIds.includes(id))
              return (
                <div key={r.d.key} className={'el-row' + (picked ? ' on' : '') + (r.present && !r.on ? ' off' : '') + (!r.present ? ' absent' : '')}
                  onClick={() => { if (r.present) st().select(r.ids.find((id) => els.find((e) => e.id === id)?.visible) ?? r.ids[0]) }}>
                  <Icon name={r.d.icon} size={14} />
                  <span className="name" title={r.present ? r.d.label : `${r.d.label} — ${r.d.hint ?? 'not on this format'}`}>{r.d.label}</span>
                  {!r.present && <span className="note">{r.d.hint ? 'Not set' : 'n/a'}</span>}
                  <Toggle checked={r.on} disabled={!r.present} label={r.on ? `Hide ${r.d.label}` : `Show ${r.d.label}`} onChange={(v) => st().setVisible(r.ids, v)} />
                </div>
              )
            })}
          </div>
        )
      })}
      {custom.length > 0 && (
        <div role="group" aria-label="Custom layers">
          <div className="el-group">
            <span>Custom</span><em>{custom.filter((e) => e.visible).length} of {custom.length}</em>
            <Toggle small checked={custom.some((e) => e.visible)} label={custom.some((e) => e.visible) ? 'Hide all custom layers' : 'Show all custom layers'} onChange={() => st().setVisible(custom.map((e) => e.id), !custom.some((e) => e.visible))} />
          </div>
          {custom.map((e) => (
            <div key={e.id} className={'el-row' + (selectedIds.includes(e.id) ? ' on' : '') + (!e.visible ? ' off' : '')} onClick={() => st().select(e.id)}>
              <Icon name={KIND_ICON[e.kind]} size={14} />
              <span className="name" title={e.name}>{e.name}</span>
              <Toggle checked={e.visible} label={e.visible ? `Hide ${e.name}` : `Show ${e.name}`} onChange={(v) => st().setVisible([e.id], v)} />
            </div>
          ))}
        </div>
      )}
    </>
  )
}

function LayersList() {
  const doc = useStore((s) => s.doc)
  const format = useStore((s) => s.format)
  const selectedIds = useStore((s) => s.selectedIds)
  const select = useStore((s) => s.select)
  const toggleSelect = useStore((s) => s.toggleSelect)
  const setOverride = useStore((s) => s.setOverride)
  const els = useSceneEls()
  const st = useStore.getState
  const [q, setQ] = useState('')
  const [dragId, setDragId] = useState<string | null>(null)
  const [over, setOver] = useState<{ id: string; pos: 'above' | 'below' } | null>(null)
  const list = useMemo(() => [...els].reverse().filter((e) => !q || (e.name + ' ' + e.group).toLowerCase().includes(q.toLowerCase())), [els, q])

  const drop = () => {
    if (!dragId || !over || dragId === over.id) { setDragId(null); setOver(null); return }
    const ids = els.map((e) => e.id).filter((x) => x !== dragId) // z ascending
    const i = ids.indexOf(over.id)
    // list is top = highest z, so "above" a row means directly after it in z order
    const beforeId = over.pos === 'above' ? (ids[i + 1] ?? null) : over.id
    st().reorderLayer(dragId, beforeId)
    setDragId(null)
    setOver(null)
  }

  return (
    <>
      <div className="search"><Icon name="layers" size={13} /><input value={q} placeholder="Filter layers…" onChange={(e) => setQ(e.target.value)} />{q && <button onClick={() => setQ('')}><Icon name="x" size={12} /></button>}</div>
      <div className="layers" onDragLeave={() => setOver(null)}>
        {list.map((e) => {
          const o = doc.overrides[`${format}:${e.id}`]
          const isSel = selectedIds.includes(e.id)
          return (
            <div key={e.id}
              className={'layer' + (isSel ? ' on' : '') + (!e.visible ? ' off' : '') + (dragId === e.id ? ' dragging' : '') + (over?.id === e.id ? ' drop-' + over.pos : '')}
              draggable={!q}
              onDragStart={(ev) => { setDragId(e.id); ev.dataTransfer.effectAllowed = 'move' }}
              onDragOver={(ev) => { if (!dragId) return; ev.preventDefault(); const r = (ev.currentTarget as HTMLElement).getBoundingClientRect(); setOver({ id: e.id, pos: ev.clientY < r.top + r.height / 2 ? 'above' : 'below' }) }}
              onDrop={(ev) => { ev.preventDefault(); drop() }}
              onDragEnd={() => { setDragId(null); setOver(null) }}
              onClick={(ev) => (ev.shiftKey || ev.ctrlKey || ev.metaKey ? toggleSelect(e.id) : select(e.id))}>
              <Icon name="grip" size={12} className="grip" />
              <Icon name={KIND_ICON[e.kind]} size={13} className="kind" />
              <span className="name" title={e.name}>{e.name}</span>
              {e.id.startsWith('x-') && <span className="tag">custom</span>}
              {o && <i className="dot" title="Changed from the template" />}
              <button className="icon-btn reset" disabled={!o} title="Reset this layer" onClick={(ev) => { ev.stopPropagation(); st().resetOverride(e.id) }}><Icon name="reset" size={13} /></button>
              <button className="icon-btn" title={e.locked ? 'Unlock' : 'Lock'} onClick={(ev) => { ev.stopPropagation(); setOverride(e.id, { locked: !e.locked }) }}><Icon name={e.locked ? 'lock' : 'unlock'} size={13} /></button>
              <button className="icon-btn" title={e.visible ? 'Hide' : 'Show'} onClick={(ev) => { ev.stopPropagation(); setOverride(e.id, { visible: !e.visible }) }}><Icon name={e.visible ? 'eye' : 'eyeOff'} size={13} /></button>
            </div>
          )
        })}
        {list.length === 0 && <p className="hint">No layers match “{q}”.</p>}
      </div>
    </>
  )
}

/** Bottom of the right column (its height is draggable): the banner's parts as switches, or the raw layer stack. */
export function Dock({ children }: { children?: ReactNode }) {
  const doc = useStore((s) => s.doc)
  const format = useStore((s) => s.format)
  const resetAll = useStore((s) => s.resetAllOverrides)
  const els = useSceneEls()
  const st = useStore.getState
  const [tab, setTab] = useState<'elements' | 'layers'>(() => { try { return localStorage.getItem('esb-banner-studio/dock-tab') === 'layers' ? 'layers' : 'elements' } catch { return 'elements' } })
  const pick = (t: 'elements' | 'layers') => { setTab(t); try { localStorage.setItem('esb-banner-studio/dock-tab', t) } catch { /* ignore */ } }
  const hidden = els.filter((e) => !e.visible && !e.id.startsWith('x-'))
  const hasAny = Object.keys(doc.overrides).some((k) => k.startsWith(format + ':'))

  return (
    <section className="dock" aria-label="Elements and layers">
      {children}
      <div className="dock-tabs" role="tablist">
        <button role="tab" aria-selected={tab === 'elements'} className={tab === 'elements' ? 'on' : ''} onClick={() => pick('elements')}>Elements{hidden.length > 0 && <span className="badge" title={`${hidden.length} hidden`}>{hidden.length} off</span>}</button>
        <button role="tab" aria-selected={tab === 'layers'} className={tab === 'layers' ? 'on' : ''} onClick={() => pick('layers')}>Layers<span className="badge">{els.length}</span></button>
        <div className="dock-actions">
          {tab === 'elements'
            ? <button className="btn sm ghost" disabled={!hidden.length} onClick={() => st().setVisible(hidden.map((e) => e.id), true)}><Icon name="eye" size={13} />Show all</button>
            : <>
              <IconButton icon="plus" tip="Add text layer (T)" onClick={() => st().addText()} />
              <IconButton icon="square" tip="Add rectangle (R)" onClick={() => st().addRect()} />
              <IconButton icon="reset" tip="Reset every manual change on this banner" disabled={!hasAny} onClick={resetAll} />
            </>}
        </div>
      </div>
      <div className="dock-body" role="tabpanel">{tab === 'elements' ? <ElementsList /> : <LayersList />}</div>
    </section>
  )
}

export { round }
