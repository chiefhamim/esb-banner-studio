// The two pictures the story's banner becomes when it is published: the 16:9 Web banner that goes on the article page
// on esbpowerline.com, and the 4:5 banner that goes to Facebook. They follow the Graphics document live — an edit in
// Graphics shows here a moment later — so Editorial never shows a stale banner.

import type { CSSProperties, ReactNode } from 'react'
import { Icon } from '../ui/Icon'
import { useBannerImage } from './useBannerImage'
import type { Assets } from '../core/render'
import type { HeroMode } from './heroMode'

export function BannerPreviews({ base, heroMode, onHeroMode, photoUrl, caption, pageName, compact = false, wide = false, webExtra, fbExtra, fbToggle, fbNote }: {
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
  /** The Facebook card's header control (the on / off switch or the connect button). */
  fbToggle?: ReactNode
  fbNote?: ReactNode
}) {
  const web = useBannerImage(heroMode === 'banner' ? base : null, 'web', compact ? 0.3 : 0.4)
  const fb = useBannerImage(base, 'fb45', compact ? 0.22 : 0.3)
  const siteImg = heroMode === 'banner' ? web : photoUrl
  return (
    <div className={'bp' + (compact ? ' compact' : '') + (wide ? ' wide' : '')}>
      <figure className="bp-card pcard">
        <header className="pcard-h">
          <span className="pcard-ic"><Icon name="globe" size={15} /></span>
          <div className="pcard-t"><b>Your website</b><span>esbpowerline.com · {heroMode === 'banner' ? 'Web banner, 16:9' : 'Original photo'}</span></div>
          {onHeroMode && <button type="button" className="btn xs" onClick={() => onHeroMode(heroMode === 'banner' ? 'photo' : 'banner')}>{heroMode === 'banner' ? 'Use photo' : 'Use banner'}</button>}
        </header>
        <div className="bp-frame web" style={{ ['--r' as string]: 16 / 9 } as CSSProperties}>{siteImg ? <img src={siteImg} alt="Banner as the article image on esbpowerline.com" /> : <span className="hint">{heroMode === 'photo' ? 'No photo on this story, so the article will have no image' : 'Rendering…'}</span>}</div>
        {heroMode === 'banner' && webExtra}
      </figure>
      <figure className="bp-card pcard">
        <header className="pcard-h">
          <span className="pcard-ic fb"><Icon name="photos" size={15} /></span>
          <div className="pcard-t"><b>Facebook</b><span>{pageName ? pageName + ' · feed banner, 4:5' : 'Feed banner, 4:5'}</span></div>
          {fbToggle}
        </header>
        <div className="bp-frame fb" style={{ ['--r' as string]: 4 / 5 } as CSSProperties}>{fb ? <img src={fb} alt="Banner as the Facebook post image" /> : <span className="hint">Rendering…</span>}</div>
        {caption && <p className="bp-caption">{caption}</p>}
        {fbExtra}
        {fbNote}
      </figure>
    </div>
  )
}
