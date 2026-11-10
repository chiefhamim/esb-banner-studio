// What the desk knows about the shared (cloud) copy of Outreach: whether sync works and when it last did, who is
// sending each campaign right now (outreach_locks), and the opens/clicks seen per recipient (outreach_events).
// Written only by cloudSync.ts; read by the status bar, the contact list, the Contact tab, the Send footer and the
// Activity desk. Kept apart from cloudSync.ts so those components never import the sync engine itself.

import { create } from 'zustand'
import type { Engagement } from './outcome'
import { fmtTime } from '../ui/time'

export type CloudState =
  | 'signed-out' // no staff session: local only
  | 'test-run' // ESB_OUTREACH_DRYRUN: simulated sends must never reach the shared ledger
  | 'not-setup' // the tables are not on the site's database yet (migration 0024 not applied)
  | 'no-access' // signed in, but the account is not staff for these tables
  | 'offline' // the last attempt did not reach the server; local work continues and is sent later
  | 'syncing'
  | 'ok'
  | 'error'

export interface LockInfo {
  campaignId: string
  pc: string
  label: string
  heartbeatAt: number
  mine: boolean
  /** No heartbeat for longer than the stale window: the other PC is probably gone, and may be taken over. */
  stale: boolean
}

export interface CloudStore {
  state: CloudState
  /** When the last full pull+push finished without error (ms). */
  lastSync: number | null
  /** The last problem, in words, for the tooltip. */
  error: string | null
  /** Changes made here that have not reached the cloud yet. */
  pending: number
  /** campaignId → email → opens/clicks. */
  engagement: Record<string, Record<string, Engagement>>
  /** campaignId → who holds its send lock (null = nobody, as last read). */
  locks: Record<string, LockInfo | null>
  /** This PC's name as other PCs see it in "Sending from ". */
  pcLabel: string
  set: (p: Partial<Omit<CloudStore, 'set'>>) => void
}

export const useCloud = create<CloudStore>((set) => ({
  state: 'signed-out',
  lastSync: null,
  error: null,
  pending: 0,
  engagement: {},
  locks: {},
  pcLabel: '',
  set: (p) => set(p),
}))

if ((import.meta as unknown as { env?: { DEV?: boolean } }).env?.DEV && typeof window !== 'undefined') Object.assign(window, { __cloud: useCloud })

export const STALE_SECONDS = 600

const ago = (t: number, now = Date.now()) => {
  const s = Math.max(0, Math.round((now - t) / 1000))
  return s < 60 ? `${s} s ago` : s < 3600 ? `${Math.round(s / 60)} min ago` : s < 86400 ? `${Math.round(s / 3600)} h ago` : new Date(t).toLocaleDateString()
}
export { ago as cloudAgo }

/** Why Send/Resume must wait for another PC, or null. A stale lock does not block: it is offered for take-over. */
export function lockBlock(lock: LockInfo | null | undefined): string | null {
  if (!lock || lock.mine || lock.stale) return null
  return `Sending from ${lock.label || 'another PC'} — last seen ${fmtTime(lock.heartbeatAt)}`
}

/** The status bar's words for the sync state. */
export function cloudText(s: Pick<CloudStore, 'state' | 'lastSync' | 'pending'>, now = Date.now()): string {
  switch (s.state) {
    case 'signed-out': return 'Not signed in — sync off'
    case 'test-run': return 'Test run — sync off'
    case 'not-setup': return 'Cloud not set up yet'
    case 'no-access': return 'No access — sync off'
    case 'offline': return 'Offline — will sync'
    case 'syncing': return s.lastSync ? `Syncing · ${ago(s.lastSync, now)}` : 'Syncing'
    case 'error': return 'Sync problem — will retry'
    case 'ok': return s.lastSync ? `Synced ${ago(s.lastSync, now)}` : 'Synced'
  }
}
