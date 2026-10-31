// src/outreach/activityMeta.ts
// How an Activity event looks: the word on its chip, its icon and its colour family. The colour families are the same
// ones the rest of Outreach uses (sent = blue, reply = teal, good/bad/warn = the status colours, quiet = neutral).

import type { IconName } from '../ui/Icon'

export type EventTone = 'sent' | 'reply' | 'good' | 'bad' | 'warn' | 'quiet'

export interface EventMeta {
  label: string
  icon: IconName
  tone: EventTone
}

const META: Record<string, EventMeta> = {
  'send.ok': { label: 'Sent', icon: 'send', tone: 'sent' },
  'send.fail': { label: 'Failed', icon: 'info', tone: 'bad' },
  'send.retry': { label: 'Retry', icon: 'refresh', tone: 'warn' },
  'send.skip': { label: 'Skipped', icon: 'minus', tone: 'warn' },
  reply: { label: 'Reply', icon: 'mail', tone: 'reply' },
  bounce: { label: 'Bounce', icon: 'undo', tone: 'bad' },
  optout: { label: 'Opt-out', icon: 'hand', tone: 'warn' },
  'recipient.held': { label: 'Held', icon: 'lock', tone: 'warn' },
  'recipient.released': { label: 'Released', icon: 'unlock', tone: 'quiet' },
  'job.created': { label: 'Batch', icon: 'layers', tone: 'quiet' },
  'job.started': { label: 'Sending', icon: 'play', tone: 'sent' },
  'job.resumed': { label: 'Sending', icon: 'play', tone: 'sent' },
  'job.paused': { label: 'Paused', icon: 'pause', tone: 'warn' },
  'job.waiting': { label: 'Waiting', icon: 'clock', tone: 'warn' },
  'job.done': { label: 'Finished', icon: 'check', tone: 'good' },
  'job.stopped': { label: 'Stopped', icon: 'square', tone: 'warn' },
  'engine.start': { label: 'Engine', icon: 'power', tone: 'quiet' },
  'engine.quit': { label: 'Engine', icon: 'power', tone: 'quiet' },
  'inbox.checked': { label: 'Inbox', icon: 'inbox', tone: 'quiet' },
  'ai.action': { label: 'Assistant', icon: 'sparkle', tone: 'quiet' },
  note: { label: 'Note', icon: 'edit', tone: 'quiet' },
}

export function eventMeta(type: string): EventMeta {
  return META[type] ?? { label: type.replace(/[._]/g, ' '), icon: 'activity', tone: 'quiet' }
}

/** "Today", "Yesterday", otherwise "Sat 31 Oct" — the heading above a day's rows in the log. */
export function dayHeading(t: number, now = Date.now()): string {
  const d = new Date(t)
  const today = new Date(now)
  if (d.toDateString() === today.toDateString()) return 'Today'
  const yesterday = new Date(now)
  yesterday.setDate(today.getDate() - 1)
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday'
  return d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })
}
