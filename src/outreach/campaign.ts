// The batch runner. The first version's "Start Daily Batch" only set a RUNNING label: nothing picked a contact,
// sent, waited or counted, so the countdown never moved and the quota never rose. Here a batch is a loop: the next
// contact the campaign may send to (compose.ts skipReason, inside the campaign's audience), one email through the
// main process, the result written to the campaign, then a random wait between the editor's shortest and longest gap,
// shown as a countdown. Pause and Stop take effect at once, even mid-wait. The main process enforces the daily cap,
// the minimum gap and no-repeat on its own ledger whatever this loop does, so a fault here can never send more than
// the settings allow.

import { designPayload, designVars, type DesignLetter } from './design'
import { useOutreachStore } from './outreachStore'
import { buildMessage, missingFields, skipReason } from './compose'
import type { Campaign, Contact } from './types'
import type { EsbOutreachMail } from '../esb'
import { buildJobSpec } from './jobSpec'
import { engineClient } from './engineClient'
import { useEngineStore } from './engineStore'
import { letterFor } from './segments'

/** The campaign's audience: one group and/or any of the chosen purposes ("" filters nothing). */
export function inAudience(c: Contact, a: Campaign['audience'] | undefined): boolean {
  if (!a) return true
  if (a.group != null && c.groupNo !== a.group) return false
  if (a.purposes.length && !c.purposes.some((p) => a.purposes.includes(p))) return false
  return true
}

/** The contacts a batch would send to now, in sheet order. */
// The Send footer, the Send tab, the header count, the Review sheet and cannotStart() each ask this on every render, over
// every contact (a regex over the letter per contact). The answer only changes with the contacts array, the letter or
// the audience, so the last one is kept. Callers only read the list; never mutate it.
let lastEligible: { contacts: Contact[]; subject: string; body: string; audience: string; out: Contact[] } | null = null
export function eligible(contacts: Contact[], subject: string, body: string, audience?: Campaign['audience']): Contact[] {
  const aud = JSON.stringify(audience ?? null)
  const l = lastEligible
  if (l && l.contacts === contacts && l.subject === subject && l.body === body && l.audience === aud) return l.out
  const out = contacts.filter((c) => inAudience(c, audience) && !skipReason(c, subject, body))
  lastEligible = { contacts, subject, body, audience: aud, out }
  return out
}

/** The signature text the campaign uses ('' for none). */
export function signatureOf(c: Campaign | null): string {
  if (!c || c.signatureId === 'none') return ''
  return useOutreachStore.getState().signatures.find((x) => x.id === c.signatureId)?.text ?? ''
}

/** Everything the main process needs to build one recipient's message. */
export function mailFor(contact: Contact, c: Campaign): Omit<EsbOutreachMail, 'to' | 'attachments'> {
  const resolved = letterFor(contact, c)
  const opener = c.openers?.[contact.email]?.text
  const m = buildMessage(contact, resolved.subject, resolved.body, c.lang, opener)
  const st = useOutreachStore.getState()
  const design = designFor(c)
  return {
    subject: m.subject, body: m.body, optOut: m.optOut, signature: signatureOf(c), lang: c.lang, letterhead: c.letterhead,
    officialPad: c.officialPad, footerLine: st.footerLine, fontFamily: st.fontFamily,
    headerBg: st.headerBg, footerBg: st.footerBg, stripeColors: st.stripeColors,
    ...(design ? { design: designPayload(design), vars: designVars(contact, design.html, opener) } : {}),
  }
}

/** The campaign's designed letter, loaded. A campaign marked as designed whose page is not loaded (another campaign
 *  is open, or IndexedDB lost it) must never quietly go out as its plain-text version, so that is an error. */
export function designFor(c: Campaign): DesignLetter | null {
  if (!c.design) return null
  const st = useOutreachStore.getState()
  if (st.activeId === c.id && st.design) return st.design
  throw new Error(`${c.name}: its designed letter is not loaded — open the campaign, or pick the HTML file again (Letter → Designed HTML)`)
}

const attachmentsOf = () => useOutreachStore.getState().attachments.map((a) => ({ name: a.name, dataUrl: a.dataUrl }))

// ------------------------------------------------------------------ follow-ups
const DAY = 24 * 3600_000

