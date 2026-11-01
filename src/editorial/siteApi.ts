import { fmtTime } from '../ui/time'
// Live communication and synchronization bridge between ESB Studio and https://esbpowerline.com
// Implements genuine Supabase Auth against sxgokpmrbgdndstygapc.supabase.co
// and replicates the exact CMS schema and API contracts of the esbpowerline repository.

export const SITE_BASE_URL = 'https://esbpowerline.com'
export const SUPABASE_URL = 'https://sxgokpmrbgdndstygapc.supabase.co'
export const SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InN4Z29rcG1yYmdkbmRzdHlnYXBjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE1ODk1ODEsImV4cCI6MjA5NzE2NTU4MX0.SwZbIiktG0pMwpgcLtAr6R5QOdU1M2ucRkbZZ3WIST8'

export interface SiteStatus {
  connected: boolean
  latencyMs: number
  lastChecked: string
  /** When the check ran (ms); shown through ui/time so the 12/24-hour setting applies at once. */
  checkedAt?: number
  version?: string
  statusText?: string
  /** The site's auth service ended this sign-in (signed in elsewhere): uploads are refused until the editor signs in again. */
  sessionEnded?: boolean
}

export interface LiveArticleSummary {
  title: string
  link: string
  category: string
  publishedAt: string
  slug: string
  description?: string
  imageUrl?: string
  author?: string
}

/** A signed-in esbpowerline.com staff account: the same Supabase Auth session the site's own /login creates. */
export interface StaffSession {
  email: string
  name: string
  /** The site's role (SUPER_ADMIN, ADMIN, EDITOR, AUTHOR, CONTRIBUTOR), or null when only the site itself can tell. */
  role: string | null
  token?: string
  refreshToken?: string
  /** Unix seconds when the access token expires. */
  expiresAt?: number
  userId?: string
  /** The Supabase user object, kept so the site can be handed the exact session it would have created. */
  user?: Record<string, unknown>
  authenticatedAt: string
  authType: 'supabase'
}

export interface CmsArticlePayload {
  title: string
  shortTitle?: string | null
  slug: string
  excerpt: string
  content: string
  readTime?: number
  category: string
  status: 'DRAFT' | 'IN_REVIEW' | 'PUBLISHED' | 'SCHEDULED' | 'ARCHIVED'
  imageUrl?: string
  imageCredit?: string | null
  tags: string[]
  isFeatured?: boolean
  isBreaking?: boolean
  isPinned?: boolean
  isTrending?: boolean
  postAsNewsDesk?: boolean
  seo: {
    metaTitle?: string
    metaDescription?: string
    focusKeyword?: string
    heroImage?: {
      caption?: string
      alt?: string
    }
  }
}

const SESSION_STORAGE_KEY = 'esb-banner-studio/site-session'

/**
 * One place that talks to esbpowerline.com. Uses the desktop net-guard bridge when available
 * (returns `{ ok, html, code, error }`), otherwise falls back to a browser fetch.
 * Always resolves to `{ ok, status, text }` so callers never depend on bridge internals.
 */
export async function siteFetch(url: string, timeoutMs = 8000): Promise<{ ok: boolean; status: number; text: string }> {
  try {
    const bridge = typeof window !== 'undefined' ? (window as any).esb : undefined
    if (bridge?.fetchUrl) {
      const res = await bridge.fetchUrl(url, { timeoutMs })
      if (res?.ok) return { ok: true, status: 200, text: String(res.html ?? res.body ?? '') }
      const m = String(res?.error || '').match(/HTTP (\d{3})/)
      return { ok: false, status: m ? Number(m[1]) : 0, text: '' }
    }
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), timeoutMs)
    try {
      const res = await fetch(url, { signal: ctrl.signal })
      return { ok: res.ok, status: res.status, text: res.ok ? await res.text() : '' }
    } finally {
      clearTimeout(timer)
    }
  } catch {
    return { ok: false, status: 0, text: '' }
  }
}

/** Check connectivity and response latency to esbpowerline.com */
export async function checkSiteConnection(): Promise<SiteStatus> {
  const start = performance.now()
  try {
    const res = await siteFetch(`${SITE_BASE_URL}/feed.xml`, 6000)
    const ok = res.ok

    const latencyMs = Math.round(performance.now() - start)
    return {
      connected: ok,
      latencyMs: latencyMs || 120,
      lastChecked: fmtTime(Date.now(), { seconds: true }),
      checkedAt: Date.now(),
      statusText: ok ? 'Online & Synchronized' : 'Site Unreachable',
    }
  } catch (err: any) {
    const latencyMs = Math.round(performance.now() - start)
    return {
      connected: false,
      latencyMs,
      lastChecked: fmtTime(Date.now(), { seconds: true }),
      checkedAt: Date.now(),
      statusText: err?.message || 'Connection Failed',
    }
  }
}

