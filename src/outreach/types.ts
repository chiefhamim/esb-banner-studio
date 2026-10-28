/** What the workbook says about an address. An empty status cell is UNKNOWN — never assumed safe. */
export type DeliverabilityStatus = 'SAFE_TO_SEND' | 'REVIEW_REQUIRED' | 'TECHNICAL_ONLY' | 'EXCLUDED' | 'UNKNOWN'

/** Where a contact is in this desk's own sending. There is no "opened": nothing here can see that. */
export type SendStatus = 'QUEUED' | 'SENDING' | 'SENT' | 'FAILED' | 'OPTED_OUT'

export interface Contact {
  id: string
  serial: number
  sectorGroup: string
  organization: string
  /** '' when the workbook names no person; the greeting then reads "Sir/Madam". */
  personName: string
  designation: string
  email: string
  phone: string
  purpose: string
  mxHost?: string
  /** As the workbook states it. */
  mxStatus: DeliverabilityStatus
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
