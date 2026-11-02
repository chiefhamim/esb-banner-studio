// The title element model: what a template (kit.ts, dataCards.ts) returns and what render.ts draws. Positions are
// frame pixels. Every text element says where its words came from (`origin`): the editor's field, the brand's fixed
// set (brand.ts), or the published data.

import type { TextAnimSpec } from './anim'
import type { GradientFill, TitleStyle } from './draw'
import type { Align, FontSpec } from './layout'
import type { CountUpSpec } from './numbers'
import type { ChartSpec } from './charts'

export type Origin = 'input' | 'brand' | 'data'

interface Base { id: string; anim?: TextAnimSpec }

export interface TextElement extends Base {
  type: 'text'
  text: string
  origin: Origin
  /** The field it shows (origin 'input'). */
  field?: string
  /** True when `text` is the field's editor-only label (an empty field in the editor). Never exported. */
  placeholder?: boolean
  /** How `text` was made from the field: `${prefix} ${transform(value)}` (prefix is a brand label, e.g. "Source:"). */
  prefix?: string
  transform?: 'upper'
  font: FontSpec
  style: TitleStyle
  x: number
  y: number
  w: number
  align?: Align
  maxLines?: number
  /** A figure that counts up to its source value (data cards). `text` is the final, exact string. */
  countUp?: CountUpSpec
  /** For data: which file and field it was read from. */
  data?: { isoDate: string; sourceField: string; derived?: string }
}

export interface RectElement extends Base {
  type: 'rect'
  x: number
  y: number
  w: number
  h: number
  radius?: number
  fill: string
  /** A gradient instead of `fill` (e.g. the dark ramp behind a headline for legibility). */
  gradient?: GradientFill
  /** Paint the ESB three stripes instead of `fill` (stacked along the long side). */
  stripes?: readonly string[]
}

export interface ImageElement extends Base {
  type: 'image'
  x: number
  y: number
  w: number
  h: number
  radius?: number
  /** The editor's picture (origin input), or the protected ESB logo, drawn as-is by the compositor. */
  src: string | null
  brandAsset?: 'esb-logo'
  field?: string
  placeholder?: boolean
}

export interface ChartElement extends Base {
  type: 'chart'
  x: number
  y: number
  w: number
  h: number
  chart: ChartSpec
}

export type TitleElement = TextElement | RectElement | ImageElement | ChartElement

export interface TitleField { value: string; label: string; required: boolean }

export type TemplateKind = 'lower-third' | 'name-strap' | 'headline' | 'breaking' | 'quote' | 'source' | 'end-card' | 'data-number' | 'data-chart'

export interface TitleSpec {
  kind: TemplateKind
  frame: { w: number; h: number }
  /** Seconds on screen (element-local time runs 0 → duration). */
  duration: number
  /** The editor's fields as given, with their labels (shown in the editor only) and whether they are required. */
  fields: Record<string, TitleField>
  elements: TitleElement[]
  /** Built for the editor (placeholders drawn) or for export (never). */
  editor: boolean
  /** Data cards: the day the figures are for and the source line that must be on the card. */
  data?: { isoDate: string; dateLabel: string; sourceLine: string }
}
