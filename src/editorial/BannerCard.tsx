// The banner's settings in the right sidebar: what the article's image is, the highlighted figure, the news label, the headline
// backdrop and the live link to the story. The banner itself, its channel and Edit / Save / Copy are the hero above (BannerThumb).

import { useStore } from '../store'
import { useEditorialStore } from './editorialStore'
import { useBannerChannel } from './BannerThumb'
import { Icon } from '../ui/Icon'
import { Field, Select, Seg, Switch } from '../ui/controls'
import { LABEL_PRESETS, suggestHighlight } from '../core/newsroom'
import type { LabelPresetId } from '../core/newsroom'
import { syncArticlePhotosToBanner } from './automation'
import type { HeroMode } from './heroMode'

const labelOptions = [
  { value: 'none', label: 'No label' },
  ...(Object.keys(LABEL_PRESETS) as LabelPresetId[]).map((id) => ({ value: id as string, label: LABEL_PRESETS[id].name })),
]

export function BannerCard({ heroMode, onHeroMode, onToast }: { heroMode: HeroMode; onHeroMode: (m: HeroMode) => void; onToast: (m: string) => void }) {
  const content = useStore((s) => s.doc.content)
  const bannerLink = useEditorialStore((s) => s.bannerLink)
  const setBannerLink = useEditorialStore((s) => s.setBannerLink)
  const applyDraftToBanner = useEditorialStore((s) => s.applyDraftToBanner)
  const source = useEditorialStore((s) => s.source)
  const channel = useBannerChannel((s) => s.channel)
  const headline = useEditorialStore((s) => s.draft.headline)
  const update = () => {
    applyDraftToBanner()
    if (source?.images?.length) void syncArticlePhotosToBanner(source.images)
    onToast('Banner updated from the story')
  }

  return (
    <div className="bc">
      {channel === 'web' && (
        <Field label="Article image on the website">
          <Seg<HeroMode> className="block" value={heroMode} onChange={onHeroMode} options={[{ value: 'banner', label: 'The banner' }, { value: 'photo', label: 'The bare photo' }]} />
        </Field>
      )}

      <Switch checked={bannerLink} onChange={(on) => { setBannerLink(on); onToast(on ? 'Banner follows the story — headline, credit and caption stay in step' : 'Banner paused — it no longer follows the story') }} label="Banner follows the story" />
      <button type="button" className="btn sm bc-update" onClick={update} data-tip="Push the headline, category and story photos to the banner now"><Icon name="refresh" size={13} /><span>Update banner from the story</span></button>

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
    </div>
  )
}
