import logoUrl from '../assets/images/esb-logo.png'
import inter500 from '../assets/fonts/Inter-500.woff2?url'
import inter700 from '../assets/fonts/Inter-700.woff2?url'
import inter800 from '../assets/fonts/Inter-800.woff2?url'
import type { Assets } from './render'
import grotesk500 from '../assets/fonts/ui-grotesk-500.woff2?url'
import grotesk700 from '../assets/fonts/ui-grotesk-700.woff2?url'
import serif500 from '../assets/fonts/serif-500.woff2?url'
import serif700 from '../assets/fonts/serif-700.woff2?url'
import oswald500 from '../assets/fonts/oswald-500.woff2?url'
import oswald700 from '../assets/fonts/oswald-700.woff2?url'
import bengali600 from '../assets/fonts/bengali-600.woff2?url'
import bengali700 from '../assets/fonts/bengali-700.woff2?url'
import bnDigits600 from '../assets/fonts/bn/noto-sans-bengali-bengali-600-normal.woff2?url'

let fontsReady: Promise<void> | null = null

/** Load the bundled Inter weights so rendering never depends on fonts installed on the PC. */
export function loadFonts(): Promise<void> {
  if (!fontsReady) {
    fontsReady = (async () => {
      const faces = [
        new FontFace('Inter', `url(${inter500}) format('woff2')`, { weight: '500', style: 'normal' }),
        new FontFace('Inter', `url(${inter700}) format('woff2')`, { weight: '700', style: 'normal' }),
        new FontFace('Inter', `url(${inter800}) format('woff2')`, { weight: '800', style: 'normal' }),
        new FontFace('Space Grotesk', `url(${grotesk500}) format('woff2')`, { weight: '500', style: 'normal' }),
        new FontFace('Space Grotesk', `url(${grotesk700}) format('woff2')`, { weight: '700', style: 'normal' }),
        new FontFace('Source Serif 4', `url(${serif500}) format('woff2')`, { weight: '500', style: 'normal' }),
        new FontFace('Source Serif 4', `url(${serif700}) format('woff2')`, { weight: '700', style: 'normal' }),
        new FontFace('Oswald', `url(${oswald500}) format('woff2')`, { weight: '500', style: 'normal' }),
        new FontFace('Oswald', `url(${oswald700}) format('woff2')`, { weight: '700', style: 'normal' }),
        new FontFace('Hind Siliguri', `url(${bengali600}) format('woff2')`, { weight: '600', style: 'normal' }),
        // Hind Siliguri 600 draws the Bangla digit one (U+09E7) tiny and raised, so it reads as a stray mark: its ten digits
        // come from Noto Sans Bengali 600 (added after the main face, so it wins for that range). Mirrors src/fonts.css.
        new FontFace('Hind Siliguri', `url(${bnDigits600}) format('woff2')`, { weight: '600', style: 'normal', unicodeRange: 'U+09E6-09EF' }),
        new FontFace('Hind Siliguri', `url(${bengali700}) format('woff2')`, { weight: '700', style: 'normal' }),
      ]
      await Promise.all(faces.map((f) => f.load()))
      faces.forEach((f) => document.fonts.add(f))
    })()
  }
  return fontsReady
}

export function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('Could not load image: ' + url.slice(0, 80)))
    img.src = url
  })
}

export async function loadBaseAssets(): Promise<Assets> {
  await loadFonts()
  return { logo: await loadImage(logoUrl) }
}
