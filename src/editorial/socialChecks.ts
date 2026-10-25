// The social checklist: what makes a caption work on each channel today, checked on the captions as written. There is
// no Google rule for social, so every item is marked as practice: Facebook shows about two short lines before "See
// more" and ranks a post by early engagement, so a short human caption with its tags on one last line and the link in the
// first comment wins; X counts links as 23 characters of 280 and does best with at most two tags; LinkedIn's feed folds
// after about three lines and takes three to five tags; Telegram readers want the headline first and the link.

import { articleUrl, xLength } from './aiDesk'
import type { Captions } from './aiDesk'

export type SocialId = keyof Captions
export interface SocialCheck {
  id: string
  platform: SocialId
  status: 'good' | 'warn' | 'bad'
  label: string
  detail: string
  why: string
}

const LINK = /https?:\/\/\S+/i
const tagsIn = (t: string) => t.match(/#[\p{L}\p{N}_]+/gu) ?? []
const emojiCount = (t: string) => (t.match(/\p{Extended_Pictographic}/gu) ?? []).length
const textOnly = (t: string) => t.replace(/#[\p{L}\p{N}_]+/gu, ' ').replace(LINK, ' ').replace(/[ \t]+/g, ' ').trim()

export function analyzeSocial(c: Captions, slug: string): SocialCheck[] {
  const url = articleUrl(slug)
  const out: SocialCheck[] = []
  const add = (platform: SocialId, id: string, label: string, ok: boolean, goodDetail: string, badDetail: string, why: string, level: 'warn' | 'bad' = 'warn') =>
    out.push({ id, platform, label, status: ok ? 'good' : level, detail: ok ? goodDetail : badDetail, why })

  // Facebook — the Page post under the banner
  const fb = c.facebook ?? ''
  const fbText = textOnly(fb)
  const fbTags = tagsIn(fb)
  const lastLine = fb.trim().split('\n').pop() ?? ''
  add('facebook', 'fb-nolink', 'No link in the caption', !LINK.test(fb), 'The link goes in the first comment.', 'The caption has a link; Facebook gives link text less reach and the Studio posts the link as a comment.', 'Posts with the link in a comment keep the caption clean and short.', 'bad')
  add('facebook', 'fb-length', 'Fits without “See more”', fbText.length > 0 && fbText.length <= 125, `${fbText.length} characters.`, fbText.length ? `${fbText.length} characters — over 125, so Facebook folds it behind “See more”.` : 'Empty.', 'Two short lines show in full on phone and desktop.')
  add('facebook', 'fb-lines', 'One or two lines', textOnly(fb).split('\n').filter(Boolean).length <= 2, 'Short enough to scan.', 'More than two lines of text — cut it to the one strongest fact.', 'A scannable hook beats a paragraph.')
  add('facebook', 'fb-tags', 'Hashtags: 3–5, one last line', fbTags.length >= 3 && fbTags.length <= 5 && tagsIn(lastLine).length === fbTags.length, `${fbTags.length} hashtags on the last line.`, fbTags.length < 3 ? `${fbTags.length} hashtag${fbTags.length === 1 ? '' : 's'} — add 3 to 5 specific ones.` : fbTags.length > 5 ? `${fbTags.length} hashtags — keep the 5 that matter.` : 'Put every hashtag together on the last line.', 'A few specific tags help discovery; piles of them look spammy.')
  add('facebook', 'fb-brand', 'Ends with #ESBPowerLine', /#esbpowerline\s*$/i.test(fb.trim()), 'Brand tag closes the line.', 'End the hashtag line with #ESBPowerLine.', 'One consistent brand tag makes the Page searchable.')
  const giveaways = /—|–\s|\bbreaking\b|\bmoreover\b|\bgame-?changer\b|here['’]s what|\bclick\b|read more|link in (the )?(bio|comments?)/i.test(fb) || /\b[A-Z]{5,}\b/.test(fbText) || emojiCount(fb) > 1
  add('facebook', 'fb-human', 'Reads like a person', !giveaways, 'No machine-writing giveaways.', 'Remove em dashes, “Breaking”, “click / read more”, ALL-CAPS words and extra emoji.', 'Plain, specific writing outperforms hype and reads as human.')

  // X
  const x = c.x ?? ''
  add('x', 'x-len', 'Within 280', xLength(x) <= 280 && x.trim().length > 0, `${xLength(x)} of 280 (a link counts 23).`, `${xLength(x)} of 280 — shorten it.`, 'X cuts anything longer.', 'bad')
  add('x', 'x-link', 'Has the article link', x.includes(url), 'Links to the article.', 'Add the article link.', 'Readers need a way to the full story.', 'bad')
  add('x', 'x-tags', 'At most 2 hashtags', tagsIn(x).length <= 2, `${tagsIn(x).length} hashtag${tagsIn(x).length === 1 ? '' : 's'}.`, `${tagsIn(x).length} hashtags — X posts do best with one or two.`, 'More tags lower engagement on X.')

  // LinkedIn
  const li = c.linkedin ?? ''
  add('linkedin', 'li-len', 'Under 1,300 characters', li.length > 0 && li.length <= 1300, `${li.length} characters.`, li.length ? `${li.length} characters — LinkedIn folds long posts.` : 'Empty.', 'The feed shows about three lines before “…see more”.')
  add('linkedin', 'li-link', 'Has the article link', li.includes(url), 'Links to the article.', 'Add the article link.', 'Readers need a way to the full story.', 'bad')
  add('linkedin', 'li-tags', 'Hashtags: 3–5', tagsIn(li).length >= 3 && tagsIn(li).length <= 5, `${tagsIn(li).length} hashtags.`, `${tagsIn(li).length} hashtags — use 3 to 5.`, 'A few topic tags place the post in LinkedIn’s topic feeds.')

  // Telegram
  const tg = c.telegram ?? ''
  const first = tg.split('\n').find((l) => l.trim()) ?? ''
  add('telegram', 'tg-link', 'Has the article link', tg.includes(url), 'Links to the article.', 'Add the article link.', 'Channel readers tap straight to the story.', 'bad')
  add('telegram', 'tg-head', 'Headline first', first.replace(/[*_📰\s]/g, '').length >= 10 && first.length <= 160, 'Starts with the headline.', 'Start with the headline on the first line (under 160 characters).', 'Telegram previews show the first line.')
  return out
}

/** Short lines for the AI: which checks fail and why. */
export const socialFixList = (checks: SocialCheck[]) => checks.filter((c) => c.status !== 'good').map((c) => `- ${c.platform}: ${c.label} — ${c.detail}`)
