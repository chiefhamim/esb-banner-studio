import { describe, it, expect, vi, beforeEach } from 'vitest'

// The library reads the story on the desk through these stores; the pure parts under test never touch them.
const editorState = { draft: { headline: '', deck: '', body: '' }, source: null as null | { url: string; title: string; rawText: string } }
const queueState = { activeId: 'story-a' as string | null, stories: [] as { id: string; publishedSlug?: string; publishedUrl?: string; snapshot: unknown }[], saveActive: () => {} }
vi.mock('../../src/editorial/editorialStore', () => ({ useEditorialStore: { getState: () => editorState } }))
vi.mock('../../src/editorial/storyQueue', () => ({ useStoryQueue: { getState: () => queueState } }))
vi.mock('../../src/store', () => ({ useStore: { getState: () => ({ doc: { content: { categoryId: '02' } } }) } }))

const lib = await import('../../src/editorial/quoteLibrary')
const { harvestStory, mergeHarvest, saveMerge, loadLibrary, setLibraryStorage, seedSpeakers, orgsFromTags, searchEntries, quoteBannerPatch, statBannerPatch, statLabelFrom, dedupeKey, MAX_ENTRIES, INDEX_KEY, entryKey, useQuoteLibrary } = lib
type LibraryEntry = import('../../src/editorial/quoteLibrary').LibraryEntry
const { idbGet, idbSet } = await import('../../src/outreach/idb')

// Synthetic story (no real people or quotes): two named speakers, one unnamed, four figures, a Bengali source.
const HEADLINE = 'Grid to add 1,320 MW as BPDB plans new tender'
const BODY = [
  '"We will add 1,320 MW to the national grid before the summer peak," said Karim Hossain, chairman of BPDB.',
  'The project will cost Tk 592 crore, officials said.',
  'BERC Chairman Nasrin Akter said: "Tariffs will be set only after a public hearing."',
  'Gas supply will rise by 30 MMCFD from the Sylhet field. Load-shedding fell 12% in October.',
  '"It\'s a good start for the season," he said.',
].join('\n\n')
const SOURCE = 'পেট্রোবাংলা জানায়, দৈনিক ৩০ এমএমসিএফডি গ্যাস যুক্ত হবে।\n\nনতুন কেন্দ্রটি ৪০০ মেগাওয়াট বিদ্যুৎ দেবে।'
const story = (o: Partial<Parameters<typeof harvestStory>[0]> = {}) => ({
  storyId: 'story-a', headline: HEADLINE, categoryId: '02', draftText: `${HEADLINE}\n\n${BODY}`, sourceText: SOURCE, sourceUrl: 'https://example.com/source', now: 1000, ...o,
})

/** A storage double over a Map that can be told to fail particular keys. */
function memStore(failOn: (key: string) => boolean = () => false) {
  const map = new Map<string, unknown>()
  return {
    map,
    get: async <T,>(k: string) => structuredClone(map.get(k)) as T | undefined,
    set: async (k: string, v: unknown) => { if (failOn(k)) throw new Error('QuotaExceededError'); map.set(k, structuredClone(v)) },
    del: async (k: string) => { map.delete(k) },
  }
}

beforeEach(() => setLibraryStorage(null))

