// Centre: the letter, laid out like a mail client's compose window — From, To, Subject, a formatting bar, the body,
// the signature and the letterhead — with Preview showing the exact email the selected contact will receive (the same
// renderer the main process sends with). One template for the whole audience: {name}, {designation}, {organization}
// and {sector} are filled from each contact's row.

import { useEffect, useMemo, useRef, useState } from 'react'
import { useOutreachStore } from './outreachStore'
import { ask, useOutreachUi } from './outreachUi'
import { OUTREACH_BLUEPRINTS, REWRITES, rewriteLetter, suggestBlueprint, writeOutreachWithAi, type LetterContext, type RewriteAction } from './outreachAi'
import { PLACEHOLDERS, buildMessage, mentionsAttachment, missingFields, softBreakOnEnter } from './compose'
import { eligible, inAudience, signatureOf, STAND_IN } from './campaign'
import { logoDataUrl, padQrDataUrl, padSidebarDataUrl, renderEmail, withViewerMargin } from './emailRender'
import { AttachmentTray } from './AttachmentTray'
import { purposeLabel } from './directory'
import { aiFor, aiPaused, loadAiSettings, providerMeta, roleProvider } from '../editorial/aiProviders'
import { ProviderMark } from '../editorial/ProviderMark'
import { Icon, type IconName } from '../ui/Icon'
import { MenuButton, Select, Seg, Switch } from '../ui/controls'
import type { OutreachLang } from './types'

const SUBJECT_MAX = 70
const EMAIL = /^[^\s@<>(),;:"]+@[^\s@<>(),;:"]+\.[a-z]{2,}$/i

