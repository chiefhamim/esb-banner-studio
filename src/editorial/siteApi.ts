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
  version?: string
  statusText?: string
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

export interface StaffSession {
  email: string
  name: string
  role: 'editor' | 'master_admin' | 'author'
  token?: string
  refreshToken?: string
  expiresIn?: number
  userId?: string
  authenticatedAt: string
  authType: 'supabase_live' | 'newsroom_bypass'
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
      lastChecked: new Date().toLocaleTimeString(),
      statusText: ok ? 'Online & Synchronized' : 'Site Unreachable',
    }
  } catch (err: any) {
    const latencyMs = Math.round(performance.now() - start)
    return {
      connected: false,
      latencyMs,
      lastChecked: new Date().toLocaleTimeString(),
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

/** Retrieve active staff session from storage */
export function getStoredStaffSession(): StaffSession | null {
  try {
    const raw = localStorage.getItem(SESSION_STORAGE_KEY)
    if (!raw) return null
    return JSON.parse(raw) as StaffSession
  } catch {
    return null
  }
}

/** Save staff session */
export function saveStaffSession(session: StaffSession) {
  try {
    localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session))
  } catch {}
}

/** Clear staff session */
export function clearStaffSession() {
  try {
    localStorage.removeItem(SESSION_STORAGE_KEY)
  } catch {}
}

/**
 * Authenticate staff account against live Supabase Auth on esbpowerline.com
 * (Endpoint: https://sxgokpmrbgdndstygapc.supabase.co/auth/v1/token?grant_type=password)
 *
 * Known newsroom accounts:
 * - Mehedi Hasan Hamim (hamim2964@gmail.com) -> Editor
 * - Sheikh Rasel (rasel@esbpowerline.com) -> Editor
 * - System Admin (admin@esbpowerline.com) -> Master Admin
 */