describe('harvest', () => {
  const got = harvestStory(story(), seedSpeakers())
  const quotes = got.filter((e) => e.kind === 'quote')
  const stats = got.filter((e) => e.kind === 'stat')

  it('finds each quote verbatim with the speaker the sentence names, and none it does not', () => {
    expect(quotes.map((q) => q.text)).toEqual([
      'We will add 1,320 MW to the national grid before the summer peak',
      'Tariffs will be set only after a public hearing.',
      "It's a good start for the season",
    ])
    expect(quotes[0]).toMatchObject({ speaker: 'Karim Hossain', speakerTitle: 'chairman of BPDB', org: 'BPDB', from: 'draft' })
    expect(quotes[1]).toMatchObject({ speaker: 'Nasrin Akter', speakerTitle: 'BERC Chairman', org: 'BERC' })
    expect(quotes[2].speaker).toBeUndefined() // "he said" is not a name
    expect(quotes[1].sentence).toBe('BERC Chairman Nasrin Akter said: "Tariffs will be set only after a public hearing."')
  })

  it('finds figures with units as written, normalised, with their sentence — Bengali digits included', () => {
    const by = Object.fromEntries(stats.map((s) => [s.text, s]))
    expect(by['1,320 MW']).toMatchObject({ value: 1320, unit: 'MW' })
    expect(by['Tk 592 crore']).toMatchObject({ value: 5.92e9, unit: 'BDT', sentence: 'The project will cost Tk 592 crore, officials said.' })
    expect(by['30 MMCFD']).toMatchObject({ value: 30, unit: 'MMCFD' }); expect(by['30 MMCFD'].org).toBeUndefined()
    expect(by['12%']).toMatchObject({ value: 12, unit: '%' })
    // only in the Bengali source, written in Bengali digits
    expect(by['৪০০ মেগাওয়াট']).toMatchObject({ value: 400, unit: 'MW', from: 'source', sentence: 'নতুন কেন্দ্রটি ৪০০ মেগাওয়াট বিদ্যুৎ দেবে।' })
    // 30 MMCFD is in both texts: one entry per figure per story, the draft's
    expect(stats.filter((s) => s.unit === 'MMCFD')).toHaveLength(1)
    expect(stats.length).toBeGreaterThanOrEqual(5)
  })

  it('every entry carries where it came from', () => {
    for (const e of got) expect(e).toMatchObject({ storyId: 'story-a', headline: HEADLINE, categoryId: '02', sourceUrl: 'https://example.com/source', harvestedAt: 1000 })
  })

  it('ids are deterministic: the same story gives the same ids', () => {
    expect(harvestStory(story({ now: 5000 })).map((e) => e.id)).toEqual(got.map((e) => e.id))
  })

  it('an apostrophe pair is not a quotation', () => {
    const t = "The minister's office said the plant's output was steady all week."
    expect(harvestStory(story({ draftText: t, sourceText: '' })).filter((e) => e.kind === 'quote')).toHaveLength(0)
  })
})

describe('dedupe', () => {
  it('harvesting the same story twice leaves the count unchanged and keeps harvestedAt', () => {
    const first = mergeHarvest([], harvestStory(story()))
    const again = mergeHarvest(first.entries, harvestStory(story({ now: 9000, slug: 'grid-adds-1320-mw', url: 'https://esbpowerline.com/articles/grid-adds-1320-mw' })))
    expect(again.entries).toHaveLength(first.entries.length)
    expect(again.added).toHaveLength(0)
    expect(again.entries.every((e) => e.harvestedAt === 1000)).toBe(true)
    // a later publish adds its address to the entries already there
    expect(again.entries.every((e) => e.slug === 'grid-adds-1320-mw')).toBe(true)
  })

  it('two stories sharing one quote keep one entry: the first harvested, with the second noted in alsoIn', () => {
    const a = mergeHarvest([], harvestStory(story()))
    const shared = '"Tariffs will be set only after a public hearing," said Nasrin Akter.'
    const b = mergeHarvest(a.entries, harvestStory(story({ storyId: 'story-b', headline: 'Another story', draftText: shared, sourceText: '', now: 2000 })))
    const hits = b.entries.filter((e) => e.kind === 'quote' && /^Tariffs will be set/.test(e.text))
    expect(hits).toHaveLength(1)
    expect(hits[0]).toMatchObject({ storyId: 'story-a', headline: HEADLINE, alsoIn: ['story-b'] })
    expect(b.merged).toBe(1)
    expect(dedupeKey(hits[0])).toBe(dedupeKey({ kind: 'quote', text: 'Tariffs will be set only after a public hearing', sentence: '' }))
  })
})

