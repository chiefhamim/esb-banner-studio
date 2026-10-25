// The banner, always in view at the top of the sidebar: the Website 16:9 image as it will go out with the story, drawn live from
// Graphics, with the category's colour along its edge. Editorial used to show it only inside a collapsed panel.

import type { CSSProperties } from 'react'
import { Icon } from '../ui/Icon'
import { useBannerImage } from './useBannerImage'
import { useShellStore } from '../shell/shellStore'
import type { Assets } from '../core/render'
import type { Category } from '../core/tokens'

export function BannerThumb({ base, cat }: { base: Assets | null; cat: Category }) {
  const url = useBannerImage(base, 'web', 0.3)
  return (
    <div className="bt" style={{ ['--cat' as string]: cat.accent } as CSSProperties}>
      <div className="bt-frame">
        {url ? <img src={url} alt="The website banner for this story" /> : <span className="hint">Drawing the banner…</span>}
        <button type="button" className="bt-edit" onClick={() => useShellStore.getState().openGraphicsFrom('editorial', null)} title="Open this banner in Graphics">
          <Icon name="edit" size={13} /><span>Edit in Graphics</span>
        </button>
      </div>
      <div className="bt-meta"><b>Website banner</b><span>16:9 · live from Graphics</span></div>
    </div>
  )
}