export const FOLLOW_UP_DEFAULT: Record<'en' | 'bn', string> = {
  en: 'Dear {name},\n\nI wrote to you recently on behalf of ESB Power Line and wanted to make sure my letter reached you.\n\nIf it is of interest, a short reply is all we need. If not, there is no need to answer, and we will not write about it again.',
  bn: 'শ্রদ্ধেয় {name},\n\nসম্প্রতি ইএসবি পাওয়ারলাইনের পক্ষ থেকে আপনাকে একটি চিঠি পাঠিয়েছিলাম; সেটি আপনার কাছে পৌঁছেছে কি না, তা নিশ্চিত হতে চাইছি।\n\nআগ্রহী হলে একটি সংক্ষিপ্ত উত্তরই যথেষ্ট। আগ্রহী না হলে উত্তর দেওয়ার প্রয়োজন নেই; এ বিষয়ে আমরা আর লিখব না।',
}

/** The follow-up letter as it will go: the editor's, else the default, with "Re:" on the first letter's subject. */
export function followUpLetter(c: Campaign): { subject: string; body: string } {
  return { subject: c.followUp.subject.trim() || `Re: ${c.subject.replace(/^re:\s*/i, '')}`, body: c.followUp.body.trim() || FOLLOW_UP_DEFAULT[c.lang] }
}

/**
 * Why this contact gets no follow-up, or null. Only someone the campaign wrote to at least `afterDays` ago, who has
 * not answered, bounced or opted out, and has not had one. The main process checks the first letter and "once a
 * month" again on its own ledger.
 */
export function followUpReason(x: Contact, c: Campaign, now = Date.now()): string | null {
  const sentAt = c.sent[x.email]
  if (!sentAt) return 'Not sent the first letter'
  if (x.status === 'OPTED_OUT') return 'Asked not to be emailed'
  if (x.status === 'BOUNCED' || c.bounced[x.email]) return 'Bounced'
  if (c.replied[x.email]) return 'Replied'
  if (c.followed[x.email]) return 'Already followed up'
  if (now - sentAt < c.followUp.afterDays * DAY) return `Due ${new Date(sentAt + c.followUp.afterDays * DAY).toLocaleDateString([], { day: 'numeric', month: 'short' })}`
  const l = followUpLetter(c)
  const miss = missingFields(x, l.subject, l.body)
  return miss.length ? `Missing ${miss.join(', ')}` : null
}

export function followUpQueue(contacts: Contact[], c: Campaign, now = Date.now()): { due: Contact[]; later: number } {
  const sent = contacts.filter((x) => inAudience(x, c.audience) && c.sent[x.email])
  const due = sent.filter((x) => !followUpReason(x, c, now))
  const later = sent.filter((x) => followUpReason(x, c, now)?.startsWith('Due')).length
  return { due, later }
}

/** Why the batch cannot start now, or null. The same answer the Send button and the Review sheet show. */
export function cannotStart(mode: 'first' | 'followup' = 'first'): string | null {
  const s = useOutreachStore.getState()
  const c = s.campaign()
  if (!window.esb?.outreachSend && !window.esb?.outreachJobSubmit) return 'Sending needs the ESB Studio desktop app'
  if (!c) return 'Open or create a campaign first'
  if (!s.mail?.hasPassword || !s.mail.settings) return 'Save the sender account and app password first'
  if (mode === 'first') {
    if (!c.subject.trim() || !c.body.trim()) return 'The letter needs a subject and a body'
    if (c.design && !s.design) return 'The designed letter is not loaded — pick the HTML file again (Letter → Designed HTML)'
    if (!eligible(s.contacts, c.subject, c.body, c.audience).length) return 'Nobody in this audience is ready to send to'
  } else if (!followUpQueue(s.contacts, c).due.length) return 'Nobody is due a follow-up yet'
  return null
}

/** Send the first letter to everyone ready (mode 'first'), or the follow-up to everyone due (mode 'followup'). */
export async function startBatch(mode: 'first' | 'followup' = 'first', startAt?: number | null) {
  const s = useOutreachStore.getState()
  await s.refreshMail()
  const why = cannotStart(mode)
  if (why) { s.addLog('warn', why); return }
  const c = s.campaign()!

  let spec
  try {
    spec = buildJobSpec({
      campaign: c,
      contacts: s.contacts,
      mode,
      attachments: mode === 'first' ? attachmentsOf() : [],
      startAt,
    })
  } catch (e) { s.addLog('error', (e as Error).message); return }

  s.patch({
    status: startAt ? 'scheduled' : 'sending',
    scheduledAt: startAt ?? null,
    interrupted: mode,
  })

  const what = mode === 'first' ? 'email' : 'follow-up'
  s.addLog('info', `${c.name}: ${spec.messages.length} ${what}${spec.messages.length === 1 ? '' : 's'} submitted to autopilot`)

  const res = await engineClient.submit(spec)
  if (!res.ok) {
    s.patch({ status: 'paused', interrupted: null })
    s.addLog('error', `Could not start batch: ${res.error}`)
  }
}

