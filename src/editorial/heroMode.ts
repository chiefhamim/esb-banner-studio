import { useState } from 'react'

/**
 * What the web article preview shows as its hero: the 16:9 Web banner (what ESB posts as the featured image) or the
 * bare photo. Remembered across launches; both previews (Story → Preview and Outputs → Web article) read it.
 */
export type HeroMode = 'banner' | 'photo'
const KEY = 'esb-banner-studio/editorial/hero'

export function useHeroMode(): [HeroMode, (m: HeroMode) => void] {
  const [mode, setMode] = useState<HeroMode>(() => { try { return localStorage.getItem(KEY) === 'photo' ? 'photo' : 'banner' } catch { return 'banner' } })
  return [mode, (m) => { setMode(m); try { localStorage.setItem(KEY, m) } catch { /* ignore */ } }]
}
