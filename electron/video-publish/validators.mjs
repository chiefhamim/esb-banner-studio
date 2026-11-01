// ESB Studio — Video Desk Pro, Phase 7: platform checks for a render and its post, before anything is uploaded.
//
// Pure functions, no Node or DOM imports, so the renderer (the Publish sheet) and the main process (checked again
// right before upload) run the same rules. Main loads this ESM file with `await import()`; the renderer imports it
// directly (types in validators.d.mts).
//
// Input is a media facts object the Phase 7 session fills from mediabunny:
//   { durationSec, width, height, fps, fpsMode?: 'constant'|'variable', fpsMin?, fpsMax?, videoCodec, gopSec?,
//     closedGop?, audioCodec?, audioProfile?, audioSampleRate?, audioChannels?, audioBitrate?, fileSize? }
// Every answer is { ok, problems: [{ code, message }], warnings: [{ code, message }] } in words an editor can act on.
// A fact that is missing is a warning (it could not be checked), never a silent pass and never an invented value.
//
// Specs as checked 2026-11-01 (docs/VIDEO_PRO_PLAN.md, PHASE 7). Re-check them against the platform docs when they move.

export const REEL_SPEC = Object.freeze({
  aspect: 9 / 16,
  minWidth: 540,
  minHeight: 960,
  minFps: 24,
  maxFps: 60,
  minSec: 3,
  maxSec: 90,
  codecs: ['h264', 'h265'],
  minGopSec: 2,
  maxGopSec: 5,
  audioSampleRate: 48000,
  audioChannels: 2,
  minAudioBitrate: 128000,
})

export const YOUTUBE_SPEC = Object.freeze({
  maxBytes: 256 * 1024 ** 3,
  maxSec: 12 * 3600,
  /** Channels that have not verified a phone number may upload up to 15 minutes. */
  unverifiedMaxSec: 15 * 60,
  /** Shorts: vertical or square, up to 3 minutes (since 2024-10-15). Verify at implementation time. */
  shortsMaxSec: 180,
  titleMaxChars: 100,
  descriptionMaxBytes: 5000,
  tagsMaxChars: 500,
})

export const FACEBOOK_SPEC = Object.freeze({
  minScheduleMs: 10 * 60 * 1000,
  maxScheduleMs: 29 * 24 * 3600 * 1000,
  states: ['PUBLISHED', 'SCHEDULED', 'DRAFT'],
})

const AI_VOICE_NOTE = /\bAI voice\b|এআই ভয়েস|কৃত্রিম কণ্ঠ/i

/** mediabunny and ffprobe names for the same codecs. */
export function normalizeVideoCodec(c) {
  const s = String(c ?? '').toLowerCase()
  if (/^(avc|avc1|avc3|h\.?264)/.test(s)) return 'h264'
  if (/^(hevc|hvc1|hev1|h\.?265)/.test(s)) return 'h265'
  if (/^(vp09|vp9)/.test(s)) return 'vp9'
  if (/^(av01|av1)/.test(s)) return 'av1'
  return s || ''
}
export function normalizeAudioCodec(c) {
  const s = String(c ?? '').toLowerCase()
  if (/^(aac|mp4a)/.test(s)) return 'aac'
  return s || ''
}

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const fmtSec = (s) => (s >= 60 ? `${Math.floor(s / 60)} min ${Math.round(s % 60)} s` : `${Math.round(s * 10) / 10} s`)

function result(problems, warnings) {
  return { ok: problems.length === 0, problems, warnings }
}

/** True when the frame rate is known to change through the file. */
function isVariableFps(f) {
  if (f.fpsMode === 'variable') return true
  const lo = num(f.fpsMin)
  const hi = num(f.fpsMax)
  if (lo !== null && hi !== null && hi - lo > Math.max(0.01, 0.005 * hi)) return true
  return false
}