function cleanXmlEntities(str: string): string {
  return str
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .trim()
}

/** Fetch live articles directly from esbpowerline.com RSS feed */
export async function fetchLiveArticles(): Promise<{ articles: LiveArticleSummary[]; categories: string[] }> {
  try {
    const xmlText = (await siteFetch(`${SITE_BASE_URL}/feed.xml`)).text

    if (!xmlText) return { articles: [], categories: [] }

    const itemMatches = [...xmlText.matchAll(/<item>([\s\S]*?)<\/item>/g)]
    const articles: LiveArticleSummary[] = []
    const categorySet = new Set<string>()

    for (const match of itemMatches) {
      const block = match[1]
      const rawTitle = (block.match(/<title>([\s\S]*?)<\/title>/) || [])[1] || ''
      const rawLink = (block.match(/<link>([\s\S]*?)<\/link>/) || [])[1] || ''
      const rawDesc = (block.match(/<description>([\s\S]*?)<\/description>/) || [])[1] || ''
      const rawCategory = (block.match(/<category>([\s\S]*?)<\/category>/) || [])[1] || 'General'
      const rawPubDate = (block.match(/<pubDate>([\s\S]*?)<\/pubDate>/) || [])[1] || ''
      const rawCreator = (block.match(/<dc:creator>([\s\S]*?)<\/dc:creator>/) || [])[1] || ''
      const rawEnclosure = (block.match(/<enclosure\s+url="([^"]+)"/) || [])[1] || ''

      const title = cleanXmlEntities(rawTitle)
      const link = cleanXmlEntities(rawLink)
      const description = cleanXmlEntities(rawDesc)
      const category = cleanXmlEntities(rawCategory)
      const author = cleanXmlEntities(rawCreator) || 'ESB News Desk'
      const imageUrl = rawEnclosure.trim()

      const slugMatch = link.match(/\/articles\/([^/?#]+)/)
      const slug = slugMatch ? slugMatch[1] : ''

      if (title && link) {
        articles.push({
          title,
          link,
          category,
          publishedAt: rawPubDate.trim(),
          slug,
          description,
          imageUrl,
          author,
        })
        categorySet.add(category)
      }
    }

    return {
      articles,
      categories: Array.from(categorySet),
    }
  } catch {
    return { articles: [], categories: [] }
  }
}

/** Fetch full article body text from esbpowerline.com */
export async function fetchLiveArticleBody(slug: string): Promise<string> {
  const clean = slug.trim().toLowerCase()
  if (!clean) return ''
  try {
    const html = (await siteFetch(`${SITE_BASE_URL}/articles/${clean}`)).text

    if (!html) return ''
    const match = html.match(/class="article-body[^"]*"[^>]*>([\s\S]*?)<\/div>/i)
    if (match) {
      return match[1]
        .replace(/<p[^>]*>/gi, '')
        .replace(/<\/p>/gi, '\n\n')
        .replace(/<[^>]+>/g, '')
        .replace(/&amp;/g, '&')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .trim()
    }
    return ''
  } catch {
    return ''
  }
}

/** Check if an article slug already exists on esbpowerline.com */
export async function checkSlugAvailability(slug: string): Promise<'available' | 'taken' | 'unknown'> {
  const clean = slug.trim().toLowerCase()
  if (!clean || clean.length < 3) return 'unknown'

  try {
    const res = await siteFetch(`${SITE_BASE_URL}/articles/${clean}`, 6000)
    if (res.ok) return 'taken'
    if (res.status === 404) return 'available'
    return 'unknown'
  } catch {
    return 'unknown'
  }
}

/** Retrieve the staff session from storage. Sessions from the old desk (newsroom bypass, no token) are discarded. */
export function getStoredStaffSession(): StaffSession | null {
  try {
    const raw = localStorage.getItem(SESSION_STORAGE_KEY)
    if (!raw) return null
    const s = JSON.parse(raw) as StaffSession
    if (s.authType !== 'supabase' || !s.token) { localStorage.removeItem(SESSION_STORAGE_KEY); return null }
    return s
  } catch {
    return null
  }
}

export function saveStaffSession(session: StaffSession) {
  try { localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session)) } catch { /* ignore */ }
  try { window.dispatchEvent(new CustomEvent('esb-session', { detail: session })) } catch { /* no window: tests */ }
}

export function clearStaffSession() {
  try { localStorage.removeItem(SESSION_STORAGE_KEY) } catch { /* ignore */ }
}

// Same wording as the site's lib/auth-error-copy.ts: an editor sees what they can act on, never the provider's
// operational detail.
const AUTH_ERRORS: Array<[RegExp, string]> = [
  [/invalid login credentials|invalid_grant|user not found/i, 'Invalid email or password. Check your credentials and try again.'],
  [/email not confirmed/i, 'This address has not been confirmed yet. Check your inbox for the confirmation link.'],
  [/too many requests|rate limit|for security purposes/i, 'Too many attempts. Wait a minute and try again.'],
]
export function friendlyAuthError(raw: string): string {
  for (const [re, msg] of AUTH_ERRORS) if (re.test(raw)) return msg
  return 'Sign-in is temporarily unavailable. Please try again shortly.'
}

const VALID_ROLES = new Set(['SUPER_ADMIN', 'ADMIN', 'EDITOR', 'AUTHOR', 'CONTRIBUTOR', 'SUBSCRIBER'])
const normalizeRole = (v: unknown) => (typeof v === 'string' && VALID_ROLES.has(v.trim().toUpperCase()) ? v.trim().toUpperCase() : null)
/** Roles the site lets into /cms to write (lib/constants.ts `article.create`). */
export const CMS_ROLES = new Set(['SUPER_ADMIN', 'ADMIN', 'EDITOR', 'AUTHOR', 'CONTRIBUTOR'])

interface TokenResponse { access_token: string; refresh_token: string; expires_in?: number; expires_at?: number; token_type?: string; user?: { id: string; email?: string; user_metadata?: Record<string, unknown>; app_metadata?: Record<string, unknown> } & Record<string, unknown> }

async function authFetch(path: string, body: unknown): Promise<{ ok: boolean; data: TokenResponse & { error?: string; error_description?: string; msg?: string; message?: string } }> {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/${path}`, {
    method: 'POST',
    headers: { apikey: SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const data = await res.json().catch(() => ({}))
  return { ok: res.ok, data }
}

/** Turn a token response into a session, reading name, role and status the way the site does (lib/auth.ts). */
async function sessionFromTokens(t: TokenResponse, fallbackEmail: string): Promise<{ session?: StaffSession; error?: string }> {
  const user = t.user
  if (!user?.id) return { error: 'Sign-in is temporarily unavailable. Please try again shortly.' }
  type ProfileRow = { role?: string | null; status?: string | null; full_name?: string | null }
  let profile: ProfileRow | null = null
  try {
    // RLS on profiles lets a signed-in account read its own row and nothing else (migration 0018).
    const res = await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${encodeURIComponent(user.id)}&select=role,status,full_name`, {
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${t.access_token}`, Accept: 'application/json' },
    })
    if (res.ok) profile = ((await res.json()) as ProfileRow[])[0] ?? null
  } catch { /* the site still checks the role itself when the CMS opens */ }
  if (profile?.status === 'SUSPENDED') return { error: 'This account has been suspended. Contact an administrator.' }
  if (profile?.status === 'PENDING') return { error: 'This account is waiting for approval. Contact an administrator.' }
  const role = normalizeRole(profile?.role) ?? normalizeRole(user.app_metadata?.role)
  if (role === 'SUBSCRIBER') return { error: 'This is a member account, not a newsroom account. Use an editor login.' }
  const meta = user.user_metadata ?? {}
  const email = (user.email ?? fallbackEmail).toLowerCase()
  const name = (profile?.full_name || (typeof meta.full_name === 'string' ? meta.full_name : '') || (typeof meta.name === 'string' ? meta.name : '') || email.split('@')[0]).trim()
  return {
    session: {
      email,
      name,
      role,
      token: t.access_token,
      refreshToken: t.refresh_token,
      expiresAt: t.expires_at ?? Math.floor(Date.now() / 1000) + (t.expires_in ?? 3600),
      userId: user.id,
      user,
      authenticatedAt: new Date().toISOString(),
      authType: 'supabase',
    },
  }
}

/**
 * Sign in with an esbpowerline.com staff account — the same Supabase Auth password sign-in the site's /login page
 * performs (app/login/actions.ts), then the same role and status checks. There is no offline or "bypass" path: a
 * session exists only when the site's auth service issued it.
 */
export async function authenticateStaff(email: string, password: string): Promise<{ success: boolean; session?: StaffSession; error?: string }> {
  const normEmail = email.trim().toLowerCase()
  if (!normEmail || !password) return { success: false, error: 'Email and password are required.' }
  try {
    const { ok, data } = await authFetch('token?grant_type=password', { email: normEmail, password })
    if (!ok) return { success: false, error: friendlyAuthError(data.error_description || data.msg || data.message || data.error || '') }
    const { session, error } = await sessionFromTokens(data, normEmail)
    if (!session) return { success: false, error }
    saveStaffSession(session)
    return { success: true, session }
  } catch {
    return { success: false, error: 'Could not reach esbpowerline.com. Check the connection and try again.' }
  }
}

/**
 * A session good for at least five more minutes. A Supabase refresh token is SINGLE USE: each refresh returns a new one and
 * the old one is dead, and presenting a dead one again is treated as theft and ends the whole session. So three rules:
 * always refresh from the NEWEST saved copy (never a stale object held in memory), refresh one at a time (a second caller
 * waits for the first and shares its result), and save the new tokens at once. The refreshed session is broadcast so the
 * desk's own copy never goes stale.
 */
let refreshing: Promise<StaffSession | null> | null = null
export async function ensureFreshSession(passed: StaffSession | null): Promise<StaffSession | null> {
  const session = getStoredStaffSession() ?? passed
  if (!session?.token) return null
  if (session.expiresAt && session.expiresAt - Date.now() / 1000 > 300) return session
  if (!session.refreshToken) return null
  if (refreshing) return refreshing
  refreshing = (async () => {
    try {
      const { ok, data } = await authFetch('token?grant_type=refresh_token', { refresh_token: session.refreshToken })
      if (!ok) return null
      const next = await sessionFromTokens(data, session.email)
      if (next.session) saveStaffSession(next.session)
      return next.session ?? null
    } catch {
      return null
    } finally {
      refreshing = null
    }
  })()
  return refreshing
}

/**
 * Is this sign-in still alive on the site? The database accepts a token until it expires, but the auth service ends a
 * session when it is signed out elsewhere (the CMS in a browser, another device) - then the site refuses uploads even
 * though reading still works. Returns the HTTP status when it is refused, else null.
 */
export async function sessionRefusedBySite(session: StaffSession | null): Promise<number | null> {
  if (!session?.token) return 401
  try {
    const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${session.token}` } })
    return r.ok ? null : r.status
  } catch {
    return null // no answer: do not block on a network blip; the publish reports its own errors
  }
}

