// The two things that tie a desk session to the live site beyond sign-in: uploading the rendered Web banner as the
// article's image, and a connection check an editor can run to prove every link of the chain before a real story
// depends on it. Neither stores anything it does not have to: the check reads, and its upload probe sends an empty
// form the site rejects after it has checked the session and the role.

import { SITE_BASE_URL, SUPABASE_ANON_KEY, SUPABASE_URL, CMS_ROLES, ensureFreshSession, siteFetch, siteSessionCookies } from './siteApi'
import type { StaffSession } from './siteApi'
import { aiFor, listModels, loadAiSettings, providerMeta, roleProvider } from './aiProviders'
import type { AiRole } from './aiProviders'

type Cookie = { name: string; value: string }
interface UploadBridge {
  siteUpload?: (cookies: Cookie[], bytes: Uint8Array, mime: string, name: string) => Promise<{ ok: boolean; url?: string; status?: number; error?: string }>
  siteUploadProbe?: (cookies: Cookie[]) => Promise<{ ok: boolean; status: number; detail: string }>
  siteRevalidate?: (cookies: Cookie[], slugs: string[]) => Promise<{ ok: boolean; status: number; error?: string }>
}
const bridge = (): UploadBridge | undefined => (typeof window !== 'undefined' ? (window as unknown as { esb?: UploadBridge }).esb : undefined)

/** Can this build upload to the site at all? Only the desktop app can send the site its session cookie. */
export const canUploadToSite = () => !!bridge()?.siteUpload

/** Vercel refuses request bodies over 4.5 MB before the site's route runs; the main process enforces 4 MB. */
export const MAX_BANNER_UPLOAD_BYTES = 4 * 1024 * 1024

export type BannerUpload = { ok: true; url: string } | { ok: false; skipped?: boolean; error: string }

/** Upload one rendered banner to the site's media library as the signed-in editor. */
export async function uploadBannerToSite(session: StaffSession | null, banner: Blob, slug: string, suffix = 'web'): Promise<BannerUpload> {
  const b = bridge()
  if (!b?.siteUpload) return { ok: false, skipped: true, error: 'Only the desktop app can upload to the site.' }
  const fresh = await ensureFreshSession(session)
  if (!fresh) return { ok: false, error: 'Sign in to esbpowerline.com first.' }
  if (banner.size > MAX_BANNER_UPLOAD_BYTES) return { ok: false, error: 'The banner is over 4 MB.' }
  const name = (slug || 'banner').toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'banner'
  const bytes = new Uint8Array(await banner.arrayBuffer())
  try {
    const res = await b.siteUpload(siteSessionCookies(fresh), bytes, banner.type || 'image/jpeg', `${name}-${suffix}`)
    return res.ok && res.url ? { ok: true, url: res.url } : { ok: false, error: res.error || 'Upload failed.' }
  } catch {
    return { ok: false, error: 'The upload could not be sent.' }
  }
}

/** A picture inside the story (photo or chart): the same upload, named after the story with a unique tail so nothing overwrites. */
export const uploadBodyImage = (session: StaffSession | null, image: Blob, slug: string): Promise<BannerUpload> =>
  uploadBannerToSite(session, image, slug, 'fig-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5))

/**
 * After the Studio saves an article straight into the database, ask the site to refresh its cached public pages for it
 * (the CMS does this itself; the Studio bypasses the CMS). Best effort: a failure only means the pages catch up on
 * their own timer (10 to 15 minutes), so it returns a short note instead of throwing.
 */
export async function refreshSite(session: StaffSession | null, slugs: string[]): Promise<{ ok: boolean; note: string }> {
  const b = bridge()
  if (!b?.siteRevalidate) return { ok: false, note: 'The browser preview cannot refresh the site; the pages update within 15 minutes.' }
  const fresh = await ensureFreshSession(session)
  if (!fresh) return { ok: false, note: 'Not signed in, so the site pages will catch up within 15 minutes.' }
  try {
    const r = await b.siteRevalidate(siteSessionCookies(fresh), slugs)
    if (r.ok) return { ok: true, note: 'The site pages were refreshed.' }
    if (r.status === 404) return { ok: false, note: 'The site has no refresh route yet, so the pages catch up within 15 minutes.' }
    return { ok: false, note: `The site refresh did not go through (${r.error ?? 'error'}); the pages catch up within 15 minutes.` }
  } catch {
    return { ok: false, note: 'The site refresh could not be sent; the pages catch up within 15 minutes.' }
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
/** `scope: 'site'` runs only what the website needs (site, sign-in service, session, role, articles, media upload); 'all' adds the AI keys. */
export async function runConnectionCheck(session: StaffSession | null, onStep?: (c: ConnectionCheck[]) => void, scope: 'site' | 'all' = 'all'): Promise<ConnectionCheck[]> {
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

  if (scope === 'site') return out

  // each AI provider a job is given — the key it holds, and whether it still answers
  const settings = loadAiSettings()
  if (settings.paused) { push({ id: 'ai-off', label: 'AI providers', status: 'skip', detail: 'AI is OFF' }); return out }
  const jobs: [AiRole, string][] = [['main', 'Main'], ['seo', 'SEO'], ['social', 'Social']]
  const providers = [...new Set(jobs.map(([role]) => roleProvider(settings, role)))]
  for (const provider of providers) {
    const name = providerMeta(provider).name
    const used = jobs.filter(([role]) => roleProvider(settings, role) === provider).map(([, label]) => label).join(' · ')
    const ai = aiFor(jobs.find(([role]) => roleProvider(settings, role) === provider)![0], settings)
    if (!ai) { push({ id: 'ai-' + provider, label: `${name} (${used})`, status: 'skip', detail: 'No API key set' }); continue }
    try {
      const models = await listModels(ai.provider, ai.key)
      push({ id: 'ai-' + provider, label: `${name} (${used})`, status: models.length ? 'ok' : 'fail', detail: models.length ? `${models.length} models — e.g. ${models[0].label}` : 'The key lists no text models' })
    } catch (e) {
      push({ id: 'ai-' + provider, label: `${name} (${used})`, status: 'fail', detail: (e as Error).message || 'Key rejected' })
    }
  }
  return out
}
