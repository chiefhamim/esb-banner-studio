// Supabase Realtime for Outreach sync — a "poke", never a data path. One websocket, one channel, postgres_changes on
// the small shared tables (sends, opens/clicks, locks, account settings). Any change there makes cloudSync pull at
// once (debounced) through the same PostgREST code as the poll, so the merge rules stay in one place and a missed or
// truncated message costs nothing: the poll still runs as the fallback.
//
// - Rows are filtered by RLS on the server (Realtime checks each change against the subscriber's JWT), so a staff
//   token sees exactly what its PostgREST reads would; anon gets nothing (no policy).
// - outreach_campaigns / outreach_lists / outreach_designs are NOT subscribed: their rows are large (whole campaigns,
//   whole workbooks) and Realtime would broadcast every one in full to every PC. Campaign edits ride the cheap poll.
// - Nothing flows until the tables are in the supabase_realtime publication (website migration proposal 0025). The
//   channel can say "subscribed" without that, so "live" is only believed after an ECHO: this PC pushes a row and
//   hears about it within ECHO_MS. Until then the poll keeps its normal pace.
// Never logs the token. Implements the Phoenix protocol (vsn 1.0.0) directly — the app has no supabase-js.

const HEARTBEAT_MS = 25_000
const ECHO_MS = 15_000
const POKE_DEBOUNCE_MS = 1_500
export const REALTIME_TABLES = ['outreach_sends', 'outreach_events', 'outreach_locks', 'outreach_settings'] as const

export interface RealtimeDeps {
  url: string
  anonKey: string
  /** The staff access token (null = signed out: close and stay closed). */
  token: () => Promise<string | null>
  /** Called (debounced) when a subscribed table changed. */
  onPoke: (tables: string[]) => void
  WebSocketImpl?: typeof WebSocket
  now?: () => number
  /** Tables to watch (default: Outreach's). Editorial's Published list watches Article with its own channel. */
  tables?: readonly string[]
  /** Channel name (default 'outreach-sync'). */
  channel?: string
}

export interface RealtimeHandle {
  /** Open (or keep open) the socket; safe to call often. */
  ensure: () => Promise<void>
  /** This PC just pushed rows to a subscribed table: if Realtime works, they come back within ECHO_MS. */
  expectEcho: () => void
  /** Joined AND an echo was heard: changes arrive in real time, the poll may slow down. */
  live: () => boolean
  close: () => void
  /** For tests. */
  state: () => { open: boolean; joined: boolean; confirmed: boolean; pokes: number }
}

export function realtimeUrl(base: string, anonKey: string): string {
  return `${base.replace(/^http/, 'ws').replace(/\/$/, '')}/realtime/v1/websocket?apikey=${encodeURIComponent(anonKey)}&vsn=1.0.0`
}

export function joinPayload(accessToken: string, tables: readonly string[] = REALTIME_TABLES) {
  return {
    config: {
      broadcast: { self: false },
      presence: { key: '' },
      postgres_changes: tables.map((table) => ({ event: '*', schema: 'public', table })),
    },
    access_token: accessToken,
  }
}

export function createRealtime(deps: RealtimeDeps): RealtimeHandle {
  const WS = deps.WebSocketImpl ?? (typeof WebSocket !== 'undefined' ? WebSocket : undefined)
  const now = deps.now ?? (() => Date.now())
  const topic = `realtime:${deps.channel ?? 'outreach-sync'}`
  const tables = deps.tables ?? REALTIME_TABLES
  let ws: WebSocket | null = null
  let joined = false
  let confirmed = false
  let ref = 0
  let joinRef = ''
  let lastToken = ''
  let hb: ReturnType<typeof setInterval> | null = null
  let echoUntil = 0
  let pokeTimer: ReturnType<typeof setTimeout> | null = null
  const pokeTables = new Set<string>()
  let pokes = 0
  let retryAt = 0
  let failures = 0
  let closedByUs = false

  const send = (event: string, payload: unknown, t = topic) => {
    if (!ws || ws.readyState !== 1) return
    ref++
    ws.send(JSON.stringify({ topic: t, event, payload, ref: String(ref), join_ref: t === topic ? joinRef : undefined }))
  }

  const teardown = () => {
    if (hb) { clearInterval(hb); hb = null }
    joined = false
    const w = ws
    ws = null
    if (w) { try { w.close() } catch { /* already closed */ } }
  }

  const poke = (table: string) => {
    pokes++
    if (echoUntil && now() <= echoUntil) confirmed = true
    pokeTables.add(table)
    if (pokeTimer) return
    pokeTimer = setTimeout(() => {
      pokeTimer = null
      const t = [...pokeTables]
      pokeTables.clear()
      deps.onPoke(t)
    }, POKE_DEBOUNCE_MS)
  }

  const onMessage = (raw: string) => {
    let m: { topic?: string; event?: string; payload?: Record<string, unknown> }
    try { m = JSON.parse(raw) } catch { return }
    if (m.topic !== topic) return
    if (m.event === 'phx_reply') {
      const status = (m.payload as { status?: string } | undefined)?.status
      if (status === 'ok') { joined = true; failures = 0 }
      else if (status === 'error') { teardown(); failures++; retryAt = now() + Math.min(30 * 60_000, 60_000 * 2 ** failures) }
      return
    }
    if (m.event === 'postgres_changes') {
      const data = (m.payload as { data?: { table?: string } } | undefined)?.data
      poke(String(data?.table ?? ''))
      return
    }
    if (m.event === 'phx_close' || m.event === 'phx_error') {
      teardown()
      failures++
      retryAt = now() + Math.min(30 * 60_000, 5_000 * 2 ** failures)
    }
  }

  async function ensure() {
    if (!WS) return
    const t = await deps.token().catch(() => null)
    if (!t) { lastToken = ''; teardown(); return }
    if (ws && ws.readyState <= 1) {
      // a refreshed token goes to the open channel; Realtime closes a channel whose token expired
      if (joined && t !== lastToken) { lastToken = t; send('access_token', { access_token: t }) }
      return
    }
    if (now() < retryAt) return
    closedByUs = false
    lastToken = t
    const sock = new WS(realtimeUrl(deps.url, deps.anonKey))
    ws = sock
    sock.onopen = () => {
      ref++
      joinRef = String(ref)
      sock.send(JSON.stringify({ topic, event: 'phx_join', payload: joinPayload(t, tables), ref: joinRef, join_ref: joinRef }))
      hb = setInterval(() => send('heartbeat', {}, 'phoenix'), HEARTBEAT_MS)
    }
    sock.onmessage = (e: MessageEvent) => onMessage(typeof e.data === 'string' ? e.data : '')
    sock.onclose = () => {
      if (ws === sock) { teardown(); if (!closedByUs) { failures++; retryAt = now() + Math.min(30 * 60_000, 5_000 * 2 ** failures) } }
    }
    sock.onerror = () => { /* onclose follows */ }
  }

  return {
    ensure,
    expectEcho: () => { if (joined && !confirmed) echoUntil = now() + ECHO_MS },
    live: () => joined && confirmed,
    close: () => { closedByUs = true; teardown() },
    state: () => ({ open: !!ws && ws.readyState === 1, joined, confirmed, pokes }),
  }
}
