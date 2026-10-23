// Bundled font families usable on banner text. asc / desc are the font's ascent and descent as ratios of its size
// (measured in the browser's text engine); they place the first baseline and size "auto" line height exactly.
export type FontId = 'inter' | 'grotesk' | 'serif' | 'oswald' | 'bengali'

export interface FontDef { id: FontId; name: string; family: string; asc: number; desc: number; note: string }

export const FONTS: FontDef[] = [
  { id: 'inter', name: 'Inter', family: 'Inter', asc: 0.96875, desc: 0.2412109375, note: 'Brand text (default)' },
  { id: 'grotesk', name: 'Space Grotesk', family: 'Space Grotesk', asc: 0.984, desc: 0.292, note: 'Same as the website headings' },
  { id: 'serif', name: 'Source Serif 4', family: 'Source Serif 4', asc: 1.036, desc: 0.335, note: 'Editorial serif' },
  { id: 'oswald', name: 'Oswald', family: 'Oswald', asc: 1.193, desc: 0.289, note: 'Condensed, for tight headlines' },
  { id: 'bengali', name: 'Hind Siliguri (বাংলা)', family: 'Hind Siliguri', asc: 1.08, desc: 0.32, note: 'Bangla news & editorial (বাংলা)' },
]

export const getFontDef = (id?: string): FontDef => FONTS.find((f) => f.id === id) ?? FONTS[0]
