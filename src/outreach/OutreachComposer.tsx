// Centre: the letter. One template for the whole list — a blueprint, English or Bangla, a subject and a plain-text
// body with {name}/{designation}/{organization}/{sector} — and a Preview that shows exactly what the selected contact
// will receive, opt-out line included. What is sent is plain text; the main process builds the HTML from it.

import { useMemo, useRef, useState } from 'react'
import { useOutreachStore } from './outreachStore'
import { OUTREACH_BLUEPRINTS, writeOutreachWithAi } from './outreachAi'
import { PLACEHOLDERS, buildMessage, mentionsAttachment, missingFields } from './compose'
import { AttachmentTray } from './AttachmentTray'
import { aiFor, aiPaused, loadAiSettings, providerMeta, roleProvider } from '../editorial/aiProviders'
import { Icon } from '../ui/Icon'
import { Select, Seg } from '../ui/controls'
import type { OutreachBlueprintId, OutreachLang } from './types'

const SUBJECT_MAX = 70

export function OutreachComposer() {
  const s = useOutreachStore()
  const [view, setView] = useState<'edit' | 'preview'>('edit')
  const [busy, setBusy] = useState(false)
  const [variants, setVariants] = useState<string[]>([])
  const bodyRef = useRef<HTMLTextAreaElement>(null)
  const active = s.contacts.find((c) => c.id === s.activeId) ?? s.contacts[0]
  const ai = aiFor('outreach')
  const aiName = providerMeta(ai?.provider ?? roleProvider(loadAiSettings(), 'outreach')).name

  const missingCount = useMemo(() => s.contacts.filter((c) => c.status === 'QUEUED' && missingFields(c, s.subject, s.body).length).length, [s.contacts, s.subject, s.body])
  const promisesFile = mentionsAttachment(s.body) && !s.attachments.length
  const msg = active ? buildMessage(active, s.subject, s.body, s.lang) : null

  const insert = (tag: string) => {
    const el = bodyRef.current
    if (!el) return s.setBody(s.body + tag)
    const a = el.selectionStart, b = el.selectionEnd
    s.setBody(s.body.slice(0, a) + tag + s.body.slice(b))
    requestAnimationFrame(() => { el.focus(); el.setSelectionRange(a + tag.length, a + tag.length) })
  }

  const write = async () => {
    setBusy(true)
    try {
      const r = await writeOutreachWithAi(s.blueprint, s.lang, active)
      s.setSubject(r.subject)
      s.setBody(r.body)
      setVariants(r.variants)
      setView('edit')
      s.addLog('ok', `Draft written by ${r.model} — read it before sending`)
    } catch (e) {
      s.addLog('error', `AI draft: ${(e as Error).message}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="or-center" aria-label="Letter">
      <div className="or-toolbar">
        <Select<OutreachBlueprintId> value={s.blueprint} options={OUTREACH_BLUEPRINTS.map((b) => ({ value: b.id, label: b.label, hint: b.tag }))} onChange={(v) => s.selectBlueprint(v)} prefix="Letter" />
        <Seg<OutreachLang> value={s.lang} onChange={s.setLang} options={[{ value: 'en', label: 'English' }, { value: 'bn', label: 'বাংলা' }]} />
        <div className="spacer" />
        <button type="button" className="btn sm ai-btn" data-provider={ai?.provider} onClick={() => void write()} disabled={busy || !ai || aiPaused()}
          data-tip={aiPaused() ? 'AI is OFF — turn it on in the Editorial Engine panel' : ai ? `${aiName} writes the template from this letter's offer, with placeholders — it replaces the subject and body` : `Add a ${aiName} key in the AI dialog to write with AI`}>
          <Icon name="sparkle" size={13} className={busy ? 'spin' : ''} /><span>{busy ? 'Writing…' : 'Write with AI'}</span>
        </button>
        <Seg<'edit' | 'preview'> value={view} onChange={setView} options={[{ value: 'edit', label: 'Edit' }, { value: 'preview', label: 'Preview', tip: active ? `As ${active.personName || active.email} will receive it` : 'Import a list to preview' }]} />
      </div>

      <div className="or-sheet">
        {view === 'edit' ? (
          <>
            <div className="or-field">
              <div className="or-field-row"><label htmlFor="or-subject">Subject</label><span className={'or-count' + (s.subject.length > SUBJECT_MAX ? ' over' : '')}>{s.subject.length} / {SUBJECT_MAX}</span></div>
              <input id="or-subject" className="or-input" value={s.subject} onChange={(e) => s.setSubject(e.target.value)} />
              {variants.length > 0 && (
                <div className="or-variants" aria-label="Other subject lines">
                  {variants.map((v) => <button key={v} type="button" className="or-variant" onClick={() => s.setSubject(v)} data-tip="Use this subject">{v}</button>)}
                </div>
              )}
            </div>
            <div className="or-field grow">
              <div className="or-field-row">
                <label htmlFor="or-body">Message</label>
                <span className="or-tags">
                  {PLACEHOLDERS.map((p) => <button key={p} type="button" className="or-tag" onClick={() => insert(`{${p}}`)} data-tip={`Insert {${p}} — filled from each contact's row`}>{p}</button>)}
                </span>
              </div>
              <textarea id="or-body" ref={bodyRef} className={'or-input or-body' + (s.lang === 'bn' ? ' bn' : '')} value={s.body} onChange={(e) => s.setBody(e.target.value)} spellCheck />
            </div>
            {(promisesFile || missingCount > 0) && (
              <div className="or-warnings">
                {promisesFile && <p><Icon name="paperclip" size={13} />The letter mentions an attachment, but nothing is attached.</p>}
                {missingCount > 0 && <p><Icon name="info" size={13} />{missingCount} contact{missingCount === 1 ? '' : 's'} lack a field this letter uses and will be skipped.</p>}
              </div>
            )}
          </>
        ) : msg && active ? (
          <article className="or-preview">
            <dl>
              <dt>To</dt><dd>{active.personName ? `${active.personName} <${active.email}>` : active.email}</dd>
              <dt>Subject</dt><dd><b>{msg.subject}</b></dd>
              {s.attachments.length > 0 && <><dt>Files</dt><dd>{s.attachments.map((a) => a.name).join(', ')}</dd></>}
            </dl>
            {missingFields(active, s.subject, s.body).length > 0 && <p className="or-preview-warn">This contact will be skipped: missing {missingFields(active, s.subject, s.body).join(', ')}.</p>}
            <div className={'or-preview-body' + (s.lang === 'bn' ? ' bn' : '')}>
              {msg.text.split(/\n{2,}/).map((p, i) => <p key={i}>{p}</p>)}
            </div>
          </article>
        ) : (
          <div className="or-empty"><p>Import a mailing list to see the letter as a contact will receive it.</p></div>
        )}
      </div>

      <AttachmentTray />
    </main>
  )
}
