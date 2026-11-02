// Figures on screen exactly as the source stores them: never rounded beyond the source's precision. A count-up
// animation shows intermediate values at the same number of decimals and lands on the exact source string.

import { ease, type Easing } from './easing'

/** Decimal digits of a number as JavaScript stores it (its shortest round-trip form): 15552.54 → 2, 0.091 → 3. */
export function sourceDecimals(value: number): number {
  if (!Number.isFinite(value)) return 0
  const s = plainDigits(Math.abs(value))
  const dot = s.indexOf('.')
  return dot < 0 ? 0 : s.length - dot - 1
}

/** The shortest round-trip decimal form, never in exponent notation (1e-7 → "0.0000001"). */
export function plainDigits(value: number): string {
  const s = String(value)
  if (!/e/i.test(s)) return s
  const [mant, expS] = s.toLowerCase().split('e')
  const exp = Number(expS)
  const neg = mant.startsWith('-')
  const [ip, fp = ''] = mant.replace('-', '').split('.')
  const digits = ip + fp
  const point = ip.length + exp
  let out: string
  if (point <= 0) out = '0.' + '0'.repeat(-point) + digits
  else if (point >= digits.length) out = digits + '0'.repeat(point - digits.length)
  else out = digits.slice(0, point) + '.' + digits.slice(point)
  return (neg ? '-' : '') + out
}

/** Largest magnitude and most decimals a figure may have to be shown exactly (a crafted file or a bad answer must not
 * reach the renderer with 1e300 or 1e-300). Real grid figures have at most a handful of decimals. */
export const MAX_FIGURE = 1e15
export const MAX_FIGURE_DECIMALS = 12
export const isShowableNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) < MAX_FIGURE && sourceDecimals(v) <= MAX_FIGURE_DECIMALS

const BN_DIGITS = '০১২৩৪৫৬৭৮৯'
export const toBanglaDigits = (s: string) => s.replace(/[0-9]/g, (d) => BN_DIGITS[Number(d)])

export interface NumberFormat {
  /** Thousands separators (default true): "15,552.54". */
  group?: boolean
  digits?: 'latin' | 'bn'
}

/** `value` exactly as stored, optionally grouped. No digit is added or dropped. */
export function formatExact(value: number, fmt: NumberFormat = {}): string {
  return formatFixed(value, sourceDecimals(value), fmt, true)
}

/** `value` at `decimals` places (for count-up intermediates). With `exact`, the digits are the stored ones. */
function formatFixed(value: number, decimals: number, fmt: NumberFormat, exact = false): string {
  const neg = value < 0
  // toFixed throws above 100 digits (a crafted 1e-300): clamp, never throw
  const body = exact ? plainDigits(Math.abs(value)) : Math.abs(value).toFixed(Math.min(100, Math.max(0, Math.trunc(decimals))))
  const [ip, fp] = body.split('.')
  const grouped = fmt.group === false ? ip : ip.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  const s = (neg ? '-' : '') + grouped + (fp !== undefined ? '.' + fp : '')
  return fmt.digits === 'bn' ? toBanglaDigits(s) : s
}

export interface CountUpSpec {
  /** The source value; the last frame shows `formatExact(target)`. */
  target: number
  from?: number
  /** Seconds (element-local). */
  delay?: number
  duration: number
  easing?: Easing
  format?: NumberFormat
}

/** The string a count-up shows at element-local time t. At and after the end it is exactly the source value. */
export function countUpText(spec: CountUpSpec, t: number): string {
  const end = (spec.delay ?? 0) + spec.duration
  if (t >= end || spec.duration <= 0) return formatExact(spec.target, spec.format)
  const p = ease(spec.easing ?? 'esb', (t - (spec.delay ?? 0)) / spec.duration)
  const from = spec.from ?? 0
  const v = from + (spec.target - from) * p
  return formatFixed(v, sourceDecimals(spec.target), spec.format ?? {})
}