/** Facebook Reels: 9:16, ≥540×960, 24–60 fps fixed, 3–90 s, H.264/H.265, closed GOP 2–5 s, AAC-LC 48 kHz stereo ≥128 kbps. */
export function validateReel(facts) {
  const f = facts && typeof facts === 'object' ? facts : {}
  const P = []
  const W = []
  const p = (code, message) => P.push({ code, message })
  const w = (code, message) => W.push({ code, message })

  const width = num(f.width)
  const height = num(f.height)
  if (width === null || height === null) p('size-unknown', 'The picture size of this render is not known, so it cannot be checked for Reels.')
  else {
    if (Math.abs(width / height - REEL_SPEC.aspect) > 0.01) p('aspect', `A Reel must be 9:16 (vertical). This render is ${width}×${height}.`)
    if (width < REEL_SPEC.minWidth || height < REEL_SPEC.minHeight) p('too-small', `A Reel must be at least 540×960 (1080×1920 is recommended). This render is ${width}×${height}.`)
  }

  const fps = num(f.fps)
  if (isVariableFps(f)) p('variable-fps', `A Reel needs a fixed frame rate. This file's frame rate varies${num(f.fpsMin) !== null ? ` (${f.fpsMin}–${f.fpsMax} fps)` : ''}. Export it again at a fixed 25, 30 or 60 fps.`)
  if (fps === null) p('fps-unknown', 'The frame rate of this render is not known, so it cannot be checked for Reels.')
  else if (fps < REEL_SPEC.minFps - 0.01 || fps > REEL_SPEC.maxFps + 0.01) p('fps', `A Reel must be 24–60 fps. This render is ${Math.round(fps * 100) / 100} fps.`)
  if (fps !== null && !f.fpsMode && num(f.fpsMin) === null) w('fps-mode-unknown', 'Could not tell whether the frame rate is fixed; Reels need a fixed rate.')

  const d = num(f.durationSec)
  if (d === null) p('duration-unknown', 'The length of this render is not known, so it cannot be checked for Reels.')
  else if (d < REEL_SPEC.minSec) p('too-short', `A Reel must be at least 3 s. This render is ${fmtSec(d)}.`)
  else if (d > REEL_SPEC.maxSec + 0.05) p('too-long', `A Reel can be at most 90 s. This render is ${fmtSec(d)}: trim ${fmtSec(d - REEL_SPEC.maxSec)} or post it as a feed video.`)

  const vc = normalizeVideoCodec(f.videoCodec)
  if (!vc) p('codec-unknown', 'The video codec of this render is not known, so it cannot be checked for Reels.')
  else if (!REEL_SPEC.codecs.includes(vc)) p('codec', `A Reel must be H.264 or H.265. This render is ${vc.toUpperCase()}.`)

  const gop = num(f.gopSec)
  if (f.closedGop === false) p('open-gop', 'A Reel needs a closed GOP (each keyframe group stands alone). Export it again with closed GOPs.')
  if (gop === null) w('gop-unknown', 'The keyframe spacing (GOP) could not be read; Reels want a keyframe every 2–5 s.')
  else if (gop < REEL_SPEC.minGopSec - 0.01 || gop > REEL_SPEC.maxGopSec + 0.01) p('gop', `A Reel wants a keyframe every 2–5 s. This render has one every ${Math.round(gop * 100) / 100} s.`)
  if (f.closedGop === undefined && gop !== null) w('closed-gop-unknown', 'Could not tell whether the GOPs are closed.')

  const ac = normalizeAudioCodec(f.audioCodec)
  if (!ac) w('no-audio', 'This render has no sound track (or it could not be read). Reels expect AAC stereo sound.')
  else {
    if (ac !== 'aac') p('audio-codec', `Reel sound must be AAC-LC. This render's sound is ${ac.toUpperCase()}.`)
    else if (f.audioProfile && !/^(lc|aac[-_ ]?lc|2|mp4a\.40\.2)$/i.test(String(f.audioProfile))) p('audio-profile', `Reel sound must be AAC-LC. This render's sound is AAC ${f.audioProfile}.`)
    const rate = num(f.audioSampleRate)
    if (rate === null) w('audio-rate-unknown', 'The sound sample rate could not be read; Reels want 48 kHz.')
    else if (rate !== REEL_SPEC.audioSampleRate) p('audio-rate', `Reel sound must be 48 kHz. This render's sound is ${rate / 1000} kHz.`)
    const ch = num(f.audioChannels)
    if (ch === null) w('audio-channels-unknown', 'The number of sound channels could not be read; Reels want stereo.')
    else if (ch !== REEL_SPEC.audioChannels) p('audio-channels', `Reel sound must be stereo (2 channels). This render's sound has ${ch}.`)
    const br = num(f.audioBitrate)
    if (br === null) w('audio-bitrate-unknown', 'The sound bitrate could not be read; Reels want at least 128 kbps.')
    else if (br < REEL_SPEC.minAudioBitrate) p('audio-bitrate', `Reel sound must be at least 128 kbps. This render's sound is ${Math.round(br / 1000)} kbps.`)
  }
  return result(P, W)
}

