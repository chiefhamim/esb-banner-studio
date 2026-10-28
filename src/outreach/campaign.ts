// The batch runner. The first version's "Start Daily Batch" only set a RUNNING label: nothing picked a contact,
// sent, waited or counted, so the countdown never moved and the quota never rose. Here a batch is a loop: the next
// contact the batch may send to (compose.ts skipReason), one email through the main process, the result written to
// the contact, then a random wait between the editor's shortest and longest gap, shown as a countdown. Pause and Stop
// take effect at once, even mid-wait. The main process enforces the daily cap, the minimum gap and no-repeat on its
// own ledger whatever this loop does, so a fault here can never send more than the settings allow.

import { useOutreachStore } from './outreachStore'
import { buildMessage, skipReason } from './compose'
import type { Contact } from './types'

let runId = 0

/** The contacts a batch would send to now, in sheet order. */
export function eligible(contacts: Contact[], subject: string, body: string): Contact[] {
  return contacts.filter((c) => !skipReason(c, subject, body))
}

const sleepUntil = (t: number, id: number) => new Promise<boolean>((resolve) => {
  const tick = () => {
    const s = useOutreachStore.getState()
    if (id !== runId || s.campaign === 'idle') return resolve(false)
    if (s.campaign === 'paused') { setTimeout(tick, 500); return }
    if (Date.now() >= t) return resolve(true)
    setTimeout(tick, Math.min(500, t - Date.now()))
  }
  tick()
})

const attachmentsOf = () => useOutreachStore.getState().attachments.map((a) => ({ name: a.name, dataUrl: a.dataUrl }))

export async function startBatch() {
  const s = useOutreachStore.getState()
  const send = window.esb?.outreachSend
  if (!send) { s.addLog('error', 'Sending needs the ESB Studio desktop app'); return }
  await s.refreshMail()
  const mail = useOutreachStore.getState().mail
  if (!mail?.hasPassword || !mail.settings) { s.addLog('error', 'Save the sender account and app password first (Sender → Settings)'); return }
  const queue = eligible(useOutreachStore.getState().contacts, s.subject, s.body)
  const room = Math.max(0, mail.settings.dailyLimit - mail.sent24h)
  if (!queue.length) { s.addLog('warn', 'Nobody on this sheet is ready to send to'); return }
  if (!room) { s.addLog('warn', `Today's limit of ${mail.settings.dailyLimit} is used up`); return }
  const id = ++runId
  const total = Math.min(queue.length, room)
  s.setCampaign('running', { runSent: 0, runTotal: total, nextAt: null })
  s.addLog('info', `Batch started: ${total} email${total === 1 ? '' : 's'}, ${mail.settings.minDelaySec}–${mail.settings.maxDelaySec} s apart`)

  let sent = 0
  const list = queue.slice(0, total)
  for (let i = 0; i < list.length; ) {
    const c = list[i]
    // the contact may have been opted out, approved away or sent by hand since the batch began
    let st = useOutreachStore.getState()
    const now = st.contacts.find((x) => x.email === c.email)
    if (!now || skipReason(now, st.subject, st.body)) { i++; continue }
    if (!(await sleepUntil(st.nextAt ?? 0, id))) return
    st = useOutreachStore.getState()
    st.markSending(c.email)
    const msg = buildMessage(now, st.subject, st.body, st.lang)
    const r = await send({ to: c.email, subject: msg.subject, text: msg.text, attachments: attachmentsOf() })
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
      st.markSent(c.email, Date.now())
      st.addLog('ok', `Sent to ${now.personName || c.email}${now.organization ? `, ${now.organization}` : ''}`)
    } else if (r.duplicate) {
      st.markSent(c.email, Date.now())
      st.addLog('warn', `${c.email}: ${r.error}`)
    } else {
      st.markFailed(c.email, r.error)
      st.addLog('error', `${c.email}: ${r.error}`)
      // the account or the daily limit refused: every later send would fail the same way
      if (r.nextAt || /password|auth|login|credential|limit/i.test(r.error)) {
        st.setCampaign('idle')
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
  useOutreachStore.getState().setCampaign('idle')
  useOutreachStore.getState().addLog('info', `Batch finished: ${sent} sent`)
}

export function pauseBatch() { useOutreachStore.getState().setCampaign('paused'); useOutreachStore.getState().addLog('warn', 'Batch paused') }
export function resumeBatch() { useOutreachStore.getState().setCampaign('running'); useOutreachStore.getState().addLog('info', 'Batch resumed') }
export function stopBatch() {
  runId++
  const s = useOutreachStore.getState()
  s.markSending(null)
  s.setCampaign('idle')
  s.addLog('warn', 'Batch stopped')
}

/** One test email to the editor's own address: the first contact's details fill the template so it reads as sent. */
export async function sendTest(to: string, sample: Contact | undefined) {
  const s = useOutreachStore.getState()
  const send = window.esb?.outreachSend
  if (!send) return { ok: false as const, error: 'Sending needs the ESB Studio desktop app' }
  const stand: Contact = sample ?? { id: 'test', serial: 0, sectorGroup: '', organization: '', personName: '', designation: '', email: to, phone: '', purpose: '', mxStatus: 'UNKNOWN', approved: false, status: 'QUEUED' }
  const msg = buildMessage(stand, s.subject, s.body, s.lang)
  const r = await send({ to, subject: `[Test] ${msg.subject}`, text: msg.text, attachments: attachmentsOf(), isTest: true })
  s.addLog(r.ok ? 'ok' : 'error', r.ok ? `Test sent to ${to}` : `Test to ${to}: ${r.error}`)
  return r
}
