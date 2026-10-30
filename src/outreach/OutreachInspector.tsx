// Right column, three tabs. Send: who sends, today's room, the batch (now or at a time), a test email and the
// results. Contact: what the sheet says about the selected address and the editor's decisions on it. Review: the
// fixed checks (checks.ts) and, on request, a second reading by the Review AI. Every figure is read from the main
// process's ledger, the campaign or the list; nothing here is a placeholder. In the browser preview (no desktop
// bridge) the column says sending needs the desktop app instead of pretending to send.

import { useEffect, useMemo, useRef, useState } from 'react'
import { useOutreachStore } from './outreachStore'
import { ask, useOutreachUi, type RightTab } from './outreachUi'
import { cannotStart, downloadText, eligible, followUpQueue, followUpReason, inAudience, pauseBatch, resultsCsv, resumeBatch, sendTest, signatureOf, startBatch, stopBatch } from './campaign'
import { skipReason } from './compose'
import { STATUS_LABEL, purposeLabel } from './directory'
import { letterChecks } from './checks'
import { fixLetterWithAi, OUTREACH_BLUEPRINTS, reviewLetter, type LetterProblem, type ReviewNote } from './outreachAi'
import { STATUS_TEXT } from './CampaignsTab'
import { aiFor, aiPaused, loadAiSettings, providerMeta, roleProvider } from '../editorial/aiProviders'
import { ProviderMark } from '../editorial/ProviderMark'
import { AutopilotCard } from './AutopilotCard'
import { Icon } from '../ui/Icon'
import { Dialog, Switch, Tabs } from '../ui/controls'
import { buildMessage } from './compose'
import { renderEmail, withViewerMargin } from './emailRender'
import { NeedsYou } from './NeedsYou'
import { domainOf, roleMailbox, disposableDomain } from './addressCheck'

const fmtWhen = (t: number) => new Date(t).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
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
      <SendFooter />
    </aside>
  )
}