/** YouTube upload basics. `opts.verifiedChannel` false warns over 15 minutes. */
export function validateYouTubeMedia(facts, opts = {}) {
  const f = facts && typeof facts === 'object' ? facts : {}
  const P = []
  const W = []
  const d = num(f.durationSec)
  if (d === null) P.push({ code: 'duration-unknown', message: 'The length of this render is not known.' })
  else if (d <= 0) P.push({ code: 'empty', message: 'This render has no length.' })
  else if (d > YOUTUBE_SPEC.maxSec) P.push({ code: 'too-long', message: `YouTube takes videos up to 12 hours. This render is ${fmtSec(d)}.` })
  else if (d > YOUTUBE_SPEC.unverifiedMaxSec && opts.verifiedChannel !== true) W.push({ code: 'needs-verified', message: 'Videos over 15 minutes need a verified YouTube channel (phone verification in YouTube Studio).' })
  const size = num(f.fileSize)
  if (size !== null && size > YOUTUBE_SPEC.maxBytes) P.push({ code: 'too-big', message: 'YouTube takes files up to 256 GB.' })
  const width = num(f.width)
  const height = num(f.height)
  if (width === null || height === null || width <= 0 || height <= 0) P.push({ code: 'size-unknown', message: 'The picture size of this render is not known.' })
  const vc = normalizeVideoCodec(f.videoCodec)
  if (!vc) W.push({ code: 'codec-unknown', message: 'The video codec could not be read.' })
  if (isVariableFps(f)) W.push({ code: 'variable-fps', message: 'The frame rate varies; YouTube accepts it but a fixed rate plays smoother.' })
  if (!normalizeAudioCodec(f.audioCodec)) W.push({ code: 'no-audio', message: 'This render has no sound track (or it could not be read).' })
  const vertical = width !== null && height !== null && height >= width
  const short = vertical && d !== null && d <= YOUTUBE_SPEC.shortsMaxSec
  return { ...result(P, W), short }
}

const codepoints = (s) => [...String(s)].length
const utf8Bytes = (s) => new TextEncoder().encode(String(s)).length

/** YouTube's own counting: tags are joined with commas, and a tag with a space counts its quotes. */
export function youtubeTagsLength(tags) {
  const list = (Array.isArray(tags) ? tags : []).map((t) => String(t).trim()).filter(Boolean)
  return list.reduce((n, t) => n + codepoints(t) + (/\s/.test(t) ? 2 : 0), 0) + Math.max(0, list.length - 1)
}

/**
 * Build the videos.insert resource (snippet + status) from the Publish sheet's fields, or say what is wrong.
 * meta: { title, description, tags[], categoryId, defaultLanguage, privacyStatus, publishAt (ISO), aiVoice }
 */
