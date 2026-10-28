// The desk's sheets: signatures, the house prompt every AI job follows, a name (rename / save as template) and
// Review & send — the last look before a batch starts, now or at a time.

import { useMemo, useState } from 'react'
import { useOutreachStore, uid } from './outreachStore'
import { useOutreachUi } from './outreachUi'
import { cannotStart, eligible, inAudience, signatureOf, startBatch } from './campaign'
import { skipReason } from './compose'
import { letterChecks } from './checks'
import { OUTREACH_BLUEPRINTS } from './outreachAi'
import { logoDataUrl, renderEmail, withViewerMargin } from './emailRender'
import { Dialog, Field } from '../ui/controls'
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
