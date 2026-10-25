// The right sidebar's banner card: the banner as it is right now (live from Graphics) in the format a channel needs —
// Website 16:9, Facebook 4:5, Square — with the few settings an editor changes here (what the article's image is, the
// highlighted figure, the news label, the headline backdrop), the live link to the story, and Edit / Save / Copy.

import { useState } from 'react'
import type { CSSProperties } from 'react'
import { useStore } from '../store'
import { useEditorialStore } from './editorialStore'
import { useBannerImage } from './useBannerImage'
import { useShellStore } from '../shell/shellStore'
import { Icon } from '../ui/Icon'
import { Field, Select, Seg, Switch } from '../ui/controls'
import { FORMATS, getFormat } from '../core/tokens'
import { LABEL_PRESETS, suggestHighlight } from '../core/newsroom'
import type { LabelPresetId } from '../core/newsroom'
import { DEFAULT_SETTINGS, copyToClipboard, humanBytes, runExport } from '../export'
import { syncArticlePhotosToBanner } from './automation'
import type { Assets } from '../core/render'
import type { FormatId } from '../core/types'
import type { HeroMode } from './heroMode'

type Channel = 'web' | 'fb45'
const CHANNELS: { value: Channel; label: string; sub: string }[] = [
  { value: 'web', label: 'Website', sub: '16:9' },
  { value: 'fb45', label: 'Facebook', sub: '4:5' },
]
const labelOptions = [
  { value: 'none', label: 'No label' },
  ...(Object.keys(LABEL_PRESETS) as LabelPresetId[]).map((id) => ({ value: id as string, label: LABEL_PRESETS[id].name })),
]

export function BannerCard({ base, heroMode, onHeroMode, onToast }: { base: Assets | null; heroMode: HeroMode; onHeroMode: (m: HeroMode) => void; onToast: (m: string) => void }) {
  const content = useStore((s) => s.doc.content)
  const slot0 = useStore((s) => s.doc.photos.slots[s.format][0])
  const bannerLink = useEditorialStore((s) => s.bannerLink)
  const setBannerLink = useEditorialStore((s) => s.setBannerLink)
  const applyDraftToBanner = useEditorialStore((s) => s.applyDraftToBanner)
  const source = useEditorialStore((s) => s.source)
  const headline = useEditorialStore((s) => s.draft.headline)
  const [channel, setChannel] = useState<Channel>(() => {
    try { const v = localStorage.getItem('esb-banner-studio/editorial/channel'); return v === 'fb45' ? v : 'web' } catch { return 'web' }
  })
  const pick = (c: Channel) => { setChannel(c); try { localStorage.setItem('esb-banner-studio/editorial/channel', c) } catch { /* ignore */ } }
  const fmtId: FormatId = channel
  const fmt = getFormat(fmtId)
  const url = useBannerImage(base, fmtId, 0.4)
  const [busy, setBusy] = useState<null | 'save' | 'copy'>(null)
  const hasPhoto = !!slot0?.src

  const save = async () => {
    if (!base) return
    setBusy('save')
    try {
      const res = await runExport(useStore.getState().doc, base, { ...DEFAULT_SETTINGS, formats: [fmtId], scales: [1], type: 'png', zip: false, saveProject: false, dir: null, openAfter: false }, () => {})
      onToast(res.saved.length ? `Saved the ${fmt.short} banner · ${humanBytes(res.bytes)}` : 'Export finished')
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Export failed'
      if (!/cancel/i.test(msg)) onToast(msg)
    } finally {
      setBusy(null)
    }
  }
  const copy = async () => {
    if (!base) return
    setBusy('copy')
    try { await copyToClipboard(useStore.getState().doc, fmtId, base); onToast('Banner copied — paste it anywhere') }
    catch { onToast('Copying the image was blocked. Use Save instead.') }
    finally { setBusy(null) }
  }
  const update = () => {
    applyDraftToBanner()
    if (source?.images?.length) void syncArticlePhotosToBanner(source.images)
    onToast('Banner updated from the story')
  }

  return (
    <div className="bc">
      <Seg<Channel> className="block bc-seg" value={channel} onChange={pick} options={CHANNELS.map((c) => ({ value: c.value, label: c.label }))} />

      <div className="bc-frame" style={{ ['--r' as string]: FORMATS[fmtId].w / FORMATS[fmtId].h } as CSSProperties}>
        {url ? <img src={url} alt={`The ${fmt.name} banner`} /> : <span className="hint">Drawing the banner…</span>}
      </div>
      <div className="bc-meta">
        <span>{fmt.name} · {FORMATS[fmtId].w}×{FORMATS[fmtId].h}</span>
        <span className={'bc-flag ' + (hasPhoto ? 'ok' : 'warn')}>{hasPhoto ? 'Photo set' : 'No photo yet'}</span>
      </div>

      {channel === 'web' && (
        <Field label="Article image on the website">
          <Seg<HeroMode> className="block" value={heroMode} onChange={onHeroMode} options={[{ value: 'banner', label: 'The banner' }, { value: 'photo', label: 'The bare photo' }]} />
        </Field>
      )}

      <div className="bc-link">
        <button type="button" className={'ed-link-pill' + (bannerLink ? ' on' : '')} aria-pressed={bannerLink}
          onClick={() => { setBannerLink(!bannerLink); onToast(bannerLink ? 'Live link paused' : 'Live link on — headline, credit and caption stay in step') }}
          data-tip={bannerLink ? 'The banner follows the story. Click to pause.' : 'Paused. Click to follow the story again.'}>
          <Icon name="link" size={12} /><span>{bannerLink ? 'Follows the story' : 'Link paused'}</span>
        </button>
        <button type="button" className="btn xs ghost" onClick={update} data-tip="Push the headline, category and story photos to the banner now"><Icon name="refresh" size={12} /><span>Update from story</span></button>
      </div>

      <Field label="Highlighted figure">
        <div className="row">
          <input type="text" className="input" placeholder="e.g. Tk 592 crore" value={content.highlight} onChange={(e) => useStore.getState().setContent({ highlight: e.target.value })} />
          <button type="button" className="btn sm" onClick={() => useStore.getState().setContent({ highlight: suggestHighlight(headline || content.headline) })}>Auto</button>
        </div>
      </Field>
      <Field label="News label">
        <Select value={content.label as string} options={labelOptions} onChange={(v) => useStore.getState().setContent({ label: v as typeof content.label })} />
      </Field>
      <Switch checked={!!content.headlineBg} onChange={(on) => useStore.getState().setContent({ headlineBg: on, headlineBgAlpha: on ? 0.78 : 0 })} label="Translucent headline backdrop" />

      <div className="bc-actions">
        <button type="button" className="btn sm" onClick={() => useShellStore.getState().openGraphicsFrom('editorial', null)}><Icon name="edit" size={13} /><span>Edit in Graphics</span></button>
        <button type="button" className="btn sm" onClick={() => void save()} disabled={!base || busy === 'save'}><Icon name="download" size={13} /><span>{busy === 'save' ? 'Saving…' : 'Save'}</span></button>
        <button type="button" className="btn sm" onClick={() => void copy()} disabled={!base || busy === 'copy'}><Icon name="copy" size={13} /><span>Copy</span></button>
      </div>
    </div>
  )
}
