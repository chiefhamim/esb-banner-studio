// Video bin → Titles, and the title parts of the clip inspector.
//
// The Titles tab holds the ESB title kit (each starts with empty fields: the editor types every word), the in-house
// stickers and shapes, the accent the next title takes (the story's category or the ESB stripes), the safe-zone
// guides for the monitor, shortcuts that set a title from the Editorial draft (the headline, a quote the editor
// selects — word for word), the logo and the adjustment layer. The inspector shows a title's fields, then a "Title"
// section with its accent, feed zones, style and in/out animation (or a sticker's shape, colour and place).

import { useEffect, useMemo, useRef, useState } from 'react'
import { useEditorialStore } from '../editorial/editorialStore'
import { useStore } from '../store'
import { CATEGORIES, getCategory } from '../core/tokens'
import { Icon } from '../ui/Icon'
import { ColorField, Select, Seg, Slider, Switch } from '../ui/controls'
import type { Opt } from '../ui/controls'
import { useVideoStore } from './videoStore'
import type { Clip } from './timeline'
import { accentFor, newTitleClip, quotesIn, useTitleUi } from './titleUi'
import {
  ANIM_PRESETS, CLASSIC_FIELDS, EASES, STICKER_COLORS, STICKER_SHAPES, TITLE_TEMPLATES, defaultOverride, fieldsOf,
  type AnimOverride, type PlatformChoice, type StickerColor, type StickerShape, type TitleData, type TitleTemplate,
} from './titleModel'
import { measureNow, titleProblems } from './titleClip'
import { AdjustmentPresetCard, FxSection, useInspectorUi } from './EffectsPanel'
import type { Platform } from './titles/brand'

const KIT: TitleTemplate[] = ['lower-third', 'name-strap', 'headline', 'breaking', 'quote', 'source', 'end-card']