function SendTab() {
  const s = useOutreachStore()
  const c = s.campaign()
  const desktop = !!window.esb?.outreachSend
  const [testTo, setTestTo] = useState('')
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ ok: boolean; msg: string } | null>(null)
  const testResultTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [, tick] = useState(0)

  // the countdown re-renders once a second while a wait is running
  useEffect(() => {
    if (!s.nextAt) return
    const t = setInterval(() => tick((n) => n + 1), 1000)
    return () => clearInterval(t)
  }, [s.nextAt])
  useEffect(() => { if (!testTo && s.mail?.settings?.user) setTestTo(s.mail.settings.user) }, [s.mail?.settings?.user]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => { if (testResultTimer.current) clearTimeout(testResultTimer.current) }, [])

  const set = s.mail?.settings
  const ready = s.mail?.hasPassword && !!set
  const limit = set?.dailyLimit ?? 0
  const used = s.mail?.sent24h ?? 0
  const queue = c ? eligible(s.contacts, c.subject, c.body, c.audience) : []
  const willSend = Math.min(queue.length, Math.max(0, limit - used))
  const active = s.contacts.find((x) => x.id === s.activeContact)
  const sent = c ? Object.keys(c.sent).length : 0
  const failed = c ? Object.keys(c.failed).length : 0

  return (
    <>
      <section className="or-card">
        <header><Icon name="mail" size={14} /><h3>Sender</h3></header>
        {!desktop ? (
          <p className="or-muted">Sending needs the ESB Studio desktop app. Here you can prepare the list and the letter.</p>
        ) : set ? (
          <div className="or-sender">
            <b>{set.name}</b><span>{set.user}</span>
            <span className={'or-chip ' + (ready ? (s.smtp.state === 'bad' ? 'bad' : 'good') : 'warn')}>{!ready ? 'No app password' : s.smtp.state === 'bad' ? 'Login failed' : s.smtp.state === 'ok' ? 'Signed in' : 'Saved'}</span>
          </div>
        ) : (
          <p className="or-muted">No sender yet. Use the account button at the top right to add the Gmail or Workspace account that sends, with a Google app password.</p>
        )}
        {desktop && set && (
          <>
            <div className="or-meter-row"><span>Last 24 hours</span><span className="or-figure">{used} <small>of {limit}</small></span></div>
            <div className="or-meter" role="meter" aria-valuemin={0} aria-valuemax={limit} aria-valuenow={used}><i style={{ width: `${limit ? Math.min(100, (used / limit) * 100) : 0}%` }} /></div>
            <p className="or-muted">{Math.max(0, limit - used)} more can go today · {gap(set.minDelaySec, set.maxDelaySec)} apart</p>
          </>
        )}
      </section>

      <AutopilotCard />

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
        <p className="or-muted">{!c ? 'Open or create a campaign.' : queue.length ? `${queue.length} ready${desktop && set ? ` · ${willSend} can go today` : ''}` : s.contacts.length ? 'Nobody in this audience is ready — see Skipped in Contacts' : c.kind === 'direct' ? 'Type addresses in the To line' : 'Import a list to start'}</p>
        {c?.status === 'scheduled' && c.scheduledAt && s.run === 'idle' && <p className="or-sched"><Icon name="clock" size={13} /><span>Starts {new Date(c.scheduledAt).toLocaleString([], { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })} — keep the app open</span><button type="button" className="btn xs" onClick={() => s.patch({ status: 'draft', scheduledAt: null })}>Cancel</button></p>}
        {c && (sent > 0 || failed > 0) && (
          <div className="or-results">
            <span><b>{sent}</b> sent</span>
            {Object.keys(c.replied).length > 0 && <span className="good"><b>{Object.keys(c.replied).length}</b> replied</span>}
            {Object.keys(c.bounced).length > 0 && <span className="bad"><b>{Object.keys(c.bounced).length}</b> bounced</span>}
            {failed > 0 && <span className="bad"><b>{failed}</b> failed</span>}
            <button type="button" className="ibtn or-results-dl" aria-label="Download the results (CSV)" onClick={() => downloadText(`${c.name.replace(/[^\w-]+/g, '-')}-results.csv`, resultsCsv(c, s.contacts))} data-tip="Download the results (CSV) — every contact in the audience: sent, failed, skipped and why"><Icon name="download" size={14} /></button>
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
          <button
            type="button"
            className={'btn' + (testing ? ' sending' : '')}
            disabled={!desktop || !ready || testing || !c || !/^\S+@\S+\.\S+$/.test(testTo)}
            onClick={async () => {
              if (testResultTimer.current) clearTimeout(testResultTimer.current)
              setTestResult(null)
              setTesting(true)
              const r = await sendTest(testTo.trim(), active)
              setTesting(false)
              setTestResult({ ok: r.ok, msg: r.ok ? 'Sent' : r.error })
              testResultTimer.current = setTimeout(() => setTestResult(null), 5000)
            }}
          >
            <Icon name={testing ? 'refresh' : testResult?.ok ? 'check' : 'send'} size={13} className={testing ? 'spin' : ''} /><span>{testing ? 'Sending' : 'Send test'}</span>
          </button>
          {testResult && <span className={'or-chip ' + (testResult.ok ? 'good' : 'bad')} role="status">{testResult.ok ? <Icon name="check" size={12} /> : <Icon name="info" size={12} />}<span>{testResult.msg}</span></span>}
        </div>
      </section>
    </>
  )
}

function ContactTab() {
  const s = useOutreachStore()
  const [previewModal, setPreviewModal] = useState(false)
  const c = s.campaign()
  const active = s.contacts.find((x) => x.id === s.activeContact)
  const personalPreview = useMemo(() => {
    if (!c || !active || !previewModal) return null
    const m = buildMessage(active, c.subject, c.body, c.lang)
    return {
      subject: m.subject,
      html: withViewerMargin(renderEmail({
        body: m.body,
        signature: signatureOf(c),
        optOut: m.optOut,
        lang: c.lang,
        letterhead: c.letterhead,
        footerLine: s.footerLine,
        fontFamily: s.fontFamily,
        headerBg: s.headerBg,
        footerBg: s.footerBg,
        stripeColors: s.stripeColors,
        officialPad: c.officialPad,
      }).html, c.letterhead, c.officialPad)
    }
  }, [c, active, previewModal, s.footerLine, s.fontFamily, s.headerBg, s.footerBg, s.stripeColors, s.signatures])
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
        {(() => {
          const dom = domainOf(active.email)
          const ver = s.verifiedAddrs[dom]
          const isRole = roleMailbox(active.email)
          const isDisp = disposableDomain(dom)
          if (!ver && !isRole && !isDisp) return null
          return (
            <>
              <dt>Address check</dt>
              <dd>
                {ver ? (ver.mx ? 'MX server verified' : ver.a ? 'A record server' : 'No mail server found') : ''}
                {isRole ? (ver ? ' · Shared mailbox' : 'Shared mailbox') : ''}
                {isDisp ? ' · Disposable domain' : ''}
              </dd>
            </>
          )
        })()}
        {active.diagnostic && <><dt>Sheet note</dt><dd>{active.diagnostic}</dd></>}
        {active.sheet && <><dt>From sheet</dt><dd>{active.sheet.replace(/_/g, ' ')}</dd></>}
        <dt>This campaign</dt><dd>{outside ? 'Outside the audience' : active.status === 'REPLIED' ? `Replied ${active.repliedAt ? fmtWhen(active.repliedAt) : ''}` : active.status === 'BOUNCED' ? `Bounced: ${active.error}` : active.status === 'SENT' ? `Sent ${active.sentAt ? fmtWhen(active.sentAt) : ''}` : active.status === 'FAILED' ? `Failed: ${active.error}` : reason ?? 'Will be sent'}</dd>
        {c && c.sent[active.email] && <><dt>Follow-up</dt><dd>{c.followed[active.email] ? `Sent ${fmtWhen(c.followed[active.email])}` : followUpReason(active, c) ?? 'Due now'}</dd></>}
        {c?.replyLabels?.[active.email] && (
          <>
            <dt>Reply analysis</dt>
            <dd>
              <span className={`or-chip cs-${c.replyLabels[active.email].label}`} style={{ marginRight: 6 }}>
                {c.replyLabels[active.email].label.replace('_', ' ')}
              </span>
              <span style={{ fontSize: 12 }}>{c.replyLabels[active.email].summary}</span>
            </dd>
          </>
        )}
      </dl>
      {active.mxStatus !== 'SAFE_TO_SEND' && active.mxStatus !== 'EXCLUDED' && active.mxStatus !== 'UNDELIVERABLE' && c?.kind !== 'direct' && (
        <Switch checked={active.approved} onChange={(v) => s.approve(active.email, v)} label="I checked this address — include it" />
      )}
      <Switch checked={active.status === 'OPTED_OUT'} onChange={(v) => s.optOutAddress(active.email, v)} label="Asked not to be emailed" />
      {c && (
        <div className="or-opener-edit" style={{ marginTop: 10, padding: 8, background: 'var(--chip-bg, rgba(0,0,0,0.03))', borderRadius: 6, border: '1px solid var(--border)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
            <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-2)' }}>Personal opening line ({'{opener|}'})</span>
            {c.openers?.[active.email]?.text && (
              <button
                type="button"
                className="or-link-btn"
                style={{ fontSize: 11 }}
                onClick={() => {
                  const updated = { ...(c.openers || {}) }
                  delete updated[active.email]
                  s.patch({ openers: updated })
                }}
              >
                Clear
              </button>
            )}
          </div>
          <textarea
            className="input textarea sm"
            rows={2}
            style={{ width: '100%', fontSize: 12, resize: 'vertical' }}
            placeholder="No personal opener set. Will render empty without leaving a blank paragraph."
            value={c.openers?.[active.email]?.text || ''}
            onChange={(e) => {
              const val = e.target.value
              const updated = { ...(c.openers || {}) }
              if (!val.trim()) delete updated[active.email]
              else updated[active.email] = { text: val.trim(), at: Date.now() }
              s.patch({ openers: updated })
            }}
          />
        </div>
      )}
      <button type="button" className="btn sm or-wide" onClick={() => setPreviewModal(true)}><Icon name="eye" size={13} /><span>Preview their email</span></button>
      {previewModal && (
        <Dialog
          title={`Email preview · ${active.personName || active.email}`}
          kicker="RECIPIENT PREVIEW"
          width={760}
          onClose={() => setPreviewModal(false)}
          footer={
            <button type="button" className="btn primary" onClick={() => setPreviewModal(false)}>
              Done
            </button>
          }
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <dl style={{ display: 'grid', gridTemplateColumns: '60px 1fr', gap: '6px 12px', margin: 0, padding: '10px 14px', background: 'var(--fill)', borderRadius: 'var(--r-2)', fontSize: 13 }}>
              <dt style={{ color: 'var(--text-3)', fontWeight: 600 }}>From</dt>
              <dd style={{ margin: 0 }}>{s.mail?.settings ? `${s.mail.settings.name} <${s.mail.settings.user}>` : 'desk@esbpowerline.com'}</dd>
              <dt style={{ color: 'var(--text-3)', fontWeight: 600 }}>To</dt>
              <dd style={{ margin: 0, fontWeight: 600 }}>{active.personName ? `${active.personName} <${active.email}>` : active.email}</dd>
              <dt style={{ color: 'var(--text-3)', fontWeight: 600 }}>Subject</dt>
              <dd style={{ margin: 0, fontWeight: 600 }}>{personalPreview?.subject || c?.subject || '(No subject)'}</dd>
            </dl>
            <iframe
              className="or-frame"
              style={{ width: '100%', height: 440, border: '1px solid var(--card-line)', borderRadius: 'var(--r-2)', background: '#fff' }}
              title="Recipient email preview"
              sandbox=""
              srcDoc={personalPreview?.html || ''}
            />
          </div>
        </Dialog>
      )}
    </section>
  )
}

function ReviewTab() {
  const ui = useOutreachUi()
  const s = useOutreachStore()
  const c = s.campaign()
  const [notes, setNotes] = useState<{ list: ReviewNote[]; model: string; for: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [fixing, setFixing] = useState(false)
  const [fixError, setFixError] = useState<string | null>(null)
  const [undo, setUndo] = useState<{ subject: string; body: string; model: string } | null>(null)
  const ai = aiFor('review')
  const aiName = providerMeta(ai?.provider ?? roleProvider(loadAiSettings(), 'review')).name
  const fixAi = aiFor('outreach')
  const fixAiName = providerMeta(fixAi?.provider ?? roleProvider(loadAiSettings(), 'outreach')).name
  const signature = signatureOf(c)
  const reference = useMemo(() => { const b = OUTREACH_BLUEPRINTS.find((x) => x.id === c?.blueprint); return b ? `${b.defaultBody}\n${b.bengaliBody}` : '' }, [c?.blueprint])
  const allowedFields = useMemo(() => {
    const keys = new Set<string>()
    for (const contact of s.contacts) {
      if (contact.fields) for (const k of Object.keys(contact.fields)) keys.add(k)
    }
    return [...keys]
  }, [s.contacts])
  const checks = useMemo(() => (c ? letterChecks({ subject: c.subject, body: c.body, signature, attachments: s.attachments, sources: c.sources, reference, allowedFields }) : []), [c, signature, s.attachments, reference, allowedFields])
  if (!c) return <div className="or-empty"><p>Open a campaign to review its letter.</p></div>
  const stamp = `${c.subject}\n${c.body}\n${signature}`
  const order = { bad: 0, warn: 1, ok: 2 }
  const sorted = [...checks].sort((a, b) => order[a.level] - order[b.level])
  const bad = checks.filter((x) => x.level === 'bad').length, warn = checks.filter((x) => x.level === 'warn').length
  // what "Fix all" sends: the free checks that failed, plus the AI reader's own notes if it has read this exact
  // letter — a stale review (the letter changed since) is dropped rather than fixing problems that may be gone
  const checkProblems: LetterProblem[] = checks.filter((x) => x.level !== 'ok').map((x) => ({ text: `${x.title}: ${x.detail}` }))
  const noteProblems: LetterProblem[] = notes && notes.for === stamp ? notes.list.filter((n) => n.level !== 'ok').map((n) => ({ text: n.text, quote: n.quote || undefined })) : []
  const problems = [...checkProblems, ...noteProblems]

  const run = async () => {
    setBusy(true); setError(null)
    try {
      const r = await reviewLetter({ subject: c.subject, body: c.body, signature }, { blueprint: c.blueprint, lang: c.lang, housePrompt: s.housePrompt, sources: c.sources })
      setNotes({ list: r.notes, model: r.model, for: stamp })
    } catch (e) { setError((e as Error).message) } finally { setBusy(false) }
  }

  const fixAll = async () => {
    setFixing(true); setFixError(null)
    try {
      const r = await fixLetterWithAi({ subject: c.subject, body: c.body }, problems, { blueprint: c.blueprint, lang: c.lang, housePrompt: s.housePrompt, sources: c.sources })
      setUndo({ subject: c.subject, body: c.body, model: r.model })
      s.patch({ subject: r.subject, body: r.body })
      s.addLog('ok', `Fixed ${problems.length} issue${problems.length === 1 ? '' : 's'} with ${r.model}`)
      setNotes(null) // the letter changed; the old review no longer describes it
    } catch (e) { setFixError((e as Error).message); s.addLog('error', `Fix all: ${(e as Error).message}`) } finally { setFixing(false) }
  }

  return (
    <>
      {c && (
        <NeedsYou
          campaign={c}
          contacts={s.contacts}
          onPatchCampaign={s.patch}
          onSelectContact={(email: string) => {
            s.setActiveContact(email)
            ui.set({ view: 'preview' })
          }}
        />
      )}
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
        <div className="or-actions">
          <button type="button" className="btn sm ai-btn" data-provider={fixAi?.provider} disabled={!fixAi || aiPaused() || fixing || !problems.length}
            onClick={() => void fixAll()}
            data-tip={aiPaused() ? 'AI is OFF' : !problems.length ? 'Nothing to fix' : fixAi ? `Rewrites only what's failing (${problems.length} issue${problems.length === 1 ? '' : 's'}) — same facts, nothing else changes` : `Add a ${fixAiName} key for the Letter job`}>
            {fixing ? <Icon name="refresh" size={13} className="spin" /> : <Icon name="sparkle" size={13} />}<span>{fixing ? 'Fixing' : `Fix all with AI${problems.length ? ` (${problems.length})` : ''}`}</span>
          </button>
          {undo && <button type="button" className="btn sm" onClick={() => { s.patch({ subject: undo.subject, body: undo.body }); setUndo(null); s.addLog('info', 'Undid the AI fix') }}><Icon name="undo" size={13} /><span>Undo</span></button>}
        </div>
        {fixError && <p className="or-note">{fixError}</p>}
      </section>
      <section className="or-card">
        <header><span className="or-card-mark">{ai ? <ProviderMark id={ai.provider} size={14} /> : <Icon name="sparkle" size={14} />}</span><h3>Second reader</h3></header>
        <p className="or-muted">{aiName} reads the letter as a cautious senior editor would before it goes to officials: unsupported claims, tone, the ask, the subject. Its notes feed "Fix all with AI" above; nothing changes until you press that.</p>
        <button type="button" className="btn sm ai-btn or-wide" data-provider={ai?.provider} onClick={() => void run()} disabled={!ai || aiPaused() || busy || !c.body.trim()}
          data-tip={aiPaused() ? 'AI is OFF' : ai ? 'One request with the letter, its signature and your ticked talking points' : `Add a ${aiName} key for the Review job`}>
          {busy ? <Icon name="refresh" size={13} className="spin" /> : <Icon name="sparkle" size={13} />}<span>{busy ? 'Reading' : notes ? 'Review again' : 'Review the letter'}</span>
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
          <Icon name="refresh" size={13} className={ib.state === 'busy' ? 'spin' : ''} /><span>{ib.state === 'busy' ? 'Reading' : 'Check'}</span>
        </button>
      </header>
      <div className="or-stats">
        <span className="good"><b>{replied}</b>replied</span>
        <span><b>{optedOut}</b>opted out</span>
        <span className={bounced ? 'bad' : ''}><b>{bounced}</b>bounced</span>
      </div>
      <p className="or-muted or-small">{!desktop ? 'Replies are read in the desktop app.' : ib.state === 'ok' ? `Read ${ago(ib.at)} · ${ib.scanned} message${ib.scanned === 1 ? '' : 's'} checked${ib.note ? ` · ${ib.note}` : ''}` : ib.state === 'bad' ? ib.error : ib.state === 'busy' ? 'Reading the inbox' : 'Not read yet — it is read on launch and every 15 minutes.'}</p>
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

/** Pinned to the foot of the right column on every tab, like Editorial's Review & publish: what is ready, and the
 *  one button that sends — or, while a batch runs, its progress with Pause and Stop. */
function SendFooter() {
  const s = useOutreachStore()
  const ui = useOutreachUi()
  const c = s.campaign()
  const [, tick] = useState(0)
  useEffect(() => {
    if (!s.nextAt) return
    const t = setInterval(() => tick((n) => n + 1), 1000)
    return () => clearInterval(t)
  }, [s.nextAt])
  const set = s.mail?.settings
  const queue = c ? eligible(s.contacts, c.subject, c.body, c.audience) : []
  const willSend = Math.min(queue.length, Math.max(0, (set?.dailyLimit ?? 0) - (s.mail?.sent24h ?? 0)))
  const why = cannotStart()
  if (s.run !== 'idle') {
    return (
      <footer className="or-right-foot">
        <div className="or-progress"><span><b>{s.runSent}</b> of {s.runTotal} sent</span>{s.current ? <span>Sending to {s.current}</span> : s.nextAt ? <span>Next in <b>{mmss(s.nextAt - Date.now())}</b></span> : null}</div>
        <div className="or-meter"><i style={{ width: `${s.runTotal ? (s.runSent / s.runTotal) * 100 : 0}%` }} /></div>
        <div className="or-actions">
          {s.run === 'running'
            ? <button type="button" className="btn" onClick={pauseBatch}><Icon name="pause" size={14} /><span>Pause</span></button>
            : <button type="button" className="btn primary" onClick={resumeBatch}><Icon name="play" size={14} /><span>Resume</span></button>}
          <button type="button" className="btn" onClick={async () => {
            if (await ask({
              title: 'Stop sending?',
              body: 'Nobody else is emailed from this campaign. Everyone already emailed stays recorded. You can start a new run for the rest.',
              ok: 'Stop sending',
              danger: true,
            })) {
              void stopBatch()
            }
          }}><Icon name="x" size={14} /><span>Stop</span></button>
        </div>
      </footer>
    )
  }
  return (
    <footer className="or-right-foot">
      <p className="or-foot-note">{!c ? 'Open or create a campaign' : why ? why : <><b>{willSend}</b> ready to go today{queue.length > willSend ? ` · ${queue.length - willSend} on later days` : ''}</>}</p>
      <button type="button" className="btn primary or-wide or-send-btn" onClick={() => ui.set({ sheet: 'review-send' })} disabled={!c} data-tip="Check everything once more, then send now or at a time">
        <Icon name="send" size={15} /><span>{willSend ? `Review & send to ${willSend}` : 'Review & send'}</span>
      </button>
    </footer>
  )
}
