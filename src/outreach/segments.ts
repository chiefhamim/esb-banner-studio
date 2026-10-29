// src/outreach/segments.ts
// Audience segmentation by sector group and blueprint, with deterministic variant & subject line resolution.

import type { Campaign, Contact, OutreachBlueprintId } from './types'

export const PURPOSE_BLUEPRINT: Record<string, OutreachBlueprintId> = {
  MAGAZINE_DISTRIBUTION: 'magazine_distribution',
  VIP_CIRCULATION: 'magazine_distribution',
  RESEARCH_DISTRIBUTION: 'magazine_distribution',
  SPONSORSHIP: 'corporate_sponsorship',
  ADVERTISING: 'corporate_sponsorship',
  ADVERTISING_PROSPECT: 'corporate_sponsorship',
  CORPORATE_SUBSCRIPTION: 'corporate_sponsorship',
  PARTNERSHIP: 'corporate_sponsorship',
  HIGH_LEVEL_ENGAGEMENT: 'executive_interview',
  EXPERT_SOURCE: 'executive_interview',
  EXPERT_COMMENTARY: 'executive_interview',
  EDITORIAL_SOURCE: 'executive_interview',
  EDITORIAL_CONTRIBUTOR: 'executive_interview',
  MEDIA_INQUIRY: 'executive_interview',
  GENERAL_INTELLIGENCE: 'breaking_intelligence',
  INTERNATIONAL_INTELLIGENCE: 'breaking_intelligence',
  DATA_PLATFORM: 'breaking_intelligence',
  GRID_EXPLORER: 'breaking_intelligence',
  PRESS_RELEASE: 'breaking_intelligence',
  INSTITUTIONAL_RELATIONS: 'institutional_dialogue',
  DIPLOMATIC_ENGAGEMENT: 'institutional_dialogue',
  POLICY_DIALOGUE: 'institutional_dialogue',
  PROJECT_FINANCING: 'institutional_dialogue',
  GENERAL_CORPORATE_COMMUNICATION: 'institutional_dialogue',
}

export const BLUEPRINT_LABELS: Record<OutreachBlueprintId | 'custom', string> = {
  magazine_distribution: 'Magazine Distribution',
  corporate_sponsorship: 'Corporate Sponsorship',
  executive_interview: 'Executive Interview',
  breaking_intelligence: 'Breaking Intelligence',
  institutional_dialogue: 'Institutional Dialogue',
  custom_pitch: 'Custom Pitch',
  custom: 'Custom',
}

/** The first mapped blueprint for a contact from its purpose tags, or null if none map. */
export function blueprintFor(contact: Contact): OutreachBlueprintId | null {
  for (const p of contact.purposes || []) {
    if (PURPOSE_BLUEPRINT[p]) return PURPOSE_BLUEPRINT[p]
  }
  return null
}

/**
 * Segment key for a contact: `${groupNo ?? 'x'}:${blueprintFor(contact) ?? 'custom'}`
 * E.g., "1:corporate_sponsorship", "3:magazine_distribution", "x:custom".
 */
export function segmentOf(contact: Contact): string {
  const g = contact.groupNo ?? 'x'
  const b = blueprintFor(contact) ?? 'custom'
  return `${g}:${b}`
}

/** 32-bit FNV-1a hash algorithm returning an unsigned 32-bit integer. */
export function fnv1a(str: string): number {
  let hash = 0x811c9dc5
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return hash >>> 0
}

/**
 * Pick subject line variant deterministically using FNV-1a hash on email.
 * Stable: the same email always receives the same subject line.
 */
export function pickSubjectVariant(email: string, variants: string[], defaultSubject: string): string {
  if (!variants || variants.length === 0) return defaultSubject
  const idx = fnv1a(email) % variants.length
  return variants[idx] || defaultSubject
}

export interface ResolvedLetter {
  subject: string
  body: string
  isVariant: boolean
  segmentKey: string
}

/**
 * Resolve the letter for a contact:
 * 1. Picks variants[segmentOf(c)] ONLY when approved; else the campaign's own subject and body.
 * 2. If campaign.subjectVariants is set, picks deterministically by fnv1a(email) % subjectVariants.length.
 */
export function letterFor(contact: Contact, campaign: Campaign): ResolvedLetter {
  const segKey = segmentOf(contact)
  const variant = campaign.variants?.[segKey]
  const isApprovedVariant = !!(variant && variant.status === 'approved')

  const baseSubject = isApprovedVariant ? variant.subject : campaign.subject
  const body = isApprovedVariant ? variant.body : campaign.body

  let subject = baseSubject
  if (campaign.subjectVariants && campaign.subjectVariants.length > 0) {
    subject = pickSubjectVariant(contact.email, campaign.subjectVariants, baseSubject)
  }

  return {
    subject,
    body,
    isVariant: isApprovedVariant,
    segmentKey: segKey,
  }
}

/** Format a human-readable title for a segment key. */
export function segmentLabel(segKey: string, contacts: Contact[] = []): string {
  const [groupStr, bpStr] = segKey.split(':')
  const bpName = BLUEPRINT_LABELS[bpStr as OutreachBlueprintId] || bpStr || 'Custom'
  if (groupStr === 'x') {
    return `General Audience · ${bpName}`
  }
  const groupNum = Number(groupStr)
  const sample = contacts.find((c) => c.groupNo === groupNum)
  if (sample?.sectorGroup) {
    return `${sample.sectorGroup} · ${bpName}`
  }
  return `Group ${groupStr} · ${bpName}`
}
