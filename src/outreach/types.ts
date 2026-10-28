export type DeliverabilityStatus = 'SAFE_TO_SEND' | 'REVIEW_REQUIRED' | 'TECHNICAL_ONLY' | 'EXCLUDED'

export type TrackingStatus = 'QUEUED' | 'SENDING' | 'SENT' | 'OPENED' | 'CLICKED' | 'REPLIED' | 'BOUNCED' | 'FAILED'

export interface Contact {
  id: string
  serial: number
  sectorGroup: string
  organization: string
  personName: string
  designation: string
  email: string
  phone: string
  purpose: string
  mxHost?: string
  mxStatus: DeliverabilityStatus
  trackingStatus: TrackingStatus
  sentAt?: string
  openedAt?: string
  openCount: number
  lastViewedAt?: string
  clickCount: number
  error?: string
  attempts: number
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
  dataUrl?: string
  path?: string
  isInline?: boolean
  cid?: string
}

export interface CampaignConfig {
  senderName: string
  senderEmail: string
  senderPassword?: string
  smtpHost: string
  smtpPort: number
  secure: boolean
  dailyLimit: number
  minDelaySec: number
  maxDelaySec: number
  trackingEndpoint: string
  enableOpenTracking: boolean
  enableClickTracking: boolean
  autoAddGraphicsBanner: boolean
  autoAddEditorialStory: boolean
}

export interface TrackingLogEntry {
  id: string
  trackingId: string
  email: string
  event: 'sent' | 'open' | 'click'
  timestamp: string
  userAgent?: string
  ip?: string
  url?: string
}
