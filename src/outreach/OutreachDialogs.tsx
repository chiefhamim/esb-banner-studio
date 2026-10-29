// The desk's sheets: signatures, the house prompt every AI job follows, a name (rename / save as template) and
// Review & send — the last look before a batch starts, now or at a time.

import { useEffect, useMemo, useRef, useState } from 'react'
import { DEFAULT_FONT_FAMILY, DEFAULT_FOOTER_LINE, useOutreachStore, uid } from './outreachStore'
import { ask, useOutreachUi } from './outreachUi'
import { cannotStart, eligible, followUpLetter, followUpQueue, inAudience, signatureOf, startBatch } from './campaign'
import { engineClient } from './engineClient'
import { fmtShortDay } from './activityFormat'
import { buildMessage, mentionsAttachment } from './compose'
import { applyMark, skipReason, softBreakOnEnter } from './compose'
import { letterChecks } from './checks'
import { reviewRendered, actionableFlags } from './rendered'
import { OUTREACH_BLUEPRINTS, reviewLetter, rewriteLetter } from './outreachAi'
import { aiFor, aiPaused } from '../editorial/aiProviders'
import { DEFAULT_STRIPES, EMAIL_FONTS, logoDataUrl, renderEmail, withViewerMargin } from './emailRender'
import { Dialog, Field, Select, Switch } from '../ui/controls'
import { Icon, type IconName } from '../ui/Icon'

export function SignaturesDialog() {
  const s = useOutreachStore()
  const ui = useOutreachUi()
  const c = s.campaign()
  const [id, setId] = useState(c?.signatureId && c.signatureId !== 'none' ? c.signatureId : s.signatures[0]?.id)
  const cur = s.signatures.find((x) => x.id === id) ?? s.signatures[0]
  const [name, setName] = useState(cur?.name ?? '')
  const [text, setText] = useState(cur?.text ?? '')
  const [logo, setLogo] = useState('')
  useEffect(() => { void logoDataUrl().then(setLogo) }, [])
  const open = (sid: string) => { const x = s.signatures.find((y) => y.id === sid); if (!x) return; setId(sid); setName(x.name); setText(x.text) }
  const dirty = !!cur && (name !== cur.name || text !== cur.text)
  const html = useMemo(() => withViewerMargin(renderEmail({ body: 'Dear Sir/Madam,\n\n…', signature: text, letterhead: false, logoSrc: logo, fontFamily: s.fontFamily }).html, false), [text, logo, s.fontFamily])
  const close = () => ui.set({ sheet: null })

  return (
    <Dialog title="Signatures" kicker="OUTREACH" width={760} onClose={close} footer={<>
      <button type="button" className="btn" onClick={() => { const n = { id: uid('sig'), name: 'New signature', text: 'With best regards,\n\n' }; s.saveSignature(n); open(n.id); setName(n.name); setText(n.text) }}><Icon name="plus" size={14} /><span>New</span></button>
      <button type="button" className="btn" disabled={s.signatures.length < 2 || !cur} onClick={() => { if (!cur) return; s.deleteSignature(cur.id); const next = s.signatures.find((x) => x.id !== cur.id); if (next) open(next.id) }}><Icon name="trash" size={14} /><span>Delete</span></button>
      <div className="spacer" />
      {c && cur && <button type="button" className="btn" onClick={() => { s.saveSignature({ ...cur, name, text }); s.patch({ signatureId: cur.id }); close() }}>Use in this campaign</button>}
      <button type="button" className="btn primary" disabled={!dirty || !name.trim()} onClick={() => cur && s.saveSignature({ ...cur, name: name.trim(), text })}>Save</button>
    </>}>
      <div className="or-sig">
        <div className="or-sig-list" role="listbox" aria-label="Signatures">
          {s.signatures.map((x) => (
            <button key={x.id} type="button" role="option" aria-selected={x.id === cur?.id} className={'or-row' + (x.id === cur?.id ? ' on' : '')} onClick={() => open(x.id)}>
              <span className="or-row-main"><b>{x.name}</b><span>{x.text.split('\n').filter(Boolean).slice(-2).join(' · ')}</span></span>
            </button>
          ))}
        </div>
        <div className="stack" style={{ gap: 10 }}>
          <Field label="Name (only you see it)"><input className="input" value={name} onChange={(e) => setName(e.target.value)} /></Field>
          <Field label="Signature — the same marks as the letter: **bold**, [words](https://link). Enter = new paragraph, Shift+Enter = line break">
            <textarea className="input or-sig-text" rows={7} value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => softBreakOnEnter(e, text, setText)} />
          </Field>
          <iframe className="or-frame or-sig-frame" title="Signature preview" sandbox="" srcDoc={html} />
        </div>
      </div>
    </Dialog>
  )
}

