import type { FormatId, IconPathDef } from './tokens'
import type { FontId } from './fonts'
import type { LabelPresetId } from './newsroom'

export type { FormatId, IconPathDef, LabelPresetId }
export type Align = 'left' | 'center' | 'right'
export type CardType = 'standard' | 'quote' | 'stat'
/** One Quote / Stats card design: each field is an independent choice, so they combine freely. */
export interface CardDesign {
  /** show the photo; without it the text block fills the photo area too */
  photo: boolean
  bg: 'tint' | 'paper' | 'ink' | 'accent' | 'gradient'
  face: 'serif' | 'sans' | 'condensed' | 'grotesk'
  align: Align
  /** big quote mark (quotes only), a short rule, a side bar, or a frame */
  mark: 'none' | 'mark' | 'rule' | 'bar' | 'frame'
  /** quote: statement first (main) / speaker first (alt); stats: label first (main) / number first (alt) / split */
  order: 'main' | 'alt' | 'split'
  /** speaker name / number in the desk colour or in the text colour */
  emph: 'accent' | 'ink'
  /** the editor's own colours (hex), each over the choice above: card background, text, name / number, accents */
  bgColor?: string
  inkColor?: string
  hiColor?: string
  accentColor?: string
  /** header and footer band colours on this card (every format) */
  headerColor?: string
  footerColor?: string
}

export interface GradientStop { p: number; c: string; a?: number }
/** Figma-style linear gradient: t = tf[0][0]*xn + tf[0][1]*yn + tf[0][2] where xn,yn are 0..1 inside the box. */
export interface GradientFill { stops: GradientStop[]; tf: [[number, number, number], [number, number, number]] }
export type Fill = string | GradientFill
export interface Shadow { x: number; y: number; blur: number; color: string; alpha: number }
export interface Stroke { color: string; width: number }

export interface ElBase {
  id: string
  name: string
  /** Layer-panel section, e.g. "Date", "Header", "Footer". */
  group: string
  x: number
  y: number
  w: number
  h: number
  visible: boolean
  locked: boolean
  opacity: number
  /** drop shadow / outline added in the editor (not part of the templates) */
  dropShadow?: Shadow
  stroke?: Stroke
}

export interface RectEl extends ElBase { kind: 'rect'; fill: Fill; radius: number; shadow?: Shadow }

export interface TextRun { start: number; end: number; color: string }
export interface TextBgPill {
  color: string
  alpha: number
  radius: number
  padX: number
  padY: number
  blur?: number
  border?: string
}
export interface TextEl extends ElBase {
  kind: 'text'
  text: string
  weight: 500 | 700 | 800
  /** font family (default Inter) */
  font?: FontId
  size: number
  /** letter spacing in px */
  ls: number
  /** line height in percent of font size; null = font default (121 %) */
  lh: number | null
  align: Align
  color: string
  runs: TextRun[]
  /** 'hug' = box width follows the text (single line); 'box' = wraps inside w */
  fit: 'hug' | 'box'
  /** Optional translucent backdrop card rendered behind the text */
  bgPill?: TextBgPill
}

export interface IconEl extends ElBase { kind: 'icon'; vw: number; vh: number; paths: IconPathDef[]; /** colour used for '$ink' strokes */ ink?: string }
export interface ImageEl extends ElBase { kind: 'image'; src: string; fit: 'contain' | 'cover' }

export type Backdrop = 'blur' | 'black' | 'white' | 'tint'

export interface PhotoSlot {
  /** key into the asset map; null = empty slot */
  src: string | null
  /** zoom on top of "cover" (1 = just covers the slot) */
  zoom: number
  /** pan, -1..1 across the available overflow */
  panX: number
  panY: number
  /** Non-destructive adjustments: brightness -100..100 */
  brightness?: number
  /** contrast -100..100 */
  contrast?: number
  /** saturation -100..100 */
  saturation?: number
  /** warmth (temperature) -100..100 */
  warmth?: number
  /** vignette 0..100 */
  vignette?: number
  /** The photo editor's settings (photoEdit.ts). Shared by every format's copy of this slot: an edit belongs to the
   *  photo, while zoom and pan stay per format. The five fields above are read as fallbacks for older documents. */
  adjust?: PhotoAdjust
}
export interface PhotoAdjust {
  /** light, each -100..100 */
  exposure?: number
  contrast?: number
  highlights?: number
  shadows?: number
  whites?: number
  blacks?: number
  /** colour: temperature cool..warm, tint green..magenta, vibrance and saturation, each -100..100 */
  temp?: number
  tint?: number
  vibrance?: number
  saturation?: number
  /** finish, each 0..100 (blur 0..20 px at banner scale) */
  fade?: number
  sharpen?: number
  grain?: number
  vignette?: number
  blur?: number
  mono?: boolean
  flipX?: boolean
  flipY?: boolean
  /** the look last applied (for the panel's highlight); the values above are what render */
  look?: string
}
export interface PhotosEl extends ElBase {
  kind: 'photos'
  collage: string
  gap: number
  gapColor: string
  slots: PhotoSlot[]
  /** tint shown behind empty slots */
  tint: string
  /** what shows behind a photo zoomed out smaller than its slot */
  backdrop?: Backdrop
}

