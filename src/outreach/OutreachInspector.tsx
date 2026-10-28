// Right column, three tabs. Send: who sends, today's room, the batch (now or at a time), a test email and the
// results. Contact: what the sheet says about the selected address and the editor's decisions on it. Review: the
// fixed checks (checks.ts) and, on request, a second reading by the Review AI. Every figure is read from the main
// process's ledger, the campaign or the list; nothing here is a placeholder. In the browser preview (no desktop
// bridge) the column says sending needs the desktop app instead of pretending to send.

import { useEffect, useMemo, useState } from 'react'
import { useOutreachStore } from './outreachStore'
import { ask, useOutreachUi, type RightTab } from './outreachUi'
import { cannotStart, downloadText, eligible, followUpQueue, followUpReason, inAudience, pauseBatch, resultsCsv, resumeBatch, sendTest, signatureOf, startBatch, stopBatch } from './campaign'
import { skipReason } from './compose'
import { STATUS_LABEL, purposeLabel } from './directory'
import { letterChecks } from './checks'
import { OUTREACH_BLUEPRINTS, reviewLetter, type ReviewNote } from './outreachAi'
import { STATUS_TEXT } from './CampaignsTab'
import { aiFor, aiPaused, loadAiSettings, providerMeta, roleProvider } from '../editorial/aiProviders'
import { ProviderMark } from '../editorial/ProviderMark'
import { Icon } from '../ui/Icon'
import { Switch, Tabs } from '../ui/controls'