const FOOTER_TOOLS: { kind: string; icon: IconName; tip: string }[] = [
  { kind: 'bold', icon: 'bold', tip: 'Bold' },
  { kind: 'italic', icon: 'italic', tip: 'Italic' },
  { kind: 'center', icon: 'alignTextCenter', tip: 'Centre this line' },
  { kind: 'link', icon: 'link', tip: 'Link — https or mailto only' },
]

export function FooterDialog() {
  const s = useOutreachStore()
  const ui = useOutreachUi()
  const [text, setText] = useState(s.footerLine)
  const [useBg, setUseBg] = useState(!!s.footerBg)
  const [hex, setHex] = useState(s.footerBg || '#fff7e6')
  const [logo, setLogo] = useState('')
  const ref = useRef<HTMLTextAreaElement>(null)
  useEffect(() => { void logoDataUrl().then(setLogo) }, [])
  const close = () => ui.set({ sheet: null })
  const html = useMemo(() => renderEmail({
    body: 'Dear Sir/Madam,\n\n…', letterhead: true, logoSrc: logo, footerLine: text, fontFamily: s.fontFamily,
    headerBg: s.headerBg, footerBg: useBg ? hex : '', stripeColors: s.stripeColors,
  }).html, [text, logo, s.headerBg, useBg, hex, s.stripeColors, s.fontFamily])
  const mark = async (kind: string) => {
    const el = ref.current
    if (!el) return
    const a0 = el.selectionStart, b0 = el.selectionEnd
    let url = ''
    if (kind === 'link') {
      const v = await ask({ title: 'Add a link', input: { label: 'Link — https:// or mailto: only', value: 'https://', pattern: /^(https:\/\/\S+\.\S+|mailto:\S+@\S+)$/i }, ok: 'Add link' })
      if (typeof v !== 'string') return
      url = v.trim()
    }
    const [t, a, b] = applyMark(text, a0, b0, kind, url)
    setText(t)
    requestAnimationFrame(() => { el.focus(); el.setSelectionRange(a, b) })
  }
  const save = () => {
    s.setFooterLine(text)
    s.setFooterBg(useBg ? hex : '')
    s.addLog('info', text.trim() ? 'Footer text saved' : 'Footer text cleared')
    close()
  }
  return (
    <Dialog title="Footer text" kicker="OUTREACH" width={760} onClose={close} footer={<>
      <button type="button" className="btn" onClick={() => { setText(DEFAULT_FOOTER_LINE); setUseBg(false) }} disabled={text === DEFAULT_FOOTER_LINE && !useBg}>Reset to default</button>
      <div className="spacer" />
      <button type="button" className="btn" onClick={close}>Cancel</button>
      <button type="button" className="btn primary" onClick={save}>Save</button>
    </>}>
      <div className="stack" style={{ gap: 10 }}>
        <p className="hint">The line under the plain ESB letterhead (Letter → "ESB letterhead", not the official pad, which has its own fuller footer). Your own words — nothing here is fixed. Leave it empty for no footer line at all, just the brand stripes.</p>
        <div className="or-fmt" role="toolbar" aria-label="Footer formatting">
          {FOOTER_TOOLS.map((t) => <button key={t.kind} type="button" className="ibtn" aria-label={t.tip} data-tip={t.tip} onMouseDown={(e) => e.preventDefault()} onClick={() => void mark(t.kind)}><Icon name={t.icon} size={14} /></button>)}
        </div>
        <textarea ref={ref} className="input" rows={3} value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => softBreakOnEnter(e, text, setText)} placeholder={DEFAULT_FOOTER_LINE} />
        <Field label="Footer background">
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <Switch checked={useBg} onChange={setUseBg} label={useBg ? hex.toUpperCase() : 'White (default)'} />
            {useBg && <input type="color" className="input" style={{ width: 44, height: 32, padding: 2 }} value={hex} onChange={(e) => setHex(e.target.value)} aria-label="Footer background colour" />}
          </div>
        </Field>
        <iframe className="or-frame or-sig-frame" title="Footer preview" sandbox="" srcDoc={html} />
      </div>
    </Dialog>
  )
}

const STRIPE_NAMES = ['First bar', 'Second bar', 'Third bar']

