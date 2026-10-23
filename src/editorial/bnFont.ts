// The Bengali reading font for the source column — a reading preference, so it lives on the document as one CSS
// variable (--bn-font) and in localStorage, not in the story.
import { create } from 'zustand'

export interface BnFont { id: string; label: string; family: string; note: string }

export const BN_FONTS: BnFont[] = [
  { id: 'hind', label: 'Hind Siliguri', family: "'Hind Siliguri'", note: 'clean sans, the default' },
  { id: 'noto-sans', label: 'Noto Sans Bengali', family: "'Noto Sans Bengali'", note: 'neutral sans, very legible' },
  { id: 'noto-serif', label: 'Noto Serif Bengali', family: "'Noto Serif Bengali'", note: 'serif, newspaper body' },
  { id: 'tiro', label: 'Tiro Bangla', family: "'Tiro Bangla'", note: 'traditional book serif' },
  { id: 'anek', label: 'Anek Bangla', family: "'Anek Bangla'", note: 'modern sans' },
  { id: 'baloo', label: 'Baloo Da 2', family: "'Baloo Da 2'", note: 'rounded, friendly' },
]

const KEY = 'esb-banner-studio/bn-font'
const apply = (id: string) => {
  const f = BN_FONTS.find((x) => x.id === id) ?? BN_FONTS[0]
  if (typeof document !== 'undefined') document.documentElement.style.setProperty('--bn-font', `${f.family}, 'Hind Siliguri', var(--ui)`)
}

export const useBnFont = create<{ id: string; set: (id: string) => void }>((set) => {
  let id = 'hind'
  try { id = localStorage.getItem(KEY) || 'hind' } catch { /* ignore */ }
  apply(id)
  return {
    id,
    set: (next) => { try { localStorage.setItem(KEY, next) } catch { /* ignore */ } apply(next); set({ id: next }) },
  }
})
