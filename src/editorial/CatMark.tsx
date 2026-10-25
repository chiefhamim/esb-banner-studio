// The story's category as the Graphics workspace shows it: its own line icon on its own colour. Editorial uses it so the desk
// reads as the same product as the banner it feeds — one accent per story, taken from the category.

import type { Category } from '../core/tokens'
import type { CSSProperties } from 'react'

export function CatMark({ cat, size = 30 }: { cat: Category; size?: number }) {
  return (
    <span className="cat-mark" style={{ ['--cat' as string]: cat.accent, ['--cat-ink' as string]: cat.chipText, width: size, height: size } as CSSProperties} aria-hidden>
      <svg viewBox="0 0 26 26" width={Math.round(size * 0.62)} height={Math.round(size * 0.62)} fill="none" stroke="currentColor" strokeWidth="2.06" strokeLinecap="round" strokeLinejoin="round">
        {cat.icon.map((p, i) => <path key={i} d={p.d} />)}
      </svg>
    </span>
  )
}