const mmss = (ms: number) => { const s = Math.max(0, Math.ceil(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` }
const gap = (lo: number, hi: number) => (lo >= 60 ? `${Math.round(lo / 60)}–${Math.round(hi / 60)} min` : `${lo}–${hi} s`)

export function OutreachInspector() {
  const ui = useOutreachUi()
  return (
    <aside className="or-right" aria-label="Sending and review">
      <Tabs<RightTab> className="or-tabs" value={ui.right} onChange={(v) => ui.set({ right: v })} options={[
        { value: 'send', label: 'Send', icon: 'send' },
        { value: 'contact', label: 'Contact', icon: 'user' },
        { value: 'review', label: 'Review', icon: 'checkDouble' },
      ]} />
      <div className="or-right-scroll">
        {ui.right === 'send' ? <SendTab /> : ui.right === 'contact' ? <ContactTab /> : <ReviewTab />}
      </div>
    </aside>
  )
}

function SendTab() {
  const s = useOutreachStore()
  const ui = useOutreachUi()
  const c = s.campaign()
  const desktop = !!window.esb?.outreachSend
  const [testTo, setTestTo] = useState('')
  const [testing, setTesting] = useState(false)
  const [, tick] = useState(0)

  // the countdown re-renders once a second while a wait is running
  useEffect(() => {
    if (!s.nextAt) return
    const t = setInterval(() => tick((n) => n + 1), 1000)
    return () => clearInterval(t)
  }, [s.nextAt])
  useEffect(() => { if (!testTo && s.mail?.settings?.user) setTestTo(s.mail.settings.user) }, [s.mail?.settings?.user]) // eslint-disable-line react-hooks/exhaustive-deps

  const set = s.mail?.settings
  const ready = s.mail?.hasPassword && !!set
  const limit = set?.dailyLimit ?? 0
  const used = s.mail?.sent24h ?? 0
  const queue = c ? eligible(s.contacts, c.subject, c.body, c.audience) : []
  const willSend = Math.min(queue.length, Math.max(0, limit - used))
  const active = s.contacts.find((x) => x.id === s.activeContact)
  const why = cannotStart()
  const sent = c ? Object.keys(c.sent).length : 0
  const failed = c ? Object.keys(c.failed).length : 0

  return (
    <>
      <section className="or-card">
        <header><Icon name="mail" size={14} /><h3>Sender</h3>
          <button type="button" className="btn sm" onClick={() => ui.set({ sheet: 'sender' })} disabled={!desktop} data-tip={desktop ? 'Account, app password and pacing' : 'Sending needs the ESB Studio desktop app'}>
            <Icon name="sliders" size={13} /><span>Settings</span>
          </button>
        </header>
        {!desktop ? (
          <p className="or-muted">Sending needs the ESB Studio desktop app. Here you can prepare the list and the letter.</p>
        ) : set ? (
          <div className="or-sender">
            <b>{set.name}</b><span>{set.user}</span>
            <span className={'or-chip ' + (ready ? (s.smtp.state === 'bad' ? 'bad' : 'good') : 'warn')}>{!ready ? 'No app password' : s.smtp.state === 'bad' ? 'Login failed' : s.smtp.state === 'ok' ? 'Signed in' : 'Saved'}</span>
          </div>
        ) : (
          <p className="or-muted">No sender yet. Add the Gmail or Workspace account that sends, with a Google app password.</p>
        )}
        {desktop && set && (
          <>
            <div className="or-meter-row"><span>Last 24 hours</span><span className="or-figure">{used} <small>of {limit}</small></span></div>
            <div className="or-meter" role="meter" aria-valuemin={0} aria-valuemax={limit} aria-valuenow={used}><i style={{ width: `${limit ? Math.min(100, (used / limit) * 100) : 0}%` }} /></div>
            <p className="or-muted">{Math.max(0, limit - used)} more can go today · {gap(set.minDelaySec, set.maxDelaySec)} apart</p>
          </>
        )}
      </section>

      {c?.interrupted && s.run === 'idle' && (
        <section className="or-card or-interrupted">
          <header><Icon name="info" size={14} /><h3>Sending was interrupted</h3></header>
          <p className="or-muted">ESB Studio closed while this campaign was sending {c.interrupted === 'followup' ? 'follow-ups' : 'its letter'}. Everyone it reached is recorded; nobody gets it twice.</p>
          <div className="or-actions">
            <button type="button" className="btn sm primary" disabled={!!cannotStart(c.interrupted)} data-tip={cannotStart(c.interrupted) ?? 'Pick up where it stopped'} onClick={() => void startBatch(c.interrupted!)}><Icon name="play" size={13} /><span>Continue sending</span></button>
            <button type="button" className="btn sm" onClick={() => s.patch({ interrupted: null })}>Not now</button>
          </div>
        </section>
      )}

      <section className="or-card">
        <header><Icon name="send" size={14} /><h3>{c?.name ?? 'Campaign'}</h3>{c && <span className={'or-chip cs-' + c.status}>{STATUS_TEXT[c.status]}</span>}</header>
        {s.run === 'idle' ? (
          <>
            <p className="or-muted">{!c ? 'Open or create a campaign.' : queue.length ? `${queue.length} ready${desktop && set ? ` · ${willSend} can go today` : ''}` : s.contacts.length ? 'Nobody in this audience is ready — see Skip in Contacts' : c.kind === 'direct' ? 'Type addresses in the To line' : 'Import a list to start'}</p>
            {c?.status === 'scheduled' && c.scheduledAt && <p className="or-sched"><Icon name="clock" size={13} /><span>Starts {new Date(c.scheduledAt).toLocaleString([], { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })} — keep the app open</span><button type="button" className="btn xs" onClick={() => s.patch({ status: 'draft', scheduledAt: null })}>Cancel</button></p>}
            <button type="button" className="btn primary or-wide" onClick={() => ui.set({ sheet: 'review-send' })} disabled={!c} data-tip={why ?? 'Check everything once more, then send now or at a time'}>
              <Icon name="send" size={13} /><span>{willSend ? `Review & send to ${willSend}` : 'Review & send'}</span>
            </button>
          </>
        ) : (
          <>
            <div className="or-progress"><span>{s.runSent} of {s.runTotal} sent</span>{s.current ? <span className="or-ellipsis">Sending to {s.current}</span> : s.nextAt ? <span>Next in <b>{mmss(s.nextAt - Date.now())}</b></span> : null}</div>
            <div className="or-meter"><i style={{ width: `${s.runTotal ? (s.runSent / s.runTotal) * 100 : 0}%` }} /></div>
            <div className="or-actions">
              {s.run === 'running'
                ? <button type="button" className="btn sm" onClick={pauseBatch}><Icon name="pause" size={13} /><span>Pause</span></button>
                : <button type="button" className="btn sm primary" onClick={resumeBatch}><Icon name="play" size={13} /><span>Resume</span></button>}
              <button type="button" className="btn sm" onClick={stopBatch}><Icon name="x" size={13} /><span>Stop</span></button>
            </div>
          </>
        )}
        {c && (sent > 0 || failed > 0) && (
          <div className="or-results">
            <span><b>{sent}</b> sent</span>
            {Object.keys(c.replied).length > 0 && <span className="good"><b>{Object.keys(c.replied).length}</b> replied</span>}
            {Object.keys(c.bounced).length > 0 && <span className="bad"><b>{Object.keys(c.bounced).length}</b> bounced</span>}
            {failed > 0 && <span className="bad"><b>{failed}</b> failed</span>}
            <button type="button" className="btn xs" onClick={() => downloadText(`${c.name.replace(/[^\w-]+/g, '-')}-results.csv`, resultsCsv(c, s.contacts))} data-tip="Every contact in the audience: sent, failed, skipped and why"><Icon name="download" size={12} /><span>Results CSV</span></button>
          </div>
        )}
      </section>

      {c && Object.keys(c.sent).length > 0 && <InboxCard />}
      {c && Object.keys(c.sent).length > 0 && <FollowUpCard />}

      <section className="or-card">
        <header><Icon name="inbox" size={14} /><h3>Test email</h3></header>
        <p className="or-muted">Sends the letter to you first, filled with {active ? <b>{active.personName || active.email}</b> : 'a nameless recipient'}’s details. Does not count toward today.</p>
        <div className="or-test">
          <input type="email" className="or-input" placeholder="your@address" value={testTo} onChange={(e) => setTestTo(e.target.value)} aria-label="Test address" />
          <button type="button" className="btn sm" disabled={!desktop || !ready || testing || !c || !/^\S+@\S+\.\S+$/.test(testTo)} onClick={async () => { setTesting(true); await sendTest(testTo.trim(), active); setTesting(false) }}>
            <Icon name="send" size={13} /><span>{testing ? 'Sending…' : 'Send test'}</span>
          </button>
        </div>
      </section>
    </>
  )
}

function ContactTab() {
  const s = useOutreachStore()
  const ui = useOutreachUi()
  const c = s.campaign()
  const active = s.contacts.find((x) => x.id === s.activeContact)
  if (!active) return <div className="or-empty"><Icon name="user" size={22} /><p>Pick a contact in the list to see what the sheet says about them.</p></div>
  const reason = c ? skipReason(active, c.subject, c.body) : null
  const outside = c && !inAudience(active, c.audience)
  return (
    <section className="or-card">
      <div className="or-contact">
        <b>{active.personName || active.email}</b>
        {(active.designation || active.organization) && <span>{[active.designation, active.organization].filter(Boolean).join(', ')}</span>}
        <span>{active.email}</span>
        {active.phone && <span>{active.phone}</span>}
      </div>
      <dl className="or-facts">
        {active.sectorGroup && <><dt>Group</dt><dd>{active.groupNo != null ? `${active.groupNo} · ` : ''}{active.sectorGroup}</dd></>}
        {active.purposes.length > 0 && <><dt>Listed for</dt><dd className="or-purposes">{active.purposes.map((p) => <span key={p} className="or-chip">{purposeLabel(p)}</span>)}</dd></>}
        <dt>Sheet status</dt><dd>{STATUS_LABEL[active.mxStatus]}{active.rawStatus && active.rawStatus !== active.mxStatus ? ` (${active.rawStatus})` : ''}</dd>
        {active.mxHost && <><dt>Mail server</dt><dd>{active.mxHost}</dd></>}
        {active.diagnostic && <><dt>Sheet note</dt><dd>{active.diagnostic}</dd></>}
        {active.sheet && <><dt>From sheet</dt><dd>{active.sheet.replace(/_/g, ' ')}</dd></>}
        <dt>This campaign</dt><dd>{outside ? 'Outside the audience' : active.status === 'REPLIED' ? `Replied ${active.repliedAt ? new Date(active.repliedAt).toLocaleString() : ''}` : active.status === 'BOUNCED' ? `Bounced: ${active.error}` : active.status === 'SENT' ? `Sent ${active.sentAt ? new Date(active.sentAt).toLocaleString() : ''}` : active.status === 'FAILED' ? `Failed: ${active.error}` : reason ?? 'Will be sent'}</dd>
        {c && c.sent[active.email] && <><dt>Follow-up</dt><dd>{c.followed[active.email] ? `Sent ${new Date(c.followed[active.email]).toLocaleString()}` : followUpReason(active, c) ?? 'Due now'}</dd></>}
      </dl>
      {active.mxStatus !== 'SAFE_TO_SEND' && active.mxStatus !== 'EXCLUDED' && active.mxStatus !== 'UNDELIVERABLE' && c?.kind !== 'direct' && (
        <Switch checked={active.approved} onChange={(v) => s.approve(active.email, v)} label="I checked this address — include it" />
      )}
      <Switch checked={active.status === 'OPTED_OUT'} onChange={(v) => s.optOutAddress(active.email, v)} label="Asked not to be emailed" />
      <button type="button" className="btn sm or-wide" onClick={() => ui.set({ view: 'preview' })}><Icon name="eye" size={13} /><span>Preview their email</span></button>
    </section>
  )
}

function ReviewTab() {
  const s = useOutreachStore()
  const c = s.campaign()
  const [notes, setNotes] = useState<{ list: ReviewNote[]; model: string; for: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const ai = aiFor('review')
  const aiName = providerMeta(ai?.provider ?? roleProvider(loadAiSettings(), 'review')).name
  const signature = signatureOf(c)
  const reference = useMemo(() => { const b = OUTREACH_BLUEPRINTS.find((x) => x.id === c?.blueprint); return b ? `${b.defaultBody}\n${b.bengaliBody}` : '' }, [c?.blueprint])
  const checks = useMemo(() => (c ? letterChecks({ subject: c.subject, body: c.body, signature, attachments: s.attachments, sources: c.sources, reference }) : []), [c, signature, s.attachments, reference])
  if (!c) return <div className="or-empty"><p>Open a campaign to review its letter.</p></div>
  const stamp = `${c.subject}\n${c.body}\n${signature}`
  const order = { bad: 0, warn: 1, ok: 2 }
  const sorted = [...checks].sort((a, b) => order[a.level] - order[b.level])
  const bad = checks.filter((x) => x.level === 'bad').length, warn = checks.filter((x) => x.level === 'warn').length

  const run = async () => {
    setBusy(true); setError(null)
    try {
      const r = await reviewLetter({ subject: c.subject, body: c.body, signature }, { blueprint: c.blueprint, lang: c.lang, housePrompt: s.housePrompt, sources: c.sources })
      setNotes({ list: r.notes, model: r.model, for: stamp })
    } catch (e) { setError((e as Error).message) } finally { setBusy(false) }
  }

  return (
    <>
      <section className="or-card">
        <header><Icon name="checkDouble" size={14} /><h3>Checks</h3><span className={'or-chip ' + (bad ? 'bad' : warn ? 'warn' : 'good')}>{bad ? `${bad} to fix` : warn ? `${warn} to look at` : 'All clear'}</span></header>
        <ul className="or-checks">
          {sorted.map((x) => (
            <li key={x.id + x.title} className={x.level}>
              <Icon name={x.level === 'ok' ? 'check' : 'info'} size={13} />
              <span><b>{x.title}</b><small>{x.detail}</small></span>
            </li>
          ))}
        </ul>
      </section>
      <section className="or-card">
        <header><span className="or-card-mark">{ai ? <ProviderMark id={ai.provider} size={14} /> : <Icon name="sparkle" size={14} />}</span><h3>Second reader</h3></header>
        <p className="or-muted">{aiName} reads the letter as a cautious senior editor would before it goes to officials: unsupported claims, tone, the ask, the subject. Advice only — nothing is changed.</p>
        <button type="button" className="btn sm ai-btn or-wide" data-provider={ai?.provider} onClick={() => void run()} disabled={!ai || aiPaused() || busy || !c.body.trim()}
          data-tip={aiPaused() ? 'AI is OFF' : ai ? 'One request with the letter, its signature and your ticked talking points' : `Add a ${aiName} key for the Review job`}>
          {busy ? <Icon name="refresh" size={13} className="spin" /> : <Icon name="sparkle" size={13} />}<span>{busy ? 'Reading…' : notes ? 'Review again' : 'Review the letter'}</span>
        </button>
        {error && <p className="or-note">{error}</p>}
        {notes && (
          <>
            {notes.for !== stamp && <p className="or-note">The letter changed since this review.</p>}
            <ul className="or-checks">
              {notes.list.map((n, i) => (
                <li key={i} className={n.level}>
                  <Icon name={n.level === 'ok' ? 'check' : 'info'} size={13} />
                  <span><b>{n.text}</b>{n.quote && <q>{n.quote}</q>}</span>
                </li>
              ))}
              {!notes.list.length && <li className="ok"><Icon name="check" size={13} /><span><b>Nothing to flag.</b></span></li>}
            </ul>
            <p className="or-muted or-small">{notes.model}</p>
          </>
        )}
      </section>
    </>
  )
}

const ago = (t: number) => { const m = Math.round((Date.now() - t) / 60_000); return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : new Date(t).toLocaleDateString() }

/** What came back: read from the sender's own inbox (electron/inbox.cjs), read-only. */
function InboxCard() {
  const s = useOutreachStore()
  const c = s.campaign()!
  const ib = s.inbox
  const desktop = !!window.esb?.outreachInbox
  const replied = Object.keys(c.replied).length, bounced = Object.keys(c.bounced).length
  const optedOut = Object.keys(c.sent).filter((e) => s.optOut.includes(e)).length
  return (
    <section className="or-card">
      <header><Icon name="inbox" size={14} /><h3>Replies &amp; bounces</h3>
        <button type="button" className="btn sm" disabled={!desktop || !s.mail?.hasPassword || ib.state === 'busy'} onClick={() => void s.checkInbox(true)} data-tip={desktop ? `Read ${s.mail?.imapHost || 'the inbox'} for answers to this desk's letters — read-only, nothing is marked read` : 'Needs the desktop app'}>
          <Icon name="refresh" size={13} className={ib.state === 'busy' ? 'spin' : ''} /><span>{ib.state === 'busy' ? 'Reading…' : 'Check'}</span>
        </button>
      </header>
      <div className="or-stats">
        <span className="good"><b>{replied}</b>replied</span>
        <span><b>{optedOut}</b>opted out</span>
        <span className={bounced ? 'bad' : ''}><b>{bounced}</b>bounced</span>
      </div>
      <p className="or-muted or-small">{!desktop ? 'Replies are read in the desktop app.' : ib.state === 'ok' ? `Inbox read ${ago(ib.at)} · ${ib.scanned} recent message${ib.scanned === 1 ? '' : 's'} looked at${ib.note ? ` · ${ib.note}` : ''}` : ib.state === 'bad' ? ib.error : ib.state === 'busy' ? 'Reading the inbox…' : 'Not read yet — it is read on launch and every 15 minutes.'}</p>
    </section>
  )
}

function FollowUpCard() {
  const s = useOutreachStore()
  const ui = useOutreachUi()
  const c = s.campaign()!
  const q = followUpQueue(s.contacts, c)
  const done = Object.keys(c.followed).length
  const why = cannotStart('followup')
  return (
    <section className="or-card">
      <header><Icon name="refresh" size={14} /><h3>Follow-up</h3><span className="or-chip">after {c.followUp.afterDays} days</span></header>
      <p className="or-muted">{q.due.length ? <><b>{q.due.length}</b> without a reply {q.due.length === 1 ? 'is' : 'are'} due a second letter</> : 'Nobody is due yet'}{q.later ? ` · ${q.later} later` : ''}{done ? ` · ${done} followed up` : ''}.</p>
      <div className="or-actions">
        <button type="button" className="btn sm" onClick={() => ui.set({ sheet: 'follow-up' })}><Icon name="edit" size={13} /><span>Letter</span></button>
        <button type="button" className="btn sm primary" disabled={!!why || s.run !== 'idle'} data-tip={why ?? 'Check the inbox first, so nobody who just answered is written to again'}
          onClick={async () => { if (await ask({ title: `Send the follow-up to ${q.due.length}?`, body: `Each goes once, threaded under the first letter, at your usual pace. ${s.inbox.state === 'ok' ? `The inbox was read ${ago(s.inbox.at)}.` : 'The inbox has not been read in this session — replies that arrived since are not known.'}`, ok: 'Send follow-ups' })) void startBatch('followup') }}>
          <Icon name="send" size={13} /><span>Send {q.due.length || ''}</span>
        </button>
      </div>
    </section>
  )
}
