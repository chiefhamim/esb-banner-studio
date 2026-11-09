// Quintype story data (Prothom Alo): the page's own story is pinned as the body, the site-wide data block emptied.
import { describe, expect, it } from 'vitest'
import { pinStoryBody, storyParagraphs } from './storyData'

const data = {
  qt: { data: { story: {
    headline: 'বিদ্যুৎ সরবরাহ স্বাভাবিক',
    cards: [
      { 'story-elements': [{ type: 'text', text: '<p>প্রথম অনুচ্ছেদ।</p><p>দ্বিতীয় অনুচ্ছেদ &amp; তথ্য।</p>' }] },
      { 'story-elements': [{ type: 'text', subtype: 'also-read', text: '<p>আরও পড়ুন</p>' }, { type: 'image' }] },
    ],
  } } },
  junk: 'কিশোর আলোতে লেখা পাঠান '.repeat(20),
}
const page = `<html><head><title>x</title></head><body><p>একটি</p><script type="application/json" id="static-page">${JSON.stringify(data)}</script></body></html>`

describe('pinStoryBody', () => {
  it('keeps the story text elements only', () => {
    expect(storyParagraphs(data.qt.data.story)).toEqual(['প্রথম অনুচ্ছেদ।', 'দ্বিতীয় অনুচ্ছেদ & তথ্য।'])
  })
  it('adds a JSON-LD articleBody and empties the data block, and is harmless twice', () => {
    const once = pinStoryBody(page)
    expect(once).toContain('"articleBody":"প্রথম অনুচ্ছেদ।\\n\\nদ্বিতীয় অনুচ্ছেদ & তথ্য।"')
    expect(once).not.toContain('কিশোর আলোতে')
    expect(pinStoryBody(once)).toBe(once)
  })
  it('leaves other pages alone', () => {
    expect(pinStoryBody('<html><body><p>x</p></body></html>')).toBe('<html><body><p>x</p></body></html>')
  })
})