/** Wrap the selection in a mark, or prefix each selected line; returns the new text and selection. */
function applyMark(text: string, a: number, b: number, kind: string, url = ''): [string, number, number] {
  const sel = text.slice(a, b)
  const wrap = (l: string, r: string, empty: string) => { const inner = sel || empty; return [text.slice(0, a) + l + inner + r + text.slice(b), a + l.length, a + l.length + inner.length] as [string, number, number] }
  if (kind === 'bold') return wrap('**', '**', 'bold words')
  if (kind === 'italic') return wrap('*', '*', 'words')
  if (kind === 'link') return wrap('[', `](${url})`, 'link words')
  if (kind === 'rule') { const ins = `${a && text[a - 1] !== '\n' ? '\n\n' : ''}---\n\n`; return [text.slice(0, a) + ins + text.slice(b), a + ins.length, a + ins.length] }
  // line marks: from the start of the first selected line to the end of the last
  const s0 = text.lastIndexOf('\n', a - 1) + 1
  const e0 = (() => { const i = text.indexOf('\n', b); return i < 0 ? text.length : i })()
  const lines = text.slice(s0, e0).split('\n')
  const pre = (i: number) => (kind === 'heading' ? '## ' : kind === 'bullet' ? '- ' : kind === 'number' ? `${i + 1}. ` : kind === 'center' ? '-> ' : '> ')
  const strip = (l: string) => l.replace(/^(#{2,3}\s+|[-•]\s+|\d+[.)]\s+|->\s+|>\s?)/, '')
  const all = lines.every((l) => l.startsWith(pre(0).trim()) || (kind === 'number' && /^\d+[.)]\s/.test(l)))
  const out = lines.map((l, i) => (all ? strip(l) : pre(i) + strip(l))).join('\n')
  return [text.slice(0, s0) + out + text.slice(e0), s0, s0 + out.length]
}

const TOOLS: { kind: string; icon: IconName; tip: string }[] = [
  { kind: 'bold', icon: 'bold', tip: 'Bold (Ctrl+B)' },
  { kind: 'italic', icon: 'italic', tip: 'Italic (Ctrl+I)' },
  { kind: 'heading', icon: 'heading', tip: 'Heading — a short line in bold' },
  { kind: 'bullet', icon: 'listBullet', tip: 'Bulleted list' },
  { kind: 'number', icon: 'listOrdered', tip: 'Numbered list' },
  { kind: 'quote', icon: 'quote', tip: 'Quotation' },
  { kind: 'center', icon: 'alignTextCenter', tip: 'Centre this paragraph' },
  { kind: 'link', icon: 'link', tip: 'Link (Ctrl+K) — https or mailto only' },
  { kind: 'rule', icon: 'rule', tip: 'Divider' },
]

export function OutreachComposer() {
  const s = useOutreachStore()
  const ui = useOutreachUi()
  const c = s.campaign()
  const [busy, setBusy] = useState<string | null>(null)
  const [variants, setVariants] = useState<string[]>([])
  const [aiNote, setAiNote] = useState<{ model: string; unsourced: string[]; undo: { subject: string; body: string; lang: OutreachLang } } | null>(null)
  const [toText, setToText] = useState('')
  const [logo, setLogo] = useState('')
  const [padSidebar, setPadSidebar] = useState('')
  const [padQr, setPadQr] = useState('')
  const bodyRef = useRef<HTMLTextAreaElement>(null)
  const ai = aiFor('outreach')
  const aiName = providerMeta(ai?.provider ?? roleProvider(loadAiSettings(), 'outreach')).name
  const active = s.contacts.find((x) => x.id === s.activeContact) ?? s.contacts[0]

  useEffect(() => { void logoDataUrl().then(setLogo) }, [])
  useEffect(() => { void padSidebarDataUrl().then(setPadSidebar); void padQrDataUrl().then(setPadQr) }, [])
  useEffect(() => { setToText(c?.kind === 'direct' ? c.recipients.join(', ') : ''); setVariants([]); setAiNote(null) }, [c?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const audience = useMemo(() => s.contacts.filter((x) => inAudience(x, c?.audience)), [s.contacts, c?.audience])
  const suggestion = useMemo(() => (c?.kind === 'list' ? suggestBlueprint(audience, c.audience.purposes) : null), [audience, c?.kind, c?.audience.purposes])
  const missingCount = useMemo(() => (c ? audience.filter((x) => x.status === 'QUEUED' && missingFields(x, c.subject, c.body).length).length : 0), [audience, c?.subject, c?.body]) // eslint-disable-line react-hooks/exhaustive-deps

  const preview = useMemo(() => {
    if (!c || ui.view !== 'preview') return null
    const who = active ?? STAND_IN
    const m = buildMessage(who, c.subject, c.body, c.lang)
    return {
      who, subject: m.subject,
      html: withViewerMargin(renderEmail({
        body: m.body, signature: signatureOf(c), optOut: m.optOut, lang: c.lang, letterhead: c.letterhead, logoSrc: logo,
        officialPad: c.officialPad, sidebarSrc: padSidebar, qrSrc: padQr, footerLine: s.footerLine,
        headerBg: s.headerBg, fontFamily: s.fontFamily,
      }).html, c.letterhead, c.officialPad),
    }
  }, [c, active, ui.view, logo, padSidebar, padQr, s.footerLine, s.headerBg, s.fontFamily, s.signatures]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!c) {
    return (
      <main className="or-center" aria-label="Letter">
        <div className="or-sheet or-start">
          <div className="or-empty">
            <Icon name="send" size={26} />
            <b>Start a campaign</b>
            <p>Import a mailing list to write one letter to an audience, or write an ordinary email to addresses you type.</p>
            <div className="or-actions">
              <button type="button" className="btn primary" onClick={() => void s.createCampaign()}><Icon name="plus" size={14} /><span>New campaign</span></button>
              <button type="button" className="btn" onClick={() => void s.createCampaign({ kind: 'direct', name: 'New email', blueprint: 'blank', subject: '', body: '' })}><Icon name="mail" size={14} /><span>New email</span></button>
            </div>
          </div>
        </div>
      </main>
    )
  }

  const promisesFile = mentionsAttachment(c.body) && !s.attachments.length
  const ctx: LetterContext = { blueprint: c.blueprint, lang: c.lang, housePrompt: s.housePrompt, sources: c.sources, example: active }
  const edited = (() => { const b = OUTREACH_BLUEPRINTS.find((x) => x.id === c.blueprint); return !!c.body.trim() && (!b || (c.body !== b.defaultBody && c.body !== b.bengaliBody)) })()

  const setBody = (body: string) => s.patch({ body })
  const mark = async (kind: string) => {
    const el = bodyRef.current
    if (!el) return
    const a0 = el.selectionStart, b0 = el.selectionEnd
    let url = ''
    if (kind === 'link') {
      const v = await ask({ title: 'Add a link', input: { label: 'Link — https:// or mailto: only', value: 'https://', pattern: /^(https:\/\/\S+\.\S+|mailto:\S+@\S+)$/i }, ok: 'Add link' })
      if (typeof v !== 'string') return
      url = v.trim()
    }
    const [t, a, b] = applyMark(c.body, a0, b0, kind, url)
    setBody(t)
    requestAnimationFrame(() => { el.focus(); el.setSelectionRange(a, b) })
  }
  const insert = (tag: string) => {
    const el = bodyRef.current
    if (!el) return setBody(c.body + tag)
    const a = el.selectionStart, b = el.selectionEnd
    setBody(c.body.slice(0, a) + tag + c.body.slice(b))
    requestAnimationFrame(() => { el.focus(); el.setSelectionRange(a + tag.length, a + tag.length) })
  }
  const pickLetter = async (v: string) => {
    if (edited && !(await ask({ title: 'Replace the letter?', body: 'The subject and body you have written are replaced. Undo is not available for this.', ok: 'Replace' }))) return
    if (v === 'blank') s.patch({ blueprint: 'blank', subject: '', body: '' })
    else if (v.startsWith('tpl-')) s.applyTemplate(v)
    else s.selectBlueprint(v as never)
  }
  const run = async (what: string, job: () => Promise<{ subject: string; body: string; variants: string[]; model: string; unsourced: string[]; lang?: OutreachLang }>) => {
    setBusy(what)
    const undo = { subject: c.subject, body: c.body, lang: c.lang }
    try {
      const r = await job()
      // written into the campaign it was asked for, even if the editor has opened another one meanwhile
      useOutreachStore.getState().patchById(c.id, { subject: r.subject || c.subject, body: r.body, ...(r.lang ? { lang: r.lang } : {}) })
      if (useOutreachStore.getState().activeId !== c.id) { s.addLog('ok', `${what} by ${r.model} — saved into ${c.name}`); return }
      setVariants(r.variants)
      setAiNote({ model: r.model, unsourced: r.unsourced, undo })
      ui.set({ view: 'edit' })
      s.addLog('ok', `${what} by ${r.model} — read it before sending`)
    } catch (e) {
      s.addLog('error', `${what}: ${(e as Error).message}`)
    } finally { setBusy(null) }
  }
  const commitTo = (t = toText) => {
    const parts = t.split(/[\s,;]+/).filter(Boolean)
    s.setRecipients(parts.filter((p) => EMAIL.test(p)))
  }
  const badTo = toText.split(/[\s,;]+/).filter((p) => p && !EMAIL.test(p))
  const mail = s.mail?.settings
  const ready = eligible(s.contacts, c.subject, c.body, c.audience).length
  const aiOff = !ai || aiPaused()
  const aiTip = aiPaused() ? 'AI is OFF — turn it on in the Engine panel (status bar)' : ai ? '' : `Add a ${aiName} key for the Letter job in the AI dialog`

  return (
    <main className="or-center" aria-label="Letter">
      <div className="or-toolbar">
        <Select<string> value={c.blueprint === 'template' ? (s.templates.find((t) => t.subject === c.subject && t.body === c.body)?.id ?? 'template') : c.blueprint} className="or-letter-select" onChange={(v) => void pickLetter(v)}
          options={[
            ...OUTREACH_BLUEPRINTS.map((b) => ({ value: b.id as string, label: b.label, hint: b.tag, icon: 'mail' as const })),
            ...s.templates.map((t) => ({ value: t.id, label: t.name, hint: 'Saved' })),
            ...(c.blueprint === 'template' && !s.templates.some((t) => t.subject === c.subject && t.body === c.body) ? [{ value: 'template', label: 'From a template (edited)', hint: '' }] : []),
            { value: 'blank', label: 'Blank letter', hint: '' },
          ]} />
        <Seg<OutreachLang> value={c.lang} onChange={s.setLang} options={[{ value: 'en', label: 'EN', tip: 'English' }, { value: 'bn', label: 'বাংলা', tip: 'Bangla' }]} />
        <div className="spacer" />
        <button type="button" className="btn ai-btn" data-provider={ai?.provider} disabled={aiOff || !!busy} onClick={() => void run('Draft', () => writeOutreachWithAi(ctx))}
          data-tip={aiTip || `${aiName} writes the template from the letter's offer${c.sources.some((x) => x.points.some((p) => p.use)) ? ' and your ticked talking points' : ''}, with placeholders. Replaces the subject and body (undoable)`}>
          {busy === 'Draft' ? <Icon name="refresh" size={13} className="spin" /> : ai ? <ProviderMark id={ai.provider} size={13} /> : <Icon name="sparkle" size={13} />}<span>{busy === 'Draft' ? 'Writing' : 'Write'}</span>
        </button>
        <MenuButton label={busy && busy !== 'Draft' ? 'Rewriting' : 'Rewrite'} icon="edit" className="" align="end" title={aiTip || 'Rewrite the letter with AI'}
          items={[...REWRITES.map((r) => ({ label: r.label, hint: r.hint, disabled: aiOff || !!busy || !c.body.trim(), onClick: () => void run(r.label, () => rewriteLetter(r.id, c, ctx)) })),
            { divider: true },
            { label: 'Your own instruction', icon: 'sparkle' as const, disabled: aiOff || !!busy || !c.body.trim(), onClick: async () => { const t = await ask({ title: 'Rewrite with your instruction', body: 'The same facts rule applies: nothing is added that the letter or your ticked talking points do not say.', input: { label: 'How should the letter change?', placeholder: 'e.g. Lead with the free digital edition; keep it under 120 words', multiline: true }, ok: 'Rewrite' }); if (typeof t === 'string' && t.trim()) void run('Rewrite', () => rewriteLetter('custom' as RewriteAction, c, ctx, t)) } }]} />
        <Seg<'edit' | 'preview'> value={ui.view} onChange={(v) => ui.set({ view: v })} options={[{ value: 'edit', label: 'Edit' }, { value: 'preview', label: 'Preview', tip: active ? `As ${active.personName || active.email} will receive it` : 'As a recipient will receive it' }]} />
      </div>

      {ui.view === 'edit' ? (
        <div className="or-sheet or-compose">
          <div className="or-line">
            <span className="or-line-k">From</span>
            {mail ? <span className="or-line-v"><b>{mail.name}</b> &lt;{mail.user}&gt;</span> : <button type="button" className="or-link" onClick={() => ui.set({ sheet: 'sender' })}>Set up the sending account</button>}
          </div>
          <div className="or-line">
            <span className="or-line-k">To</span>
            {c.kind === 'direct' ? (
              <input className="or-line-input" value={toText} placeholder="name@example.com, other@example.org" aria-label="Recipients"
                onChange={(e) => setToText(e.target.value)} onBlur={() => commitTo()} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); commitTo() } }} />
            ) : (
              <button type="button" className="or-line-v or-aud" onClick={() => ui.set({ left: 'contacts' })} data-tip="Change the audience in Contacts">
                {s.contacts.length ? <><b>{audience.length}</b> contact{audience.length === 1 ? '' : 's'}{c.sheet ? ` · ${c.sheet.replace(/_/g, ' ')}` : ''}{c.audience.group != null ? ` · ${s.groupNames.get(c.audience.group) ?? `Group ${c.audience.group}`}` : ''}{c.audience.purposes[0] ? ` · ${purposeLabel(c.audience.purposes[0])}` : ''} · <b>{ready}</b> ready</> : 'Import a list in Contacts'}
              </button>
            )}
            {c.kind === 'list' && suggestion && suggestion.id !== c.blueprint && c.blueprint !== 'blank' && (
                  <button type="button" className="or-suggest" onClick={() => void pickLetter(suggestion.id)} data-tip={`Use “${OUTREACH_BLUEPRINTS.find((b) => b.id === suggestion.id)?.label}” — ${suggestion.count} contacts in this audience are listed for ${purposeLabel(suggestion.purpose).toLowerCase()}`}>
                    <Icon name="star" size={12} /><span>Suggested: {OUTREACH_BLUEPRINTS.find((b) => b.id === suggestion.id)?.label}</span>
                  </button>
            )}
          </div>
          {badTo.length > 0 && <p className="or-inline-warn">Not an address: {badTo.slice(0, 3).join(', ')}</p>}
          <div className="or-line">
            <span className="or-line-k">Subject</span>
            <input id="or-subject" className="or-line-input or-subject" value={c.subject} onChange={(e) => s.patch({ subject: e.target.value })} aria-label="Subject" />
            <span className={'or-count' + (c.subject.length > SUBJECT_MAX ? ' over' : '')}>{c.subject.length} / {SUBJECT_MAX}</span>
          </div>
          {variants.length > 0 && (
            <div className="or-variants" aria-label="Other subject lines">
              {variants.map((v) => <button key={v} type="button" className="or-variant" onClick={() => s.patch({ subject: v })} data-tip="Use this subject">{v}</button>)}
            </div>
          )}

          <div className="or-fmt" role="toolbar" aria-label="Formatting">
            {TOOLS.map((t) => <button key={t.kind} type="button" className="ibtn" aria-label={t.tip} data-tip={t.tip} onMouseDown={(e) => e.preventDefault()} onClick={() => void mark(t.kind)}><Icon name={t.icon} size={14} /></button>)}
            <i className="or-fmt-sep" />
            {PLACEHOLDERS.map((p) => <button key={p} type="button" className="or-tag" onMouseDown={(e) => e.preventDefault()} onClick={() => insert(`{${p}}`)} data-tip={`Insert {${p}} — filled from each contact's row`}>{p}</button>)}
          </div>
          <textarea ref={bodyRef} className={'or-text' + (c.lang === 'bn' ? ' bn' : '')} value={c.body} onChange={(e) => setBody(e.target.value)} spellCheck aria-label="Message"
            placeholder="Write the letter. Enter starts a new paragraph; Shift+Enter breaks the line."
            onKeyDown={(e) => {
              if (e.ctrlKey || e.metaKey) {
                const k = e.key.toLowerCase()
                if (k === 'b' || k === 'i' || k === 'k') { e.preventDefault(); void mark(k === 'b' ? 'bold' : k === 'i' ? 'italic' : 'link'); return }
              }
              softBreakOnEnter(e, c.body, setBody)
            }} />

          <div className="or-foot">
            <Select<string> value={c.signatureId} prefix="Signature" onChange={(v) => s.patch({ signatureId: v })}
              options={[...s.signatures.map((x) => ({ value: x.id, label: x.name })), { value: 'none', label: 'No signature' }]} />
            <button type="button" className="btn" onClick={() => ui.set({ sheet: 'signatures' })}><Icon name="edit" size={14} /><span>Signatures</span></button>
            <div className="spacer" />
            <Switch checked={c.letterhead} onChange={(v) => s.patch({ letterhead: v })} label="ESB letterhead" />
          </div>

          {(aiNote || promisesFile || missingCount > 0) && (
            <div className="or-warnings">
              {aiNote && (
                <p className="ai"><Icon name="sparkle" size={13} /><span>Written by {aiNote.model}. {aiNote.unsourced.length ? `Check these figures — no source has them: ${aiNote.unsourced.join(', ')}.` : 'Read it before sending.'}</span>
                  <button type="button" className="btn xs" onClick={() => { s.patch(aiNote.undo); setAiNote(null); setVariants([]) }}>Undo</button></p>
              )}
              {promisesFile && <p><Icon name="paperclip" size={13} /><span>The letter mentions an attachment, but nothing is attached.</span></p>}
              {missingCount > 0 && <p><Icon name="info" size={13} /><span>{missingCount} contact{missingCount === 1 ? '' : 's'} lack a field this letter uses and will be skipped.</span></p>}
            </div>
          )}
        </div>
      ) : preview && (
        <div className="or-sheet or-preview">
          <dl>
            <dt>From</dt><dd>{mail ? `${mail.name} <${mail.user}>` : 'No sender yet'}</dd>
            <dt>To</dt><dd>{preview.who.email ? (preview.who.personName ? `${preview.who.personName} <${preview.who.email}>` : preview.who.email) : 'A recipient with no name (greeted Sir/Madam)'}</dd>
            <dt>Subject</dt><dd><b>{preview.subject || '(no subject)'}</b></dd>
            {s.attachments.length > 0 && <><dt>Files</dt><dd>{s.attachments.map((a) => a.name).join(', ')}</dd></>}
          </dl>
          {active && missingFields(active, c.subject, c.body).length > 0 && <p className="or-preview-warn">This contact will be skipped: missing {missingFields(active, c.subject, c.body).join(', ')}.</p>}
          <iframe className="or-frame" title="Email preview" sandbox="" srcDoc={preview.html} />
        </div>
      )}

      <AttachmentTray />
    </main>
  )
}
