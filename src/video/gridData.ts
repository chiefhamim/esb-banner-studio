// The Video desk's way to esbpowerline.com's grid data: through the main process (electron/grid-data.cjs), with the
// editor's site session. The renderer never fetches the site itself (the site refuses a cross-origin read and the
// session cookie cannot be sent from here). What comes back is checked again with the prebuild's parseGridDay.

import { ensureFreshSession, getStoredStaffSession, siteSessionCookies, CMS_ROLES, type StaffSession } from '../editorial/siteApi'
import { GridDataError, parseGridDay } from './titles/grid'
import type { FetchedDay } from './dataCardClip'

type Cookie = { name: string; value: string }
interface GridAnswer { ok: boolean; code?: string; error?: string; status?: number; iso?: string; fetchedAt?: string; source?: string; data?: unknown; cached?: boolean; cachedLatest?: string | null }
interface GridBridge {
  gridDay?: (cookies: Cookie[] | null, iso: string, opts?: { refresh?: boolean }) => Promise<GridAnswer>
  gridLatest?: (cookies: Cookie[] | null) => Promise<GridAnswer>
  gridCached?: (iso: string) => Promise<GridAnswer>
  gridCachedDates?: () => Promise<string[]>
}
const bridge = (): GridBridge | undefined => (typeof window !== 'undefined' ? (window as unknown as { esb?: GridBridge }).esb : undefined)

/** Only the desktop app can read the site's grid data (main process, session cookie). */
export const canFetchGrid = () => !!bridge()?.gridDay

export type GridResult = { ok: true; fetched: FetchedDay; cached: boolean } | { ok: false; code: string; error: string; cachedLatest?: string | null }

/** The access window a session has on the site's grid archive (grid-tier-access.ts): staff full, members 30 days,
 * everyone else 7. Shown with a 403 "Subscription required". */
export function accessWindowText(session: StaffSession | null): string {
  if (session?.role && CMS_ROLES.has(session.role)) return 'Outside your access window (staff accounts see the full archive; the site did not recognise this session as staff)'
  if (session?.role === 'SUBSCRIBER') return 'Outside your access window: latest 30 days'
  return 'Outside your access window: latest 7 days'
}

function toResult(a: GridAnswer, iso: string | null, session: StaffSession | null): GridResult {
  if (!a || typeof a !== 'object') return { ok: false, code: 'bad-data', error: 'No answer from the app.' }
  if (!a.ok) {
    const error = a.code === 'window' ? accessWindowText(session) : a.code === 'signed-out' ? 'Not signed in' + (a.error && a.error !== 'Not signed in.' ? ` — ${a.error.replace(/^Not signed in[:.]?\s*/, '')}` : '') : a.error ?? 'Failed.'
    return { ok: false, code: a.code ?? 'error', error, cachedLatest: a.cachedLatest }
  }
  const day = (a.iso ?? iso) as string
  try {
    return { ok: true, fetched: { day: parseGridDay(a.data, day), fetchedAt: String(a.fetchedAt), source: String(a.source) }, cached: !!a.cached }
  } catch (e) {
    return { ok: false, code: 'bad-data', error: e instanceof GridDataError ? `The file did not read as a daily report: ${e.message}` : 'The file did not read as a daily report.' }
  }
}

async function cookies(): Promise<{ session: StaffSession | null; cookies: Cookie[] | null }> {
  const fresh = await ensureFreshSession(getStoredStaffSession()).catch(() => null)
  return { session: fresh, cookies: fresh ? siteSessionCookies(fresh) : null }
}

/** One day (the saved copy unless `refresh`). */
export async function loadGridDay(iso: string, refresh = false): Promise<GridResult> {
  const b = bridge()
  if (!b?.gridDay) return { ok: false, code: 'no-app', error: 'Grid data is read in the desktop app only.' }
  const { session, cookies: c } = await cookies()
  try {
    return toResult(await b.gridDay(c, iso, { refresh }), iso, session)
  } catch {
    return { ok: false, code: 'error', error: 'The request could not be sent.' }
  }
}

/** The newest published day. */
export async function loadLatestGridDay(): Promise<GridResult> {
  const b = bridge()
  if (!b?.gridLatest) return { ok: false, code: 'no-app', error: 'Grid data is read in the desktop app only.' }
  const { session, cookies: c } = await cookies()
  try {
    return toResult(await b.gridLatest(c), null, session)
  } catch {
    return { ok: false, code: 'error', error: 'The request could not be sent.' }
  }
}

/** A saved copy only (never the network). */
export async function cachedGridDay(iso: string): Promise<GridResult> {
  const b = bridge()
  if (!b?.gridCached) return { ok: false, code: 'no-app', error: 'Grid data is read in the desktop app only.' }
  try {
    return toResult(await b.gridCached(iso), iso, null)
  } catch {
    return { ok: false, code: 'error', error: 'The saved copy could not be read.' }
  }
}

export async function cachedGridDates(): Promise<string[]> {
  try { const d = await bridge()?.gridCachedDates?.(); return Array.isArray(d) ? d.filter((x) => typeof x === 'string') : [] } catch { return [] }
}
