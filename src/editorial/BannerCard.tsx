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
    </div>
  )
}