export async function pauseBatch() {
  const s = useOutreachStore.getState()
  const c = s.campaign()
  if (c) {
    const job = useEngineStore.getState().jobForCampaign(c.id)
    if (job) {
      await engineClient.control(job.jobId, 'pause')
    }
  }
  s.setRun('paused')
  s.patch({ status: 'paused' })
  s.addLog('warn', 'Batch paused')
}

export async function resumeBatch() {
  const s = useOutreachStore.getState()
  const c = s.campaign()
  if (c) {
    const job = useEngineStore.getState().jobForCampaign(c.id)
    if (job) {
      await engineClient.control(job.jobId, 'resume')
    }
  }
  s.setRun('running')
  s.patch({ status: 'sending' })
  s.addLog('info', 'Batch resumed')
}

export async function stopBatch() {
  const s = useOutreachStore.getState()
  const c = s.campaign()
  if (c) {
    const job = useEngineStore.getState().jobForCampaign(c.id)
    if (job) {
      await engineClient.control(job.jobId, 'stop')
    }
  }
  s.markSending(null)
  s.setRun('idle')
  s.patch({ status: 'paused', interrupted: null })
  s.addLog('warn', 'Batch stopped')
}

/** A stand-in recipient for a test or a preview when the list has nobody: no name, so the greeting is "Sir/Madam". */
export const STAND_IN: Contact = { id: 'test', serial: 0, sectorGroup: '', groupNo: null, organization: '', personName: '', designation: '', email: '', phone: '', purposes: [], mxStatus: 'UNKNOWN', rawStatus: '', diagnostic: '', sheet: '', approved: false, status: 'QUEUED' }

/** One test email to the editor's own address: the selected contact's details fill the template so it reads as sent. */
export async function sendTest(to: string, sample: Contact | undefined) {
  const s = useOutreachStore.getState()
  const c = s.campaign()
  const send = window.esb?.outreachSend
  if (!send) return { ok: false as const, error: 'Sending needs the ESB Studio desktop app' }
  if (!c) return { ok: false as const, error: 'Open a campaign first' }
  let m
  try { m = mailFor(sample ?? { ...STAND_IN, email: to }, c) } catch (e) { return { ok: false as const, error: (e as Error).message } }
  const r = await send({ to, ...m, subject: `[Test] ${m.subject}`, attachments: attachmentsOf(), isTest: true })
  s.addLog(r.ok ? 'ok' : 'error', r.ok ? `Test sent to ${to}` : `Test to ${to}: ${r.error}`)
  return r
}

// ------------------------------------------------------------------ scheduled start
// A campaign set to start at a time starts then — while the app is open. Nothing runs when it is closed (there is no
// server here), and a time that passed while it was closed starts the batch at the next launch only if it is less than
// 12 hours late; older ones wait for the editor, so a forgotten schedule never fires a week later.
export function startScheduler() {
  void engineClient.init()
}

// ------------------------------------------------------------------ results
const csvCell = (v: string | number) => { const t = String(v); return /[",\n\r]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t }

/** One row per contact in the campaign's audience: what happened and why. Read from the campaign, nothing estimated. */
export function resultsCsv(c: Campaign, contacts: Contact[]): string {
  const head = ['Email', 'Name', 'Designation', 'Organization', 'Group', 'Sheet status', 'Result', 'When', 'Detail', 'Replied', 'Followed up']
  const rows = contacts.filter((x) => inAudience(x, c.audience)).map((x) => {
    const t = c.sent[x.email]
    const bounced = c.bounced[x.email]
    const result = bounced ? 'Bounced' : t ? 'Sent' : c.failed[x.email] ? 'Failed' : x.status === 'OPTED_OUT' ? 'Opted out' : skipReason(x, c.subject, c.body) ? 'Skipped' : 'Not sent yet'
    const detail = bounced ?? c.failed[x.email] ?? (t ? (x.status === 'OPTED_OUT' ? 'Asked not to be emailed' : '') : skipReason(x, c.subject, c.body) ?? '')
    const iso = (v?: number) => (v ? new Date(v).toISOString() : '')
    return [x.email, x.personName, x.designation, x.organization, x.sectorGroup, x.rawStatus, result, iso(t), detail, iso(c.replied[x.email]), iso(c.followed[x.email])]
  })
  return [head, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n'
}

export function downloadText(name: string, text: string, type = 'text/csv') {
  const url = URL.createObjectURL(new Blob(['﻿' + text], { type: `${type};charset=utf-8` }))
  const a = Object.assign(document.createElement('a'), { href: url, download: name })
  document.body.appendChild(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
