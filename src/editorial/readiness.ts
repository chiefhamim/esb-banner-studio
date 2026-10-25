// What stands between this story and "publish": a short, honest list worked out from the draft itself — not a score for show.
// "Required" items would make the article wrong or unpublishable; "Quality" items are what a careful editor would still check.
// Every item says what is wrong in one line and where to fix it, so the sidebar can take the editor straight there.

import type { SeoCheck } from './seo'

export type ReadyStatus = 'ok' | 'warn' | 'bad'
export type ReadyFix = 'headline' | 'deck' | 'body' | 'facts' | 'seo' | 'photo' | 'tags' | 'sign-in' | 'site' | 'bengali'

export interface ReadyCheck {
  id: string
  group: 'Required' | 'Quality'
  status: ReadyStatus
  label: string
  detail: string
  fix?: ReadyFix
}

export interface ReadyInput {
  headline: string
  deck: string
  body: string
  words: number
  hasImage: boolean
  imageAlt: string
  tagCount: number
  /** Figures, quotes or dates in the draft that the source does not contain. */
  unverified: number
  seo: Pick<SeoCheck, 'status' | 'label'>[]
  signedIn: boolean
  siteOnline: boolean
  /** Only a signed-in editor in the desktop app can upload the banner; the browser preview publishes without one. */
  canUpload: boolean
}

const BENGALI = /[ঀ-৿]/

export interface Readiness {
  checks: ReadyCheck[]
  /** Required items not met. */
  blockers: number
  /** Quality items that still need a look. */
  warnings: number
  ok: number
  total: number
  /** 'ready' (nothing to do), 'review' (only quality items), 'blocked' (a required item is open). */
  state: 'ready' | 'review' | 'blocked'
}

export function buildReadiness(i: ReadyInput): Readiness {
  const checks: ReadyCheck[] = []
  const add = (c: ReadyCheck) => checks.push(c)
  const h = i.headline.trim().length

  add(!h
    ? { id: 'headline', group: 'Required', status: 'bad', label: 'Headline', detail: 'Write the headline readers will see.', fix: 'headline' }
    : h > 104
      ? { id: 'headline', group: 'Required', status: 'bad', label: 'Headline', detail: `${h} characters; the site takes 104.`, fix: 'headline' }
      : { id: 'headline', group: 'Required', status: 'ok', label: 'Headline', detail: `${h} of 104 characters.` })

  add(i.deck.trim().length > 200
    ? { id: 'deck', group: 'Required', status: 'bad', label: 'Deck', detail: `${i.deck.trim().length} characters; the site takes 200.`, fix: 'deck' }
    : !i.deck.trim()
      ? { id: 'deck', group: 'Quality', status: 'warn', label: 'Deck', detail: 'No standfirst; the site will show the start of the story.', fix: 'deck' }
      : { id: 'deck', group: 'Quality', status: 'ok', label: 'Deck', detail: `${i.deck.trim().length} of 200 characters.` })

  add(i.words < 40
    ? { id: 'body', group: 'Required', status: 'bad', label: 'Story', detail: i.words ? `Only ${i.words} words so far.` : 'The story is empty.', fix: 'body' }
    : { id: 'body', group: 'Required', status: 'ok', label: 'Story', detail: `${i.words} words.` })

  if (BENGALI.test(`${i.headline} ${i.deck} ${i.body}`)) {
    add({ id: 'bengali', group: 'Required', status: 'bad', label: 'English only', detail: 'Bengali text is still in the story; translate it first.', fix: 'bengali' })
  }

  add(i.siteOnline
    ? { id: 'site', group: 'Required', status: 'ok', label: 'Website reachable', detail: 'esbpowerline.com answered.' }
    : { id: 'site', group: 'Required', status: 'bad', label: 'Website reachable', detail: 'esbpowerline.com is not answering.', fix: 'site' })

  add(i.signedIn
    ? { id: 'signin', group: 'Required', status: 'ok', label: 'Signed in', detail: 'You can publish as yourself.' }
    : { id: 'signin', group: 'Required', status: 'bad', label: 'Signed in', detail: 'Sign in with your newsroom account to publish.', fix: 'sign-in' })

  add(i.unverified
    ? { id: 'facts', group: 'Quality', status: 'warn', label: 'Figures match the source', detail: `${i.unverified} figure${i.unverified === 1 ? '' : 's'} or quote${i.unverified === 1 ? '' : 's'} not found in the source.`, fix: 'facts' }
    : { id: 'facts', group: 'Quality', status: 'ok', label: 'Figures match the source', detail: 'Every figure was found in the original.' })

  const seoBad = i.seo.filter((c) => c.status === 'bad').length
  const seoWarn = i.seo.filter((c) => c.status === 'warn').length
  add(seoBad || seoWarn
    ? { id: 'seo', group: 'Quality', status: seoBad ? 'bad' : 'warn', label: 'Search (SEO)', detail: `${i.seo.length - seoBad - seoWarn} of ${i.seo.length} checks pass${seoBad ? `; ${seoBad} need fixing` : ''}.`, fix: 'seo' }
    : { id: 'seo', group: 'Quality', status: 'ok', label: 'Search (SEO)', detail: `All ${i.seo.length} checks pass.` })

  add(!i.hasImage
    ? { id: 'photo', group: 'Quality', status: 'warn', label: 'Photo', detail: 'No photo on the banner yet.', fix: 'photo' }
    : !i.imageAlt.trim()
      ? { id: 'photo', group: 'Quality', status: 'warn', label: 'Photo', detail: 'Add alt text so the picture is described.', fix: 'photo' }
      : { id: 'photo', group: 'Quality', status: 'ok', label: 'Photo', detail: 'Set, with alt text.' })

  add(i.tagCount < 3
    ? { id: 'tags', group: 'Quality', status: 'warn', label: 'Tags', detail: i.tagCount ? `${i.tagCount} tag${i.tagCount === 1 ? '' : 's'}; three or more help readers find it.` : 'No tags yet.', fix: 'tags' }
    : { id: 'tags', group: 'Quality', status: 'ok', label: 'Tags', detail: `${i.tagCount} tags.` })

  if (!i.canUpload) {
    add({ id: 'upload', group: 'Quality', status: 'warn', label: 'Banner upload', detail: 'Only the desktop app uploads the banner; here the original photo link is used.' })
  }

  const blockers = checks.filter((c) => c.group === 'Required' && c.status !== 'ok').length
  const warnings = checks.filter((c) => c.group === 'Quality' && c.status !== 'ok').length
  const ok = checks.filter((c) => c.status === 'ok').length
  return { checks, blockers, warnings, ok, total: checks.length, state: blockers ? 'blocked' : warnings ? 'review' : 'ready' }
}
