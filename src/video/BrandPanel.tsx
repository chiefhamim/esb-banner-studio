// Brand kit: the accent, the logo bug (on, corner) and the end card, kept on this PC and used when a template builds a
// video. The fonts are the studio's own and fixed (shown, not edited). The bug's on/off and corner also change the open video.
import { useState } from 'react'
import { useVideoStore } from './videoStore'
import { BRAND_FONTS, BUG_CORNERS, loadBrand, saveBrand, type BrandKit, type BugCorner } from './brandKit'
import { CATEGORIES } from '../core/tokens'

export function BrandPanel() {
  const [brand, setBrand] = useState<BrandKit>(() => loadBrand())
  const bugOn = useVideoStore((s) => s.project.bug !== false)
  const corner = useVideoStore((s) => s.project.bugCorner ?? 'tr')
  const setBug = useVideoStore((s) => s.setBug)
  const setBugCorner = useVideoStore((s) => s.setBugCorner)

  const update = (patch: Partial<BrandKit>) => { const next = { ...brand, ...patch }; setBrand(next); saveBrand(next) }

  return (
    <section className="vw-sec" aria-label="Brand kit">
      <div className="vw-sec-head"><h4 className="vw-sec-title">Brand kit</h4></div>
      <label className="vw-cut-row">
        <span className="vw-cut-label">Accent</span>
        <select value={brand.accent} onChange={(e) => update({ accent: e.target.value })} aria-label="Accent colour">
          <option value="auto">The story’s category</option>
          <option value="stripes">The three ESB stripes</option>
          {CATEGORIES.map((c) => <option key={c.id} value={c.id}>{c.id} {c.name}</option>)}
        </select>
      </label>
      <label className="vw-cut-row">
        <span className="vw-cut-label">Logo</span>
        <select value={bugOn ? corner : 'off'} onChange={(e) => { const v = e.target.value; if (v === 'off') { setBug(false); update({ bugOn: false }) } else { setBug(true); setBugCorner(v as BugCorner); update({ bugOn: true, bugCorner: v as BugCorner }) } }} aria-label="Logo position">
          {BUG_CORNERS.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
          <option value="off">Off</option>
        </select>
      </label>
      <label className="vw-cut-row vw-check">
        <input type="checkbox" checked={brand.endCard} onChange={(e) => update({ endCard: e.target.checked })} />
        <span>Close with the ESB end card</span>
      </label>
      <p className="vw-hint">Fonts: {BRAND_FONTS.english} and {BRAND_FONTS.bangla}, set by the studio. The logo setting also applies to the video that is open.</p>
    </section>
  )
}
