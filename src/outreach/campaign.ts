// The batch runner. The first version's "Start Daily Batch" only set a RUNNING label: nothing picked a contact,
// sent, waited or counted, so the countdown never moved and the quota never rose. Here a batch is a loop: the next
// contact the campaign may send to (compose.ts skipReason, inside the campaign's audience), one email through the
// main process, the result written to the campaign, then a random wait between the editor's shortest and longest gap,
// shown as a countdown. Pause and Stop take effect at once, even mid-wait. The main process enforces the daily cap,
// the minimum gap and no-repeat on its own ledger whatever this loop does, so a fault here can never send more than
// the settings allow.

import { useOutreachStore } from './outreachStore'
import { buildMessage, skipReason } from './compose'
import type { Campaign, Contact } from './types'
import type { EsbOutreachMail } from '../esb'

let runId = 0

/** The campaign's audience: one group and/or any of the chosen purposes ("" filters nothing). */
export function inAudience(c: Contact, a: Campaign['audience'] | undefined): boolean {
  if (!a) return true
  if (a.group != null && c.groupNo !== a.group) return false
  if (a.purposes.length && !c.purposes.some((p) => a.purposes.includes(p))) return false
  return true
}

/** The contacts a batch would send to now, in sheet order. */
export function eligible(contacts: Contact[], subject: string, body: string, audience?: Campaign['audience']): Contact[] {
  return contacts.filter((c) => inAudience(c, audience) && !skipReason(c, subject, body))
}

/** The signature text the campaign uses ('' for none). */
export function signatureOf(c: Campaign | null): string {
  if (!c || c.signatureId === 'none') return ''
  return useOutreachStore.getState().signatures.find((x) => x.id === c.signatureId)?.text ?? ''
}

/** Everything the main process needs to build one recipient's message. */
export function mailFor(contact: Contact, c: Campaign): Omit<EsbOutreachMail, 'to' | 'attachments'> {
  const m = buildMessage(contact, c.subject, c.body, c.lang)
  return { subject: m.subject, body: m.body, optOut: m.optOut, signature: signatureOf(c), lang: c.lang, letterhead: c.letterhead }
}

const sleepUntil = (t: number, id: number) => new Promise<boolean>((resolve) => {
  const tick = () => {
    const s = useOutreachStore.getState()
    if (id !== runId || s.run === 'idle') return resolve(false)
    if (s.run === 'paused') { setTimeout(tick, 500); return }
    if (Date.now() >= t) return resolve(true)
    setTimeout(tick, Math.min(500, t - Date.now()))
  }
  tick()
})

const attachmentsOf = () => useOutreachStore.getState().attachments.map((a) => ({ name: a.name, dataUrl: a.dataUrl }))

/** Why the batch cannot start now, or null. The same answer the Send button and the Review sheet show. */
export function cannotStart(): string | null {
  const s = useOutreachStore.getState()
  const c = s.campaign()
  if (!window.esb?.outreachSend) return 'Sending needs the ESB Studio desktop app'
  if (!c) return 'Open or create a campaign first'
  if (!s.mail?.hasPassword || !s.mail.settings) return 'Save the sender account and app password first'
  if (!c.subject.trim() || !c.body.trim()) return 'The letter needs a subject and a body'
  if (!eligible(s.contacts, c.subject, c.body, c.audience).length) return 'Nobody in this audience is ready to send to'
  if (s.mail.sent24h >= s.mail.settings.dailyLimit) return `Today's limit of ${s.mail.settings.dailyLimit} is used up`
  return null
}

export async function startBatch() {
  const s = useOutreachStore.getState()
  await s.refreshMail()
  const why = cannotStart()
  if (why) { s.addLog('warn', why); return }
  const c = s.campaign()!
  const mail = useOutreachStore.getState().mail!
  const queue = eligible(useOutreachStore.getState().contacts, c.subject, c.body, c.audience)
  const room = Math.max(0, mail.settings!.dailyLimit - mail.sent24h)
  const id = ++runId
  const total = Math.min(queue.length, room)
  const campaignId = c.id
  s.patch({ status: 'sending', scheduledAt: null })
  s.setRun('running', { runSent: 0, runTotal: total, nextAt: null })
  s.addLog('info', `${c.name}: ${total} email${total === 1 ? '' : 's'}, ${mail.settings!.minDelaySec}–${mail.settings!.maxDelaySec} s apart`)

  let sent = 0
  const list = queue.slice(0, total)
  const finish = (status: Campaign['status']) => { useOutreachStore.getState().patch({ status }); useOutreachStore.getState().setRun('idle') }
  for (let i = 0; i < list.length; ) {
    const target = list[i]
    // the contact may have been opted out, approved away or sent by hand since the batch began
    let st = useOutreachStore.getState()
    const cur = st.campaign()
    if (!cur || cur.id !== campaignId) return
    const now = st.contacts.find((x) => x.email === target.email)
    if (!now || skipReason(now, cur.subject, cur.body)) { i++; continue }
    if (!(await sleepUntil(st.nextAt ?? 0, id))) return
    st = useOutreachStore.getState()
    const live = st.campaign()!
    st.markSending(target.email)
    const r = await window.esb!.outreachSend!({ to: target.email, ...mailFor(now, live), attachments: attachmentsOf() })
    st = useOutreachStore.getState()
    st.markSending(null)
    if (id !== runId) return
    if (!r.ok && r.nextAt && /too soon/i.test(r.error)) {
      // the main process keeps a floor between sends: wait it out and try the same contact again
      st.setNextAt(r.nextAt + 1000)
      continue
    }
    i++
    if (r.ok) {
      sent++
      st.markSent(target.email, Date.now())
      st.addLog('ok', `Sent to ${now.personName || target.email}${now.organization ? `, ${now.organization}` : ''}`)
    } else if (r.duplicate) {
      st.markSent(target.email, Date.now())
      st.addLog('warn', `${target.email}: ${r.error}`)
    } else {
      st.markFailed(target.email, r.error)
      st.addLog('error', `${target.email}: ${r.error}`)
      // the account or the daily limit refused: every later send would fail the same way
      if (r.nextAt || /password|auth|login|credential|limit/i.test(r.error)) {
        finish('paused')
        st.addLog('warn', r.nextAt ? `Stopped — the next send is allowed at ${new Date(r.nextAt).toLocaleTimeString()}` : 'Stopped — check the sender account')
        await st.refreshMail()
        return
      }
    }
    useOutreachStore.setState({ runSent: sent })
    await useOutreachStore.getState().refreshMail()
    const m = useOutreachStore.getState().mail?.settings
    const lo = (m?.minDelaySec ?? 180) * 1000, hi = (m?.maxDelaySec ?? 480) * 1000
    // no wait after the last one
    useOutreachStore.getState().setNextAt(i < list.length ? Date.now() + lo + Math.random() * (hi - lo) : null)
  }
  if (id !== runId) return
  const left = eligible(useOutreachStore.getState().contacts, c.subject, c.body, c.audience).length
  finish(left ? 'paused' : 'done')
  useOutreachStore.getState().addLog('info', `${c.name}: ${sent} sent${left ? ` · ${left} left for another day` : ''}`)
}

