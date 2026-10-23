// The two things that tie a desk session to the live site beyond sign-in: uploading the rendered Web banner as the
// article's image, and a connection check an editor can run to prove every link of the chain before a real story
// depends on it. Neither stores anything it does not have to: the check reads, and its upload probe sends an empty
// form the site rejects after it has checked the session and the role.

import { SITE_BASE_URL, SUPABASE_ANON_KEY, SUPABASE_URL, CMS_ROLES, ensureFreshSession, siteFetch, siteSessionCookies } from './siteApi'
import type { StaffSession } from './siteApi'
import { listGeminiModels } from './translator'

type Cookie = { name: string; value: string }
interface UploadBridge {
  siteUpload?: (cookies: Cookie[], bytes: Uint8Array, mime: string, name: string) => Promise<{ ok: boolean; url?: string; status?: number; error?: string }>
  siteUploadProbe?: (cookies: Cookie[]) => Promise<{ ok: boolean; status: number; detail: string }>
}
const bridge = (): UploadBridge | undefined => (typeof window !== 'undefined' ? (window as unknown as { esb?: UploadBridge }).esb : undefined)

/** Can this build upload to the site at all? Only the desktop app can send the site its session cookie. */
export const canUploadToSite = () => !!bridge()?.siteUpload

/** Vercel refuses request bodies over 4.5 MB before the site's route runs; the main process enforces 4 MB. */
export const MAX_BANNER_UPLOAD_BYTES = 4 * 1024 * 1024

export type BannerUpload = { ok: true; url: string } | { ok: false; skipped?: boolean; error: string }

/** Upload one rendered banner to the site's media library as the signed-in editor. */
export async function uploadBannerToSite(session: StaffSession | null, banner: Blob, slug: string): Promise<BannerUpload> {
  const b = bridge()
  if (!b?.siteUpload) return { ok: false, skipped: true, error: 'Only the desktop app can upload to the site.' }
  const fresh = await ensureFreshSession(session)
  if (!fresh) return { ok: false, error: 'Sign in to esbpowerline.com first.' }
  if (banner.size > MAX_BANNER_UPLOAD_BYTES) return { ok: false, error: 'The banner is over 4 MB.' }
  const name = (slug || 'banner').toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'banner'
  const bytes = new Uint8Array(await banner.arrayBuffer())
  try {
    const res = await b.siteUpload(siteSessionCookies(fresh), bytes, banner.type || 'image/jpeg', `${name}-web`)
    return res.ok && res.url ? { ok: true, url: res.url } : { ok: false, error: res.error || 'Upload failed.' }
  } catch {
    return { ok: false, error: 'The upload could not be sent.' }
  }
}

export type CheckStatus = 'ok' | 'fail' | 'skip'
export interface ConnectionCheck { id: string; label: string; status: CheckStatus; detail: string }

async function timed(url: string, init: RequestInit = {}, ms = 8000): Promise<Response> {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), ms)
  try {
    return await fetch(url, { ...init, signal: ctrl.signal })
  } finally {
    clearTimeout(t)
  }
}

/**
 * Every link between this desk and the live site, checked in the order a publish uses them. Each step reports what
 * it actually saw; a step that cannot run says why rather than passing.
 */
export async function runConnectionCheck(session: StaffSession | null, geminiKey: string, onStep?: (c: ConnectionCheck[]) => void): Promise<ConnectionCheck[]> {
  const out: ConnectionCheck[] = []
  const push = (c: ConnectionCheck) => { out.push(c); onStep?.([...out]) }

  try {
    const t0 = performance.now()
    const r = await siteFetch(`${SITE_BASE_URL}/feed.xml`, 8000)
    const ms = Math.round(performance.now() - t0)
    push({ id: 'site', label: 'Site online', status: r.ok ? 'ok' : 'fail', detail: r.ok ? `Feed answered in ${ms} ms` : `Feed answered HTTP ${r.status}` })
  } catch {
    push({ id: 'site', label: 'Site online', status: 'fail', detail: 'No answer from the site' })
  }

  try {
    const r = await timed(`${SUPABASE_URL}/auth/v1/health`, { headers: { apikey: SUPABASE_ANON_KEY } })
    push({ id: 'auth', label: 'Sign-in service', status: r.ok ? 'ok' : 'fail', detail: r.ok ? 'Supabase Auth is up' : `HTTP ${r.status}` })
  } catch {
    push({ id: 'auth', label: 'Sign-in service', status: 'fail', detail: 'Supabase Auth did not answer' })
  }

  const fresh = await ensureFreshSession(session).catch(() => null)
  if (!fresh?.token) {
    push({ id: 'session', label: 'Your session', status: session ? 'fail' : 'skip', detail: session ? 'Expired and could not be renewed — sign in again' : 'Not signed in' })
  } else {
    try {
      const r = await timed(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${fresh.token}` } })
      push({ id: 'session', label: 'Your session', status: r.ok ? 'ok' : 'fail', detail: r.ok ? `Valid for ${fresh.email}` : `The site rejected it (HTTP ${r.status}) — sign in again` })
    } catch {
      push({ id: 'session', label: 'Your session', status: 'fail', detail: 'Could not confirm the token' })
    }
  }

  if (fresh) {
    push(fresh.role
      ? { id: 'role', label: 'Newsroom role', status: CMS_ROLES.has(fresh.role) ? 'ok' : 'fail', detail: CMS_ROLES.has(fresh.role) ? `${fresh.role} — may write in the CMS` : `${fresh.role} cannot write in the CMS` }
      : { id: 'role', label: 'Newsroom role', status: 'fail', detail: 'Your profile row could not be read' })
    try {
      const r = await timed(`${SUPABASE_URL}/rest/v1/Article?select=id&limit=1`, { headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${fresh.token}`, Accept: 'application/json' } })
      push({ id: 'articles', label: 'Articles table', status: r.ok ? 'ok' : 'fail', detail: r.ok ? 'Readable with your session' : `HTTP ${r.status}` })
    } catch {
      push({ id: 'articles', label: 'Articles table', status: 'fail', detail: 'No answer from the database' })
    }
    const b = bridge()
    if (!b?.siteUploadProbe) {
      push({ id: 'upload', label: 'Media upload', status: 'skip', detail: 'Checked in the desktop app only' })
    } else {
      try {
        const r = await b.siteUploadProbe(siteSessionCookies(fresh))
        push({ id: 'upload', label: 'Media upload', status: r.ok ? 'ok' : 'fail', detail: r.ok ? 'Allowed — nothing was stored' : r.detail })
      } catch {
        push({ id: 'upload', label: 'Media upload', status: 'fail', detail: 'The probe could not be sent' })
      }
    }
  } else {
    for (const [id, label] of [['role', 'Newsroom role'], ['articles', 'Articles table'], ['upload', 'Media upload']] as const) push({ id, label, status: 'skip', detail: 'Needs a signed-in session' })
  }

  if (!geminiKey.trim()) {
    push({ id: 'gemini', label: 'Gemini translation', status: 'skip', detail: 'No API key set' })
  } else {
    try {
      const models = await listGeminiModels(geminiKey)
      push({ id: 'gemini', label: 'Gemini translation', status: models.length ? 'ok' : 'fail', detail: models.length ? `${models.length} models — best: ${models[0].label}` : 'The key lists no text models' })
    } catch (e) {
      push({ id: 'gemini', label: 'Gemini translation', status: 'fail', detail: (e as Error).message || 'Key rejected' })
    }
  }
  return out
}