/** Sign out on the site's auth service too, so the refresh token stops working. */
export async function signOutStaff(session: StaffSession | null) {
  clearStaffSession()
  if (!session?.token) return
  try {
    await fetch(`${SUPABASE_URL}/auth/v1/logout`, { method: 'POST', headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${session.token}` } })
  } catch { /* already signed out locally */ }
}

/**
 * The site's own session cookie for this sign-in, exactly as @supabase/ssr 0.12 writes it: name
 * `sb-<project-ref>-auth-token`, value `base64-` + base64url(JSON session), split into `.0`, `.1`… chunks when the
 * URI-encoded value passes 3,180 characters. Setting these on esbpowerline.com signs that browser in as this editor.
 */
export function siteSessionCookies(session: StaffSession): { name: string; value: string }[] {
  if (!session.token) return []
  const ref = new URL(SUPABASE_URL).hostname.split('.')[0]
  const key = `sb-${ref}-auth-token`
  const json = JSON.stringify({
    access_token: session.token,
    token_type: 'bearer',
    expires_in: Math.max(0, (session.expiresAt ?? 0) - Math.floor(Date.now() / 1000)),
    expires_at: session.expiresAt,
    // Never the Studio's own refresh token: the site would rotate it and the Studio's copy would die (a used token ends the
    // whole session). The CMS window lives on this access token (about an hour); the Studio keeps its own sign-in.
    refresh_token: 'studio-managed',
    user: session.user ?? { id: session.userId, email: session.email },
  })
  const bytes = new TextEncoder().encode(json)
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  const value = 'base64-' + btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  const MAX = 3180
  if (encodeURIComponent(value).length <= MAX) return [{ name: key, value }]
  // base64url is URI-safe, so the encoded length equals the raw length and chunks can be cut directly
  const out: { name: string; value: string }[] = []
  for (let i = 0, n = 0; i < value.length; i += MAX, n++) out.push({ name: `${key}.${n}`, value: value.slice(i, i + MAX) })
  return out
}

/** The site stores article bodies as HTML paragraphs (`<p>…</p>`), so plain text must be converted. */
export function bodyToHtml(body: string): string {
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  return body
    .replace(/\r/g, '')
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => `<p>${esc(p).replace(/\n/g, '<br />')}</p>`)
    .join('\n')
}

/** Construct standard ArticleInput payload matching the esbpowerline `Article` table / CMS createArticle action */
export function buildCmsArticlePayload(params: {
  headline: string
  deck: string
  slug: string
  body: string
  /** The story as the site's HTML, when it has formatting; otherwise the plain body becomes paragraphs. */
  bodyHtml?: string
  category: string
  tags?: string[]
  metaTitle?: string
  metaDescription?: string
  focusKeywords?: string
  focusKeyphrase?: string
  imageUrl?: string
  imageAlt?: string
  imageCaption?: string
  credit?: string
  byline?: string
  postAsNewsDesk?: boolean
  status?: 'DRAFT' | 'IN_REVIEW' | 'PUBLISHED' | 'SCHEDULED' | 'ARCHIVED'
}): CmsArticlePayload {
  const cleanHeadline = params.headline.trim().slice(0, 104)
  const cleanDeck = params.deck.trim().slice(0, 200)
  const cleanSlug = params.slug.trim().toLowerCase().slice(0, 80)
  const tagList = params.tags && params.tags.length > 0
    ? params.tags
    : params.focusKeywords
    ? params.focusKeywords.split(',').map((t) => t.trim()).filter(Boolean)
    : []

  return {
    title: cleanHeadline,
    shortTitle: cleanHeadline.length > 60 ? cleanHeadline.slice(0, 58) + '…' : null,
    slug: cleanSlug,
    excerpt: cleanDeck,
    content: params.bodyHtml || bodyToHtml(params.body),
    readTime: Math.max(1, Math.ceil(params.body.trim().split(/\s+/).filter(Boolean).length / 200)),
    category: params.category || 'Fossil Fuels & Commodities',
    status: 'PUBLISHED',
    // only a link the site can serve: a photo opened from disk is a blob: URL that exists in this window alone
    imageUrl: params.imageUrl && /^https:\/\//.test(params.imageUrl) ? params.imageUrl : undefined,
    imageCredit: params.credit?.trim() || undefined,
    tags: tagList,
    isFeatured: false,
    isBreaking: false,
    isPinned: false,
    isTrending: false,
    postAsNewsDesk: !!params.postAsNewsDesk,
    seo: {
      metaTitle: params.metaTitle || cleanHeadline,
      metaDescription: params.metaDescription || cleanDeck,
      focusKeyword: params.focusKeyphrase?.trim() || tagList[0] || '',
      // The site prints heroImage.caption under the photo, right below the deck — so the deck must never be used as
      // the caption (it printed every Studio story's deck twice). Alt describes the photo; the headline is only the
      // site's own fallback when there is none.
      heroImage: {
        alt: params.imageAlt?.trim() || cleanHeadline,
        ...(params.imageCaption?.trim() ? { caption: params.imageCaption.trim() } : {}),
      },
    },
  }
}

/** Official Category mapping for esbpowerline.com matching public.Category */
export const ESB_CATEGORIES: Record<string, { id: string; slug: string; name: string }> = {
  'Consumers & Tariffs': { id: 'cmqv473nh000avk55ur3yty0p', slug: 'consumers-tariffs', name: 'Consumers & Tariffs' },
  'Distribution & Utilities': { id: 'cmqv473nh0009vk55nefpoof1', slug: 'distribution-utilities', name: 'Distribution & Utilities' },
  'Energy Policy & Regulators': { id: 'cmqv473nh0004vk55oaccbbvz', slug: 'energy-policy-regulators', name: 'Energy Policy & Regulators' },
  'Environment & Efficiency': { id: 'cmqv473nh000dvk55qsg8qbkd', slug: 'environment-efficiency', name: 'Environment & Efficiency' },
  'Fossil Fuels & Commodities': { id: 'cmqv473nh0006vk555w03ngbq', slug: 'fossil-fuels-commodities', name: 'Fossil Fuels & Commodities' },
  'Grid & Transmission': { id: 'cmqv473nh0008vk55hv4ga5ls', slug: 'grid-transmission', name: 'Grid & Transmission' },
  'International & Cross-Border': { id: 'cmqv473nh000cvk559jgrh40y', slug: 'international-cross-border', name: 'International & Cross-Border' },
  'Market, Finance & Subsidies': { id: 'cmqv473nh000bvk55mu43hu0w', slug: 'market-finance-subsidies', name: 'Market, Finance & Subsidies' },
  'Power Generation': { id: 'cmqv473nh0005vk55cyytt3r4', slug: 'power-generation', name: 'Power Generation' },
  'Renewables & Nuclear': { id: 'cmqv473nh0007vk55fyfwonza', slug: 'renewables-nuclear', name: 'Renewables & Nuclear' },
}

/** The site's author record (public.User) for each staff account, keyed by the SHA-256 of the account's lower-case
 * email — so the shipped app carries no one's address, and a signed-in session still finds its own record. The names
 * are the public bylines on esbpowerline.com. `newsDesk` marks the shared desk account, whose posts go out as the desk. */
export interface SiteAuthor { id: string; name: string; role: string; newsDesk?: boolean }
export const ESB_AUTHORS: Record<string, SiteAuthor> = {
  e0949ef415de7fe4a72e0d9f1c44c59a82c60ef78b35ba8d23b0aa4c4bc4e3f1: { id: 'cmqv471bq0001vk55aw07256e', name: 'Mehedi Hasan Hamim', role: 'EDITOR' },
  '953e07d714089108dd65eefdadeed299cd02803d3c3f639791534107e863c5e1': { id: 'cmqv471700000vk55trr7n8df', name: 'ESB NEWS DESK', role: 'SUPER_ADMIN', newsDesk: true },
  ea3930a44d4f0c5c9c3bc2eff2026969499763aea67c5a4694a45709b83fb9cf: { id: 'cmqv471gb0002vk55sozpxt7p', name: 'Sheikh Rasel', role: 'EDITOR' },
  e2912d649e362102e78c8dd634362e571daddc35ab51ea5f85d1e1ad3c5a8542: { id: 'cmtveuqkv000004jm5sjwsqox', name: 'Faisal Al Mahmud', role: 'EDITOR' },
  '53ab50c34db9e4c1c328cc1feea9313853d6701bd3343ad55b3c01d6ddbdf1d3': { id: 'cmttn1o9s000204igmykknlg9', name: 'Yeasin Fiyaz', role: 'EDITOR' },
}

export async function emailKey(email: string): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(email.trim().toLowerCase()))
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/** The site author for a signed-in email, or undefined when the Studio does not know it. */
export async function authorFor(email: string): Promise<SiteAuthor | undefined> {
  return ESB_AUTHORS[await emailKey(email)]
}

// dev server only (like __store): the end-to-end test registers a synthetic example.com author, so no test needs a
// real staff address to exercise publishing
if ((import.meta as unknown as { env?: { DEV?: boolean } }).env?.DEV && typeof window !== 'undefined') {
  Object.assign(window, { __addTestAuthor: async (email: string, a: SiteAuthor) => { ESB_AUTHORS[await emailKey(email)] = a } })
}

/** Helper to generate a collision-resistant CUID-formatted ID compatible with Prisma `@default(cuid())` */
export function generateCuid(): string {
  const timestamp = Date.now().toString(36)
  const randomPart = Math.random().toString(36).substring(2, 10) + Math.random().toString(36).substring(2, 10)
  return `cmv${timestamp}${randomPart}`.substring(0, 25)
}

export interface InsertArticleResult {
  success: boolean
  /** True when the save changed an article already on the site rather than creating one. */
  updated?: boolean
  articleId?: string
  slug?: string
  liveUrl?: string
  error?: string
}

/**
 * Directly insert an article into Supabase PostgreSQL (public.Article)
 * Compatible with genuine Supabase auth sessions and verified staff bypasses.
 */
export async function insertArticleToSupabase(
  payload: CmsArticlePayload,
  session?: StaffSession | null,
  opts: { updateId?: string } = {},
): Promise<InsertArticleResult> {
  try {
    if (!payload.title?.trim()) {
      return { success: false, error: 'Headline is required before publishing.' }
    }
    if (!payload.content?.trim()) {
      return { success: false, error: 'Article story body is required before publishing.' }
    }
    if (!payload.slug?.trim()) {
      return { success: false, error: 'Article URL slug is required.' }
    }

    // Writing to the site needs a signed-in staff session; the public key is never used to write.
    if (!session?.token) {
      return { success: false, error: 'Sign in with your esbpowerline.com editor account before publishing.' }
    }
    if (session.role && !CMS_ROLES.has(session.role)) {
      return { success: false, error: `A ${session.role.toLowerCase()} account cannot publish articles.` }
    }

    // Resolve Category ID
    const categoryInfo = ESB_CATEGORIES[payload.category] || ESB_CATEGORIES['Fossil Fuels & Commodities']

    // The article is credited to the account that signed in — never to someone else's.
    const author = await authorFor(session.email)
    if (!author) {
      return { success: false, error: `${session.email} is signed in, but the Studio does not know its author record on the site yet. Use "Open the site CMS" to publish from the site itself.` }
    }

    const id = opts.updateId || generateCuid()
    const nowIso = new Date().toISOString()
    const status = payload.status || 'PUBLISHED'

    const record = {
      id,
      title: payload.title.trim(),
      shortTitle: payload.shortTitle?.trim() || null,
      slug: payload.slug.trim().toLowerCase(),
      excerpt: payload.excerpt?.trim() || null,
      content: payload.content,
      authorId: author.id,
      publishedAt: status === 'PUBLISHED' ? nowIso : null,
      status,
      category: categoryInfo.name,
      categoryId: categoryInfo.id,
      imageUrl: payload.imageUrl || null,
      imageCredit: payload.imageCredit?.trim() || null,
      readTime: payload.readTime || Math.max(1, Math.ceil(payload.content.length / 1000)),
      views: 0,
      likes: 0,
      isFeatured: !!payload.isFeatured,
      isBreaking: !!payload.isBreaking,
      isPinned: !!payload.isPinned,
      isTrending: !!payload.isTrending,
      postAsNewsDesk: !!payload.postAsNewsDesk || !!author.newsDesk,
      tags: Array.isArray(payload.tags) ? payload.tags : [],
      seo: payload.seo || {},
      locale: 'en',
      version: 1,
      editorTrash: false,
      createdAt: nowIso,
      updatedAt: nowIso,
    }

    const headers: Record<string, string> = {
      'apikey': SUPABASE_ANON_KEY,
      'Authorization': `Bearer ${session.token}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=minimal',
    }

    let res: Response
    if (opts.updateId) {
      // Updating keeps what the site owns: author, creation time, first publish time, views and likes.
      const cur = await findArticle({ id: opts.updateId }, session)
      if (!cur) return { success: false, error: 'That article is no longer on esbpowerline.com (it may have been deleted). Publish it again as a new article.' }
      const { id: _id, authorId: _a, createdAt: _c, views: _v, likes: _l, version: _ver, locale: _loc, editorTrash: _t, ...changes } = record
      void _id; void _a; void _c; void _v; void _l; void _ver; void _loc; void _t
      const patch: Record<string, unknown> = { ...changes, publishedAt: status === 'PUBLISHED' ? cur.publishedAt || nowIso : cur.publishedAt ?? null, updatedAt: nowIso }
      // no new image this time: the one on the site stays
      if (!payload.imageUrl) delete patch.imageUrl
      res = await fetch(`${SUPABASE_URL}/rest/v1/Article?id=eq.${encodeURIComponent(opts.updateId)}`, { method: 'PATCH', headers, body: JSON.stringify(patch) })
    } else {
      res = await fetch(`${SUPABASE_URL}/rest/v1/Article`, { method: 'POST', headers, body: JSON.stringify(record) })
    }

    if (res.status === 201 || res.ok) {
      const liveUrl = `${SITE_BASE_URL}/articles/${record.slug}`
      return {
        success: true,
        updated: !!opts.updateId,
        articleId: id,
        slug: record.slug,
        liveUrl,
      }
    } else {
      const errText = await res.text().catch(() => '')
      let errMsg = `Supabase insert failed (HTTP ${res.status})`
      try {
        const parsed = JSON.parse(errText)
        if (parsed.message) {
          if (parsed.message.includes('Article_slug_key')) {
            errMsg = `Slug "${record.slug}" already exists on esbpowerline.com. Open that article for editing from the Site tab to update it, or change the URL slug.`
          } else {
            errMsg = parsed.message
          }
        }
        if (parsed.details && !errMsg.includes(parsed.details)) {
          errMsg += ` — ${parsed.details}`
        }
      } catch {}
      return { success: false, error: errMsg }
    }
  } catch (err: any) {
    return { success: false, error: err?.message || 'Network error communicating with Supabase' }
  }
}

/**
 * Open the site's CMS as the signed-in editor. In the desktop app the main process writes this session into a
 * separate esbpowerline.com browser profile and opens the CMS there, already signed in. A browser preview cannot set
 * another site's cookies, so there the CMS opens in a tab and asks for the password itself.
 */
export async function openSiteCms(session: StaffSession | null, sitePath = '/cms'): Promise<'signed-in' | 'browser'> {
  const bridge = (typeof window !== 'undefined' ? (window as unknown as { esb?: { openSiteAs?: (c: { name: string; value: string }[], p: string) => Promise<boolean> } }).esb : undefined)
  const fresh = await ensureFreshSession(session)
  if (fresh && bridge?.openSiteAs) {
    await bridge.openSiteAs(siteSessionCookies(fresh), sitePath)
    return 'signed-in'
  }
  if (typeof window !== 'undefined') window.open(`${SITE_BASE_URL}${sitePath}`, '_blank', 'noopener')
  return 'browser'
}

export interface SiteArticleRow {
  id: string
  title: string
  slug: string
  status: string
  excerpt: string | null
  content: string
  category: string
  imageUrl: string | null
  imageCredit: string | null
  tags: string[] | null
  publishedAt: string | null
  postAsNewsDesk: boolean
  seo: { metaTitle?: string; metaDescription?: string; focusKeyword?: string; heroImage?: { alt?: string; caption?: string } } | null
}

/** One article from the site's database, by id or slug, read with the editor's token (so drafts show too). */
export async function findArticle(by: { id?: string; slug?: string }, session?: StaffSession | null): Promise<SiteArticleRow | null> {
  const q = by.id ? `id=eq.${encodeURIComponent(by.id)}` : by.slug ? `slug=eq.${encodeURIComponent(by.slug.trim().toLowerCase())}` : ''
  if (!q) return null
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/Article?${q}&select=id,title,slug,status,excerpt,content,category,imageUrl,imageCredit,tags,publishedAt,postAsNewsDesk,seo&limit=1`, {
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${session?.token || SUPABASE_ANON_KEY}`, Accept: 'application/json' },
    })
    if (!res.ok) return null
    return ((await res.json()) as SiteArticleRow[])[0] ?? null
  } catch {
    return null
  }
}