export function pauseBatch() { useOutreachStore.getState().setRun('paused'); useOutreachStore.getState().patch({ status: 'paused' }); useOutreachStore.getState().addLog('warn', 'Batch paused') }
export function resumeBatch() { useOutreachStore.getState().setRun('running'); useOutreachStore.getState().patch({ status: 'sending' }); useOutreachStore.getState().addLog('info', 'Batch resumed') }
export function stopBatch() {
  runId++
  const s = useOutreachStore.getState()
  s.markSending(null)
  s.setRun('idle')
  s.patch({ status: 'paused' })
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
  const m = mailFor(sample ?? { ...STAND_IN, email: to }, c)
  const r = await send({ to, ...m, subject: `[Test] ${m.subject}`, attachments: attachmentsOf(), isTest: true })
  s.addLog(r.ok ? 'ok' : 'error', r.ok ? `Test sent to ${to}` : `Test to ${to}: ${r.error}`)
  return r
}

// ------------------------------------------------------------------ scheduled start
// A campaign set to start at a time starts then — while the app is open. Nothing runs when it is closed (there is no
// server here), and a time that passed while it was closed starts the batch at the next launch only if it is less than
// 12 hours late; older ones wait for the editor, so a forgotten schedule never fires a week later.
const LATE_LIMIT = 12 * 3600_000
let scheduler: ReturnType<typeof setInterval> | null = null
export function startScheduler() {
  if (scheduler) return
  scheduler = setInterval(() => {
    const s = useOutreachStore.getState()
    if (s.run !== 'idle') return
    const due = s.campaigns.find((c) => c.status === 'scheduled' && c.scheduledAt && c.scheduledAt <= Date.now())
    if (!due) return
    if (Date.now() - due.scheduledAt! > LATE_LIMIT) {
      s.patchById(due.id, { status: 'draft', scheduledAt: null })
      s.addLog('warn', `${due.name}: its start time passed while the app was closed — schedule it again`)
      return
    }
    void (async () => {
      if (s.activeId !== due.id) await s.openCampaign(due.id)
      s.addLog('info', `${due.name}: scheduled start`)
      await startBatch()
    })()
  }, 15_000)
}

// ------------------------------------------------------------------ results
const csvCell = (v: string | number) => { const t = String(v); return /[",\n\r]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t }

/** One row per contact in the campaign's audience: what happened and why. Read from the campaign, nothing estimated. */
export function resultsCsv(c: Campaign, contacts: Contact[]): string {
  const head = ['Email', 'Name', 'Designation', 'Organization', 'Group', 'Sheet status', 'Result', 'When', 'Detail']
  const rows = contacts.filter((x) => inAudience(x, c.audience)).map((x) => {
    const t = c.sent[x.email]
    const result = t ? 'Sent' : c.failed[x.email] ? 'Failed' : x.status === 'OPTED_OUT' ? 'Opted out' : skipReason(x, c.subject, c.body) ? 'Skipped' : 'Not sent yet'
    const detail = c.failed[x.email] ?? (t ? '' : skipReason(x, c.subject, c.body) ?? '')
    return [x.email, x.personName, x.designation, x.organization, x.sectorGroup, x.rawStatus, result, t ? new Date(t).toISOString() : '', detail]
  })
  return [head, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n'
}

export function downloadText(name: string, text: string, type = 'text/csv') {
  const url = URL.createObjectURL(new Blob(['﻿' + text], { type: `${type};charset=utf-8` }))
  const a = Object.assign(document.createElement('a'), { href: url, download: name })
  document.body.appendChild(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