describe('persistence', () => {
  it('round-trips through the memory fallback (no IndexedDB in the test runner)', async () => {
    const m = mergeHarvest([], harvestStory(story()))
    const res = await saveMerge(m, [])
    expect(res.failed).toEqual([])
    const back = await loadLibrary()
    expect(back.dropped).toBe(0)
    expect(back.entries).toEqual(m.entries)
    const idx = await idbGet<{ rows: { id: string }[] }>(INDEX_KEY)
    expect(idx?.rows.map((r) => r.id).sort()).toEqual(m.entries.map((e) => e.id).sort())
    expect(await idbGet(entryKey(m.entries[0].id))).toEqual(m.entries[0])
  })

  it('caps at MAX_ENTRIES, evicting the oldest harvestedAt first, and deletes their records', async () => {
    const s = memStore()
    setLibraryStorage(s)
    const many: LibraryEntry[] = Array.from({ length: MAX_ENTRIES + 5 }, (_, i) => ({ id: 'e' + i, kind: 'stat', text: `${i} MW`, value: i, unit: 'MW', sentence: `Unit ${i} adds ${i} MW.`, from: 'draft', storyId: 's' + i, headline: 'h', categoryId: '01', harvestedAt: 10_000 + i }))
    const first = mergeHarvest([], many.slice(0, 5))
    await saveMerge(first, [])
    const m = mergeHarvest(first.entries, many.slice(5))
    expect(m.entries).toHaveLength(MAX_ENTRIES)
    expect(m.evicted).toEqual(['e0', 'e1', 'e2', 'e3', 'e4'])
    await saveMerge(m, first.entries)
    expect(s.map.has(entryKey('e0'))).toBe(false)
    expect(s.map.has(entryKey('e504'))).toBe(true)
    expect((await loadLibrary()).entries).toHaveLength(MAX_ENTRIES)
  })

  it('a failed entry write leaves an index that names only stored entries', async () => {
    const m = mergeHarvest([], harvestStory(story()))
    const victim = m.entries[1].id
    const s = memStore((k) => k === entryKey(victim))
    setLibraryStorage(s)
    const res = await saveMerge(m, [])
    expect(res.failed).toEqual([victim])
    expect(res.entries.some((e) => e.id === victim)).toBe(false)
    const idx = s.map.get(INDEX_KEY) as { rows: { id: string }[] }
    expect(idx.rows.some((r) => r.id === victim)).toBe(false)
    for (const r of idx.rows) expect(s.map.has(entryKey(r.id))).toBe(true)
    const back = await loadLibrary()
    expect(back.dropped).toBe(0)
    expect(back.entries).toHaveLength(m.entries.length - 1)
  })

  it('a failed index write keeps the previous index; an index row with no entry is dropped on load', async () => {
    const s = memStore((k) => k === INDEX_KEY)
    setLibraryStorage(s)
    const m = mergeHarvest([], harvestStory(story()))
    const res = await saveMerge(m, [])
    expect(res.entries).toEqual([])
    expect(s.map.has(INDEX_KEY)).toBe(false)
    // an index that points at a missing entry (written by hand / a lost write) is repaired on read
    const ok = memStore()
    setLibraryStorage(ok)
    await saveMerge(m, [])
    ok.map.delete(entryKey(m.entries[0].id))
    const back = await loadLibrary()
    expect(back.dropped).toBe(1)
    expect((ok.map.get(INDEX_KEY) as { rows: unknown[] }).rows).toHaveLength(m.entries.length - 1)
  })
})

describe('speaker registry', () => {
  it('is seeded with the organisations among the newsroom tags (TAGS), not the topic tags', () => {
    const orgs = orgsFromTags()
    expect(orgs).toEqual(expect.arrayContaining(['BERC', 'BPDB', 'Petrobangla', 'Titas Gas', 'PGCB', 'DPDC', 'DESCO']))
    expect(orgs).not.toContain('LNG')
    expect(orgs).not.toContain('Renewables')
    const seed = seedSpeakers()
    expect(seed.find((s) => s.name === 'BERC')).toEqual({ id: 'org-berc', name: 'BERC', title: '', org: 'BERC' })
  })

  it('a quote links to a registry speaker when the names match', () => {
    const speakers = [...seedSpeakers(), { id: 'sp1', name: 'karim  hossain', title: 'Chairman, BPDB', org: 'BPDB' }]
    const q = harvestStory(story(), speakers).find((e) => e.speaker === 'Karim Hossain')!
    expect(q.speakerId).toBe('sp1')
    // the hand-off prefers the registry's (edited) name and title
    expect(quoteBannerPatch(q, speakers)).toEqual({ cardType: 'quote', quoteText: q.text, speakerName: 'karim  hossain', speakerTitle: 'Chairman, BPDB' })
  })
})

