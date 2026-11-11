// Opens and clicks from the ESB Mail Tracker (cloud/tracker), as the main process appends them to the event log
// (electron/outreach-tracker-pull.cjs: `track.open` / `track.click`, each already matched to its address and campaign).
// They are folded into the same per-recipient Engagement the contact chips, the results panel and the CSV read, kept
// in IndexedDB `engageT:{campaignId}` (apart from the website-tracking fold `engage:{id}` that cloudSync owns) and
// shown merged. Folding is idempotent per letter key and per hit id, so a replayed event never counts twice.
// Test letters (`test: true`) stay in the Activity log only.

import type { OutreachEvent } from '../esb'
import { foldEvents, keySentAt, type EventRow } from './cloudMerge'
import { useCloud } from './cloudStore'
import { idbGet, idbSet } from './idb'
import type { Engagement } from './outcome'
import { useOutreachStore } from './outreachStore'

type Saved = { v: 1; byEmail: Record<string, Engagement>; hitIds: number[] }
const V = 1
const MAX_SEEN = 6
const queue = new Map<string, Promise<unknown>>()

/** One at a time per campaign (a burst of pushes must not interleave read-modify-write). */
function serial<T>(id: string, fn: () => Promise<T>): Promise<T> {
  const next = (queue.get(id) ?? Promise.resolve()).then(fn, fn)
  queue.set(id, next.catch(() => null))
  return next
}

export const trackerSaved = async (campaignId: string): Promise<Record<string, Engagement>> =>
  ((await idbGet<Saved>(`engageT:${campaignId}`))?.byEmail) ?? {}

/** Two folds of the same recipients, as one: key lists unioned, counts recomputed from them. */
export function mergeEngagement(a?: Engagement, b?: Engagement): Engagement | undefined {
  if (!a) return b
  if (!b) return a
  const u = (x: string[] = [], y: string[] = []) => [...new Set([...x, ...y])]
  const ka = a.keys ?? { o: [], m: [], c: [], l: [] }, kb = b.keys ?? { o: [], m: [], c: [], l: [] }
  const keys = { o: u(ka.o, kb.o), m: u(ka.m, kb.m), c: u(ka.c, kb.c), l: u(ka.l, kb.l) }
  const per = new Map<string, number>()
  for (const kl of keys.l) { const label = kl.slice(kl.indexOf('|') + 1); per.set(label, (per.get(label) ?? 0) + 1) }
  const mn = (x?: number, y?: number) => (x == null ? y : y == null ? x : Math.min(x, y))
  const mx = (x?: number, y?: number) => (x == null ? y : y == null ? x : Math.max(x, y))
  return {
    ...a, ...b, keys,
    opens: keys.o.length, clicks: keys.c.length, machineOpens: keys.m.filter((k) => !keys.o.includes(k)).length,
    links: [...per].map(([link, n]) => ({ link, n })).sort((p, q) => q.n - p.n),
    firstOpen: mn(a.firstOpen, b.firstOpen), lastOpen: mx(a.lastOpen, b.lastOpen),
    firstMachine: mn(a.firstMachine, b.firstMachine),
    firstClick: mn(a.firstClick, b.firstClick), lastClick: mx(a.lastClick, b.lastClick),
    hits: (a.hits ?? 0) + (b.hits ?? 0) || undefined,
    seen: u(b.seen, a.seen).slice(0, MAX_SEEN), places: u(a.places, b.places),
    forwarded: b.forwarded ?? a.forwarded,
  }
}

export function mergeAll(a: Record<string, Engagement> = {}, b: Record<string, Engagement> = {}): Record<string, Engagement> {
  const out: Record<string, Engagement> = { ...a }
  for (const [email, e] of Object.entries(b)) out[email] = mergeEngagement(a[email], e)!
  return out
}

/** "Gmail", "Outlook · Windows · Dhaka, BD" */
export function whereOf(ev: OutreachEvent): string {
  const place = [ev.city, ev.country].filter(Boolean).join(', ')
  if (ev.cls === 'proxy') return ev.client || 'Mail provider'
  return [ev.client, ev.device, place].filter(Boolean).join(' · ') || 'Unknown reader'
}