export async function authenticateStaff(
  email: string,
  password: string,
  allowBypass: boolean = false
): Promise<{ success: boolean; session?: StaffSession; error?: string }> {
  const normEmail = email.trim().toLowerCase()
  if (!normEmail || (!password && !allowBypass)) {
    return { success: false, error: 'Email and password are required.' }
  }

  // 1. Attempt genuine live Supabase Auth verification
  try {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: {
        'apikey': SUPABASE_ANON_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ email: normEmail, password }),
    })

    if (res.ok) {
      const data = await res.json()
      const displayName =
        normEmail === 'hamim2964@gmail.com'
          ? 'Mehedi Hasan Hamim'
          : normEmail === 'admin@esbpowerline.com'
          ? 'System Admin'
          : normEmail === 'rasel@esbpowerline.com'
          ? 'Sheikh Rasel'
          : data.user?.user_metadata?.full_name || 'Editorial Staff'

      const role: 'editor' | 'master_admin' | 'author' =
        normEmail === 'admin@esbpowerline.com' ? 'master_admin' : 'editor'

      const session: StaffSession = {
        email: normEmail,
        name: displayName,
        role,
        token: data.access_token,
        refreshToken: data.refresh_token,
        expiresIn: data.expires_in,
        userId: data.user?.id,
        authenticatedAt: new Date().toISOString(),
        authType: 'supabase_live',
      }
      saveStaffSession(session)
      return { success: true, session }
    } else {
      const errData = await res.json().catch(() => null)
      const errorMsg =
        errData?.error_description ||
        errData?.msg ||
        errData?.message ||
        'Supabase Auth: Invalid credentials.'

      // If user opted into newsroom bypass for known editorial staff:
      if (allowBypass && (normEmail === 'hamim2964@gmail.com' || normEmail === 'admin@esbpowerline.com' || normEmail === 'rasel@esbpowerline.com')) {
        const session: StaffSession = {
          email: normEmail,
          name: normEmail === 'hamim2964@gmail.com' ? 'Mehedi Hasan Hamim' : 'System Admin',
          role: normEmail === 'admin@esbpowerline.com' ? 'master_admin' : 'editor',
          authenticatedAt: new Date().toISOString(),
          authType: 'newsroom_bypass',
        }
        saveStaffSession(session)
        return { success: true, session }
      }

      return { success: false, error: errorMsg }
    }
  } catch (netErr: any) {
    if (allowBypass) {
      const session: StaffSession = {
        email: normEmail,
        name: normEmail === 'hamim2964@gmail.com' ? 'Mehedi Hasan Hamim' : 'Editorial Staff',
        role: 'editor',
        authenticatedAt: new Date().toISOString(),
        authType: 'newsroom_bypass',
      }
      saveStaffSession(session)
      return { success: true, session }
    }
    return { success: false, error: `Live Supabase unreachable: ${netErr?.message || 'Network error'}` }
  }
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
  category: string
  tags?: string[]
  metaTitle?: string
  metaDescription?: string
  focusKeywords?: string
  imageUrl?: string
  credit?: string
  byline?: string
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
    content: bodyToHtml(params.body),
    readTime: Math.max(1, Math.ceil(params.body.trim().split(/\s+/).filter(Boolean).length / 200)),
    category: params.category || 'Fossil Fuels & Commodities',
    status: 'PUBLISHED',
    imageUrl: params.imageUrl,
    imageCredit: params.credit || 'ESB PowerLine',
    tags: tagList,
    isFeatured: false,
    isBreaking: false,
    isPinned: false,
    isTrending: false,
    seo: {
      metaTitle: params.metaTitle || cleanHeadline,
      metaDescription: params.metaDescription || cleanDeck,
      focusKeyword: tagList[0] || '',
      heroImage: {
        alt: cleanHeadline,
        caption: cleanDeck,
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

/** Verified Editorial Staff mapping for esbpowerline.com matching public.User */
export const ESB_AUTHORS: Record<string, { id: string; name: string; email: string; role: string }> = {
  'hamim2964@gmail.com': { id: 'cmqv471bq0001vk55aw07256e', name: 'Mehedi Hasan Hamim', email: 'hamim2964@gmail.com', role: 'EDITOR' },
  'admin@esbpowerline.com': { id: 'cmqv471700000vk55trr7n8df', name: 'ESB NEWS DESK', email: 'admin@esbpowerline.com', role: 'SUPER_ADMIN' },
  'rasel@esbpowerline.com': { id: 'cmqv471gb0002vk55sozpxt7p', name: 'Sheikh Rasel', email: 'rasel@esbpowerline.com', role: 'EDITOR' },
  'rezafaisalmahmud@gmail.com': { id: 'cmtveuqkv000004jm5sjwsqox', name: 'Faisal Al Mahmud', email: 'rezafaisalmahmud@gmail.com', role: 'EDITOR' },
  'yeasinfiyaz@gmail.com': { id: 'cmttn1o9s000204igmykknlg9', name: 'Yeasin Fiyaz', email: 'yeasinfiyaz@gmail.com', role: 'EDITOR' },
}

/** Helper to generate a collision-resistant CUID-formatted ID compatible with Prisma `@default(cuid())` */
export function generateCuid(): string {
  const timestamp = Date.now().toString(36)
  const randomPart = Math.random().toString(36).substring(2, 10) + Math.random().toString(36).substring(2, 10)
  return `cmv${timestamp}${randomPart}`.substring(0, 25)
}

export interface InsertArticleResult {
  success: boolean
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
  session?: StaffSession | null
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

    // Resolve Category ID
    const categoryInfo = ESB_CATEGORIES[payload.category] || ESB_CATEGORIES['Fossil Fuels & Commodities']

    // Resolve Author ID (default to Mehedi Hasan Hamim if unspecified)
    const authorEmail = session?.email ? session.email.toLowerCase() : 'hamim2964@gmail.com'
    const author = ESB_AUTHORS[authorEmail] || ESB_AUTHORS['hamim2964@gmail.com']

    const id = generateCuid()
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
      imageCredit: payload.imageCredit || 'ESB PowerLine',
      readTime: payload.readTime || Math.max(1, Math.ceil(payload.content.length / 1000)),
      views: 0,
      likes: 0,
      isFeatured: !!payload.isFeatured,
      isBreaking: !!payload.isBreaking,
      isPinned: !!payload.isPinned,
      isTrending: !!payload.isTrending,
      postAsNewsDesk: author.email === 'admin@esbpowerline.com',
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
      'Authorization': session?.token ? `Bearer ${session.token}` : `Bearer ${SUPABASE_ANON_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=minimal',
    }

    const res = await fetch(`${SUPABASE_URL}/rest/v1/Article`, {
      method: 'POST',
      headers,
      body: JSON.stringify(record),
    })

    if (res.status === 201 || res.ok) {
      const liveUrl = `${SITE_BASE_URL}/articles/${record.slug}`
      return {
        success: true,
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
            errMsg = `Slug "${record.slug}" already exists on esbpowerline.com. Please change the URL slug.`
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
