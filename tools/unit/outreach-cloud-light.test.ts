// @vitest-environment jsdom
// Cross-PC sync stays light and complete (2026-11-01): a campaign's whole data comes down only when another PC changed
// it (never the PC's own push again), the account-wide Autopilot settings travel between PCs (newest wins, a missing
// table changes nothing), the poll slows down when nothing needs it, and Realtime is only a poke that is believed
// after an echo. Fake PostgREST / fake WebSocket; synthetic data; no real network.
import { beforeEach, describe, expect, it, vi } from 'vitest'

const SESSION = { email: 'desk@example.com', name: 'Desk', role: 'EDITOR', token: 'test-token', refreshToken: 'r', expiresAt: Math.floor(Date.now() / 1000) + 3600, userId: 'u-1', authenticatedAt: new Date().toISOString(), authType: 'supabase' }
const signIn = () => localStorage.setItem('esb-banner-studio/site-session', JSON.stringify(SESSION))

type Handler = (url: string, init: RequestInit) => { status: number; body?: unknown }
let handler: Handler
const calls: { url: string; init: RequestInit }[] = []
const json = (status: number, body?: unknown) => ({ status, body })

beforeEach(() => {
  localStorage.clear()
  calls.length = 0
  ;(window as unknown as { esb?: unknown }).esb = undefined
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit = {}) => {
    calls.push({ url: decodeURIComponent(url), init })
    const r = handler(decodeURIComponent(url), init)
    return new Response(r.body === undefined ? '' : JSON.stringify(r.body), { status: r.status, headers: { 'content-type': 'application/json' } })
  }))
})

const load = async () => {
  vi.resetModules()
  const sync = await import('../../src/outreach/cloudSync')
  const { useCloud } = await import('../../src/outreach/cloudStore')
  const { useOutreachStore, newCampaign } = await import('../../src/outreach/outreachStore')
  const { useEngineStore } = await import('../../src/outreach/engineStore')
  return { sync, useCloud, useOutreachStore, newCampaign, useEngineStore }
}