export function HeaderDialog() {
  const s = useOutreachStore()
  const ui = useOutreachUi()
  const [useBg, setUseBg] = useState(!!s.headerBg)
  const [hex, setHex] = useState(s.headerBg || '#ffe9c7')
  const [fontId, setFontId] = useState(s.fontFamily || DEFAULT_FONT_FAMILY)
  const [stripes, setStripes] = useState<string[]>(() => {
    const given = s.stripeColors ? s.stripeColors.split(',') : []
    return DEFAULT_STRIPES.map((def, i) => given[i] || def)
  })
  const stripesCsv = stripes.join(',')
  const stripesChanged = stripesCsv !== DEFAULT_STRIPES.join(',')
  const [logo, setLogo] = useState('')
  useEffect(() => { void logoDataUrl().then(setLogo) }, [])
  const close = () => ui.set({ sheet: null })
  const html = useMemo(() => renderEmail({
    body: 'Dear Sir/Madam,\n\nWe are pleased to introduce ESB PowerLine…', letterhead: true, logoSrc: logo,
    footerLine: s.footerLine, headerBg: useBg ? hex : '', footerBg: s.footerBg, fontFamily: fontId, stripeColors: stripesCsv,
  }).html, [logo, s.footerLine, s.footerBg, useBg, hex, fontId, stripesCsv])
  const save = () => {
    s.setHeaderBg(useBg ? hex : '')
    s.setFontFamily(fontId)
    s.setStripeColors(stripesChanged ? stripesCsv : '')
    s.addLog('info', `Header, stripes and font saved · ${EMAIL_FONTS.find((f) => f.id === fontId)?.label ?? fontId}`)
    close()
  }
  return (
    <Dialog title="Header & fonts" kicker="OUTREACH" width={760} onClose={close} footer={<>
      <button type="button" className="btn" onClick={() => { setUseBg(false); setFontId(DEFAULT_FONT_FAMILY); setStripes(DEFAULT_STRIPES) }} disabled={!useBg && fontId === DEFAULT_FONT_FAMILY && !stripesChanged}>Reset to default</button>
      <div className="spacer" />
      <button type="button" className="btn" onClick={close}>Cancel</button>
      <button type="button" className="btn primary" onClick={save}>Save</button>
    </>}>
      <div className="stack" style={{ gap: 14 }}>
        <p className="hint">Only the plain ESB letterhead (Letter → "ESB letterhead") — the official pad keeps its own gold rail, which this does not touch. The font applies to the whole letter, not only the header.</p>
        <Field label="Header background">
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <Switch checked={useBg} onChange={setUseBg} label={useBg ? hex.toUpperCase() : 'White (default)'} />
            {useBg && <input type="color" className="input" style={{ width: 44, height: 32, padding: 2 }} value={hex} onChange={(e) => setHex(e.target.value)} aria-label="Header background colour" />}
          </div>
        </Field>
        <Field label="Brand stripes — the three bars above the header and below the footer">
          <div style={{ display: 'flex', gap: 14 }}>
            {stripes.map((c, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <input type="color" className="input" style={{ width: 36, height: 28, padding: 2 }} value={c}
                  onChange={(e) => setStripes((s0) => s0.map((x, j) => (j === i ? e.target.value : x)))} aria-label={STRIPE_NAMES[i]} />
                <span className="hint">{STRIPE_NAMES[i]}</span>
              </div>
            ))}
          </div>
        </Field>
        <Field label="Font — the handful that render as themselves in Outlook, Gmail and Apple Mail, not whatever is installed on this PC (which the recipient's inbox never sees)">
          <Select<string> value={fontId} onChange={setFontId} options={EMAIL_FONTS.map((f) => ({ value: f.id, label: f.label }))} />
        </Field>
        <iframe className="or-frame or-sig-frame" title="Header preview" sandbox="" srcDoc={html} />
      </div>
    </Dialog>
  )
}

export function HousePromptDialog() {
  const s = useOutreachStore()
  const ui = useOutreachUi()
  const [text, setText] = useState(s.housePrompt)
  const close = () => ui.set({ sheet: null })
  return (
    <Dialog title="House prompt" kicker="OUTREACH · AI" width={620} onClose={close} footer={<>
      <button type="button" className="btn" onClick={() => setText('')} disabled={!text}>Clear</button>
      <div className="spacer" />
      <button type="button" className="btn" onClick={close}>Cancel</button>
      <button type="button" className="btn primary" onClick={() => { s.setHousePrompt(text.trim()); s.addLog('info', text.trim() ? 'House prompt saved' : 'House prompt cleared'); close() }}>Save</button>
    </>}>
      <div className="stack" style={{ gap: 10 }}>
        <p className="hint">How ESB PowerLine writes to people. Every AI job on this desk reads it — writing and rewriting the letter, finding talking points, reviewing — so set it once: tone, words to avoid, what to always offer, how to sign. It cannot override the facts rule: the AI still writes only what the sources and the letter's offer say.</p>
        <textarea className="input or-prompt" rows={10} value={text} onChange={(e) => setText(e.target.value)} placeholder={'Address senior officials as “Honourable” only when their designation is Minister or State Minister.\nAlways offer the digital edition as well as print.\nNo more than three paragraphs before the ask.'} />
        <p className="hint">{text.trim().length} characters · saved on this computer</p>
      </div>
    </Dialog>
  )
}

