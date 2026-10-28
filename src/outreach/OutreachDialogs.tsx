// The desk's sheets: signatures, the house prompt every AI job follows, a name (rename / save as template) and
// Review & send — the last look before a batch starts, now or at a time.

import { useMemo, useState } from 'react'
import { useOutreachStore, uid } from './outreachStore'
import { ask, useOutreachUi } from './outreachUi'
import { cannotStart, eligible, followUpLetter, followUpQueue, inAudience, signatureOf, startBatch } from './campaign'
import { skipReason } from './compose'
import { letterChecks } from './checks'
import { OUTREACH_BLUEPRINTS, rewriteLetter } from './outreachAi'
import { aiFor, aiPaused } from '../editorial/aiProviders'
import { logoDataUrl, renderEmail, withViewerMargin } from './emailRender'
import { Dialog, Field, Select } from '../ui/controls'
import { Icon } from '../ui/Icon'
import { useEffect } from 'react'

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
  const html = useMemo(() => withViewerMargin(renderEmail({ body: 'Dear Sir/Madam,\n\n…', signature: text, letterhead: false, logoSrc: logo }).html, false), [text, logo])
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
          <Field label="Signature — the same marks as the letter: **bold**, [words](https://link)"><textarea className="input or-sig-text" rows={7} value={text} onChange={(e) => setText(e.target.value)} /></Field>
          <iframe className="or-frame or-sig-frame" title="Signature preview" sandbox="" srcDoc={html} />
        </div>
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
  const close = () => ui.set({ sheet: null })
  const set = s.mail?.settings
  const audience = s.contacts.filter((x) => inAudience(x, c.audience))
  const ready = eligible(s.contacts, c.subject, c.body, c.audience)
  const room = set ? Math.max(0, set.dailyLimit - (s.mail?.sent24h ?? 0)) : 0
  const today = Math.min(ready.length, room)
  const reasons = useMemo(() => {
    const m = new Map<string, number>()
    for (const x of audience) { const r = skipReason(x, c.subject, c.body); if (r) { const k = r.replace(/\s*\(.*?\)/, '').replace(/ — .*/, ''); m.set(k, (m.get(k) ?? 0) + 1) } }
    return [...m].sort((a, b) => b[1] - a[1])
  }, [audience, c.subject, c.body])
  const reference = OUTREACH_BLUEPRINTS.find((b) => b.id === c.blueprint)
  const checks = letterChecks({ subject: c.subject, body: c.body, signature: signatureOf(c), attachments: s.attachments, sources: c.sources, reference: reference ? `${reference.defaultBody}\n${reference.bengaliBody}` : '' }).filter((x) => x.level !== 'ok')
  const why = cannotStart()
  const atMs = new Date(at).getTime()
  const avg = set ? (set.minDelaySec + set.maxDelaySec) / 2 : 0
  const span = today > 1 ? Math.round(((today - 1) * avg) / 60) : 0

  const go = () => {
    if (when === 'later') {
      if (!(atMs > Date.now() + 30_000)) return
      s.patch({ status: 'scheduled', scheduledAt: atMs })
      s.addLog('info', `${c.name}: scheduled for ${new Date(atMs).toLocaleString()}`)
      close()
      return
    }
    close()
    void startBatch()
  }

  return (
    <Dialog title="Review & send" kicker={c.name.toUpperCase()} width={620} onClose={close} footer={<>
      <div className="spacer" />
      <button type="button" className="btn" onClick={close}>Cancel</button>
      <button type="button" className="btn primary" onClick={go} disabled={!!why && when === 'now' || (when === 'later' && (!(atMs > Date.now() + 30_000) || !ready.length || !set))}>
        <Icon name={when === 'now' ? 'send' : 'clock'} size={14} /><span>{when === 'now' ? `Send to ${today}` : 'Schedule'}</span>
      </button>
    </>}>
      <div className="or-rs">
        <dl className="or-facts">
          <dt>From</dt><dd>{set ? `${set.name} <${set.user}>` : 'No sender — set it up in Send → Settings'}</dd>
          <dt>Subject</dt><dd><b>{c.subject || '(none)'}</b></dd>
          <dt>Audience</dt><dd>{audience.length} contact{audience.length === 1 ? '' : 's'} · <b>{ready.length} ready</b>{reasons.length ? ` · ${audience.length - ready.length} not sent` : ''}</dd>
          {reasons.length > 0 && <><dt />
            <dd className="or-reasons">{reasons.slice(0, 6).map(([r, n]) => <span key={r}><b>{n}</b> {r.toLowerCase()}</span>)}</dd></>}
          <dt>Today</dt><dd>{set ? <>{today} of {ready.length} can go today ({room} left of {set.dailyLimit}){ready.length > today ? ' — the rest on later days' : ''}{today > 1 ? ` · ${set.minDelaySec}–${set.maxDelaySec} s apart, about ${span >= 60 ? `${Math.floor(span / 60)} h ${span % 60} min` : `${span} min`} from your gap settings` : ''}</> : '—'}</dd>
          <dt>With it</dt><dd>{[c.letterhead ? 'ESB letterhead' : 'No letterhead', c.signatureId === 'none' ? 'no signature' : `signature “${s.signatures.find((x) => x.id === c.signatureId)?.name ?? '—'}”`, s.attachments.length ? `${s.attachments.length} file${s.attachments.length === 1 ? '' : 's'}` : 'no files', 'an unsubscribe line'].join(' · ')}</dd>
        </dl>
        {checks.length > 0 && (
          <ul className="or-checks">
            {checks.map((x) => <li key={x.id + x.title} className={x.level}><Icon name="info" size={13} /><span><b>{x.title}</b><small>{x.detail}</small></span></li>)}
          </ul>
        )}
        <div className="or-when" role="radiogroup" aria-label="When">
          <label className={when === 'now' ? 'on' : ''}><input type="radio" checked={when === 'now'} onChange={() => setWhen('now')} /><span><b>Send now</b><small>The first email goes at once; the rest follow at your pace.</small></span></label>
          <label className={when === 'later' ? 'on' : ''}><input type="radio" checked={when === 'later'} onChange={() => setWhen('later')} /><span><b>Start at a time</b><small>Starts while ESB Studio is open on this computer — nothing sends while it is closed.</small></span>
            {when === 'later' && <input className="input or-at" type="datetime-local" value={at} min={toLocalInput(Date.now())} onChange={(e) => setAt(e.target.value)} />}
          </label>
        </div>
        {why && when === 'now' && <div className="callout warn"><Icon name="info" size={14} /><span>{why}</span></div>}
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
        <Icon name={busy ? 'refresh' : 'sparkle'} size={14} className={busy ? 'spin' : ''} /><span>{busy ? 'Writing…' : 'Write from the letter'}</span>
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
