import { useState, useMemo } from 'react'
import { useOutreachStore } from './outreachStore'
import { OUTREACH_BLUEPRINTS, generateAiOutreachCopy } from './outreachAi'
import { AttachmentTray } from './AttachmentTray'
import { Icon } from '../ui/Icon'
import type { OutreachBlueprintId } from './types'

export function OutreachComposer() {
  const selectedBlueprint = useOutreachStore((s) => s.selectedBlueprint)
  const selectBlueprint = useOutreachStore((s) => s.selectBlueprint)
  const languageMode = useOutreachStore((s) => s.languageMode)
  const setLanguageMode = useOutreachStore((s) => s.setLanguageMode)
  const subject = useOutreachStore((s) => s.subject)
  const setSubject = useOutreachStore((s) => s.setSubject)
  const bodyHtml = useOutreachStore((s) => s.bodyHtml)
  const setBodyHtml = useOutreachStore((s) => s.setBodyHtml)
  const contacts = useOutreachStore((s) => s.contacts)
  const activeContactId = useOutreachStore((s) => s.activeContactId)
  const addLog = useOutreachStore((s) => s.addLog)

  const [isGenerating, setIsGenerating] = useState(false)
  const [showPreview, setShowPreview] = useState(false)
  const [subjectVariants, setSubjectVariants] = useState<string[]>([])

  // Resolve currently previewed contact
  const activeContact = useMemo(() => {
    return contacts.find((c) => c.id === activeContactId) || contacts[0] || {
      personName: 'মেজর জেনারেল এস এম জিয়া-উল-আজিম, এনডিসি',
      designation: 'চেয়ারম্যান',
      organization: 'BREB (বাংলাদেশ পল্লী বিদ্যুতায়ন বোর্ড)',
      sectorGroup: 'Group 1: Power Distribution Utilities',
      purpose: 'MAGAZINE_DISTRIBUTION',
      email: 'chairman@reb.gov.bd',
    }
  }, [contacts, activeContactId])

  // Interpolated preview
  const previewSubject = useMemo(() => {
    return subject
      .replace(/{name}/g, activeContact.personName)
      .replace(/{designation}/g, activeContact.designation)
      .replace(/{organization}/g, activeContact.organization)
      .replace(/{sector}/g, activeContact.sectorGroup)
      .replace(/{purpose}/g, activeContact.purpose)
  }, [subject, activeContact])

  const previewBody = useMemo(() => {
    return bodyHtml
      .replace(/{name}/g, activeContact.personName)
      .replace(/{designation}/g, activeContact.designation)
      .replace(/{organization}/g, activeContact.organization)
      .replace(/{sector}/g, activeContact.sectorGroup)
      .replace(/{purpose}/g, activeContact.purpose)
  }, [bodyHtml, activeContact])

  const handleGenerateAi = async () => {
    setIsGenerating(true)
    addLog('info', `Calling Claude AI to draft ${selectedBlueprint} pitch for ${activeContact.personName}...`)
    try {
      const res = await generateAiOutreachCopy(
        activeContact as unknown as Parameters<typeof generateAiOutreachCopy>[0],
        selectedBlueprint,
        languageMode
      )
      setSubject(res.subject)
      setBodyHtml(res.bodyHtml || res.bodyText)
      setSubjectVariants(res.subjectVariants || [])
      addLog('success', `Claude generated promotional draft: "${res.subject}"`)
    } catch (err) {
      addLog('error', `AI Generation failed: ${String(err)}`)
    } finally {
      setIsGenerating(false)
    }
  }

  const insertTag = (tag: string) => {
    setBodyHtml(bodyHtml + tag)
  }

  return (
    <main className="center ed-center outreach-center" aria-label="Promotional Composer">
      {/* Top blueprint & language control bar */}
      <div className="outreach-composer-topbar">
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
          {/* Blueprint pill selector */}
          <div className="row" style={{ gap: 4, overflowX: 'auto', flex: 1, paddingRight: 8 }}>
            {OUTREACH_BLUEPRINTS.map((bp) => (
              <button
                key={bp.id}
                type="button"
                className={'pill xs' + (selectedBlueprint === bp.id ? ' on' : '')}
                style={{ fontSize: 11, cursor: 'pointer', whiteSpace: 'nowrap' }}
                onClick={() => selectBlueprint(bp.id as OutreachBlueprintId)}
              >
                {bp.label}
              </button>
            ))}
          </div>

          {/* Language mode switcher */}
          <div className="seg-ctl xs" style={{ display: 'inline-flex' }}>
            <button
              type="button"
              className={'seg-btn' + (languageMode === 'en' ? ' on' : '')}
              onClick={() => setLanguageMode('en')}
            >
              EN
            </button>
            <button
              type="button"
              className={'seg-btn' + (languageMode === 'bn' ? ' on' : '')}
              onClick={() => setLanguageMode('bn')}
            >
              বাংলা
            </button>
            <button
              type="button"
              className={'seg-btn' + (languageMode === 'bilingual' ? ' on' : '')}
              onClick={() => setLanguageMode('bilingual')}
            >
              Dual
            </button>
          </div>
        </div>

        {/* AI Action Strip */}
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', marginTop: 8 }}>
          <div className="row" style={{ gap: 6, alignItems: 'center' }}>
            <button
              type="button"
              className={'btn xs primary' + (isGenerating ? ' loading' : '')}
              disabled={isGenerating}
              onClick={handleGenerateAi}
              data-tip="Generate tailored promotional copy using Claude Sonnet/Opus"
            >
              <Icon name="sparkle" size={13} />
              <span>{isGenerating ? 'Writing with Claude...' : '✨ Write with Claude'}</span>
            </button>

            {subjectVariants.length > 0 && (
              <select
                className="select xs"
                style={{ fontSize: 11, maxWidth: 220 }}
                onChange={(e) => setSubject(e.target.value)}
              >
                <option value="">A/B Subject Variants ({subjectVariants.length})</option>
                {subjectVariants.map((v, i) => (
                  <option key={i} value={v}>{v}</option>
                ))}
              </select>
            )}
          </div>

          {/* Merge variable chips */}
          <div className="row" style={{ gap: 4, alignItems: 'center' }}>
            <span style={{ fontSize: 10, opacity: 0.6, textTransform: 'uppercase' }}>Tags:</span>
            {['{name}', '{designation}', '{organization}', '{sector}'].map((t) => (
              <button
                key={t}
                type="button"
                className="pill xs"
                style={{ fontSize: 10, padding: '1px 5px', cursor: 'pointer', fontFamily: 'monospace' }}
                onClick={() => insertTag(t)}
                data-tip={`Insert ${t} tag`}
              >
                {t}
              </button>
            ))}
            <button
              type="button"
              className={'pill xs' + (showPreview ? ' on' : '')}
              style={{ fontSize: 10, padding: '1px 8px', cursor: 'pointer' }}
              onClick={() => setShowPreview(!showPreview)}
            >
              <Icon name="eye" size={11} />
              <span style={{ marginLeft: 3 }}>Preview</span>
            </button>
          </div>
        </div>
      </div>

      {/* Editor or Live Preview View */}
      <div className="outreach-composer-body" style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
        {showPreview ? (
          /* Live Recipient Preview Card */
          <div className="outreach-preview-box">
            <div className="preview-meta-header">
              <div><span className="lbl">To:</span> <strong className="val">{activeContact.personName} &lt;{activeContact.email}&gt;</strong></div>
              <div><span className="lbl">Role:</span> <span className="val">{activeContact.designation} · {activeContact.organization}</span></div>
              <div><span className="lbl">Subject:</span> <strong className="val-subj">{previewSubject}</strong></div>
            </div>
            <div className="preview-content-rendered">
              {previewBody.includes('<') ? (
                <div dangerouslySetInnerHTML={{ __html: previewBody }} />
              ) : (
                <pre style={{ whiteSpace: 'pre-wrap', fontFamily: 'inherit' }}>{previewBody}</pre>
              )}
            </div>
          </div>
        ) : (
          /* Real Editor */
          <div className="stack" style={{ flex: 1, gap: 8, padding: '10px 12px' }}>
            <div>
              <div className="row" style={{ justifyContent: 'space-between', marginBottom: 3 }}>
                <label style={{ fontSize: 10, textTransform: 'uppercase', opacity: 0.7, fontWeight: 700 }}>
                  Subject Line
                </label>
                <span style={{ fontSize: 10, opacity: subject.length > 68 ? 0.9 : 0.5, color: subject.length > 68 ? '#f59e0b' : 'inherit' }}>
                  {subject.length} / 68 chars
                </span>
              </div>
              <input
                type="text"
                className="input"
                style={{ width: '100%', fontSize: 13, fontWeight: 600 }}
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
              />
            </div>

            <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
              <label style={{ fontSize: 10, textTransform: 'uppercase', opacity: 0.7, fontWeight: 700, marginBottom: 3 }}>
                Email Proposal Body (HTML & Plaintext)
              </label>
              <textarea
                className="textarea custom-scroll"
                style={{ flex: 1, width: '100%', minHeight: 280, resize: 'none', fontSize: 12, lineHeight: 1.6 }}
                value={bodyHtml}
                onChange={(e) => setBodyHtml(e.target.value)}
              />
            </div>

            {/* Universal Attachment Tray */}
            <AttachmentTray />
          </div>
        )}
      </div>
    </main>
  )
}
