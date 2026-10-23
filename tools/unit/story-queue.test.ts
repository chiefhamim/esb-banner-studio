import { describe, it, expect, vi } from 'vitest'

vi.mock('../../src/editorial/editorialStore', () => ({ useEditorialStore: { getState: () => ({}), subscribe: () => () => {}, setState: () => {} } }))
const { capStories, nextStatus, storyTitle, hasContent, checklistDone, MAX_STORIES } = await import('../../src/editorial/storyQueue')

const draft = (o: Record<string, string> = {}) => ({ headline: '', deck: '', slug: '', focusKeywords: '', focusKeyphrase: '', metaTitle: '', metaDescription: '', body: '', byline: '', credit: '', tags: [], social: { facebook: '', x: '', linkedin: '', telegram: '' }, ...o })
const checklist = (all = false) => ({ sourcesVerified: all, figuresChecked: all, quotesChecked: all, namesChecked: all, attributionKept: all, imagesCleared: all })
const snap = (o: { headline?: string; body?: string; done?: boolean; title?: string } = {}) => ({
  source: o.title ? ({ url: 'https://x.test/a', title: o.title, deck: '', rawText: '', paragraphs: [], images: [], factTable: [] } as never) : null,
  draft: draft({ headline: o.headline ?? '', body: o.body ?? '' }), checklist: checklist(o.done), deskAuto: true, translationProvider: null, modelUsed: null,
})
const item = (id: string, updatedAt: number, status: 'draft' | 'review' | 'approved' | 'published' = 'draft') => ({ id, status, createdAt: updatedAt, updatedAt, snapshot: snap({ headline: id }) })

describe('story queue rules', () => {
  it('names a story by its headline, then its source title', () => {
    expect(storyTitle(snap({ headline: 'Gas output rises', title: 'গ্যাস' }))).toBe('Gas output rises')
    expect(storyTitle(snap({ title: 'গ্যাস উৎপাদন' }))).toBe('গ্যাস উৎপাদন')
    expect(storyTitle(snap())).toBe('Untitled story')
  })

  it('an empty editor is not a story', () => {
    expect(hasContent(snap())).toBe(false)
    expect(hasContent(snap({ title: 'x' }))).toBe(true)
    expect(hasContent(snap({ headline: 'x' }))).toBe(true)
  })

  it('status follows the work: draft → needs check → approved; hand-set and published stay', () => {
    expect(nextStatus({ status: 'draft' }, snap({ headline: 'h' }))).toBe('draft')
    expect(nextStatus({ status: 'draft' }, snap({ body: 'b' }))).toBe('review')
    expect(nextStatus({ status: 'review' }, snap({ body: 'b', done: true }))).toBe('approved')
    expect(nextStatus({ status: 'published' }, snap({ body: 'b' }))).toBe('published')
    expect(nextStatus({ status: 'draft', statusPinned: true }, snap({ body: 'b', done: true }))).toBe('draft')
    expect(checklistDone({ ...checklist(), figuresChecked: true, namesChecked: true })).toBe(false)
  })

  it('caps the queue: never the active story, published first, then the oldest', () => {
    const many = Array.from({ length: MAX_STORIES + 3 }, (_, i) => item('s' + i, 1000 + i))
    many[10].status = 'published'
    const kept = capStories(many, 's0')
    expect(kept).toHaveLength(MAX_STORIES)
    expect(kept.some((s) => s.id === 's0')).toBe(true) // oldest, but active
    expect(kept.some((s) => s.id === 's10')).toBe(false) // published goes first
    expect(kept.some((s) => s.id === 's1')).toBe(false)
    expect(kept.some((s) => s.id === 's2')).toBe(false)
    expect(kept[0].id).toBe('s' + (MAX_STORIES + 2)) // newest first
  })
})
