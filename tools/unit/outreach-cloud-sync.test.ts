// @vitest-environment jsdom
// Cross-PC sync against a fake PostgREST (src/outreach/cloudSync.ts): it degrades cleanly while the website migration
// is not applied, a fresh lock on another PC blocks Send/Resume, a stale one is offered for take-over, and the shared
// sends reach this PC's main-process ledger before a batch. No real network; synthetic data only; no token is logged.
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
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit = {}) => {
    calls.push({ url, init })
    const r = handler(url, init)
    return new Response(r.body === undefined ? '' : JSON.stringify(r.body), { status: r.status, headers: { 'content-type': 'application/json' } })
  }))
})

const load = async () => {
  vi.resetModules()
  const sync = await import('../../src/outreach/cloudSync')
  const { useCloud } = await import('../../src/outreach/cloudStore')
  const { useOutreachStore, newCampaign } = await import('../../src/outreach/outreachStore')
  const ui = await import('../../src/outreach/outreachUi')
  return { sync, useCloud, useOutreachStore, newCampaign, ui }
}

describe('cloudSync', () => {
  it('signed out: no request at all, the pill says sync is off, sending is not blocked', async () => {
    handler = () => json(500)
    const { sync, useCloud } = await load()
    await sync.syncNow()
    expect(calls.length).toBe(0)
    expect(useCloud.getState().state).toBe('signed-out')
    expect(await sync.beforeSend('cmp-1')).toMatchObject({ ok: true })
  })

  it('a dry run (ESB_OUTREACH_DRYRUN) never talks to the shared copy, even signed in', async () => {
    signIn()
    handler = () => json(200, [])
    const { sync, useCloud } = await load()
    const { useEngineStore } = await import('../../src/outreach/engineStore')
    useEngineStore.setState({ settings: { ...(useEngineStore.getState().settings ?? {}), dryRun: true } as never })
    await sync.syncNow()
    expect(await sync.beforeSend('cmp-1')).toEqual({ ok: true })
    expect(calls.length).toBe(0)
    expect(useCloud.getState().state).toBe('test-run')
  })

  it('the website migration not applied yet (404 / PGRST205): "Cloud not set up yet", and sending goes ahead', async () => {
    signIn()
    handler = () => json(404, { code: 'PGRST205', message: 'Could not find the table' })
    const { sync, useCloud } = await load()
    await sync.syncNow()
    expect(useCloud.getState().state).toBe('not-setup')
    expect(await sync.beforeSend('cmp-1')).toEqual({ ok: true, note: 'Cloud not set up yet — sending from this PC only' })
    // the token goes in the Authorization header, never in a URL
    expect(calls.every((c) => !c.url.includes('test-token'))).toBe(true)
    expect((calls[0].init.headers as Record<string, string>).Authorization).toBe('Bearer test-token')
  })

  it('offline: "Offline — will sync", local sending carries on', async () => {
    signIn()
    const { sync, useCloud } = await load()
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch') }))
    await sync.syncNow()
    expect(useCloud.getState().state).toBe('offline')
    expect((await sync.beforeSend('cmp-1')).ok).toBe(true)
  })

  it('a fresh lock held by another PC blocks with its name; the shared sends were merged into the ledger first', async () => {
    signIn()
    const marked: unknown[] = []
    ;(window as unknown as { esb: unknown }).esb = { outreachMarkSent: async (l: unknown[]) => { marked.push(...l); return { ok: true, ledger: l.length, events: l.length, rejected: 0 } } }
    const fresh = new Date().toISOString()
    handler = (url) => {
      if (url.includes('/outreach_sends?')) return json(200, [{ id: 'cmp-1:campaign:a@example.com', campaign_id: 'cmp-1', email: 'a@example.com', kind: 'campaign', status: 'sent', detail: null, message_key: null, at: '2026-11-01T05:00:00.000Z', pc: 'DESK-2#bbbbbbbb', updated_at: fresh }])
      if (url.includes('/outreach_locks?')) return json(200, [{ campaign_id: 'cmp-1', pc: 'other-pc', pc_label: 'DESK-2', heartbeat_at: fresh }])
      return json(200, [])
    }
    const { sync, useOutreachStore, newCampaign, useCloud } = await load()
    useOutreachStore.setState({ campaigns: [newCampaign({ id: 'cmp-1', name: 'Magazine' })], activeId: 'cmp-1' })
    const r = await sync.beforeSend('cmp-1')
    expect(r.ok).toBe(false)
    expect(r.ok === false && r.reason).toMatch(/^Sending from DESK-2 — last seen /)
    expect(marked).toEqual([{ email: 'a@example.com', kind: 'campaign', campaignId: 'cmp-1', at: Date.parse('2026-11-01T05:00:00.000Z') }])
    expect(useOutreachStore.getState().campaigns[0].sent['a@example.com']).toBeTruthy()
    expect(useCloud.getState().locks['cmp-1']?.label).toBe('DESK-2')
    // no lock was taken over a fresh one
    expect(calls.some((c) => c.url.includes('rpc/outreach_acquire_lock'))).toBe(false)
  })

  it('a stale lock is offered for take-over with a warning; declining leaves it, accepting acquires it', async () => {
    signIn()
    const old = new Date(Date.now() - 30 * 60_000).toISOString()
    let acquired = 0
    handler = (url, init) => {
      if (url.includes('/outreach_locks?')) return json(200, [{ campaign_id: 'cmp-1', pc: 'other-pc', pc_label: 'DESK-2', heartbeat_at: old }])
      if (url.includes('rpc/outreach_acquire_lock')) {
        acquired++
        const body = JSON.parse(String(init.body))
        expect(body).toMatchObject({ p_campaign: 'cmp-1', p_stale_seconds: 600 })
        return json(200, { campaign_id: 'cmp-1', pc: body.p_pc, pc_label: body.p_label, heartbeat_at: new Date().toISOString() })
      }
      return json(200, [])
    }
    const { sync, ui } = await load()
    const asked: string[] = []
    const answer = (yes: boolean) => ui.useOutreachUi.subscribe((s) => { const q = s.asking; if (q) { asked.push(q.title); queueMicrotask(() => q.resolve(yes ? true : null)) } })
    let off = answer(false)
    const no = await sync.beforeSend('cmp-1')
    off()
    expect(no.ok).toBe(false)
    expect(acquired).toBe(0)
    off = answer(true)
    const yes = await sync.beforeSend('cmp-1')
    off()
    expect(yes).toEqual({ ok: true })
    expect(acquired).toBe(1)
    expect(asked[0]).toBe('Take over from DESK-2?')
  })
})
