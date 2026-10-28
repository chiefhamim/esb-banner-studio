/**
 * What the workbook says about an address. An empty status cell is UNKNOWN — never assumed safe.
 * UNDELIVERABLE (the sheet's DEAD_NO_DNS: the domain has no mail server) can never be sent to, even when approved.
 */
export type DeliverabilityStatus = 'SAFE_TO_SEND' | 'REVIEW_REQUIRED' | 'TECHNICAL_ONLY' | 'EXCLUDED' | 'UNDELIVERABLE' | 'UNKNOWN'

/** Where a contact is in this desk's own sending. There is no "opened": nothing here can see that. */
export type SendStatus = 'QUEUED' | 'SENDING' | 'SENT' | 'FAILED' | 'OPTED_OUT'

export interface Contact {
  id: string
  serial: number
  /** The group's name ("Power Generation Utilities & …"), from the summary sheet or a GROUP banner; '' when none. */
  sectorGroup: string
  /** The group's number in the workbook (GROUP 3 → 3), or null. */
  groupNo: number | null
  organization: string
  /** '' when the workbook names no person; the greeting then reads "Sir/Madam". */
  personName: string
  designation: string
  email: string
  phone: string
  /** The sheet's purpose tags (MAGAZINE_DISTRIBUTION, SPONSORSHIP, …), as written. */
  purposes: string[]
  mxHost?: string
  /** As the workbook states it, mapped (see DeliverabilityStatus); `rawStatus` keeps the sheet's own word. */
  mxStatus: DeliverabilityStatus
  rawStatus: string
  /** The sheet's "Diagnostic Issue & Recommended Action" for this address, if any. */
  diagnostic: string
  /** The sheet the contact was read from. */
  sheet: string
  /** The editor approved this address by hand (stored per address). */
  approved: boolean
  status: SendStatus
  sentAt?: number
  error?: string
}

export type OutreachBlueprintId =
  | 'magazine_distribution'
  | 'corporate_sponsorship'
  | 'executive_interview'
  | 'breaking_intelligence'
  | 'institutional_dialogue'
  | 'custom_pitch'

export interface OutreachBlueprint {
  id: OutreachBlueprintId
  label: string
  tag: string
  defaultSubject: string
  defaultBody: string
  bengaliSubject: string
  bengaliBody: string
}

export interface AttachmentItem {
  id: string
  name: string
  size: number
  mimeType: string
  dataUrl: string
}

export type OutreachLang = 'en' | 'bn'

/** A talking point the Research AI took from a source. `quote` is the source's own sentence, checked to be in it. */
export interface TalkingPoint { id: string; text: string; quote: string; use: boolean }

/** Material a campaign draws on: an Editorial story, a web page, a PDF/Word file, or pasted text. */
export interface Source {
  id: string
  kind: 'story' | 'link' | 'file' | 'text'
  title: string
  url?: string
  /** The source's own text (capped at 24,000 characters), what the AI reads and what quotes are checked against. */
  text: string
  points: TalkingPoint[]
  addedAt: number
}

export interface Signature { id: string; name: string; text: string }
export interface Template { id: string; name: string; lang: OutreachLang; subject: string; body: string; savedAt: number }

export type CampaignStatus = 'draft' | 'scheduled' | 'sending' | 'paused' | 'done'

/**
 * One campaign: who (a list + sheet + group + purposes, or typed addresses for an ordinary email), what (letter,
 * signature, letterhead, sources), when (now or a scheduled time) and what happened (per-address results).
 */
export interface Campaign {
  id: string
  name: string
  createdAt: number
  updatedAt: number
  status: CampaignStatus
  kind: 'list' | 'direct'
  listId: string | null
  sheet: string
  audience: { group: number | null; purposes: string[] }
  /** For kind 'direct': the addresses typed in. */
  recipients: string[]
  blueprint: OutreachBlueprintId | 'template' | 'blank'
  lang: OutreachLang
  subject: string
  body: string
  signatureId: string
  letterhead: boolean
  sources: Source[]
  scheduledAt: number | null
  sent: Record<string, number>
  failed: Record<string, string>
}

/** A saved workbook (its rows live in IndexedDB under `list:{id}`). */
export interface ListMeta { id: string; fileName: string; addedAt: number; sheets: { name: string; contacts: number }[] }