describe('campaign data comes down only when it changed elsewhere', () => {
  it('own push is not downloaded back; a change by another PC is', async () => {
    signIn()
    const server: Record<string, { data: unknown; updated_at: string }> = {}
    handler = (url, init) => {
      if (url.includes('/outreach_campaigns?on_conflict')) {
        for (const r of JSON.parse(String(init.body))) server[r.id] = { data: r.data, updated_at: r.updated_at }
        return json(201)
      }
      if (url.includes('/outreach_campaigns?select=id,updated_at')) return json(200, Object.entries(server).map(([id, v]) => ({ id, updated_at: v.updated_at.replace('Z', '+00:00') })))
      if (url.includes('/outreach_campaigns?id=in.')) {
        const ids = url.match(/in\.\(([^)]*)\)/)![1].split(',').map((x) => x.replace(/"/g, ''))
        return json(200, ids.filter((id) => server[id]).map((id) => ({ id, ...server[id] })))
      }
      return json(200, [])
    }
    const { sync, useOutreachStore, newCampaign } = await load()
    const c = newCampaign({ id: 'cmp-1', name: 'Magazine' })
    useOutreachStore.setState({ campaigns: [{ ...c, updatedAt: Date.now() }], activeId: 'cmp-1' })
    await sync.syncNow() // pushes cmp-1
    expect(server['cmp-1']).toBeTruthy()
    calls.length = 0
    await sync.syncNow() // nothing changed anywhere: only the small id/updated_at list
    expect(calls.filter((x) => x.url.includes('outreach_campaigns?id=in.'))).toHaveLength(0)
    // another PC renames it
    server['cmp-1'] = { data: { ...(server['cmp-1'].data as object), name: 'Renamed elsewhere', updatedAt: Date.now() + 5000 }, updated_at: new Date(Date.now() + 5000).toISOString() }
    calls.length = 0
    await sync.syncNow()
    expect(calls.filter((x) => x.url.includes('outreach_campaigns?id=in.'))).toHaveLength(1)
    expect(useOutreachStore.getState().campaigns[0].name).toBe('Renamed elsewhere')
  })
})

describe('account-wide Autopilot settings travel between PCs', () => {
  const bridge = (local: Record<string, unknown>) => {
    const saved: Record<string, unknown>[] = []
    ;(window as unknown as { esb: unknown }).esb = {
      outreachSettings: async () => local,
      outreachSettingsSave: async (p: Record<string, unknown>) => { saved.push(p); Object.assign(local, p); return { ok: true, settings: { ...local } } },
    }
    return saved
  }
  const base = { window: { enabled: true, from: '09:00', to: '17:00', days: [0, 1, 2, 3, 4], tz: 'Asia/Dhaka' }, dailyLimit: 100, ramp: true, pace: 'manual', minDelaySec: 180, maxDelaySec: 480, domainMaxPerDay: 3, domainMinGapSec: 1200, contactCooldownDays: 30, traySending: true, aiAutonomy: 'suggest', aiReadsReply: false, autoResume: true }

  it('another PC changed them later: adopted here with its stamp (per-PC options untouched)', async () => {
    signIn()
    const saved = bridge({ ...base, sharedUpdatedAt: 1000, traySending: false })
    handler = (url) => url.includes('/outreach_settings?id=eq.autopilot')
      ? json(200, [{ id: 'autopilot', data: { ...base, minDelaySec: 60, maxDelaySec: 120, sharedUpdatedAt: 5000, traySending: true } }])
      : json(200, [])
    const { sync, useEngineStore } = await load()
    await sync.syncNow()
    expect(saved).toHaveLength(1)
    expect(saved[0]).toMatchObject({ minDelaySec: 60, maxDelaySec: 120, sharedUpdatedAt: 5000 })
    expect(saved[0]).not.toHaveProperty('traySending')
    expect(useEngineStore.getState().settings?.minDelaySec).toBe(60)
  })

  it('this PC changed them later: pushed; same stamp both sides: nothing written', async () => {
    signIn()
    bridge({ ...base, minDelaySec: 60, maxDelaySec: 120, sharedUpdatedAt: 9000 })
    let remote: { data: Record<string, unknown> } | null = { data: { ...base, sharedUpdatedAt: 1000 } }
    let desk: unknown = null
    handler = (url, init) => {
      if (url.includes('/outreach_settings?on_conflict')) { const r = JSON.parse(String(init.body))[0]; if (r.id === 'autopilot') remote = r; else desk = r; return json(201) }
      if (url.includes('/outreach_settings?id=eq.autopilot')) return json(200, remote ? [remote] : [])
      if (url.includes('/outreach_settings?id=eq.desk')) return json(200, desk ? [desk] : [])
      return json(200, [])
    }
    const { sync } = await load()
    await sync.syncNow()
    expect(remote!.data).toMatchObject({ minDelaySec: 60, maxDelaySec: 120, sharedUpdatedAt: 9000 })
    expect(remote!.data).not.toHaveProperty('traySending')
    calls.length = 0
    await sync.syncNow()
    expect(calls.some((x) => x.url.includes('/outreach_settings?on_conflict'))).toBe(false)
  })

  it('table not on the site yet: the rest of sync is "ok", and it is not asked again for 30 min', async () => {
    signIn()
    bridge({ ...base, sharedUpdatedAt: 9000 })
    handler = (url) => (url.includes('/outreach_settings') ? json(404, { code: 'PGRST205' }) : json(200, []))
    const { sync, useCloud } = await load()
    await sync.syncNow()
    expect(useCloud.getState().state).toBe('ok')
    calls.length = 0
    await sync.syncNow()
    expect(calls.some((x) => x.url.includes('/outreach_settings'))).toBe(false)
  })
})

describe('poll pace', () => {
  it('60 s while sending or in front, 5 min in the background, 2 min in front with Realtime live', async () => {
    const { sync } = await load()
    expect(sync.pollEvery({ visible: false, activeJob: true, live: true })).toBe(60_000)
    expect(sync.pollEvery({ visible: true, activeJob: false, live: false })).toBe(60_000)
    expect(sync.pollEvery({ visible: true, activeJob: false, live: true })).toBe(120_000)
    expect(sync.pollEvery({ visible: false, activeJob: false, live: false })).toBe(300_000)
  })
})

describe('Realtime is a poke, believed only after an echo', () => {
  class FakeWS {
    static last: FakeWS | null = null
    readyState = 0
    sent: { topic: string; event: string; payload: Record<string, unknown> }[] = []
    onopen: (() => void) | null = null
    onmessage: ((e: { data: string }) => void) | null = null
    onclose: (() => void) | null = null
    onerror: (() => void) | null = null
    constructor(public url: string) { FakeWS.last = this }
    send(s: string) { this.sent.push(JSON.parse(s)) }
    close() { this.readyState = 3 }
    open() { this.readyState = 1; this.onopen?.() }
    msg(m: unknown) { this.onmessage?.({ data: JSON.stringify(m) }) }
  }

  it('joins one channel on the small tables with the staff token; a change pokes a pull', async () => {
    vi.useFakeTimers()
    const { createRealtime, REALTIME_TABLES } = await import('../../src/outreach/cloudRealtime')
    const pokes: string[][] = []
    const rt = createRealtime({ url: 'https://abc.supabase.co', anonKey: 'anon', token: async () => 'jwt-1', onPoke: (t) => pokes.push(t), WebSocketImpl: FakeWS as unknown as typeof WebSocket })
    await rt.ensure()
    const ws = FakeWS.last!
    expect(ws.url).toBe('wss://abc.supabase.co/realtime/v1/websocket?apikey=anon&vsn=1.0.0')
    ws.open()
    const join = ws.sent[0]
    expect(join.event).toBe('phx_join')
    expect(join.payload.access_token).toBe('jwt-1')
    const tables = ((join.payload.config as { postgres_changes: { table: string }[] }).postgres_changes).map((x) => x.table)
    expect(tables).toEqual([...REALTIME_TABLES])
    expect(tables).not.toContain('outreach_campaigns') // big rows never broadcast
    expect(tables).not.toContain('outreach_lists')
    ws.msg({ topic: join.topic, event: 'phx_reply', payload: { status: 'ok' } })
    expect(rt.live()).toBe(false) // joined, but no proof changes flow (publication may be missing)
    ws.msg({ topic: join.topic, event: 'postgres_changes', payload: { data: { table: 'outreach_sends' } } })
    ws.msg({ topic: join.topic, event: 'postgres_changes', payload: { data: { table: 'outreach_locks' } } })
    await vi.advanceTimersByTimeAsync(2000)
    expect(pokes).toEqual([['outreach_sends', 'outreach_locks']]) // debounced into one pull
    expect(rt.live()).toBe(false)
    // this PC pushes a row and hears it back: now it is live
    rt.expectEcho()
    ws.msg({ topic: join.topic, event: 'postgres_changes', payload: { data: { table: 'outreach_sends' } } })
    expect(rt.live()).toBe(true)
    // heartbeats keep the socket open
    await vi.advanceTimersByTimeAsync(26_000)
    expect(ws.sent.some((m) => m.topic === 'phoenix' && m.event === 'heartbeat')).toBe(true)
    rt.close()
    vi.useRealTimers()
  })

  it('signed out: no socket at all', async () => {
    const { createRealtime } = await import('../../src/outreach/cloudRealtime')
    FakeWS.last = null
    const rt = createRealtime({ url: 'https://abc.supabase.co', anonKey: 'anon', token: async () => null, onPoke: () => {}, WebSocketImpl: FakeWS as unknown as typeof WebSocket })
    await rt.ensure()
    expect(FakeWS.last).toBeNull()
  })
})

describe('address-wide facts and the desk travel too', () => {
  it('an opt-out of an address no campaign wrote to goes up as its own row and comes down on the other PC', async () => {
    const { addressRows, applySendRows } = await import('../../src/outreach/cloudMerge')
    const rows = addressRows(['Never@Example.com'], 'PC-1#aaaaaaaa', Date.UTC(2026, 10, 1))
    expect(rows[0]).toMatchObject({ id: 'addr:optout:never@example.com', campaign_id: null, kind: null, status: 'opted_out', email: 'never@example.com' })
    const res = applySendRows([], rows, 'PC-2#bbbbbbbb')
    expect(res.optOut).toEqual(['never@example.com'])
    expect(res.changed).toBe(false)
  })

  it('pushSends sends the address-wide opt-out rows', async () => {
    signIn()
    const pushed: { id: string }[] = []
    handler = (url, init) => {
      if (url.includes('/outreach_sends?on_conflict')) { pushed.push(...JSON.parse(String(init.body))); return json(201) }
      return json(200, [])
    }
    const { sync, useOutreachStore } = await load()
    useOutreachStore.setState({ optOut: ['never@example.com'] })
    await sync.syncNow()
    expect(pushed.map((r) => r.id)).toContain('addr:optout:never@example.com')
  })

  it('approvals are a union across PCs; a newer desk (signatures, templates…) from another PC is adopted', async () => {
    signIn()
    let desk: { id: string; data: Record<string, unknown> } = { id: 'desk', data: { deskUpdatedAt: Date.now() + 60_000, approved: ['b@example.com'], housePrompt: 'Plain words, no hype.' } }
    handler = (url, init) => {
      if (url.includes('/outreach_settings?on_conflict')) { const r = JSON.parse(String(init.body))[0]; if (r.id === 'desk') desk = r; return json(201) }
      if (url.includes('/outreach_settings?id=eq.desk')) return json(200, [desk])
      return json(200, [])
    }
    const { sync, useOutreachStore } = await load()
    useOutreachStore.setState({ approved: ['a@example.com'] })
    await sync.syncNow()
    expect(useOutreachStore.getState().approved.sort()).toEqual(['a@example.com', 'b@example.com'])
    expect(useOutreachStore.getState().housePrompt).toBe('Plain words, no hype.')
    expect((desk.data.approved as string[]).sort()).toEqual(['a@example.com', 'b@example.com'])
  })
})
