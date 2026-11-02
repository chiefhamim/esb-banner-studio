// Types for validators.mjs, so the renderer's Publish sheet (Phase 7) can import the same checks.
export interface MediaFacts {
  durationSec?: number
  width?: number
  height?: number
  fps?: number
  fpsMode?: 'constant' | 'variable'
  fpsMin?: number
  fpsMax?: number
  videoCodec?: string
  gopSec?: number
  closedGop?: boolean
  audioCodec?: string
  audioProfile?: string
  audioSampleRate?: number
  audioChannels?: number
  audioBitrate?: number
  fileSize?: number
}
export interface Finding { code: string; message: string }
export interface CheckResult { ok: boolean; problems: Finding[]; warnings: Finding[] }
export interface YouTubeMeta {
  title?: string
  description?: string
  tags?: string[]
  categoryId?: string
  defaultLanguage?: string
  privacyStatus?: 'private' | 'unlisted' | 'public'
  publishAt?: string | null
  aiVoice?: boolean
}
export interface YouTubeResource {
  snippet: { title: string; description: string; tags: string[]; categoryId: string; defaultLanguage?: string; defaultAudioLanguage?: string }
  status: { privacyStatus: 'private' | 'unlisted' | 'public'; selfDeclaredMadeForKids: false; containsSyntheticMedia: boolean; publishAt?: string }
}
export interface FacebookMeta { state?: 'PUBLISHED' | 'SCHEDULED' | 'DRAFT'; scheduledAt?: string | null; description?: string; aiVoice?: boolean }

export declare const REEL_SPEC: Readonly<Record<string, number | string[]>>
export declare const YOUTUBE_SPEC: Readonly<Record<string, number>>
export declare const FACEBOOK_SPEC: Readonly<{ minScheduleMs: number; maxScheduleMs: number; states: string[] }>
export declare function normalizeVideoCodec(c: unknown): string
export declare function normalizeAudioCodec(c: unknown): string
export declare function validateReel(facts: MediaFacts): CheckResult
export declare function validateYouTubeMedia(facts: MediaFacts, opts?: { verifiedChannel?: boolean }): CheckResult & { short: boolean }
export declare function youtubeTagsLength(tags: string[]): number
export declare function buildYouTubeResource(meta: YouTubeMeta, now?: number): CheckResult & { resource: YouTubeResource | null }
export declare function checkFacebookPost(meta: FacebookMeta, now?: number): CheckResult & { scheduledTime: number | null; state: string }
