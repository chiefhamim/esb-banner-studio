// Published, live: the site's newest stories read straight from its database, and kept current in real time.
//
// The public feed (esbpowerline.com/feed.xml) is served from Vercel's CDN cache (X-Vercel-Cache: HIT, Age ~14 min; a
// cache-busting query does not get past it), so a story published from the phone or the CMS was missing here for up to
// a quarter of an hour. ESB Studio Phone reads the Article table for the same reason (src/mobile/editorial/
// publishedLive.ts there; keep the two queries in step). The feed stays as the fallback when the database cannot be
// reached.
//
// Real time: one Supabase Realtime socket watches public.Article (postgres_changes). It delivers only once the table is
// in the supabase_realtime publication (`alter publication supabase_realtime add table public."Article";` — not
// applied as of 2026-11-06; until then the 30-second signature check below keeps the list current). A change only POKES a re-read through the same query, so the list
// never depends on a message arriving whole. Realtime checks every change against the subscriber's token with the
// table's own RLS: signed out it hears published stories only, signed in as staff it hears drafts too (as the CMS does).
// Only news data travels: no other table is watched.
import { createRealtime, type RealtimeHandle } from '../outreach/cloudRealtime'
import { SUPABASE_ANON_KEY, SUPABASE_URL, ensureFreshSession, type LiveArticleSummary, type StaffSession } from './siteApi'

interface Row { title: string; slug: string; category: string | null; publishedAt: string | null; excerpt: string | null; imageUrl: string | null; postAsNewsDesk: boolean | null }

const SITE = 'https://esbpowerline.com'
export const PUBLISHED_LIMIT = 80

/** Row → the summary the desk lists. Supabase returns timestamps without a zone: they are UTC. */
export function toSummary(r: Row): LiveArticleSummary | null {
  if (!r.title || !r.slug) return null
  const at = r.publishedAt ? new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(r.publishedAt) ? r.publishedAt : r.publishedAt + 'Z') : null
  return {
    title: r.title,
    slug: r.slug,
    link: `${SITE}/articles/${r.slug}`,
    category: r.category || 'General',
    publishedAt: at && !Number.isNaN(at.getTime()) ? at.toUTCString() : '',
    description: r.excerpt ?? undefined,
    imageUrl: r.imageUrl ?? undefined,
    author: r.postAsNewsDesk ? 'ESB News Desk' : undefined,
  }
}

/** The newest published stories from the Article table, or null when the database did not answer. */
export async function fetchPublishedFromDatabase(session: StaffSession | null, fetchImpl: typeof fetch = fetch): Promise<LiveArticleSummary[] | null> {
  const fresh = session ? await ensureFreshSession(session).catch(() => null) : null
  const token = fresh?.token || SUPABASE_ANON_KEY
  const q = `status=eq.PUBLISHED&select=title,slug,category,publishedAt,excerpt,imageUrl,postAsNewsDesk&order=publishedAt.desc&limit=${PUBLISHED_LIMIT}`
  try {
    const res = await fetchImpl(`${SUPABASE_URL}/rest/v1/Article?${q}`, { headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${token}`, Accept: 'application/json' }, cache: 'no-store' })
    if (!res.ok) return null
    const rows = (await res.json()) as Row[]
    if (!Array.isArray(rows)) return null
    return rows.map(toSummary).filter((a): a is LiveArticleSummary => !!a)
  } catch {
    return null
  }
}

let rt: RealtimeHandle | null = null
let started = false

/**
 * Keep Published current: open the Article socket (once per app run) and re-open it after sleep, a network change or a
 * new sign-in. `refresh` re-reads the list; `session` gives the current staff session (or null).
 */
export function startPublishedLive(refresh: () => void, session: () => StaffSession | null): void {
  if (started) { void rt?.ensure(); return }
  started = true
  rt = createRealtime({
    url: SUPABASE_URL,
    anonKey: SUPABASE_ANON_KEY,
    channel: 'esb-articles',
    tables: ['Article'],
    // signed out, the public key is the token: Realtime then applies the "published only" policy
    token: async () => {
      const s = session()
      const fresh = s ? await ensureFreshSession(s).catch(() => null) : null
      return fresh?.token || SUPABASE_ANON_KEY
    },
    onPoke: () => refresh(),
  })
  void rt.ensure()
  const again = () => { void rt?.ensure() }
  window.addEventListener('online', again)
  window.addEventListener('focus', again)
  window.addEventListener('esb-session', again)
  // a socket that dropped while the PC slept comes back on the next minute; a refreshed token is handed to the channel
  setInterval(again, 60_000)

  // The safety net (and the only path until Article is in the realtime publication): while the window is on screen,
  // a one-row read of the newest change and the published count every 30 s (every 2 min once the socket has delivered);
  // the list is re-read only when that changes. A few hundred bytes per check.
  let sig = ''
  let lastCheck = 0
  const check = async () => {
    if (document.visibilityState !== 'visible') return
    const every = (rt?.state().pokes ?? 0) > 0 ? 120_000 : 30_000
    if (Date.now() - lastCheck < every - 1_000) return
    lastCheck = Date.now()
    const next = await publishedSignature(session()).catch(() => null)
    if (!next) return
    if (sig && next !== sig) refresh()
    sig = next
  }
  setInterval(() => void check(), 10_000)
  document.addEventListener('visibilitychange', () => { lastCheck = 0; void check() })
}

/** "count|newest change": changes when a story is published, edited or taken down. Null when the site did not answer. */
export async function publishedSignature(session: StaffSession | null, fetchImpl: typeof fetch = fetch): Promise<string | null> {
  const fresh = session ? await ensureFreshSession(session).catch(() => null) : null
  const token = fresh?.token || SUPABASE_ANON_KEY
  const res = await fetchImpl(`${SUPABASE_URL}/rest/v1/Article?status=eq.PUBLISHED&select=slug,updatedAt&order=updatedAt.desc.nullslast&limit=1`, {
    headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${token}`, Accept: 'application/json', Prefer: 'count=exact' }, cache: 'no-store',
  })
  if (!res.ok) return null
  const rows = (await res.json()) as { slug?: string; updatedAt?: string }[]
  const total = (res.headers.get('content-range') ?? '').split('/')[1] ?? ''
  return `${total}|${rows[0]?.slug ?? ''}|${rows[0]?.updatedAt ?? ''}`
}

/** For tests and the connection panel. */
export const publishedLiveState = () => rt?.state() ?? { open: false, joined: false, confirmed: false, pokes: 0 }