export function buildYouTubeResource(meta, now = Date.now()) {
  const m = meta && typeof meta === 'object' ? meta : {}
  const P = []
  const W = []
  const p = (code, message) => P.push({ code, message })
  const title = String(m.title ?? '').replace(/\s+/g, ' ').trim()
  const description = String(m.description ?? '').replace(/\r\n/g, '\n')
  if (!title) p('title-empty', 'The YouTube title is empty.')
  else if (codepoints(title) > YOUTUBE_SPEC.titleMaxChars) p('title-long', `The YouTube title is ${codepoints(title)} characters; YouTube allows 100.`)
  if (/[<>]/.test(title)) p('title-angle', 'YouTube does not accept < or > in a title.')
  if (utf8Bytes(description) > YOUTUBE_SPEC.descriptionMaxBytes) p('description-long', `The description is ${utf8Bytes(description)} bytes; YouTube allows 5,000 (Bangla letters take 3 bytes each).`)
  if (/[<>]/.test(description)) p('description-angle', 'YouTube does not accept < or > in a description.')
  const tags = (Array.isArray(m.tags) ? m.tags : []).map((t) => String(t).replace(/\s+/g, ' ').trim()).filter(Boolean)
  if (tags.some((t) => /[<>,]/.test(t))) p('tag-chars', 'A tag may not contain <, > or a comma.')
  const tagLen = youtubeTagsLength(tags)
  if (tagLen > YOUTUBE_SPEC.tagsMaxChars) p('tags-long', `The tags come to ${tagLen} characters; YouTube allows 500 in all.`)
  const categoryId = String(m.categoryId ?? '25')
  if (!/^\d{1,3}$/.test(categoryId)) p('category', 'The YouTube category is not valid.')
  const lang = String(m.defaultLanguage ?? '').trim()
  if (lang && !/^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/.test(lang)) p('language', `"${lang}" is not a language code (use bn or en).`)
  let privacyStatus = String(m.privacyStatus ?? 'private')
  if (!['private', 'unlisted', 'public'].includes(privacyStatus)) p('privacy', 'Privacy must be private, unlisted or public.')
  let publishAt = null
  if (m.publishAt) {
    const t = Date.parse(String(m.publishAt))
    if (!Number.isFinite(t)) p('publish-at', 'The scheduled time is not a date.')
    else if (t <= now + 60_000) p('publish-at-past', 'The scheduled time must be in the future.')
    else {
      publishAt = new Date(t).toISOString()
      // YouTube: publishAt can only be set while the video is private; it turns public at that time.
      if (privacyStatus !== 'private') W.push({ code: 'publish-at-private', message: 'A scheduled YouTube video is uploaded as private and turns public at the set time.' })
      privacyStatus = 'private'
    }
  }
  if (m.aiVoice && !AI_VOICE_NOTE.test(description)) p('ai-voice-note', 'This video uses an AI voice: the description must say so ("AI voice").')
  if (P.length) return { ...result(P, W), resource: null }
  const snippet = { title, description, tags, categoryId }
  if (lang) { snippet.defaultLanguage = lang; snippet.defaultAudioLanguage = lang }
  const status = { privacyStatus, selfDeclaredMadeForKids: false, containsSyntheticMedia: !!m.aiVoice }
  if (publishAt) status.publishAt = publishAt
  return { ...result(P, W), resource: { snippet, status } }
}

/** Facebook post fields: state, schedule window (10 min – 29 days ahead), AI voice disclosure. */
export function checkFacebookPost(meta, now = Date.now()) {
  const m = meta && typeof meta === 'object' ? meta : {}
  const P = []
  const state = String(m.state ?? 'DRAFT')
  if (!FACEBOOK_SPEC.states.includes(state)) P.push({ code: 'state', message: 'A Facebook post must be PUBLISHED, SCHEDULED or DRAFT.' })
  let scheduledTime = null
  if (state === 'SCHEDULED') {
    const t = Date.parse(String(m.scheduledAt ?? ''))
    if (!Number.isFinite(t)) P.push({ code: 'schedule-missing', message: 'A scheduled Facebook post needs a time.' })
    else if (t - now < FACEBOOK_SPEC.minScheduleMs) P.push({ code: 'schedule-soon', message: 'Facebook needs a scheduled post at least 10 minutes ahead.' })
    else if (t - now > FACEBOOK_SPEC.maxScheduleMs) P.push({ code: 'schedule-far', message: 'Facebook schedules a video at most 29 days ahead.' })
    else scheduledTime = Math.floor(t / 1000)
  }
  const description = String(m.description ?? '')
  if (description.length > 63206) P.push({ code: 'description-long', message: 'The Facebook text is too long.' })
  if (m.aiVoice && !AI_VOICE_NOTE.test(description)) P.push({ code: 'ai-voice-note', message: 'This video uses an AI voice: the Facebook text must say so ("AI voice").' })
  return { ok: P.length === 0, problems: P, warnings: [], scheduledTime, state }
}
