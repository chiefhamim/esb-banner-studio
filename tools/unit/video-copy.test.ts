import { describe, it, expect } from 'vitest'
import { buildDescription, chaptersFromMarkers, sanitizeTags, sanitizeYoutubeTitle, writeVideoCopy, YT_TITLE_MAX } from '../../src/video/ai/videoCopy'
import type { TextAiDeps } from '../../src/video/ai/aiText'

const story = {
  headline: 'Petrobangla to drill two new wells in Sylhet',
  deck: 'The wells are expected to add 30 MMCFD to the grid by winter.',
  body: 'Petrobangla will drill two new wells in Sylhet this winter. The wells are expected to add 30 MMCFD to the grid. The project will cost Tk 592 crore.',
  slug: 'two-new-wells-sylhet',
}
const deps = (data: Record<string, unknown>): TextAiDeps => ({
  paused: () => false,
  pick: () => ({ provider: 'gemini', key: 'k', model: 'auto' }),
  call: async () => ({ data, model: 'm' }),
  resolve: async (_p, _k, m) => m,
})

describe('title and tags', () => {
  it('keeps a title to one line within 100 characters without em dashes or quotes', () => {
    const t = sanitizeYoutubeTitle('“Two new wells — 30 MMCFD ” \n' + 'x'.repeat(200), 'fallback')
    expect(t.length).toBeLessThanOrEqual(YT_TITLE_MAX)
    expect(t).not.toMatch(/[—–\n]/)
    expect(sanitizeYoutubeTitle('', 'Fallback headline')).toBe('Fallback headline')
  })
  it('de-duplicates tags, strips hashes and respects the character budget', () => {
    expect(sanitizeTags('#Petrobangla, petrobangla, Sylhet gas ,, x, LNG')).toEqual(['Petrobangla', 'Sylhet gas', 'LNG'])
    expect(sanitizeTags(Array.from({ length: 60 }, (_, i) => `tag number ${i} here`).join(',')).join(',').length).toBeLessThanOrEqual(420)
  })
})

describe('chapters', () => {
  it('needs 0:00, three chapters and ten seconds each; otherwise none', () => {
    const ok = [{ t: 0, name: 'Wells' }, { t: 15, name: 'Cost' }, { t: 40, name: 'Timeline' }]
    expect(chaptersFromMarkers(ok, 60)).toBe('0:00 Wells\n0:15 Cost\n0:40 Timeline')
    expect(chaptersFromMarkers([{ t: 5, name: 'Late' }, ...ok.slice(1)], 60)).toBe('')
    expect(chaptersFromMarkers([{ t: 0, name: 'A' }, { t: 4, name: 'B' }, { t: 30, name: 'C' }], 60)).toBe('')
    expect(chaptersFromMarkers(undefined, 60)).toBe('')
  })
})

describe('description', () => {
  it('has the summary, the article link with UTM, chapters and the site line', () => {
    const d = buildDescription({ summary: 'Two wells.', slug: 'two-new-wells-sylhet', chapters: '0:00 A\n0:20 B\n0:40 C' })
    expect(d).toContain('Two wells.')
    expect(d).toContain('https://esbpowerline.com/articles/two-new-wells-sylhet?utm_source=youtube&utm_medium=video')
    expect(d).toContain('Chapters\n0:00 A')
    expect(d.trim().endsWith('ESB Power Line · esbpowerline.com')).toBe(true)
  })
  it('omits the link and chapters when there is no slug or no honest chapter list', () => {
    const d = buildDescription({ summary: 'S' })
    expect(d).not.toContain('http')
    expect(d).not.toContain('Chapters')
  })
})

describe('writeVideoCopy', () => {
  it('builds the copy from a good answer', async () => {
    const { copy, problems } = await writeVideoCopy(story, { duration: 60 }, deps({
      youtubeTitle: 'Two new Sylhet wells to add 30 MMCFD',
      summary: 'Petrobangla will drill two wells in Sylhet. They are expected to add 30 MMCFD.',
      tags: 'Petrobangla, Sylhet, gas',
      facebook: 'Two new wells will add 30 MMCFD to the grid.\n\n#Bangladesh #Gas #Sylhet #ESBPowerLine',
    }))
    expect(problems).toEqual([])
    expect(copy.youtubeTitle).toBe('Two new Sylhet wells to add 30 MMCFD')
    expect(copy.tags).toEqual(['Petrobangla', 'Sylhet', 'gas'])
    expect(copy.facebook).not.toMatch(/https?:/)
  })

  it('replaces a field that brings a figure the story does not have, and says so', async () => {
    const { copy, problems } = await writeVideoCopy(story, { duration: 60 }, deps({
      youtubeTitle: 'Two new wells will add 45 MMCFD',
      summary: 'Petrobangla will drill two wells.',
      tags: 'a1, b2',
      facebook: 'Fine caption.\n\n#Gas',
    }))
    expect(copy.youtubeTitle).toBe(story.headline)
    expect(problems.some((p) => p.startsWith('YouTube title') && p.includes('45'))).toBe(true)
  })
})

describe('no links of the model’s own', () => {
  it('strips links from the title, summary and tags (the only link is the article’s)', async () => {
    const { copy } = await writeVideoCopy(story, { duration: 60 }, deps({
      youtubeTitle: 'Two new wells https://evil.example/x in Sylhet',
      summary: 'Petrobangla will drill two wells. Visit www.evil.example now.',
      tags: 'Petrobangla, https://evil.example, Sylhet',
      facebook: 'Two new wells.\n\n#Gas',
    }))
    expect(copy.youtubeTitle).not.toMatch(/evil/)
    expect(copy.tags.join(' ')).not.toMatch(/evil|http/)
    const links = copy.description.match(/https?:\/\/\S+/g) ?? []
    expect(links).toHaveLength(1)
    expect(links[0]).toContain('esbpowerline.com/articles/two-new-wells-sylhet')
  })
})