export interface WatermarkEl extends ElBase {
  kind: 'watermark'
  paths: IconPathDef[]
  color: string
  /** watermark artwork box (900 px in the template) and its offset inside the clip box */
  size: number
  ox: number
  oy: number
  strokeWidth: number
  /** alpha-mask gradient that fades the artwork */
  mask: GradientFill
  maxOpacity: number
  /** Figma layer-blur radius applied to the artwork before it is faded (0 / undefined = sharp) */
  blur?: number
}

export type El = RectEl | TextEl | IconEl | ImageEl | PhotosEl | WatermarkEl

export interface Scene {
  format: FormatId
  w: number
  h: number
  background: string
  elements: El[]
}

/** Everything the user types / picks. The template builders turn this into a Scene. */
export interface Content {
  categoryId: string
  /** ISO date yyyy-mm-dd */
  date: string
  headline: string
  /** key phrase to highlight in the headline (empty = none) */
  highlight: string
  showLinkPill: boolean
  /** the guideline highlights the key phrase on web only; allow it on social too if wanted */
  highlightOnSocial: boolean
  /** photo credit printed on the picture, e.g. "Photo: PID" (empty = none) */
  credit: string
  /** where the credit sits on the photo, its size, colour, font and optional dark pill */
  creditPos: 'bl' | 'br' | 'tl' | 'tr'
  creditSize: number
  creditColor: string
  creditFont: FontId
  creditChip: boolean
  /** news label pill on the photo, copied from the website: breaking / exclusive / special / analysis / opinion / trending / featured / custom */
  label: 'none' | LabelPresetId | 'custom'
  labelText: string
  labelPos: 'tl' | 'tr' | 'bl' | 'br' | 'hc'
  labelScale: number
  labelColor: string
  /** Facebook post text; null = generated from the headline */
  caption: string | null
  /** Card layout style: standard headline, quote/statement, or data/stat callout */
  cardType?: CardType
  /** Quote statement mode */
  quoteText?: string
  speakerName?: string
  speakerTitle?: string
  /** Data / Stat mode */
  statNumber?: string
  statLabel?: string
  statDelta?: string
  statNote?: string
  /** Quote / Stats card: the preset the design starts from (templates.ts QUOTE_PRESETS / STAT_PRESETS) and the
   *  editor's own choices on top of it — any mix of picture, background, typeface, alignment, accent, order, colour */
  quoteStyle?: string
  statStyle?: string
  quoteDesign?: Partial<CardDesign>
  statDesign?: Partial<CardDesign>
  /** text size of the card's block, 0.8–1.3 */
  cardScale?: number
  /** curly quotes around the statement (Bold draws its own big mark) */
  quoteMarks?: boolean
  /** colour of the trend line: auto reads ▲/▼, +/−, "record", "fall"… */
  statTrend?: 'auto' | 'up' | 'down' | 'none'
  /** number in ink instead of the desk colour */
  statNumberInk?: boolean
  /** Translucent backdrop card behind the headline text so it stays legible anywhere over photos */
  headlineBg?: boolean
  headlineBgColor?: string
  headlineBgAlpha?: number
  headlineBgBlur?: number
  headlineBgRadius?: number
  /** Opacity of the template headline band / side panel (0..1, default 1). When < 1, photo expands full-bleed behind the band */
  bandOpacity?: number
}

/** Per-element manual overrides. Stored by element id so they survive category/date changes. */
export type Override = Partial<Pick<ElBase, 'w' | 'h' | 'visible' | 'locked' | 'opacity'>> & {
  /** offset from the template position (so manual moves follow layout changes) */
  dx?: number
  dy?: number
  size?: number
  color?: string
  weight?: 500 | 700 | 800
  font?: FontId
  ls?: number
  text?: string
  radius?: number
  fill?: string
  /** line height in percent (text) */
  lh?: number
  /** headline icon (watermark): offset inside its clip area, size, blur, opacity, stroke */
  iconDx?: number
  iconDy?: number
  iconSize?: number
  blur?: number
  iconOpacity?: number
  iconStroke?: number
  align?: Align
  shadow?: Shadow
  stroke?: Stroke
  bgPill?: TextBgPill
}
export type Overrides = Record<string, Override>

export interface PhotoState {
  collage: string
  gap: number
  gapColor: string
  backdrop: Backdrop
  /** per-format slot state; `src` is shared, zoom/pan are per format */
  slots: Record<FormatId, PhotoSlot[]>
}

export interface GuideLine { id: string; axis: 'x' | 'y'; at: number }

export interface Doc {
  content: Content
  /** keyed `${format}:${elementId}` */
  overrides: Overrides
  photos: PhotoState
  /** layers the user added or duplicated (per format) */
  extras: Record<FormatId, El[]>
  /** explicit layer order (bottom -> top) per format; empty = template order */
  order: Record<FormatId, string[]>
  guides: Record<FormatId, GuideLine[]>
}