describe('search', () => {
  const entries = mergeHarvest([], harvestStory(story())).entries
  const speakers = [...seedSpeakers(), { id: 'sp-nasrin', name: 'Nasrin Akter', title: 'Chairman', org: 'BERC' }]

  it('matches text, sentence, speaker and org, case-insensitively', () => {
    expect(searchEntries(entries, 'TARIFFS').map((e) => e.speaker)).toEqual(['Nasrin Akter'])
    expect(searchEntries(entries, 'karim').length).toBe(1)
    expect(searchEntries(entries, 'bpdb hossain').length).toBe(1)
    expect(searchEntries(entries, 'nothing-like-this')).toEqual([])
    expect(searchEntries(entries, '').length).toBe(entries.length)
  })

  it('Bengali digits and thousands separators match either way', () => {
    expect(searchEntries(entries, '৫৯২').map((e) => e.text)).toEqual(['Tk 592 crore'])
    expect(searchEntries(entries, '400').map((e) => e.text)).toEqual(['৪০০ মেগাওয়াট'])
    expect(searchEntries(entries, '1320 mw').some((e) => e.text === '1,320 MW')).toBe(true)
  })

  it('filters by kind, registry speaker and org', () => {
    expect(searchEntries(entries, '', { kind: 'quote' }).every((e) => e.kind === 'quote')).toBe(true)
    expect(searchEntries(entries, '', { kind: 'stat' }).length).toBe(entries.filter((e) => e.kind === 'stat').length)
    expect(searchEntries(entries, '', { speaker: 'sp-nasrin' }, speakers).map((e) => e.text)).toEqual(['Tariffs will be set only after a public hearing.'])
    expect(searchEntries(entries, '', { org: 'bpdb' }, speakers).map((e) => e.kind).sort()).toEqual(['quote', 'stat'])
  })
})

describe('banner hand-off', () => {
  const got = harvestStory(story())
  it('a stat card gets the figure as written, a label from its sentence, the story as source, and no stale delta', () => {
    const tk = got.find((e) => e.text === 'Tk 592 crore')!
    expect(statBannerPatch(tk)).toEqual({ cardType: 'stat', statNumber: 'Tk 592 crore', statLabel: 'Project will cost', statDelta: '', statNote: `Source: ${HEADLINE}` })
    expect(statLabelFrom('Gas supply will rise by 30 MMCFD from the Sylhet field.', '30 MMCFD')).toBe('Sylhet field')
    // a Bengali case ending glued to the figure is not the start of the label
    expect(statLabelFrom('প্রকল্পে ৫৯২ কোটি টাকায় দুটি নতুন কূপ খনন হবে।', '৫৯২ কোটি টাকা')).toBe('দুটি নতুন কূপ খনন হবে')
  })
})