export function NameDialog({ mode }: { mode: 'rename' | 'save-template' }) {
  const s = useOutreachStore()
  const ui = useOutreachUi()
  const c = s.campaign()
  const [name, setName] = useState(mode === 'rename' ? c?.name ?? '' : c?.subject.slice(0, 48) ?? '')
  const close = () => ui.set({ sheet: null })
  const ok = () => {
    if (!name.trim()) return
    if (mode === 'rename') s.patch({ name: name.trim() })
    else { s.saveTemplate(name.trim()); s.addLog('ok', `Saved “${name.trim()}” as a template`) }
    close()
  }
  return (
    <Dialog title={mode === 'rename' ? 'Rename campaign' : 'Save as template'} kicker="OUTREACH" width={460} onClose={close} footer={<>
      <div className="spacer" />
      <button type="button" className="btn" onClick={close}>Cancel</button>
      <button type="button" className="btn primary" onClick={ok} disabled={!name.trim()}>{mode === 'rename' ? 'Rename' : 'Save'}</button>
    </>}>
      <Field label={mode === 'rename' ? 'Name' : 'Template name — the subject and body are saved, with their placeholders'}>
        <input className="input" autoFocus value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') ok() }} />
      </Field>
    </Dialog>
  )
}

const toLocalInput = (t: number) => { const d = new Date(t - new Date(t).getTimezoneOffset() * 60_000); return d.toISOString().slice(0, 16) }

