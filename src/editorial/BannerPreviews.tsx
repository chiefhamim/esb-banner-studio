// The two pictures the story's banner becomes when it is published: the 16:9 Web banner that goes on the article page
// on esbpowerline.com, and the 4:5 banner that goes to Facebook. They follow the Graphics document live — an edit in
// Graphics shows here a moment later — so Editorial never shows a stale banner.

import type { CSSProperties, ReactNode } from 'react'
import { Icon } from '../ui/Icon'
import { useBannerImage } from './useBannerImage'
import type { Assets } from '../core/render'
import type { HeroMode } from './heroMode'

export function BannerPreviews({ base, heroMode, onHeroMode, photoUrl, caption, pageName, compact = false, wide = false, webExtra, fbExtra }: {
  base: Assets | null
  heroMode: HeroMode
  /** When given, the website card gets a switch between the banner and the bare photo. */
  onHeroMode?: (m: HeroMode) => void
  photoUrl: string | null
  caption?: string
  pageName?: string | null
  compact?: boolean
  /** Two columns, one per destination. */
  wide?: boolean
  /** Shown under the website / Facebook picture (the picture settings). */
  webExtra?: ReactNode
  fbExtra?: ReactNode
}) {
  const web = useBannerImage(heroMode === 'banner' ? base : null, 'web', compact ? 0.3 : 0.4)
  const fb = useBannerImage(base, 'fb45', compact ? 0.22 : 0.3)
  const siteImg = heroMode === 'banner' ? web : photoUrl
  return (
    <div className={'bp' + (compact ? ' compact' : '') + (wide ? ' wide' : '')}>
      <figure className="bp-card">
        <figcaption><Icon name="globe" size={13} /><b>Your website</b><span>{heroMode === 'banner' ? 'Web banner · 16:9' : 'Original photo'}</span>{onHeroMode && <button type="button" className="btn-link" onClick={() => onHeroMode(heroMode === 'banner' ? 'photo' : 'banner')}>{heroMode === 'banner' ? 'Use photo' : 'Use banner'}</button>}</figcaption>
        <div className="bp-frame web" style={{ ['--r' as string]: 16 / 9 } as CSSProperties}>{siteImg ? <img src={siteImg} alt="Banner as the article image on esbpowerline.com" /> : <span className="hint">{heroMode === 'photo' ? 'No photo on this story, so the article will have no image' : 'Rendering…'}</span>}</div>
        {heroMode === 'banner' && webExtra}
      </figure>
      <figure className="bp-card">
        <figcaption><Icon name="photos" size={13} /><b>Facebook</b><span>{pageName ? pageName + ' · 4:5' : 'Feed banner · 4:5'}</span></figcaption>
        <div className="bp-frame fb" style={{ ['--r' as string]: 4 / 5 } as CSSProperties}>{fb ? <img src={fb} alt="Banner as the Facebook post image" /> : <span className="hint">Rendering…</span>}</div>
        {fbExtra}
        {caption && <p className="bp-caption">{caption}</p>}
      </figure>
    </div>
  )
}
