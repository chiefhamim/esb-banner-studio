// Publishing an article that already exists must update it, and each story keeps its own activity history.
import { describe, expect, it } from 'vitest'
import { htmlToBody, bodyToHtml } from '../../src/editorial/siteApi'
import { jobsOf, trimJobs, KEEP_PER_STORY } from '../../src/editorial/jobLog'
import type { Job } from '../../src/editorial/jobLog'
import { facebookError } from '../../src/editorial/facebook'

const job = (id: number, story: string): Job => ({ id, story, kind: 'story', title: 't', by: '', start: id, end: id + 1, steps: [{ label: 'a', start: id, end: id + 1 }] })

describe('per-story activity', () => {
  it('shows only the jobs of one story', () => {
    const all = [job(3, 'b'), job(2, 'a'), job(1, 'a')]
    expect(jobsOf(all, 'a').map((j) => j.id)).toEqual([2, 1])
    expect(jobsOf(all, 'b').map((j) => j.id)).toEqual([3])
  })
  it('keeps at most KEEP_PER_STORY per story, newest first, without crowding other stories out', () => {
    const many = Array.from({ length: KEEP_PER_STORY + 5 }, (_, i) => job(100 - i, 'a'))
    const kept = trimJobs([job(200, 'b'), ...many])
    expect(jobsOf(kept, 'a')).toHaveLength(KEEP_PER_STORY)
    expect(jobsOf(kept, 'b')).toHaveLength(1)
  })
})

describe('article body round trip', () => {
  it('turns the site HTML back into the desk text', () => {
    expect(htmlToBody('<p>One &amp; two</p>\n<p>Three<br />four</p><p>&nbsp;</p>')).toBe('One & two\n\nThree\nfour')
  })
  it('survives the trip desk → site → desk', () => {
    const text = 'First paragraph.\n\nSecond <b> paragraph.'
    expect(htmlToBody(bodyToHtml(text))).toBe(text)
  })
})

describe('facebook errors', () => {
  it('explains an expired token and a missing permission in words', () => {
    expect(facebookError(400, { error: { code: 190, message: 'x' } })).toMatch(/expired/)
    expect(facebookError(403, { error: { code: 200, message: 'x' } })).toMatch(/pages_manage_posts/)
    expect(facebookError(500, null)).toMatch(/HTTP 500/)
  })
})