export function ReviewSendDialog() {
  const s = useOutreachStore()
  const ui = useOutreachUi()
  const c = s.campaign()!
  const [when, setWhen] = useState<'now' | 'later'>('now')
  const [at, setAt] = useState(() => toLocalInput(Date.now() + 3600_000))
  const [planSummary, setPlanSummary] = useState('')
  const close = () => ui.set({ sheet: null })
  const set = s.mail?.settings
  const audience = useMemo(() => s.contacts.filter((x) => inAudience(x, c.audience)), [s.contacts, c.audience])
  const ready = eligible(s.contacts, c.subject, c.body, c.audience)
  const room = set ? Math.max(0, set.dailyLimit - (s.mail?.sent24h ?? 0)) : 0
  const skippedCount = audience.length - ready.length

  const reasons = useMemo(() => {
    const m = new Map<string, number>()
    for (const x of audience) { const r = skipReason(x, c.subject, c.body); if (r) { const k = r.replace(/\s*\(.*?\)/, '').replace(/ — .*/, ''); m.set(k, (m.get(k) ?? 0) + 1) } }
    return [...m].sort((a, b) => b[1] - a[1])
  }, [audience, c.subject, c.body])

  const reference = OUTREACH_BLUEPRINTS.find((b) => b.id === c.blueprint)
  const allowedFields = useMemo(() => {
    const keys = new Set<string>()
    for (const contact of s.contacts) {
      if (contact.fields) for (const k of Object.keys(contact.fields)) keys.add(k)
    }
    return [...keys]
  }, [s.contacts])
  const checks = letterChecks({ subject: c.subject, body: c.body, signature: signatureOf(c), attachments: s.attachments, sources: c.sources, reference: reference ? `${reference.defaultBody}\n${reference.bengaliBody}` : '', allowedFields }).filter((x) => x.level !== 'ok')
  const why = cannotStart()
  const atMs = new Date(at).getTime()

  // AI Second Reading (§5.5)
  const aiReviewer = !aiPaused() && !!aiFor('review')
  const [secondReading, setSecondReading] = useState<{
    status: 'idle' | 'running' | 'done' | 'error'
    badNotes: string[]
    warnNotes: string[]
  }>({ status: 'idle', badNotes: [], warnNotes: [] })

  useEffect(() => {
    if (!aiReviewer || !c) return
    let active = true
    setSecondReading({ status: 'running', badNotes: [], warnNotes: [] })

    const approvedVariants = Object.entries(c.variants || {})
      .filter(([_, v]) => v.status === 'approved')
      .slice(0, 5)

    const versionsToRead = [
      { name: 'Main letter', subject: c.subject, body: c.body },
      ...approvedVariants.map(([key, v]) => ({ name: 'Segment ' + key, subject: v.subject, body: v.body })),
    ]

    const runReadings = async () => {
      const allBad: string[] = []
      const allWarn: string[] = []
      try {
        for (const ver of versionsToRead) {
          const res = await reviewLetter(
            { subject: ver.subject, body: ver.body, signature: signatureOf(c) },
            { blueprint: c.blueprint, lang: c.lang, housePrompt: s.housePrompt, sources: c.sources }
          )
          if (!active) return
          for (const note of res.notes) {
            if (note.level === 'bad') allBad.push(ver.name + ': ' + note.text)
            else if (note.level === 'warn') allWarn.push(ver.name + ': ' + note.text)
          }
        }
        if (active) {
          setSecondReading({
            status: 'done',
            badNotes: allBad,
            warnNotes: allWarn,
          })
        }
      } catch (err) {
        if (active) {
          setSecondReading({
            status: 'error',
            badNotes: [],
            warnNotes: ['Second reading unavailable'],
          })
        }
      }
    }

    void runReadings()
    return () => {
      active = false
    }
  }, [aiReviewer, c?.id, c?.subject, c?.body])

  // Pre-flight deterministic checks (§5.5)
  const senderSigned = !!set && !!s.mail?.hasPassword && s.smtp.state !== 'bad'
  const hasRoom = room > 0
  const attachMentioned = mentionsAttachment(c.body)
  const attachOk = !attachMentioned || s.attachments.length > 0
  const testSent = s.log.some((l) => l.text.includes('Test sent to'))
  const checksBad = checks.some((x) => x.level === 'bad')

  const needsYouCount = useMemo(() => {
    let count = 0
    const reviewedMap = c.reviewed || {}
    for (const x of ready) {
      const msg = buildMessage(x, c.subject, c.body, c.lang)
      const flags = actionableFlags(reviewRendered(x, msg))
      const approved = new Set(reviewedMap[x.email] || [])
      if (flags.some((f) => !approved.has(f.kind))) count++
    }
    return count
  }, [ready, c.subject, c.body, c.lang, c.reviewed])
  const willBeSentCount = Math.max(0, ready.length - needsYouCount)

  // Calculate pacing plan
  useEffect(() => {
    if (!ready.length) return
    void engineClient.plan({ count: ready.length }).then((p) => {
      if (p && p.days) {
        setPlanSummary(`About ${p.days} sending ${p.days === 1 ? 'day' : 'days'}${p.firstAt && p.lastAt ? `, from ${fmtShortDay(p.firstAt)} to ${fmtShortDay(p.lastAt)}` : ''}, up to ${set?.dailyLimit ?? 100} a day.`)
      }
    })
  }, [ready.length, set?.dailyLimit])

  // Spot check contacts (3 stable samples)
  const spots = useMemo(() => {
    if (!ready.length) return []
    const indices = [0, Math.floor(ready.length / 2), ready.length - 1]
    const uniq = Array.from(new Set(indices)).map((i) => ready[i]).filter(Boolean)
    return uniq.map((ct) => ({
      contact: ct,
      msg: buildMessage(ct, c.subject, c.body, c.lang),
    }))
  }, [ready, c])

  const badReason = !senderSigned
    ? 'Save the sender account and app password first'
    : checksBad
    ? 'Letter has serious issues that must be fixed'
    : secondReading.badNotes.length > 0
    ? 'Second reading: ' + secondReading.badNotes[0]
    : !attachOk
    ? 'Attachment is mentioned in letter but no file is attached'
    : why

  const go = () => {
    if (when === 'later') {
      if (!(atMs > Date.now() + 30_000)) return
      s.patch({ status: 'scheduled', scheduledAt: atMs })
      s.addLog('info', `${c.name}: scheduled for ${new Date(atMs).toLocaleString()}`)
      close()
      return
    }
    close()
    void startBatch('first')
  }

  return (
    <Dialog title="Review & send" kicker={c.name.toUpperCase()} width={660} onClose={close} footer={<>
      <div className="spacer" />
      <button type="button" className="btn" onClick={close}>Cancel</button>
      <button
        type="button"
        className="btn primary"
        onClick={go}
        disabled={!!badReason && when === 'now' || (when === 'later' && (!(atMs > Date.now() + 30_000) || !ready.length || !set))}
      >
        <Icon name={when === 'now' ? 'send' : 'clock'} size={14} />
        <span>{when === 'now' ? 'Start sending' : 'Start at a time…'}</span>
      </button>
    </>}>
      <div className="or-rs stack" style={{ gap: 14 }}>
        {/* 1. Plan row (§5.5) */}
        <section className="or-rs-plan">
          <div className="or-rs-plan-stats">
            <button type="button" onClick={() => { close(); ui.set({ left: 'contacts', view: 'edit' }); s.setView('ready') }}>
              <b>{willBeSentCount.toLocaleString()}</b> will be sent
            </button>
            <span>·</span>
            {needsYouCount > 0 && (
              <>
                <button type="button" onClick={() => { close(); ui.set({ right: 'review' }) }}>
                  <b>{needsYouCount.toLocaleString()}</b> need you
                </button>
                <span>·</span>
              </>
            )}
            <button type="button" onClick={() => { close(); ui.set({ left: 'contacts', view: 'edit' }); s.setView('skipped') }}>
              <b>{skippedCount.toLocaleString()}</b> skipped
            </button>
          </div>
          {planSummary && <p className="or-rs-plan-sub">{planSummary}</p>}
        </section>

        {/* 2. Checks list (§5.5) */}
        <section className="or-rs-checks">
          <div className={`or-rs-check-row ${senderSigned ? 'good' : 'bad'}`}>
            <Icon name={senderSigned ? 'check' : 'x'} size={14} />
            <span><b>Sender:</b> {senderSigned ? `Signed in as ${set?.user}` : 'Not signed in'}</span>
          </div>
          <div className={`or-rs-check-row ${hasRoom ? 'good' : 'warn'}`}>
            <Icon name={hasRoom ? 'check' : 'info'} size={14} />
            <span><b>Today’s room:</b> {hasRoom ? `${room} emails can go today` : 'Daily quota reached for today'}</span>
          </div>
          <div className="or-rs-check-row good">
            <Icon name="check" size={14} />
            <span><b>Pacing window:</b> Send window active</span>
          </div>
          <div className={`or-rs-check-row ${checksBad ? 'bad' : checks.length > 0 ? 'warn' : 'good'}`}>
            <Icon name={checksBad ? 'x' : checks.length > 0 ? 'info' : 'check'} size={14} />
            <span><b>Letter checks:</b> {checks.length === 0 ? 'Passed all checks' : `${checks.length} warning${checks.length === 1 ? '' : 's'} in Review tab`}</span>
          </div>
          {aiReviewer && (
            <div
              className={`or-rs-check-row ${
                secondReading.status === 'running'
                  ? 'warn'
                  : secondReading.badNotes.length > 0
                  ? 'bad'
                  : secondReading.status === 'error' || secondReading.warnNotes.length > 0
                  ? 'warn'
                  : 'good'
              }`}
            >
              <Icon
                name={
                  secondReading.status === 'running'
                    ? 'clock'
                    : secondReading.badNotes.length > 0
                    ? 'x'
                    : secondReading.status === 'error' || secondReading.warnNotes.length > 0
                    ? 'info'
                    : 'check'
                }
                size={14}
              />
              <span>
                <b>Second reading:</b>{' '}
                {secondReading.status === 'running'
                  ? 'Reading… (senior editor AI)'
                  : secondReading.badNotes.length > 0
                  ? `${secondReading.badNotes.length} critical issue${secondReading.badNotes.length === 1 ? '' : 's'}`
                  : secondReading.status === 'error'
                  ? 'Second reading unavailable'
                  : secondReading.warnNotes.length > 0
                  ? `${secondReading.warnNotes.length} warning${secondReading.warnNotes.length === 1 ? '' : 's'}`
                  : 'Passed senior editor reading'}
              </span>
            </div>
          )}
          <div className={`or-rs-check-row ${attachOk ? 'good' : 'bad'}`}>
            <Icon name={attachOk ? 'check' : 'x'} size={14} />
            <span><b>Attachments:</b> {attachOk ? (s.attachments.length ? `${s.attachments.length} attached` : 'None needed') : 'Mentioned in body but not attached'}</span>
          </div>
          <div className={`or-rs-check-row ${testSent ? 'good' : 'warn'}`}>
            <Icon name={testSent ? 'check' : 'info'} size={14} />
            <span><b>Test email:</b> {testSent ? 'Sent to yourself' : 'Not sent to yourself yet'}</span>
          </div>
        </section>

        {/* 3. Spot check (§5.5) */}
        {spots.length > 0 && (
          <section className="or-rs-spot">
            <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-2)' }}>Spot check (samples):</span>
            <div className="or-rs-spot-grid">
              {spots.map(({ contact: ct, msg }) => (
                <div key={ct.id} className="or-rs-spot-card">
                  <span className="or-rs-spot-to">{ct.personName || ct.email}</span>
                  <span className="or-rs-spot-sub">{msg.subject}</span>
                  <span className="or-rs-spot-body">{msg.body.slice(0, 100)}…</span>
                  <button
                    type="button"
                    className="or-link-btn"
                    style={{ marginTop: 4, textAlign: 'left' }}
                    onClick={() => {
                      s.setActiveContact(ct.id)
                      ui.set({ view: 'preview', sheet: null })
                    }}
                  >
                    Open full preview →
                  </button>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* 4. Audience details */}
        <dl className="or-facts">
          <dt>From</dt><dd>{set ? `${set.name} <${set.user}>` : 'No sender — set it up in Send → Settings'}</dd>
          <dt>Subject</dt><dd><b>{c.subject || '(none)'}</b></dd>
          <dt>Audience</dt><dd>{audience.length} contact{audience.length === 1 ? '' : 's'} · <b>{ready.length} ready</b>{reasons.length ? ` · ${audience.length - ready.length} not sent` : ''}</dd>
          {reasons.length > 0 && <><dt />
            <dd className="or-reasons">{reasons.slice(0, 6).map(([r, n]) => <span key={r}><b>{n}</b> {r.toLowerCase()}</span>)}</dd></>}
          <dt>With it</dt><dd>{[c.letterhead ? 'ESB letterhead' : 'No letterhead', c.signatureId === 'none' ? 'no signature' : `signature “${s.signatures.find((x) => x.id === c.signatureId)?.name ?? '—'}”`, s.attachments.length ? `${s.attachments.length} file${s.attachments.length === 1 ? '' : 's'}` : 'no files', 'an unsubscribe line'].join(' · ')}</dd>
        </dl>

        {/* 5. Schedule timing picker */}
        <div className="or-when" role="radiogroup" aria-label="When">
          <label className={when === 'now' ? 'on' : ''}><input type="radio" checked={when === 'now'} onChange={() => setWhen('now')} /><span><b>Send now</b><small>The first email goes at once; the rest follow at your pace.</small></span></label>
          <label className={when === 'later' ? 'on' : ''}><input type="radio" checked={when === 'later'} onChange={() => setWhen('later')} /><span><b>Start at a time…</b><small>Starts while ESB Studio is open on this computer.</small></span>
            {when === 'later' && <input className="input or-at" type="datetime-local" value={at} min={toLocalInput(Date.now())} onChange={(e) => setAt(e.target.value)} />}
          </label>
        </div>

        {badReason && when === 'now' && (
          <div className="callout warn" role="alert">
            <Icon name="info" size={14} />
            <span>{badReason}</span>
          </div>
        )}
      </div>
    </Dialog>
  )
}

/** The desk's confirm / prompt (outreachUi `ask`). */
export function AskDialog() {
  const a = useOutreachUi((u) => u.asking)
  const [v, setV] = useState(a?.input?.value ?? '')
  useEffect(() => { setV(a?.input?.value ?? '') }, [a])
  if (!a) return null
  const valid = !a.input || (v.trim() !== '' && (!a.input.pattern || a.input.pattern.test(v.trim())))
  const ok = () => { if (valid) a.resolve(a.input ? v : true) }
  return (
    <Dialog title={a.title} kicker="OUTREACH" width={a.input?.multiline ? 560 : 480} onClose={() => a.resolve(null)} footer={<>
      <div className="spacer" />
      <button type="button" className="btn" onClick={() => a.resolve(null)}>Cancel</button>
      <button type="button" className={'btn primary' + (a.danger ? ' danger' : '')} onClick={ok} disabled={!valid}>{a.ok}</button>
    </>}>
      <div className="stack" style={{ gap: 10 }}>
        {a.body && <p className="hint or-ask-body">{a.body}</p>}
        {a.input && (
          <Field label={a.input.label}>
            {a.input.multiline
              ? <textarea className="input or-prompt" rows={4} autoFocus value={v} placeholder={a.input.placeholder} onChange={(e) => setV(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) ok() }} />
              : <input className="input" autoFocus value={v} placeholder={a.input.placeholder} onChange={(e) => setV(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') ok() }} />}
          </Field>
        )}
      </div>
    </Dialog>
  )
}

/** The second letter: when it goes, what it says. Defaults are a short, honest nudge with "Re:" on the subject. */
export function FollowUpDialog() {
  const s = useOutreachStore()
  const ui = useOutreachUi()
  const c = s.campaign()!
  const def = followUpLetter({ ...c, followUp: { ...c.followUp, subject: '', body: '' } })
  const [subject, setSubject] = useState(c.followUp.subject || def.subject)
  const [body, setBody] = useState(c.followUp.body || def.body)
  const [days, setDays] = useState(c.followUp.afterDays)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const ai = aiFor('outreach')
  const close = () => ui.set({ sheet: null })
  const q = followUpQueue(s.contacts, { ...c, followUp: { afterDays: days, subject, body } })
  const write = async () => {
    setBusy(true); setNote(null)
    try {
      const r = await rewriteLetter('custom', { subject: c.subject, body: c.body }, { blueprint: c.blueprint, lang: c.lang, housePrompt: s.housePrompt, sources: c.sources },
        'Write a short, courteous FOLLOW-UP to this letter for someone who has not answered (60–110 words). Remind them in one sentence what was offered, make the one ask again, and say plainly that no answer is needed if it is not of interest. Subject: "Re: " plus the original subject.')
      setSubject(r.subject); setBody(r.body)
      setNote(`Written by ${r.model}.${r.unsourced.length ? ` Check these figures — no source has them: ${r.unsourced.join(', ')}.` : ' Read it before sending.'}`)
    } catch (e) { setNote((e as Error).message) } finally { setBusy(false) }
  }
  return (
    <Dialog title="Follow-up letter" kicker={c.name.toUpperCase()} width={640} onClose={close} footer={<>
      <button type="button" className="btn" onClick={() => { setSubject(def.subject); setBody(def.body) }}>Use the default</button>
      <button type="button" className="btn ai-btn" data-provider={ai?.provider} onClick={() => void write()} disabled={!ai || aiPaused() || busy || !c.body.trim()}>
        <Icon name={busy ? 'refresh' : 'sparkle'} size={14} className={busy ? 'spin' : ''} /><span>{busy ? 'Writing' : 'Write from the letter'}</span>
      </button>
      <div className="spacer" />
      <button type="button" className="btn" onClick={close}>Cancel</button>
      <button type="button" className="btn primary" disabled={!subject.trim() || !body.trim()} onClick={() => { s.patch({ followUp: { afterDays: days, subject: subject.trim() === def.subject ? '' : subject.trim(), body: body.trim() === def.body ? '' : body } }); close() }}>Save</button>
    </>}>
      <div className="stack" style={{ gap: 10 }}>
        <p className="hint">Goes only to people this campaign wrote to who have not replied, bounced or opted out — once each, threaded under the first letter in their mail client. Replies are read from your inbox; a follow-up never goes to someone whose answer is still arriving, so check the inbox before sending.</p>
        <div className="or-fu-row">
          <Field label="Send after"><Select<number> value={days} onChange={setDays} options={[2, 3, 5, 7, 10, 14].map((d) => ({ value: d, label: `${d} days without a reply` }))} /></Field>
          <div className="or-fu-count"><b>{q.due.length}</b> due now{q.later ? <> · <b>{q.later}</b> later</> : ''}</div>
        </div>
        <Field label="Subject"><input className="input" value={subject} onChange={(e) => setSubject(e.target.value)} /></Field>
        <Field label="Letter — the same placeholders and marks as the first one; your signature is added"><textarea className={'input or-prompt' + (c.lang === 'bn' ? ' bn' : '')} rows={8} value={body} onChange={(e) => setBody(e.target.value)} /></Field>
        {note && <p className="or-note">{note}</p>}
      </div>
    </Dialog>
  )
}

export function TemplatesDialog() {
  const s = useOutreachStore()
  const ui = useOutreachUi()
  const c = s.campaign()
  const close = () => ui.set({ sheet: null })
  return (
    <Dialog title="Templates" kicker="OUTREACH" width={620} onClose={close} footer={<>
      <button type="button" className="btn" disabled={!c?.body.trim()} onClick={() => ui.set({ sheet: 'save-template' })}><Icon name="plus" size={14} /><span>Save this letter</span></button>
      <div className="spacer" />
      <button type="button" className="btn primary" onClick={close}>Done</button>
    </>}>
      {!s.templates.length ? (
        <div className="or-empty"><Icon name="folder" size={22} /><b>No templates yet</b><p>A template keeps a subject and a letter, placeholders included, to start another campaign from.</p></div>
      ) : (
        <div className="or-tpl-list">
          {s.templates.map((t) => (
            <div key={t.id} className="or-row or-tpl">
              <span className="or-row-main"><b>{t.name}</b><span>{t.lang === 'bn' ? 'বাংলা' : 'English'} · saved {new Date(t.savedAt).toLocaleDateString()}</span><span className="or-row-mail">{t.subject}</span></span>
              <button type="button" className="btn sm" disabled={!c} onClick={async () => { if (await ask({ title: `Use “${t.name}”?`, body: 'The subject and body of this campaign are replaced.', ok: 'Use template' })) { s.applyTemplate(t.id); close() } }}>Use</button>
              <button type="button" className="ibtn" aria-label={`Delete ${t.name}`} data-tip="Delete" onClick={async () => { if (await ask({ title: `Delete “${t.name}”?`, ok: 'Delete', danger: true })) s.deleteTemplate(t.id) }}><Icon name="trash" size={14} /></button>
            </div>
          ))}
        </div>
      )}
    </Dialog>
  )
}
