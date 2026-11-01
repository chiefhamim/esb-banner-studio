// Every time of day the app shows goes through here, so Home → Settings → Time format (12-hour / 24-hour) reaches all of
// it. 12-hour reads "4:58 PM" (no leading zero, uppercase AM/PM, a normal space); 24-hour reads "16:58".
// Not for durations or countdowns ("1:33", "15 h 59 m"), ISO strings, filenames, CSV, or anything sent to the site.
import { useShellStore, type ClockFormat } from '../shell/shellStore'

export type { ClockFormat } from '../shell/shellStore'

/** The preference as it is now (for code outside React; components use `useClockFormat` so they re-render on a change). */
export const clockFormat = (): ClockFormat => useShellStore.getState().clock

/** Subscribes the component to the time-format setting only; it re-renders when the editor flips it, never otherwise. */
export const useClockFormat = (): ClockFormat => useShellStore((s) => s.clock)

type When = number | string | Date
interface TimeOpts { tz?: string; seconds?: boolean; clock?: ClockFormat }
interface DateTimeOpts extends TimeOpts { weekday?: boolean; year?: boolean }

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const DOWS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

interface Parts { y: number; mo: number; d: number; dow: number; h: number; mi: number; s: number }

// one formatter per time zone (log lists format hundreds of rows), always 0-23 hours and English names
const dtfCache = new Map<string, Intl.DateTimeFormat | null>()
function dtfFor(tz: string): Intl.DateTimeFormat | null {
  if (dtfCache.has(tz)) return dtfCache.get(tz)!
  let f: Intl.DateTimeFormat | null = null
  try {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', weekday: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit',
    })
  } catch { f = null } // an unknown zone falls back to this computer's own time
  dtfCache.set(tz, f)
  return f
}

function partsOf(when: When, tz?: string): Parts | null {
  const date = when instanceof Date ? when : new Date(when)
  const t = date.getTime()
  if (!Number.isFinite(t)) return null
  const f = tz ? dtfFor(tz) : null
  if (f) {
    const p: Record<string, string> = {}
    for (const x of f.formatToParts(date)) p[x.type] = x.value
    return { y: +p.year, mo: +p.month - 1, d: +p.day, dow: Math.max(0, DOWS.indexOf(p.weekday)), h: +p.hour % 24, mi: +p.minute, s: +p.second }
  }
  return { y: date.getFullYear(), mo: date.getMonth(), d: date.getDate(), dow: date.getDay(), h: date.getHours(), mi: date.getMinutes(), s: date.getSeconds() }
}

const pad = (n: number) => String(n).padStart(2, '0')

/** A wall-clock hour and minute in the chosen format: (16, 58) → "4:58 PM" / "16:58". */
export function fmtHm(h: number, m: number, o: { seconds?: number; clock?: ClockFormat } = {}): string {
  const clock = o.clock ?? clockFormat()
  const sec = o.seconds != null ? ':' + pad(o.seconds) : ''
  if (clock === '24h') return `${pad(h)}:${pad(m)}${sec}`
  return `${h % 12 === 0 ? 12 : h % 12}:${pad(m)}${sec} ${h < 12 ? 'AM' : 'PM'}`
}

/** A whole hour, for chart buckets: 9 → "9 AM" / "09:00". */
export function fmtHour(h: number, clock: ClockFormat = clockFormat()): string {
  const hh = ((h % 24) + 24) % 24
  return clock === '24h' ? `${pad(hh)}:00` : `${hh % 12 === 0 ? 12 : hh % 12} ${hh < 12 ? 'AM' : 'PM'}`
}

/** A stored "HH:MM" (the Autopilot window) as the editor reads times: "17:00" → "5:00 PM" / "17:00". Unreadable text comes back as it was. */
export function fmtWallClock(hhmm: string, clock: ClockFormat = clockFormat()): string {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim())
  if (!m || +m[1] > 23 || +m[2] > 59) return hhmm
  return fmtHm(+m[1], +m[2], { clock })
}

/** Time of day: "4:58 PM" / "16:58" (`seconds`: "4:58:07 PM" / "16:58:07"). `tz` keeps a place's own zone (Outreach: the Autopilot window's). */
export function fmtTime(when: When, o: TimeOpts = {}): string {
  const p = partsOf(when, o.tz)
  if (!p) return ''
  return fmtHm(p.h, p.mi, { seconds: o.seconds ? p.s : undefined, clock: o.clock })
}

/** Date and time: "Sun 1 Nov 4:58 PM" / "Sun 1 Nov 16:58" (`weekday: false` drops "Sun", `year: true` adds the year). */
export function fmtDateTime(when: When, o: DateTimeOpts = {}): string {
  const p = partsOf(when, o.tz)
  if (!p) return ''
  const day = `${o.weekday === false ? '' : DOWS[p.dow] + ' '}${p.d} ${MONTHS[p.mo]}${o.year ? ' ' + p.y : ''}`
  return `${day} ${fmtHm(p.h, p.mi, { seconds: o.seconds ? p.s : undefined, clock: o.clock })}`
}

/** Today's events show the time ("4:58 PM"); older ones the date ("1 Nov"). */
export function fmtShortTime(when: When, o: { tz?: string; clock?: ClockFormat; now?: number } = {}): string {
  const p = partsOf(when, o.tz)
  const n = partsOf(o.now ?? Date.now(), o.tz)
  if (!p || !n) return ''
  if (p.y === n.y && p.mo === n.mo && p.d === n.d) return fmtHm(p.h, p.mi, { clock: o.clock })
  return `${p.d} ${MONTHS[p.mo]}`
}