describe('store', () => {
  it('harvestActive reads the desk, persists, and a second harvest adds nothing', async () => {
    setLibraryStorage(memStore())
    editorState.draft = { headline: HEADLINE, deck: '', body: BODY }
    editorState.source = { url: 'https://example.com/source', title: 'উৎস', rawText: SOURCE }
    const st = useQuoteLibrary.getState()
    const r1 = await st.harvestActive({ slug: 'grid-1320', url: 'https://esbpowerline.com/articles/grid-1320' })
    expect(r1.added).toBeGreaterThanOrEqual(7)
    expect(r1.failed).toBe(0)
    const n = useQuoteLibrary.getState().entries.length
    expect(useQuoteLibrary.getState().entries.every((e) => e.storyId === 'story-a' && e.slug === 'grid-1320' && e.categoryId === '02')).toBe(true)
    const r2 = await st.harvestActive()
    expect(r2.added).toBe(0)
    expect(useQuoteLibrary.getState().entries.length).toBe(n)
    // speakers named by the story join the registry
    expect(useQuoteLibrary.getState().speakers.some((s) => s.name === 'Karim Hossain' && s.org === 'BPDB')).toBe(true)
    await st.editSpeaker('org-berc', { title: 'Regulator' })
    expect(useQuoteLibrary.getState().speakers.find((s) => s.id === 'org-berc')?.title).toBe('Regulator')
    const id = useQuoteLibrary.getState().entries[0].id
    await st.remove(id)
    expect(useQuoteLibrary.getState().entries.some((e) => e.id === id)).toBe(false)
    expect(useQuoteLibrary.getState().last).toBeNull() // the "N added" note no longer describes the list
  })

  it('a remove the storage refuses is reported and the entry stays', async () => {
    const before = useQuoteLibrary.getState().entries
    setLibraryStorage(memStore((k) => k === INDEX_KEY))
    await useQuoteLibrary.getState().remove(before[0].id)
    expect(useQuoteLibrary.getState().entries).toEqual(before)
    expect(useQuoteLibrary.getState().problem).toMatch(/Could not remove/)
  })

  it('a publish event for a story this desk does not know files nothing', async () => {
    setLibraryStorage(memStore())
    const n = useQuoteLibrary.getState().entries.length
    const r = await useQuoteLibrary.getState().harvestActive({ storyId: 'someone-elses-story', slug: 'x' }, 'published')
    expect(r).toEqual({ found: 0, added: 0, updated: 0, merged: 0, failed: 0 })
    expect(useQuoteLibrary.getState().entries.length).toBe(n)
    expect(useQuoteLibrary.getState().entries.some((e) => e.storyId === 'someone-elses-story')).toBe(false)
  })
})

describe('quotation marks (QA cases): no narration is ever taken for a quote', () => {
  const quotes = (t: string) => harvestStory(story({ draftText: t, sourceText: '' }), seedSpeakers()).filter((e) => e.kind === 'quote').map((e) => ({ text: e.text, speaker: e.speaker, title: e.speakerTitle }))

  it('an apostrophe inside a double-quoted statement does not end it', () => {
    const t = `"We need Bangladesh's gas fields to deliver more," said Karim Hossain, chairman of BPDB. Later the minister added: "Tariffs will stay where they are for now."`
    expect(quotes(t)).toEqual([
      { text: "We need Bangladesh's gas fields to deliver more", speaker: 'Karim Hossain', title: 'chairman of BPDB' },
      { text: 'Tariffs will stay where they are for now.', speaker: undefined, title: undefined },
    ])
  })

  it('an unclosed quote does not run across paragraphs or swallow the next quote', () => {
    const t = `The chairman said "the grid is stable and we are ready\n\nIn other news, "Load-shedding will end soon," said Rafiq Islam.`
    expect(quotes(t)).toEqual([{ text: 'Load-shedding will end soon', speaker: 'Rafiq Islam', title: '' }])
    // the same, inside one paragraph
    expect(quotes(t.replace('\n\n', ' ')).map((q) => q.text)).toEqual(['Load-shedding will end soon'])
  })

  it('curly double quotes keep an apostrophe inside', () => {
    const t = `“Petrobangla’s new wells will add gas by winter,” said Nasrin Akter, a director at Petrobangla.`
    expect(quotes(t)).toEqual([{ text: 'Petrobangla’s new wells will add gas by winter', speaker: 'Nasrin Akter', title: 'a director at Petrobangla' }])
  })

  it('curly single quotes keep an apostrophe inside; possessives alone are not quotes', () => {
    const t = `‘We won’t raise the gas price this year,’ said Rafiq Islam. The ministry’s plan and the plant’s output stayed the same.`
    expect(quotes(t).map((q) => q.text)).toEqual(['We won’t raise the gas price this year'])
  })

  it('keeps the 8–160 character limits', () => {
    expect(quotes('He said "too few" and left.')).toEqual([])
    expect(quotes(`"${'a'.repeat(170)}," said Rafiq Islam.`)).toEqual([])
  })
})

// keep the real idb module referenced so the memory fallback path is the one exercised above
void idbSet
