import type { IconName } from '../ui/Icon'

/** The banner's parts as a person thinks of them (a "logo", a "date"), each mapping onto the template layers that draw it. */
export type ElementSection = 'Header' | 'Photo' | 'Headline' | 'Footer'
export interface ElementDef { key: string; label: string; section: ElementSection; icon: IconName; match: (id: string) => boolean; hint?: string }

const pre = (...p: string[]) => (id: string) => p.some((x) => id === x || id.startsWith(x + '-'))

export const ELEMENT_DEFS: ElementDef[] = [
  { key: 'logo', label: 'Logo', section: 'Header', icon: 'image', match: (id) => id === 'logo' },
  { key: 'date', label: 'Date', section: 'Header', icon: 'calendar', match: pre('date') },
  { key: 'category', label: 'Category chip', section: 'Header', icon: 'palette', match: pre('chip') },
  { key: 'header-bg', label: 'Header background', section: 'Header', icon: 'square', match: (id) => id === 'header-bg' },
  { key: 'stripes', label: 'Colour stripes', section: 'Header', icon: 'layers', match: (id) => id.startsWith('stripe') },

  { key: 'photos', label: 'Photo area', section: 'Photo', icon: 'photos', match: (id) => id === 'photos' },
  { key: 'label', label: 'Label pill', section: 'Photo', icon: 'sparkle', match: pre('label'), hint: 'Choose one in the Story panel' },
  { key: 'credit', label: 'Photo credit', section: 'Photo', icon: 'type', match: pre('credit'), hint: 'Type one in the Story panel' },

  { key: 'headline', label: 'Headline', section: 'Headline', icon: 'type', match: (id) => id === 'headline' },
  { key: 'band', label: 'Headline background', section: 'Headline', icon: 'square', match: (id) => id === 'band' || id === 'panel' },
  { key: 'watermark', label: 'Headline icon', section: 'Headline', icon: 'watermark', match: (id) => id === 'watermark' },
  { key: 'link', label: 'News-link pill', section: 'Headline', icon: 'link', match: pre('link') },
  { key: 'edge', label: 'Edge line', section: 'Headline', icon: 'minus', match: (id) => id === 'edge-line' || id === 'panel-edge' },

  { key: 'footer-bg', label: 'Footer bar', section: 'Footer', icon: 'square', match: (id) => id === 'footer-bg' || id === 'footer-line' },
  { key: 'fb', label: 'Facebook handle', section: 'Footer', icon: 'icon', match: pre('fb') },
  { key: 'web', label: 'Website', section: 'Footer', icon: 'icon', match: pre('web') },
  { key: 'yt', label: 'YouTube', section: 'Footer', icon: 'icon', match: pre('yt') },
]

export const ELEMENT_SECTIONS: ElementSection[] = ['Header', 'Photo', 'Headline', 'Footer']