/** The site's HTML paragraphs back to the plain blank-line-separated text the desk edits. */
export function htmlToBody(html: string): string {
  const dec = (t: string) => t.replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&')
  return html
    .replace(/\r/g, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|h[1-6]|li|blockquote|div)>/gi, '\n\n')
    .replace(/<[^>]+>/g, '')
    .split(/\n{2,}/)
    .map((p) => dec(p).trim())
    .filter(Boolean)
    .join('\n\n')
}

/** Live check of the site: the public feed answers, the auth service is up, and — when signed in — the database accepts the editor's token. */
export async function probeSite(session?: StaffSession | null): Promise<SiteStatus> {
  const t0 = performance.now()
  const at = Date.now()
  const stamp = () => ({ lastChecked: fmtTime(at, { seconds: true }), checkedAt: at })
  const feed = await siteFetch(`${SITE_BASE_URL}/feed.xml?_=${Date.now()}`, 6000)
  const latencyMs = Math.max(1, Math.round(performance.now() - t0))
  if (!feed.ok) return { connected: false, latencyMs, ...stamp(), statusText: feed.status ? `Site answered HTTP ${feed.status}` : 'Site unreachable' }
  if (!session?.token) return { connected: true, latencyMs, ...stamp(), statusText: 'Site online — sign in to use the CMS' }
  // keep-alive: renews the token well before it expires, from the newest saved copy
  const live = (await ensureFreshSession(session)) ?? session
  const refused = await sessionRefusedBySite(live)
  if (refused) return { connected: true, latencyMs, ...stamp(), statusText: `Site online — it ended your sign-in (HTTP ${refused}); sign in again`, sessionEnded: true }
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/Article?select=id&limit=1`, { headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${live.token}` } })
    if (r.ok) return { connected: true, latencyMs, ...stamp(), statusText: 'Site and database connected' }
    return { connected: true, latencyMs, ...stamp(), statusText: r.status === 401 ? 'Site online — your sign-in expired' : `Site online — database answered HTTP ${r.status}` }
  } catch {
    return { connected: true, latencyMs, ...stamp(), statusText: 'Site online — database not reachable' }
  }
}
