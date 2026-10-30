// src/outreach/SubjectVersionsDialog.tsx
// Rotating subject line variants picked deterministically by stable recipient hash (§5.3).

import { useState } from 'react'
import { Dialog } from '../ui/controls'
import { Icon } from '../ui/Icon'
import { useOutreachStore } from './outreachStore'
import { pickSubjectVariant } from './segments'
import { aiPaused, aiFor, aiJson, type AiSchema } from '../editorial/aiProviders'

interface SubjectVersionsDialogProps {
  onClose: () => void
}

const subjectSchema: AiSchema = {
  type: 'object',
  properties: {
    subjects: {
      type: 'string',
      description: 'Three alternative subject lines, one per line, each under 70 characters',
    },
  },
  required: ['subjects'],
}

export function SubjectVersionsDialog({ onClose }: SubjectVersionsDialogProps) {
  const s = useOutreachStore()
  const campaign = s.campaign()
  const [newSubj, setNewSubj] = useState('')
  const [busy, setBusy] = useState(false)

  if (!campaign) return null

  const variants = campaign.subjectVariants || []
  const activeContact = s.contacts.find((x) => x.id === s.activeContact) || s.contacts[0]
  const aiAvailable = !aiPaused() && !!aiFor('outreach')

  // The subject line the active contact would get
  const previewSubject = activeContact
    ? pickSubjectVariant(activeContact.email, variants, campaign.subject)
    : campaign.subject

  const addVariant = (val?: string) => {
    const text = (val ?? newSubj).trim()
    if (!text || variants.length >= 4) return
    const updated = [...variants, text]
    s.patch({ subjectVariants: updated })
    setNewSubj('')
    s.addLog('info', `Added subject variant: "${text}"`)
  }

  const removeVariant = (index: number) => {
    const updated = variants.filter((_, i) => i !== index)
    s.patch({ subjectVariants: updated })
  }

  const updateVariant = (index: number, text: string) => {
    const updated = [...variants]
    updated[index] = text
    s.patch({ subjectVariants: updated })
  }

  // Generate 3 alternative subject lines with AI
  const suggestWithAi = async () => {
    if (!aiAvailable) return
    setBusy(true)
    const ai = aiFor('outreach')!
    try {
      const system = `You write engaging, professional B2B email subject lines for ESB Power Line.
Generate 3 distinct alternative subject lines for the email below, one per line.
Rules:
- Keep length under 70 characters.
- Professional, clear tone for energy executives and officials.
- You may use the placeholder {organization}.
- No spam or hype words.`
      const user = `Original Subject: ${campaign.subject}\n\nEmail body:\n${campaign.body.slice(0, 500)}`

      const res = await aiJson<{ subjects: string }>({
        provider: ai.provider,
        key: ai.key,
        model: ai.model,
        system,
        user,
        schema: subjectSchema,
        maxTokens: 500,
        effort: 'low',
      })

      const raw = String(res.data?.subjects || '')
      const generated = raw
        .split('\n')
        .map((line) => line.replace(/^[-*•\d.)\s]+/, '').trim())
        .filter(Boolean)

      const merged = [...variants]
      for (const item of generated) {
        if (merged.length < 4 && !merged.includes(item)) {
          merged.push(item)
        }
      }
      s.patch({ subjectVariants: merged })
      s.addLog('info', `Generated ${generated.length} subject variants with AI`)
    } catch (err) {
      s.addLog('error', `Failed to generate subject variants: ${String(err)}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog
      title="Subject line variants"
      kicker={campaign.name.toUpperCase()}
      width={600}
      onClose={onClose}
      footer={
        <>
          <div className="spacer" />
          <button type="button" className="btn primary" onClick={onClose}>
            Done
          </button>
        </>
      }
    >
      <div className="or-subj-dialog stack" style={{ gap: 16 }}>
        <p style={{ fontSize: 13, color: 'var(--text-2)', margin: 0 }}>
          Rotate multiple subject lines across your audience. Each recipient deterministically receives the same subject line based on their email address.
        </p>

        {/* Primary Subject */}
        <div style={{ padding: 10, borderRadius: 6, background: 'var(--chip-bg, rgba(0,0,0,0.03))', border: '1px solid var(--border)' }}>
          <span style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', color: 'var(--text-3)', letterSpacing: '0.04em' }}>
            Primary Subject (Main Letter)
          </span>
          <div style={{ marginTop: 4, fontSize: 13, fontWeight: 500 }}>
            {campaign.subject || '(None set)'}
          </div>
        </div>

        {/* Alternate Variants */}
        <div className="stack" style={{ gap: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-2)' }}>
              Alternate Variants ({variants.length}/4)
            </span>
            <button
              type="button"
              className="btn sm"
              disabled={!aiAvailable || busy || variants.length >= 4}
              onClick={() => void suggestWithAi()}
              title={aiAvailable ? 'Generate alternate subject lines with AI' : 'Connect an AI'}
            >
              <Icon name="sparkle" size={12} />
              <span>{busy ? 'Generating…' : 'Suggest with AI'}</span>
            </button>
          </div>

          {variants.length === 0 ? (
            <div style={{ padding: 12, textAlign: 'center', fontSize: 12, color: 'var(--text-3)', background: 'var(--chip-bg, rgba(0,0,0,0.02))', borderRadius: 6 }}>
              No alternate subject lines set. All recipients will receive the primary subject line.
            </div>
          ) : (
            <div className="stack" style={{ gap: 8 }}>
              {variants.map((variantText, idx) => (
                <div key={idx} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-3)', width: 20 }}>
                    #{idx + 1}
                  </span>
                  <input
                    className="input sm"
                    style={{ flex: 1, fontSize: 12 }}
                    value={variantText}
                    onChange={(e) => updateVariant(idx, e.target.value)}
                  />
                  <button
                    type="button"
                    className="ibtn"
                    title="Remove variant"
                    onClick={() => removeVariant(idx)}
                  >
                    <Icon name="trash" size={13} />
                  </button>
                </div>
              ))}
            </div>
          )}

          {variants.length < 4 && (
            <form
              onSubmit={(e) => {
                e.preventDefault()
                addVariant()
              }}
              style={{ display: 'flex', gap: 6, marginTop: 4 }}
            >
              <input
                className="input sm"
                style={{ flex: 1, fontSize: 12 }}
                placeholder="Add alternate subject line…"
                value={newSubj}
                onChange={(e) => setNewSubj(e.target.value)}
              />
              <button type="submit" className="btn sm" disabled={!newSubj.trim()}>
                <Icon name="plus" size={13} />
                <span>Add</span>
              </button>
            </form>
          )}
        </div>

        {/* Live Preview */}
        {activeContact && (
          <div style={{ marginTop: 8, padding: 10, borderRadius: 6, background: 'var(--card-bg)', border: '1px solid var(--border)' }}>
            <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-3)' }}>
              Deterministic Preview for Selected Contact:
            </span>
            <div style={{ marginTop: 2, fontSize: 12 }}>
              <b>{activeContact.personName || activeContact.email}</b> ({activeContact.email})
            </div>
            <div style={{ marginTop: 6, padding: '6px 8px', borderRadius: 4, background: 'var(--chip-bg, rgba(0,0,0,0.04))', fontSize: 13, color: 'var(--color-primary, #0066cc)', fontWeight: 500 }}>
              {previewSubject}
            </div>
          </div>
        )}
      </div>
    </Dialog>
  )
}