function forwardOf(e: Engagement): Engagement['forwarded'] {
  const places = e.places ?? []
  const countries = new Set(places.map((p) => p.split('|')[0]).filter(Boolean))
  if (countries.size >= 2 || places.length >= 3) return 'likely'
  const devices = new Set((e.seen ?? []).map((s) => s.split(' · ')[1]).filter(Boolean))
  if (places.length === 2 && devices.size >= 2) return 'possible'
  return undefined
}

const toRow = (ev: OutreachEvent): EventRow => ({
  id: Number(ev.hitId) || 0, message_key: String(ev.messageKey), type: ev.type === 'track.open' ? 'open' : 'click',
  link: ev.link ?? null, at: new Date(ev.t).toISOString(), ua: ev.ua ?? null, cls: ev.cls ?? 'human', why: ev.why ?? null,
})

/** Fold pushed / caught-up `track.*` events. Returns when every campaign touched is saved and shown. */
export async function foldTrackEvents(events: OutreachEvent[]): Promise<void> {
  const byCampaign = new Map<string, OutreachEvent[]>()
  for (const ev of events) {
    if ((ev.type !== 'track.open' && ev.type !== 'track.click') || ev.test || !ev.campaignId || !ev.email || !ev.messageKey) continue
    const list = byCampaign.get(ev.campaignId) ?? []
    list.push(ev)
    byCampaign.set(ev.campaignId, list)
  }
  await Promise.all([...byCampaign].map(([cid, evs]) => serial(cid, async () => {
    const c = useOutreachStore.getState().campaigns.find((x) => x.id === cid)
    if (!c) return
    const saved = (await idbGet<Saved>(`engageT:${cid}`)) ?? { v: V, byEmail: {}, hitIds: [] }
    const seenIds = new Set(saved.hitIds)
    const fresh = evs.filter((e) => !seenIds.has(Number(e.hitId)))
    if (!fresh.length) return
    const keys = new Map(fresh.map((e) => [String(e.messageKey), String(e.email).toLowerCase()]))
    let byEmail = foldEvents(saved.byEmail, fresh.map(toRow), keys, { sentAt: keySentAt(c), bounced: c.bounced })
    // what the fold does not keep: how many times, where, and the forward estimate
    for (const e of fresh) {
      const email = String(e.email).toLowerCase()
      const cur = byEmail[email]
      if (!cur) continue
      const counted = e.cls === 'human' || (e.cls === 'proxy' && e.why !== 'microsoft-network')
      if (!counted) continue
      const where = whereOf(e)
      const next: Engagement = { ...cur, hits: (cur.hits ?? 0) + 1, seen: [where, ...(cur.seen ?? []).filter((x) => x !== where)].slice(0, MAX_SEEN) }
      if (e.cls === 'human' && (e.country || e.network)) {
        const pk = `${e.country ?? ''}|${e.network ?? ''}`
        if (!(next.places ?? []).includes(pk)) next.places = [...(next.places ?? []), pk].slice(0, 20)
      }
      next.forwarded = forwardOf(next)
      byEmail = { ...byEmail, [email]: next }
    }
    for (const e of fresh) seenIds.add(Number(e.hitId))
    await idbSet(`engageT:${cid}`, { v: V, byEmail, hitIds: [...seenIds].slice(-50_000) })
    const cloudFold = (await idbGet<{ byEmail?: Record<string, Engagement> }>(`engage:${cid}`))?.byEmail
    useCloud.getState().set({ engagement: { ...useCloud.getState().engagement, [cid]: mergeAll(cloudFold, byEmail) } })
  })))
}

/** At launch: show what was folded before, for every campaign that tracked anything (sync may be off). */
export async function hydrateTrackerEngagement(): Promise<void> {
  const st = useOutreachStore.getState()
  const shown = { ...useCloud.getState().engagement }
  let changed = false
  for (const c of st.campaigns) {
    if (!Object.keys(c.tracking ?? {}).length) continue
    const t = await trackerSaved(c.id)
    if (!Object.keys(t).length) continue
    shown[c.id] = mergeAll(shown[c.id], t)
    changed = true
  }
  if (changed) useCloud.getState().set({ engagement: { ...useCloud.getState().engagement, ...shown } })
}
