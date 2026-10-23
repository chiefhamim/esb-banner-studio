// Graphics rail for the Editorial Desk: Companion preview (Banner 4:5 · Web Article · Facebook Feed)
// Everything here edits the same document Graphics Studio uses, with live link sync into the editorial draft.

import { useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { useStore } from '../store'
import { useEditorialStore } from './editorialStore'
import { useShellStore } from '../shell/shellStore'
import { BannerCanvas, FacebookMock } from '../components/PreviewPanel'
import { FormatPicker } from '../components/FormatPicker'
import { Icon } from '../ui/Icon'
import { Field, Select, Switch } from '../ui/controls'
import { CATEGORIES, FORMATS, getFormat } from '../core/tokens'
import { LABEL_PRESETS, defaultCaption, suggestHighlight } from '../core/newsroom'
import type { LabelPresetId } from '../core/newsroom'
import type { Assets } from '../core/render'
import { DEFAULT_SETTINGS, copyToClipboard, runExport, humanBytes } from '../export'
import { bannerImageIdForUrl, importImageToBanner, syncArticlePhotosToBanner } from './automation'
import logoUrl from '../assets/images/esb-logo.png'
import avatarUrl from '../assets/images/esb-avatar.png'

const labelOptions = [
  { value: 'none', label: 'No label' },
  ...(Object.keys(LABEL_PRESETS) as LabelPresetId[]).map((id) => ({ value: id as string, label: LABEL_PRESETS[id].name })),
]

interface PhotoChoice {
  key: string
  thumb: string
  title: string
  active: boolean
  pick: () => void
}

export function GraphicsRail({ base, onToast }: { base: Assets; onToast: (msg: string) => void }) {
  const format = useStore((s) => s.format)
  const setFormat = useStore((s) => s.setFormat)
  const content = useStore((s) => s.doc.content)
  const slot0 = useStore((s) => s.doc.photos.slots[s.format][0])
  const images = useStore((s) => s.images)
  const source = useEditorialStore((s) => s.source)
  const draft = useEditorialStore((s) => s.draft)
  const staffSession = useEditorialStore((s) => s.staffSession)
  const bannerLink = useEditorialStore((s) => s.bannerLink)
  const deskAuto = useEditorialStore((s) => s.deskAuto)
  const setBannerLink = useEditorialStore((s) => s.setBannerLink)
  const setDesk = useEditorialStore((s) => s.setDesk)
  const autoDetectDesk = useEditorialStore((s) => s.autoDetectDesk)
  const applyDraftToBanner = useEditorialStore((s) => s.applyDraftToBanner)
  const setWorkspace = useShellStore((s) => s.setWorkspace)

  // Preview tab switcher: Banner 4:5 · Web Article · Facebook Feed
  const [railTab, setRailTab] = useState<'banner' | 'article' | 'facebook'>('banner')
  const [previewDevice, setPreviewDevice] = useState<'desktop' | 'mobile'>('desktop')
  const [previewTheme, setPreviewTheme] = useState<'dark' | 'light'>('dark')

  const stageRef = useRef<HTMLDivElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const [box, setBox] = useState({ w: 320, h: 420 })
  const [dropping, setDropping] = useState(false)
  const [busy, setBusy] = useState<null | 'export' | 'copy'>(null)

  // Fit the banner into the stage: responsive without pushing controls off screen.
  useEffect(() => {
    const el = stageRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setBox({ w: el.clientWidth, h: el.clientHeight }))
    ro.observe(el)
    setBox({ w: el.clientWidth, h: el.clientHeight })
    return () => ro.disconnect()
  }, [])

  const fmt = getFormat(format)
  const ratio = FORMATS[format].w / FORMATS[format].h
  const stageW = Math.max(120, Math.min(box.w - 24, (box.h - 24) * ratio))

  const cat = CATEGORIES.find((c) => c.id === content.categoryId) || CATEGORIES[0]
  const slotImage = slot0?.src ? images.find((i) => i.id === slot0.src) : undefined
  const bannerLeadImage = slotImage?.url || null
  const generatedCaption = useMemo(() => defaultCaption({ ...content }), [content])
  const caption = content.caption ?? generatedCaption

  const wordCount = useMemo(() => {
    return draft.body.trim() ? draft.body.trim().split(/\s+/).filter(Boolean).length : 0
  }, [draft.body])
  const readTimeMin = Math.max(1, Math.ceil(wordCount / 200))

  // Photo choices: story photos first, then banner library
  const choices: PhotoChoice[] = useMemo(() => {
    const out: PhotoChoice[] = []
    const used = new Set<string>()
    const st = useStore.getState()
    ;(source?.images ?? []).slice(0, 8).forEach((img, i) => {
      const id = bannerImageIdForUrl(img.src)
      if (id) used.add(id)
      out.push({
        key: 'src-' + img.src,
        thumb: img.src,
        title: i === 0 ? 'Story lead photo' : `Story photo ${i + 1}`,
        active: !!id && slot0?.src === id,
        pick: () => { void importImageToBanner(img.src, `story-photo-${i + 1}.jpg`, { slotIndex: 0 }) },
      })
    })
    for (const im of images) {
      if (used.has(im.id)) continue
      out.push({
        key: im.id,
        thumb: im.url,
        title: im.name,
        active: slot0?.src === im.id,
        pick: () => {
          if (st.doc.photos.collage !== 'single') st.setCollage('single')
          useStore.getState().assignImage(0, im.id)
        },
      })
    }
    return out
  }, [source?.images, images, slot0?.src])

  const addFiles = async (files: File[]) => {
    const pics = files.filter((f) => f.type.startsWith('image/'))
    if (!pics.length) { onToast('Drop an image file (JPG, PNG, WebP)'); return }
    const before = useStore.getState().images.length
    await useStore.getState().addImages(pics.slice(0, 1))
    const st = useStore.getState()
    const added = st.images[st.images.length - 1]
    if (added && st.images.length > before) {
      if (st.doc.photos.collage !== 'single') st.setCollage('single')
      st.assignImage(0, added.id)
      onToast('Photo placed on the banner')
    }
  }

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

  const handleSendToBanner = () => {
    applyDraftToBanner()
    if (source?.images && source.images.length > 0) {
      void syncArticlePhotosToBanner(source.images)
    }
    onToast('Banner updated from the draft')
  }

  const noPhoto = !slotImage

  return (
    <aside className="ed-rail" style={{ ['--cat' as string]: cat.accent } as CSSProperties} aria-label="Editorial Preview Rail">
      {/* 1. Header with Tab Bar & Companion Sync */}
      <div className="ed-rail-head">
        <div className="rail-tab-bar" style={{ borderBottom: 'none', padding: 0, background: 'transparent' }}>
          <button
            type="button"
            className={`rail-tab-btn ${railTab === 'banner' ? 'active' : ''}`}
            onClick={() => setRailTab('banner')}
            title="Live Graphic Banner Preview"
          >
            <Icon name="image" size={12} />
            <span>Banner</span>
          </button>
          <button
            type="button"
            className={`rail-tab-btn ${railTab === 'article' ? 'active' : ''}`}
            onClick={() => setRailTab('article')}
            title="Website Article Reader Preview"
          >
            <Icon name="globe" size={12} />
            <span>Web Article</span>
          </button>
          <button
            type="button"
            className={`rail-tab-btn ${railTab === 'facebook' ? 'active' : ''}`}
            onClick={() => setRailTab('facebook')}
            title="Facebook Feed Post Preview"
          >
            <Icon name="externalLink" size={12} />
            <span>Facebook</span>
          </button>
        </div>

        <div className="row" style={{ gap: 6, alignItems: 'center' }}>
          <button
            type="button"
            className="btn xs ghost"
            onClick={handleSendToBanner}
            title="Sync headline and story photos to the banner"
          >
            <Icon name="refresh" size={11} />
            <span>Send to Banner</span>
          </button>
          <button
            type="button"
            className={'ed-link-pill' + (bannerLink ? ' on' : '')}
            onClick={() => { setBannerLink(!bannerLink); onToast(bannerLink ? 'Live link paused' : 'Live link on — headline, credit and caption stay in step') }}
            title={bannerLink ? 'Draft and banner stay in step. Click to pause.' : 'Paused. Click to resume live sync.'}
            aria-pressed={bannerLink}
          >
            <Icon name="link" size={11} />
            <span>{bannerLink ? 'Live link' : 'Paused'}</span>
          </button>
          <button
            type="button"
            className="btn xs ghost"
            onClick={() => setWorkspace('graphics')}
            title="Open full Graphics Studio"
          >
            <span>Graphics Studio</span>
            <Icon name="chevRight" size={12} />
          </button>
        </div>
      </div>

      <div className="ed-rail-scroll scroll">
        {/* =========================================================
            STAGE VIEW: Switches between Banner, Web Article, Facebook
            ========================================================= */}
        {railTab === 'banner' && (
          <>
            <div className="ed-rail-format">
              <FormatPicker value={format} onChange={setFormat} />
            </div>

            <div
              ref={stageRef}
              className={'ed-rail-stage' + (dropping ? ' dropping' : '')}
              onDragOver={(e) => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); setDropping(true) } }}
              onDragLeave={() => setDropping(false)}
              onDrop={(e) => { e.preventDefault(); setDropping(false); void addFiles(Array.from(e.dataTransfer.files)) }}
            >
              <div className="ed-rail-canvas" style={{ width: stageW }}>
                <BannerCanvas base={base} cssWidth={Math.round(stageW)} interactive />
              </div>
              {dropping && <div className="ed-rail-drop"><Icon name="upload" size={18} /><span>Drop to use as banner photo</span></div>}
            </div>

            <div className="ed-rail-meta">
              <span>{fmt.name} · {FORMATS[format].w}×{FORMATS[format].h}</span>
              {noPhoto
                ? <span className="ed-rail-flag warn">No photo yet</span>
                : <span className="ed-rail-flag ok">Photo set</span>}
            </div>
          </>
        )}

        {/* Keep Banner Canvas attached in DOM even when on Article tab so playwright & telemetry see exactly 1 canvas */}
        {railTab === 'article' && (
          <div style={{ position: 'absolute', opacity: 0, pointerEvents: 'none', width: 0, height: 0, overflow: 'hidden' }}>
            <BannerCanvas base={base} cssWidth={120} interactive={false} />
          </div>
        )}

        {/* Web Article Replica */}
        {railTab === 'article' && (
          <div style={{ padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
              <div className="seg-ctl">
                <button
                  type="button"
                  className={previewDevice === 'desktop' ? 'on' : ''}
                  onClick={() => setPreviewDevice('desktop')}
                >
                  Desktop
                </button>
                <button
                  type="button"
                  className={previewDevice === 'mobile' ? 'on' : ''}
                  onClick={() => setPreviewDevice('mobile')}
                >
                  Mobile
                </button>
              </div>
              <button
                type="button"
                className="btn xs"
                onClick={() => setPreviewTheme(previewTheme === 'dark' ? 'light' : 'dark')}
              >
                {previewTheme === 'dark' ? 'Light Mode' : 'Dark Mode'}
              </button>
            </div>

            <div
              className="esb-site-mock"
              style={{
                background: previewTheme === 'light' ? '#ffffff' : '#0b0f19',
                color: previewTheme === 'light' ? '#0f172a' : '#f8fafc',
                border: '1px solid var(--line-2)',
                borderRadius: 8,
                overflow: 'hidden',
                maxWidth: previewDevice === 'mobile' ? 340 : '100%',
                margin: '0 auto',
                width: '100%',
              }}
            >
              <div
                style={{
                  padding: '6px 12px',
                  background: previewTheme === 'light' ? '#f1f5f9' : '#060911',
                  borderBottom: '1px solid var(--line)',
                  fontSize: 10,
                }}
              >
                <span className="mono" style={{ color: 'var(--text-3)' }}>
                  https://esbpowerline.com/articles/{draft.slug || 'story-slug'}
                </span>
              </div>

              <div
                style={{
                  padding: '8px 12px',
                  borderBottom: '1px solid var(--line)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                }}
              >
                <div className="row" style={{ gap: 6, alignItems: 'center' }}>
                  <img src={logoUrl} alt="ESB" style={{ height: 16, objectFit: 'contain' }} />
                  <b style={{ fontSize: 11, letterSpacing: '0.02em' }}>ESB POWERLINE</b>
                </div>
                <img src={avatarUrl} alt="Editor" style={{ width: 18, height: 18, borderRadius: '50%' }} />
              </div>

              <div style={{ padding: '14px 14px', display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div className="row" style={{ gap: 6, alignItems: 'center' }}>
                  <span className="swatch-dot" style={{ background: cat.accent }} />
                  <span
                    style={{
                      fontSize: 10,
                      fontWeight: 700,
                      letterSpacing: '0.06em',
                      textTransform: 'uppercase',
                      color: cat.accent,
                    }}
                  >
                    {cat.name}
                  </span>
                </div>

                <h1
                  style={{
                    fontSize: previewDevice === 'mobile' ? 14 : 16,
                    fontWeight: 700,
                    lineHeight: 1.25,
                    margin: 0,
                    whiteSpace: 'pre-line',
                  }}
                >
                  {draft.headline || 'English Headline Appears Here'}
                </h1>

                {draft.deck && (
                  <p
                    style={{
                      fontSize: 11.5,
                      lineHeight: 1.45,
                      color: previewTheme === 'light' ? '#475569' : '#94a3b8',
                      margin: 0,
                    }}
                  >
                    {draft.deck}
                  </p>
                )}

                <div
                  className="row"
                  style={{
                    justifyContent: 'space-between',
                    padding: '4px 0',
                    borderTop: '1px solid var(--line)',
                    borderBottom: '1px solid var(--line)',
                    fontSize: 10,
                    color: 'var(--text-3)',
                  }}
                >
                  <span>By {staffSession?.name || draft.byline || 'Mehedi Hasan Hamim'}</span>
                  <span>~{readTimeMin} min read</span>
                </div>

                {bannerLeadImage && (
                  <div style={{ borderRadius: 6, overflow: 'hidden', border: '1px solid var(--line)' }}>
                    <img
                      src={bannerLeadImage}
                      alt="Lead"
                      style={{ width: '100%', maxHeight: 150, objectFit: 'cover', display: 'block' }}
                    />
                  </div>
                )}

                <div
                  style={{
                    fontSize: 11.5,
                    lineHeight: 1.55,
                    color: previewTheme === 'light' ? '#334155' : '#cbd5e1',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 6,
                  }}
                >
                  {draft.body ? (
                    draft.body.split(/\n\n+/).slice(0, 3).map((para, idx) => (
                      <p key={idx} style={{ margin: 0 }}>
                        {para}
                      </p>
                    ))
                  ) : (
                    <p style={{ margin: 0, fontStyle: 'italic', color: 'var(--text-3)' }}>
                      Article body will appear here formatted as published on esbpowerline.com…
                    </p>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Facebook Feed Replica */}
        {railTab === 'facebook' && (
          <div style={{ padding: '10px 12px', overflow: 'hidden' }}>
            <div style={{ zoom: 0.65, transformOrigin: 'top left', width: '154%' }}>
              <FacebookMock base={base} device="desktop" dark={true} zoom={0.65} />
            </div>
          </div>
        )}

        {/* =========================================================
            CONTROLS SECTION: Photos, Desk, Text, Caption
            Always accessible in rail scroll
            ========================================================= */}

        {/* Photo Selection */}
        <section className="ed-rail-sec">
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <span className="kicker">Photo</span>
            <div className="row" style={{ gap: 4 }}>
              {slotImage && (
                <button type="button" className="btn-link" onClick={() => useStore.getState().assignImage(0, null)}>Clear</button>
              )}
              <button type="button" className="btn sm" onClick={() => fileRef.current?.click()}>
                <Icon name="plus" size={13} />
                <span>Add photo</span>
              </button>
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                hidden
                onChange={(e) => { const f = Array.from(e.target.files ?? []); e.target.value = ''; void addFiles(f) }}
              />
            </div>
          </div>
          {choices.length > 0 ? (
            <div className="ed-rail-photos">
              {choices.map((c) => (
                <button key={c.key} type="button" className={'ed-rail-photo' + (c.active ? ' on' : '')} title={c.title} onClick={c.pick}>
                  <img src={c.thumb} alt={c.title} loading="lazy" />
                </button>
              ))}
            </div>
          ) : (
            <p className="hint">Drop a photo on the banner, or add one. Photos found in a story link appear here automatically.</p>
          )}
        </section>

        {/* Desk / Sector Selection */}
        <section className="ed-rail-sec">
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <span className="kicker">Desk · {cat.name}</span>
            <button
              type="button"
              className={'btn-link' + (deskAuto ? ' on' : '')}
              onClick={() => { const id = autoDetectDesk(); const c = CATEGORIES.find((x) => x.id === id); onToast(`Desk set to ${c?.name ?? id} from the story`) }}
              title="Detect the sector desk from the story text"
            >
              {deskAuto ? '✓ Auto-detected' : 'Auto-detect'}
            </button>
          </div>
          <div className="ed-rail-desks" role="radiogroup" aria-label="Sector desk">
            {CATEGORIES.map((c) => (
              <button
                key={c.id}
                type="button"
                role="radio"
                aria-checked={c.id === content.categoryId}
                className={'ed-rail-desk' + (c.id === content.categoryId ? ' on' : '')}
                style={{ ['--c' as string]: c.accent } as CSSProperties}
                title={c.name}
                onClick={() => setDesk(c.id)}
              >
                <i />
                <span>{c.id}</span>
              </button>
            ))}
          </div>
        </section>

        {/* Banner text options */}
        <section className="ed-rail-sec">
          <Field label="Highlighted figure">
            <div className="row">
              <input
                type="text"
                className="input"
                placeholder="e.g. Tk 592 crore"
                value={content.highlight}
                onChange={(e) => useStore.getState().setContent({ highlight: e.target.value })}
              />
              <button
                type="button"
                className="btn sm"
                onClick={() => useStore.getState().setContent({ highlight: suggestHighlight(draft.headline || content.headline) })}
              >
                Auto
              </button>
            </div>
          </Field>
          <Field label="News label">
            <Select
              value={content.label as string}
              options={labelOptions}
              onChange={(v) => useStore.getState().setContent({ label: v as typeof content.label })}
            />
          </Field>
          <Switch
            checked={!!content.headlineBg}
            onChange={(checked) => useStore.getState().setContent({ headlineBg: checked, headlineBgAlpha: checked ? 0.78 : 0 })}
            label="Translucent headline backdrop"
          />
        </section>

        {/* Post caption */}
        <section className="ed-rail-sec">
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <label className="kicker" htmlFor="ed-rail-caption">Facebook caption</label>
            {content.caption !== null && (
              <button type="button" className="btn-link" onClick={() => useStore.getState().setContent({ caption: null })}>Reset to auto</button>
            )}
          </div>
          <textarea
            id="ed-rail-caption"
            className="input"
            rows={4}
            value={caption}
            onChange={(e) => useStore.getState().setContent({ caption: e.target.value })}
          />
        </section>
      </div>

      {/* Action footer */}
      <div className="ed-rail-actions">
        <button type="button" className="btn primary" onClick={() => void exportPng()} disabled={busy !== null}>
          <Icon name="download" size={14} />
          <span>{busy === 'export' ? 'Exporting…' : 'Export PNG'}</span>
        </button>
        <button type="button" className="btn" onClick={() => void copyImage()} disabled={busy !== null} title="Copy the banner image to the clipboard">
          <Icon name="image" size={14} />
          <span>Copy image</span>
        </button>
        <button
          type="button"
          className="btn"
          onClick={() => { void navigator.clipboard.writeText(caption); onToast('Caption copied') }}
          title="Copy the Facebook caption"
        >
          <Icon name="copy" size={14} />
          <span>Copy caption</span>
        </button>
      </div>
    </aside>
  )
}