export function TitlesTab({ bug, onBug, onAddLogo }: { bug: boolean; onBug: (on: boolean) => void; onAddLogo: () => void }) {
  const addClip = useVideoStore((s) => s.addClip)
  const aspect = useVideoStore((s) => s.project.aspect)
  const { accent, guides, platform } = useTitleUi()
  const draft = useEditorialStore((s) => s.draft)
  const storyCat = useStore((s) => s.doc.content.categoryId) ?? null
  const hasStory = !!draft.headline.trim()
  const cat = hasStory ? storyCat : null
  const [sel, setSel] = useState('')
  const bodyRef = useRef<HTMLTextAreaElement>(null)
  const quotes = useMemo(() => quotesIn(`${draft.deck}\n${draft.body}`), [draft.deck, draft.body])

  const add = (template: TitleTemplate, fields: Record<string, string> = {}, extra: Partial<TitleData> = {}) => {
    const categoryId = accentFor(accent, cat)
    addClip(newTitleClip(template, fields, { ...(categoryId ? { categoryId } : {}), ...extra }))
  }
  const addSticker = (shape: StickerShape) => add('sticker', {}, { sticker: { shape, color: shape === 'highlight' ? 'yellow' : 'red', x: 0.5, y: 0.5, size: shape === 'callout' ? 0.42 : 0.3, rotation: 0 } })
  const takeSelection = () => {
    const el = bodyRef.current
    const s = el ? el.value.slice(el.selectionStart, el.selectionEnd) : ''
    setSel(s.replace(/\s+/g, ' ').trim().replace(/^[“"']+|[”"']+$/g, ''))
  }
  const accentOpts: Opt<string>[] = [
    { value: 'auto', label: hasStory && storyCat ? `Story · ${getCategory(storyCat).name}` : 'Story (none open)', swatch: hasStory && storyCat ? getCategory(storyCat).accent : undefined },
    { value: 'stripes', label: 'ESB stripes' },
    ...CATEGORIES.map((c) => ({ value: c.id, label: c.name, swatch: c.accent })),
  ]

  return (
    <div className="vw-preset-list vw-titles-tab">
      <div className="vw-tt-opts">
        <div className="vw-tt-row vw-tt-accentrow">
          <span className="vw-tt-label">Accent</span>
          <Select<string> className="vw-tt-accent" value={accent} options={accentOpts} onChange={(v) => useTitleUi.setState({ accent: v })} />
        </div>
        <div className="vw-tt-chips vw-tt-guides">
          <button type="button" role="switch" aria-checked={bug} className="vw-tt-chip" data-chip="bug" onClick={() => onBug(!bug)} data-tip="The ESB bug, top right of every frame">ESB bug</button>
          <button type="button" role="switch" aria-checked={guides} className="vw-tt-chip" data-chip="guides" onClick={() => useTitleUi.setState({ guides: !guides })} data-tip="Safe zones on the monitor (never in the export)">Safe zones</button>
          {aspect === '9:16' && guides && <Seg<Platform> className="vw-tt-platform" value={platform} onChange={(v) => useTitleUi.setState({ platform: v })} options={[{ value: 'reels', label: 'Reels' }, { value: 'shorts', label: 'Shorts' }]} />}
        </div>
      </div>

      <div className="vw-subhead">ESB title kit</div>
      <p className="vw-preset-intro" data-tip="Empty fields show their label, dimmed, on the monitor only; they are never exported.">Starts empty: type its words in the inspector.</p>
      {KIT.map((t) => {
        const d = TITLE_TEMPLATES[t]
        return (
          <div key={t} className="vw-preset-card" data-preset={t}>
            <div className="vw-preset-header">
              <span className="vw-tag" data-tag={t}>{d.label}</span>
              <button type="button" className="btn xs" onClick={() => add(t)}><Icon name="plus" size={12} />Add</button>
            </div>
            <p className="vw-preset-desc">{d.desc}</p>
          </div>
        )
      })}

      <div className="vw-subhead">From the story</div>
      {!hasStory ? <p className="vw-preset-desc vw-tt-note">Open a story on the Editorial desk to set titles from its headline and quotes.</p> : (
        <div className="vw-preset-card vw-tt-story">
          <div className="vw-preset-header">
            <span className="vw-tt-story-head" data-tip={draft.headline}>{draft.headline}</span>
            <button type="button" className="btn xs vw-tt-headline" onClick={() => add('headline', { headline: draft.headline })}><Icon name="plus" size={12} />Headline card</button>
          </div>
          {quotes.length > 0 && (
            <div className="vw-tt-quotes" role="list" aria-label="Quotes in the story">
              {quotes.map((q) => <button key={q} type="button" role="listitem" className={`vw-tt-quote${sel === q ? ' on' : ''}`} onClick={() => setSel(q)}>“{q}”</button>)}
            </div>
          )}
          <textarea ref={bodyRef} className="vw-tt-body" readOnly value={draft.body} rows={4} aria-label="The story: select a quote" onSelect={takeSelection} onMouseUp={takeSelection} onKeyUp={takeSelection} />
          <div className="vw-tt-quote-row">
            <span className="vw-preset-desc">{sel ? `Quote: “${sel.length > 90 ? sel.slice(0, 88)  : sel}”` : quotes.length ? 'Pick a quote above or select one in the story.' : 'Select a quote in the story text above.'}</span>
            <button type="button" className="btn xs vw-tt-quotecard" disabled={!sel} onClick={() => add('quote', { quote: sel })}><Icon name="plus" size={12} />Quote card</button>
          </div>
        </div>
      )}

      <div className="vw-subhead">Stickers and shapes</div>
      <div className="vw-sticker-grid">
        {STICKER_SHAPES.map((s) => (
          <button key={s.shape} type="button" className="vw-sticker-btn" data-shape={s.shape} onClick={() => addSticker(s.shape)} data-tip={`Add a ${s.label.toLowerCase()} at the playhead`}>
            <StickerIcon shape={s.shape} />
            <span>{s.label}</span>
          </button>
        ))}
      </div>

      <div className="vw-subhead">Brand</div>
      <div className="vw-preset-card" data-preset="logo">
        <div className="vw-preset-header">
          <span className="vw-tag" data-tag="logo">Logo</span>
          <button type="button" className="btn xs" onClick={onAddLogo}><Icon name="plus" size={12} />Add</button>
        </div>
        <p className="vw-preset-desc">The official ESB Power Line logo, at its own proportions.</p>
      </div>
      <div className="vw-preset-card vw-planned" data-preset="intro">
        <div className="vw-preset-header">
          <span className="vw-tag" data-tag="intro">Intro bumper</span>
          <span className="vw-planned-chip">Planned</span>
        </div>
        <p className="vw-preset-desc">Planned — needs the approved intro render. The 8 s logo intro comes here once the owner approves its final render.</p>
      </div>
      <AdjustmentPresetCard />
    </div>
  )
}

function StickerIcon({ shape }: { shape: StickerShape }) {
  const p = { fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const }
  return (
    <svg viewBox="0 0 32 20" width={32} height={20} aria-hidden="true">
      {shape === 'arrow' && <><path d="M3 10h22" {...p} /><path d="M20 4l7 6-7 6z" fill="currentColor" /></>}
      {shape === 'circle' && <ellipse cx="16" cy="10" rx="12" ry="7.5" {...p} />}
      {shape === 'highlight' && <><rect x="3" y="5" width="26" height="10" rx="2" fill="#facc15" /><path d="M7 10h18" stroke="#1c1917" strokeWidth="2" strokeLinecap="round" /></>}
      {shape === 'underline' && <path d="M4 15h24" {...p} strokeWidth={2.5} />}
      {shape === 'box' && <rect x="4" y="3" width="24" height="14" rx="3" {...p} />}
      {shape === 'callout' && <path d="M5 3h22a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H12l-5 4v-4H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z" {...p} />}
    </svg>
  )
}

// ------------------------------------------------------------------ inspector

/** The title's words, at the top of the inspector. */
export function TitleFields({ clip }: { clip: Clip; onChange?: (c: Clip) => void }) {
  const td = clip.titleData!
  const defs = fieldsOf(td)
  const w = useVideoStore((s) => s.project.width)
  const h = useVideoStore((s) => s.project.height)
  // typing is one undo step per field (a run of keystrokes in one field coalesces); leaving the field closes the step
  const set = (key: string, v: string) => useVideoStore.getState().updateClipCoalesced({ ...clip, titleData: { ...td, fields: { ...td.fields, [key]: v } } }, `field:${key}`)
  const close = () => useVideoStore.getState().endCoalesce()
  const problems = useMemo(() => titleProblems({ clips: [clip], width: w, height: h }, measureNow())[0]?.messages ?? [], [clip, w, h])
  const anyEmpty = defs.some((d) => !(td.fields[d.key] ?? '').trim())
  return (
    <div className="vw-title-fields">
      {defs.map((d) => (
        <div key={d.key} className="vw-field" data-field={d.key}>
          <label htmlFor={`vw-tf-${d.key}`}>{d.label}{d.required && <em className="vw-req" aria-label="required">Required</em>}</label>
          {d.multiline
            ? <textarea id={`vw-tf-${d.key}`} className="vw-tf" rows={3} value={td.fields[d.key] ?? ''} placeholder={d.label} onChange={(e) => set(d.key, e.target.value)} onBlur={close} />
            : <input id={`vw-tf-${d.key}`} type="text" className="vw-tf" value={td.fields[d.key] ?? ''} placeholder={d.label} onChange={(e) => set(d.key, e.target.value)} onBlur={close} onKeyDown={(e) => { if (e.key === 'Enter') close() }} />}
        </div>
      ))}
      {td.template === 'end-card' && <p className="vw-hint">The end card carries only the brand: the logo, esbpowerline.com and the Facebook and YouTube handles.</p>}
      {anyEmpty && defs.length > 0 && <p className="vw-hint">An empty field shows its label on the monitor only; it is never drawn into the export.</p>}
      {problems.length > 0 && (
        <div className="vw-title-problems" role="status">
          <Icon name="info" size={12} />
          <span>Export is blocked until: {problems.join('; ')}</span>
        </div>
      )}
    </div>
  )
}

const ANIM_OPTS: Opt<string>[] = [{ value: 'kit', label: 'ESB kit (default)' }, ...ANIM_PRESETS.map((p) => ({ value: p.id, label: p.label }))]
const EASE_OPTS: Opt<string>[] = EASES.map((e) => ({ value: e.id, label: e.label }))

function AnimRows({ which, o, onChange }: { which: 'in' | 'out'; o: AnimOverride | undefined; onChange: (o: AnimOverride | undefined) => void }) {
  const preset = o?.preset ?? 'kit'
  const typeOn = preset === 'type-on'
  const staggered = ['type-on', 'word', 'line', 'mask'].includes(preset)
  return (
    <div className={`vw-anim vw-anim-${which}`}>
      <div className="vw-field vw-field-row">
        <label>{which === 'in' ? 'Words in' : 'Words out'}</label>
        <Select<string> className={`vw-anim-preset vw-anim-${which}-preset`} value={preset} options={ANIM_OPTS} onChange={(v) => onChange(v === 'kit' ? undefined : defaultOverride(v as AnimOverride['preset'], which === 'out'))} />
      </div>
      {o && o.preset !== 'none' && (
        <>
          {!typeOn && <div className="vw-field"><label>Duration <em>{o.duration.toFixed(2)} s</em></label><Slider className={`vw-s-anim-dur-${which}`} min={0.05} max={2} step={0.05} value={o.duration} onChange={(v) => onChange({ ...o, duration: v })} /></div>}
          <div className="vw-field"><label>Delay <em>{o.delay.toFixed(2)} s</em></label><Slider className={`vw-s-anim-delay-${which}`} min={0} max={3} step={0.05} value={o.delay} onChange={(v) => onChange({ ...o, delay: v })} /></div>
          {staggered && <div className="vw-field"><label>{typeOn ? 'Per letter' : 'Stagger'} <em>{o.stagger.toFixed(3)} s</em></label><Slider className={`vw-s-anim-stagger-${which}`} min={typeOn ? 0.01 : 0} max={typeOn ? 0.2 : 0.5} step={0.005} value={o.stagger} onChange={(v) => onChange({ ...o, stagger: v })} /></div>}
          {!typeOn && <div className="vw-field vw-field-row"><label>Ease</label><Select<string> className={`vw-anim-ease-${which}`} value={o.ease} options={EASE_OPTS} onChange={(v) => onChange({ ...o, ease: v as AnimOverride['ease'] })} /></div>}
        </>
      )}
    </div>
  )
}

const COLOR_OPTS = (Object.keys(STICKER_COLORS) as StickerColor[]).map((k) => ({ k, ...STICKER_COLORS[k] }))

/** The "Title" section of the inspector: accent, feed zones, style and animation (or a sticker's shape and place). */
export function TitleSection({ clip, onChange }: { clip: Clip; onChange: (c: Clip) => void }) {
  const td = clip.titleData!
  const aspect = useVideoStore((s) => s.project.aspect)
  // a title opens on its own section (its words and look are what the editor came for)
  // (opened without scrolling to it: the fields above stay in view)
  useEffect(() => { useInspectorUi.setState({ open: 'title' }) }, [clip.id])
  const setTd = (patch: Partial<TitleData>) => onChange({ ...clip, titleData: { ...td, ...patch } })
  const style = td.style ?? {}
  const setStyle = (patch: Partial<NonNullable<TitleData['style']>>) => {
    const next = { ...style, ...patch }
    for (const k of Object.keys(next) as (keyof typeof next)[]) if (next[k] === undefined || next[k] === false) delete next[k]
    setTd({ style: Object.keys(next).length ? next : undefined })
  }
  const accentOpts: Opt<string>[] = [{ value: '', label: clip.accent ? 'The story’s accent' : 'ESB stripes', swatch: clip.accent }, ...CATEGORIES.map((c) => ({ value: c.id, label: c.name, swatch: c.accent }))]
  const classic = td.look === 'classic'
  const kitOf: Partial<Record<string, TitleTemplate>> = { 'lower-third': 'lower-third', headline: 'headline', breaking: 'breaking' }
  const toKit = () => {
    const tpl = td.classic ? kitOf[td.classic] : undefined
    if (!tpl || !td.classic) return
    const [a, b] = CLASSIC_FIELDS[td.classic]
    const fields: Record<string, string> = {}
    for (const d of TITLE_TEMPLATES[tpl].fields) fields[d.key] = ''
    fields[a.key] = td.fields[a.key] ?? ''
    fields[b.key] = td.fields[b.key] ?? ''
    onChange({ ...clip, titleData: { template: tpl, fields, ...(td.categoryId ? { categoryId: td.categoryId } : {}) } })
  }
  return (
    <FxSection id="title" title={td.template === 'sticker' ? 'Sticker' : 'Title'} icon="type" bare>
      {classic ? (
        <div className="vw-title-classic">
          <p className="vw-hint">Classic look, from an earlier version of the desk: drawn exactly as before, without animation.</p>
          {td.classic && kitOf[td.classic] && <button type="button" className="btn sm vw-to-kit" onClick={toKit}><Icon name="sparkle" size={12} />Use the ESB kit look</button>}
        </div>
      ) : td.template === 'sticker' && td.sticker ? (
        <>
          <div className="vw-field vw-field-row"><label>Shape</label><Select<string> className="vw-st-shape" value={td.sticker.shape} options={STICKER_SHAPES.map((s) => ({ value: s.shape, label: s.label }))} onChange={(v) => setTd({ sticker: { ...td.sticker!, shape: v as StickerShape }, fields: v === 'callout' ? { text: td.fields.text ?? '' } : {} })} /></div>
          <div className="vw-field"><label>Colour</label>
            <div className="vw-st-colors" role="radiogroup" aria-label="Sticker colour">
              {COLOR_OPTS.map((c) => <button key={c.k} type="button" role="radio" aria-checked={td.sticker!.color === c.k} className={`vw-st-color${td.sticker!.color === c.k ? ' on' : ''}`} data-tip={c.label} style={{ background: c.hex ?? (clip.accent || (td.categoryId ? getCategory(td.categoryId).accent : '#e52d2d')) }} onClick={() => setTd({ sticker: { ...td.sticker!, color: c.k } })} />)}
            </div>
          </div>
          <div className="vw-field"><label>Across <em>{Math.round(td.sticker.x * 100)}%</em></label><Slider className="vw-s-st-x" min={0} max={1} step={0.01} value={td.sticker.x} onChange={(v) => setTd({ sticker: { ...td.sticker!, x: v } })} /></div>
          <div className="vw-field"><label>Down <em>{Math.round(td.sticker.y * 100)}%</em></label><Slider className="vw-s-st-y" min={0} max={1} step={0.01} value={td.sticker.y} onChange={(v) => setTd({ sticker: { ...td.sticker!, y: v } })} /></div>
          <div className="vw-field"><label>Size <em>{Math.round(td.sticker.size * 100)}%</em></label><Slider className="vw-s-st-size" min={0.05} max={0.9} step={0.01} value={td.sticker.size} onChange={(v) => setTd({ sticker: { ...td.sticker!, size: v } })} /></div>
          <div className="vw-field"><label>Turn <em>{Math.round(td.sticker.rotation)}°</em></label><Slider className="vw-s-st-rot" min={-180} max={180} step={1} value={td.sticker.rotation} onChange={(v) => setTd({ sticker: { ...td.sticker!, rotation: v } })} /></div>
        </>
      ) : (
        <>
          <div className="vw-field vw-field-row"><label>Accent</label><Select<string> className="vw-title-accent" value={td.categoryId ?? ''} options={accentOpts} onChange={(v) => setTd({ categoryId: v || undefined })} /></div>
          {aspect === '9:16' && (
            <div className="vw-field vw-field-row"><label>Keep clear of</label>
              <Seg<PlatformChoice> className="vw-title-platform" value={td.platform ?? 'auto'} onChange={(v) => setTd({ platform: v === 'auto' ? undefined : v })} options={[{ value: 'auto', label: 'Reels', tip: 'Reels zones (the default for 9:16)' }, { value: 'shorts', label: 'Shorts' }, { value: 'none', label: 'None' }]} />
            </div>
          )}
          <div className="vw-subhead">Style of the words</div>
          <div className="vw-field vw-field-row"><label>Fill</label><ColorField className="vw-title-fill" value={style.fill ?? '#f4f4f5'} onChange={(c) => setStyle({ fill: c })} onReset={() => setStyle({ fill: undefined, fill2: undefined })} /></div>
          <Switch checked={!!style.fill2} onChange={(on) => setStyle({ fill2: on ? '#ec8e3c' : undefined, fill: style.fill ?? (on ? '#f4f4f5' : undefined) })} label="Gradient" />
          {style.fill2 && <div className="vw-field vw-field-row"><label>Gradient to</label><ColorField className="vw-title-fill2" value={style.fill2} onChange={(c) => setStyle({ fill2: c })} /></div>}
          <Switch checked={!!style.stroke} onChange={(on) => setStyle({ stroke: on ? '#0e0e12' : undefined, strokeWidth: on ? 3 : undefined })} label="Outline" />
          {style.stroke && (
            <>
              <div className="vw-field vw-field-row"><label>Outline colour</label><ColorField className="vw-title-stroke" value={style.stroke} onChange={(c) => setStyle({ stroke: c })} /></div>
              <div className="vw-field"><label>Outline width <em>{(style.strokeWidth ?? 3).toFixed(1)} px</em></label><Slider className="vw-s-stroke" min={0.5} max={12} step={0.5} value={style.strokeWidth ?? 3} onChange={(v) => setStyle({ strokeWidth: v })} /></div>
            </>
          )}
          <Switch checked={!!style.shadow} onChange={(on) => setStyle({ shadow: on || undefined })} label="Shadow" />
          <Switch checked={!!style.box} onChange={(on) => setStyle({ box: on ? '#0e0e12' : undefined })} label="Box behind the words" />
          {style.box && <div className="vw-field vw-field-row"><label>Box colour</label><ColorField className="vw-title-box" value={style.box} onChange={(c) => setStyle({ box: c })} /></div>}
          <div className="vw-subhead">Animation</div>
          <AnimRows which="in" o={td.animIn} onChange={(o) => setTd({ animIn: o })} />
          <AnimRows which="out" o={td.animOut} onChange={(o) => setTd({ animOut: o })} />
          <p className="vw-hint">The panel, bars and brand words keep the kit’s motion; these choices move the title’s own words. Word-by-word karaoke timing comes with transcripts (Phase 5).</p>
        </>
      )}
    </FxSection>
  )
}
