// src/outreach/SegmentsDialog.tsx
// Sector-tailored letter variants and VIP personal openers (§5.2, §5.4).

import { useState, useMemo, useRef } from 'react'
import { Dialog } from '../ui/controls'
import { Icon } from '../ui/Icon'
import { useOutreachStore } from './outreachStore'
import { inAudience } from './campaign'
import { segmentOf, segmentLabel, blueprintFor } from './segments'
import { openerCandidates, buildOtherEntities, guardOpener, writeOpenerWithAi } from './openers'
import { writeOutreachWithAi } from './outreachAi'
import { letterChecks } from './checks'
import { softBreakOnEnter } from './compose'
import { aiPaused, aiFor } from '../editorial/aiProviders'
import type { Contact, OutreachBlueprintId } from './types'

interface SegmentsDialogProps {
  onClose: () => void
}

export function SegmentsDialog({ onClose }: SegmentsDialogProps) {
  const s = useOutreachStore()
  const campaign = s.campaign()
  const [editingSeg, setEditingSeg] = useState<string | null>(null)
  const [draftingSegs, setDraftingSegs] = useState<Record<string, 'busy' | 'done' | 'error'>>({})
  const [draftAllProgress, setDraftAllProgress] = useState<string | null>(null)
  const [draftingOpeners, setDraftingOpeners] = useState(false)
  const [openerProgress, setOpenerProgress] = useState<string | null>(null)
  const editAreaRef = useRef<HTMLTextAreaElement>(null)

  const audience = useMemo(() => {
    if (!campaign) return []
    return s.contacts.filter((c) => inAudience(c, campaign.audience))
  }, [s.contacts, campaign])

  // Group contacts by segment key
  const segments = useMemo(() => {
    const map = new Map<string, Contact[]>()
    for (const c of audience) {
      const key = segmentOf(c)
      const list = map.get(key) ?? []
      list.push(c)
      map.set(key, list)
    }
    return [...map.entries()].map(([key, contacts]) => ({
      key,
      contacts,
      label: segmentLabel(key, contacts),
      sample: contacts[0],
      blueprintId: blueprintFor(contacts[0]) || ('custom_pitch' as OutreachBlueprintId),
    }))
  }, [audience])

  // VIP Opener candidates
  const candidates = useMemo(() => openerCandidates(audience), [audience])

  if (!campaign) return null

  const variants = campaign.variants || {}
  const openers = campaign.openers || {}
  const aiAvailable = !aiPaused() && !!aiFor('outreach')

  // Draft a single segment with AI
  const draftSegment = async (segKey: string, bpId: OutreachBlueprintId, sample: Contact) => {
    if (!aiAvailable) return
    setDraftingSegs((prev) => ({ ...prev, [segKey]: 'busy' }))
    try {
      const res = await writeOutreachWithAi({
        blueprint: bpId,
        lang: campaign.lang,
        housePrompt: s.housePrompt,
        sources: campaign.sources,
        example: sample,
      })

      const updatedVariants = {
        ...(campaign.variants || {}),
        [segKey]: {
          subject: res.subject,
          body: res.body,
          status: 'draft' as const,
          by: 'ai' as const,
          at: Date.now(),
        },
      }
      s.patch({ variants: updatedVariants })
      setDraftingSegs((prev) => ({ ...prev, [segKey]: 'done' }))
      s.addLog('info', `Drafted letter version for ${segmentLabel(segKey, [sample])}`)
    } catch (err) {
      setDraftingSegs((prev) => ({ ...prev, [segKey]: 'error' }))
      s.addLog('error', `Failed drafting segment ${segKey}: ${String(err)}`)
    }
  }

  // Concurrency 2 draft all
  const draftAll = async () => {
    if (!aiAvailable || segments.length === 0) return
    const unapproved = segments.filter((seg) => variants[seg.key]?.status !== 'approved')
    if (unapproved.length === 0) return

    setDraftAllProgress(`Drafting 0 of ${unapproved.length}`)
    let done = 0

    // Concurrency pool of 2
    const queue = [...unapproved]
    const worker = async () => {
      while (queue.length > 0) {
        const item = queue.shift()!
        await draftSegment(item.key, item.blueprintId, item.sample)
        done++
        setDraftAllProgress(`Drafting ${done} of ${unapproved.length}`)
      }
    }

    await Promise.all([worker(), worker()])
    setDraftAllProgress(null)
    s.addLog('info', `Drafted ${done} letter versions across segments`)
  }

  // Approve a segment version
  const approveSegment = (segKey: string) => {
    const current = variants[segKey]
    if (!current) return
    const updated = {
      ...variants,
      [segKey]: {
        ...current,
        status: 'approved' as const,
        by: 'you' as const,
        at: Date.now(),
      },
    }
    s.patch({ variants: updated })
    s.addLog('info', `Approved letter version for ${segKey}`)
  }

  // Reset to using the main letter
  const revertToMainLetter = (segKey: string) => {
    const updated = { ...variants }
    delete updated[segKey]
    s.patch({ variants: updated })
    if (editingSeg === segKey) setEditingSeg(null)
  }

  // Update variant inline text
  const updateVariantText = (segKey: string, patch: { subject?: string; body?: string }) => {
    const current = variants[segKey] || {
      subject: campaign.subject,
      body: campaign.body,
      status: 'draft',
      by: 'you',
      at: Date.now(),
    }
    const updated = {
      ...variants,
      [segKey]: {
        ...current,
        ...patch,
        by: 'you' as const,
        at: Date.now(),
      },
    }
    s.patch({ variants: updated })
  }

  // Draft openers for all leadership candidates
  const draftAllOpeners = async () => {
    if (!aiAvailable || candidates.length === 0) return
    setDraftingOpeners(true)
    setOpenerProgress(`Writing openers for 0 of ${candidates.length}`)
    let count = 0
    const newOpeners = { ...(campaign.openers || {}) }

    for (const cand of candidates) {
      count++
      setOpenerProgress(`Writing opener for ${cand.personName || cand.email} (${count}/${candidates.length})`)
      const res = await writeOpenerWithAi(cand, {
        lang: campaign.lang,
        sources: campaign.sources,
        allContacts: audience,
      })
      if (res) {
        newOpeners[cand.email] = { text: res, at: Date.now() }
      }
    }

    s.patch({ openers: newOpeners })
    setDraftingOpeners(false)
    setOpenerProgress(null)
    s.addLog('info', `Generated VIP openers for ${Object.keys(newOpeners).length} leadership contacts`)
  }

  // Update single contact opener
  const updateOpener = (email: string, text: string) => {
    const updated = { ...(campaign.openers || {}) }
    if (!text.trim()) {
      delete updated[email]
    } else {
      updated[email] = { text: text.trim(), at: Date.now() }
    }
    s.patch({ openers: updated })
  }

  return (
    <Dialog
      title="Versions by sector & VIP openers"
      kicker={campaign.name.toUpperCase()}
      width={780}
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
      <div className="or-seg-dialog stack" style={{ gap: 20 }}>
        {/* Intro */}
        <p className="or-seg-sub" style={{ fontSize: 13, color: 'var(--text-2)', margin: 0 }}>
          Tailor letters for specific audience sectors. Approved versions are sent to their segment; all other contacts receive the campaign’s main letter.
        </p>

        {/* 1. Sector Segments Section */}
        <section className="or-seg-section">
          <div className="or-seg-section-head" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <div>
              <h3 style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>Audience Segments ({segments.length})</h3>
              <span style={{ fontSize: 12, color: 'var(--text-3)' }}>{audience.length} total contacts across {segments.length} segment groups</span>
            </div>
            <button
              type="button"
              className="btn sm primary"
              disabled={!aiAvailable || !!draftAllProgress}
              onClick={() => void draftAll()}
              title={aiAvailable ? 'Draft versions for all segments with AI (concurrency 2)' : 'Connect an AI to draft versions'}
            >
              <Icon name="sparkle" size={13} />
              <span>{draftAllProgress || 'Draft all unapproved'}</span>
            </button>
          </div>

          <div className="or-seg-list stack" style={{ gap: 10 }}>
            {segments.map((seg) => {
              const variant = variants[seg.key]
              const hasVariant = !!variant
              const isApproved = variant?.status === 'approved'
              const isDraft = variant?.status === 'draft'
              const isEditing = editingSeg === seg.key
              const isBusy = draftingSegs[seg.key] === 'busy'
              const checks = variant
                ? letterChecks({
                    subject: variant.subject,
                    body: variant.body,
                    signature: '',
                    attachments: s.attachments,
                    sources: campaign.sources,
                  })
                : []
              const hasBadCheck = checks.some((chk) => chk.level === 'bad')

              return (
                <div key={seg.key} className={`or-seg-card ${hasVariant ? 'has-variant' : ''}`} style={{ border: '1px solid var(--border)', borderRadius: 6, padding: 12, background: 'var(--card-bg)' }}>
                  <div className="or-seg-card-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ fontWeight: 600, fontSize: 13 }}>{seg.label}</span>
                        <span className="or-seg-badge count" style={{ fontSize: 11, color: 'var(--text-3)', padding: '2px 6px', background: 'var(--chip-bg, rgba(0,0,0,0.05))', borderRadius: 4 }}>
                          {seg.contacts.length} {seg.contacts.length === 1 ? 'contact' : 'contacts'}
                        </span>
                        {isApproved && (
                          <span className="or-seg-badge approved" style={{ fontSize: 11, color: 'var(--color-good, #2e7d32)', fontWeight: 600, padding: '2px 6px', background: 'rgba(46,125,50,0.1)', borderRadius: 4 }}>
                            Approved
                          </span>
                        )}
                        {isDraft && (
                          <span className="or-seg-badge draft" style={{ fontSize: 11, color: 'var(--color-warn, #e65100)', fontWeight: 600, padding: '2px 6px', background: 'rgba(230,81,0,0.1)', borderRadius: 4 }}>
                            Draft
                          </span>
                        )}
                        {!hasVariant && (
                          <span className="or-seg-badge default" style={{ fontSize: 11, color: 'var(--text-3)', padding: '2px 6px', background: 'var(--chip-bg, rgba(0,0,0,0.05))', borderRadius: 4 }}>
                            Using main letter
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="or-seg-card-actions" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <button
                        type="button"
                        className="btn sm"
                        disabled={!aiAvailable || isBusy}
                        onClick={() => void draftSegment(seg.key, seg.blueprintId, seg.sample)}
                        title={aiAvailable ? 'Draft version for this sector with AI' : 'Connect an AI to draft'}
                      >
                        <Icon name="sparkle" size={12} />
                        <span>{isBusy ? 'Drafting' : 'Draft with AI'}</span>
                      </button>

                      <button
                        type="button"
                        className="btn sm"
                        onClick={() => {
                          if (!variant) {
                            // Seed from main campaign letter
                            updateVariantText(seg.key, { subject: campaign.subject, body: campaign.body })
                          }
                          setEditingSeg(isEditing ? null : seg.key)
                        }}
                      >
                        <Icon name="edit" size={12} />
                        <span>{isEditing ? 'Close edit' : 'Edit'}</span>
                      </button>

                      {isDraft && (
                        <button
                          type="button"
                          className="btn sm primary"
                          disabled={hasBadCheck}
                          onClick={() => approveSegment(seg.key)}
                          title={hasBadCheck ? 'Fix letter check errors before approving' : 'Approve this version for sending'}
                        >
                          <Icon name="check" size={12} />
                          <span>Approve</span>
                        </button>
                      )}

                      {hasVariant && (
                        <button
                          type="button"
                          className="btn sm"
                          onClick={() => revertToMainLetter(seg.key)}
                          title="Revert back to using the main letter for this sector"
                        >
                          <span>Use main letter</span>
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Inline Editor */}
                  {isEditing && variant && (
                    <div className="or-seg-editor stack" style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--border)', gap: 10 }}>
                      <label className="or-field">
                        <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-2)' }}>Subject</span>
                        <input
                          className="input"
                          style={{ width: '100%', marginTop: 4 }}
                          value={variant.subject}
                          onChange={(e) => updateVariantText(seg.key, { subject: e.target.value })}
                        />
                      </label>

                      <label className="or-field">
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-2)' }}>Letter Body</span>
                          <span style={{ fontSize: 11, color: 'var(--text-3)' }}>Supports {'{name}'}, {'{designation}'}, {'{organization}'}, {'{opener|}'}</span>
                        </div>
                        <textarea
                          ref={editAreaRef}
                          className="input textarea"
                          rows={6}
                          style={{ width: '100%', marginTop: 4, fontFamily: 'inherit', resize: 'vertical' }}
                          value={variant.body}
                          onKeyDown={(e) => softBreakOnEnter(e, variant.body, (v) => updateVariantText(seg.key, { body: v }))}
                          onChange={(e) => updateVariantText(seg.key, { body: e.target.value })}
                        />
                      </label>

                      {hasBadCheck && (
                        <div className="callout warn" style={{ padding: '6px 10px', fontSize: 12 }}>
                          {checks.filter((c) => c.level === 'bad').map((c) => (
                            <div key={c.id}>• {c.title}: {c.detail}</div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </section>

        {/* 2. VIP Personal Opening Lines (Tier 2) */}
        <section className="or-seg-openers" style={{ borderTop: '1px solid var(--border)', paddingTop: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
            <div>
              <h3 style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>Personal Opening Lines — VIP Leadership</h3>
              <p style={{ margin: '2px 0 0', fontSize: 12, color: 'var(--text-3)' }}>
                {candidates.length} leadership contacts identified (Chairmen, MDs, CEOs, DG, Secretaries). Use <code>{'{opener|}'}</code> in your letter to insert.
              </p>
            </div>
            <button
              type="button"
              className="btn sm"
              disabled={!aiAvailable || draftingOpeners || candidates.length === 0}
              onClick={() => void draftAllOpeners()}
              title={aiAvailable ? 'Write grounded opening lines with AI for all leadership contacts' : 'Connect an AI'}
            >
              <Icon name="sparkle" size={13} />
              <span>{openerProgress || 'Write VIP openers with AI'}</span>
            </button>
          </div>

          {candidates.length === 0 ? (
            <div style={{ padding: 12, textAlign: 'center', fontSize: 12, color: 'var(--text-3)', background: 'var(--chip-bg, rgba(0,0,0,0.02))', borderRadius: 6 }}>
              No contacts with VIP leadership designations found in this audience.
            </div>
          ) : (
            <div className="stack" style={{ gap: 8, maxHeight: 260, overflowY: 'auto' }}>
              {candidates.map((cand) => {
                const current = openers[cand.email]?.text || ''
                const otherEntities = buildOtherEntities(audience, cand.id)
                const guard = current ? guardOpener(current, cand, { lang: campaign.lang, sources: campaign.sources, otherEntities }) : null

                return (
                  <div key={cand.id} style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: 8, border: '1px solid var(--border)', borderRadius: 6, background: 'var(--card-bg)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontSize: 12, fontWeight: 600 }}>
                        {cand.personName || cand.email} · <span style={{ color: 'var(--text-2)', fontWeight: 400 }}>{cand.designation} at {cand.organization}</span>
                      </span>
                      {guard && (
                        <span style={{ fontSize: 11, color: guard.ok ? 'var(--color-good, #2e7d32)' : 'var(--color-warn, #d32f2f)', fontWeight: 500 }}>
                          {guard.ok ? '✓ Compliant' : `⚠ ${guard.reason}`}
                        </span>
                      )}
                    </div>
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                      <input
                        className="input sm"
                        style={{ flex: 1, fontSize: 12 }}
                        placeholder="Courteous 1–2 sentence personal opening greeting line"
                        value={current}
                        onChange={(e) => updateOpener(cand.email, e.target.value)}
                      />
                      {current && (
                        <button
                          type="button"
                          className="ibtn"
                          title="Clear opener"
                          onClick={() => updateOpener(cand.email, '')}
                        >
                          <Icon name="x" size={13} />
                        </button>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </section>
      </div>
    </Dialog>
  )
}
