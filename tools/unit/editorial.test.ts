import { describe, it, expect } from 'vitest'
import { bengaliToAsciiDigits, asciiToBengaliDigits, parseBengaliAmount } from '../../src/editorial/bengali'
import { parseArticleDocument, isBoilerplateParagraph, extractCatchSentence, cleanParagraphLead } from '../../src/editorial/extract'
import { extractFactTable, verifyDraftAgainstSource } from '../../src/editorial/facts'
import { enforceHeadlineLength, enforceDeckLength, generateSlug, translateNewsArticle, translateParagraphsBatch, buildSeoFromEnglishStory } from '../../src/editorial/translator'

describe('Editorial Desk — Bengali Normalisation', () => {
  it('converts Bengali digits to ASCII and vice versa', () => {
    expect(bengaliToAsciiDigits('৫৯২ কোটি টাকায় ৩০ MMCFD')).toBe('592 কোটি টাকায় 30 MMCFD')
    expect(asciiToBengaliDigits('592 MW capacity in 2026')).toBe('৫৯২ MW capacity in ২০২৬')
  })

  it('normalises Bengali currency expressions', () => {
    const res1 = parseBengaliAmount('৫৯২ কোটি টাকা')
    expect(res1).not.toBeNull()
    expect(res1?.normalized).toBe('Tk 592 crore')
    expect(res1?.value).toBe(592 * 1e7)
    expect(res1?.currency).toBe('BDT')

    const res2 = parseBengaliAmount('Tk 45.5 lakh')
    expect(res2?.normalized).toBe('Tk 45.5 lakh')
    expect(res2?.value).toBe(45.5 * 1e5)

    const res3 = parseBengaliAmount('$120 million')
    expect(res3?.currency).toBe('USD')
  })
})

describe('Editorial Desk — Article Extraction', () => {
  it('extracts structured article metadata and body from HTML', () => {
    const html = `
      <!DOCTYPE html>
      <html>
        <head>
          <title>Drilling two new wells for Tk 592 crore — Bonik Barta</title>
          <meta property="og:title" content="Drilling two new wells for Tk 592 crore, 30 MMCFD Gas to National Grid" />
          <meta property="og:description" content="Petrobangla plans new drilling campaign in Sylhet gas fields." />
          <meta property="og:image" content="https://example.com/gas-field.jpg" />
        </head>
        <body>
          <main>
            <p>Petrobangla and BAPEX will begin drilling two new development wells in the Sylhet region.</p>
            <p>The total estimated expenditure stands at Tk 592 crore, adding 30 MMCFD gas to the national grid by 2026.</p>
          </main>
        </body>
      </html>
    `

    const article = parseArticleDocument(html, 'https://bonikbarta.net/news/gas-drilling')
    expect(article.title).toBe('Drilling two new wells for Tk 592 crore, 30 MMCFD Gas to National Grid')
    expect(article.deck).toBe('Petrobangla plans new drilling campaign in Sylhet gas fields.')
    expect(article.paragraphs.length).toBe(2)
    expect(article.images.length).toBe(1)
    expect(article.images[0].src).toBe('https://example.com/gas-field.jpg')
  })
})

describe('Editorial Desk — Fact Verification & Discrepancy Flagging', () => {
  const source = `৫৯২ কোটি টাকায় নতুন দুটি কূপ খনন করবে বাপেক্স। গ্রিডে দৈনিক ৩০ MMCFD গ্যাস যুক্ত হবে। জ্বালানি সচিব বলেন, "আগামী বছরের মধ্যে উৎপাদন শুরু হবে।" BAPEX ও Petrobangla প্রকল্পটি বাস্তবায়ন করবে।`

  it('extracts fact table items accurately', () => {
    const facts = extractFactTable(source)
    const currencies = facts.filter((f) => f.kind === 'currency')
    const numbers = facts.filter((f) => f.kind === 'number')
    const quotes = facts.filter((f) => f.kind === 'quote')
    const entities = facts.filter((f) => f.kind === 'entity')

    expect(currencies.some((c) => c.normalized.includes('592 crore'))).toBe(true)
    expect(numbers.some((n) => n.normalized.includes('30 MMCFD'))).toBe(true)
    expect(quotes.some((q) => q.normalized.includes('আগামী বছরের মধ্যে'))).toBe(true)
    expect(entities.some((e) => e.normalized === 'Petrobangla')).toBe(true)
    expect(entities.some((e) => e.normalized === 'BAPEX')).toBe(true)
  })

  it('passes verified draft with matching figures', () => {
    const facts = extractFactTable(source)
    const draft = 'BAPEX to drill two wells for Tk 592 crore, adding 30 MMCFD gas.'
    const flags = verifyDraftAgainstSource(draft, source, facts)
    expect(flags.length).toBe(0)
  })

  it('flags unverified/altered figures as discrepancies', () => {
    const facts = extractFactTable(source)
    // Seeded error: 750 crore instead of 592 crore, 50 MMCFD instead of 30 MMCFD
    const hallucinatedDraft = 'BAPEX to drill two wells for Tk 750 crore, adding 50 MMCFD gas.'
    const flags = verifyDraftAgainstSource(hallucinatedDraft, source, facts)

    expect(flags.length).toBeGreaterThanOrEqual(2)
    expect(flags.some((f) => f.kind === 'unverified_number' && f.text === '750')).toBe(true)
    expect(flags.some((f) => f.kind === 'unverified_number' && f.text === '50')).toBe(true)
  })

  it('flags fabricated or altered quotes', () => {
    const facts = extractFactTable(source)
    const badQuoteDraft = 'Secretary stated: "all gas production has been indefinitely suspended."'
    const flags = verifyDraftAgainstSource(badQuoteDraft, source, facts)

    expect(flags.some((f) => f.kind === 'unverified_quote')).toBe(true)
  })
})

describe('Editorial Desk — Newsroom Boilerplate Filtering & CMS Constraints', () => {
  it('filters out editor, publisher, office addresses, and advertisement noise', () => {
    expect(isBoilerplateParagraph('ভারপ্রাপ্ত সম্পাদক: দেওয়ান হানিফ মাহমুদ')).toBe(true)
    expect(isBoilerplateParagraph('বার্তা ও বাণিজ্যিক কার্যালয়: বিসিআইসি ভবন (৮ম তলা), দিলকুশা বা/এ, ঢাকা')).toBe(true)
    expect(isBoilerplateParagraph('ফোন: ৯৫৬৩২৫১, ফ্যাক্স: ৯৫৬৩২৫২, ইমেইল: info@example.com')).toBe(true)
    expect(isBoilerplateParagraph('সর্বস্বত্ব সংরক্ষিত © ২০২৬ বণিক বার্তা')).toBe(true)
    expect(isBoilerplateParagraph('বিজ্ঞাপনের জন্য যোগাযোগ করুন: 01700000000')).toBe(true)
    expect(isBoilerplateParagraph('আমাদের ইউটিউব চ্যানেলে সাবস্ক্রাইব করুন')).toBe(true)

    // Valid news paragraph must NOT be filtered
    expect(isBoilerplateParagraph('সিলেট গ্যাস ফিল্ডসের কৈলাশটিলা ও রশীদপুর গ্যাস ক্ষেত্রে নতুন কূপ খননের উদ্যোগ নেওয়া হয়েছে।')).toBe(false)
  })

  it('enforces headline under 104 characters and deck under 200 characters', () => {
    const longHeadline = 'Official Announcement from Petrobangla: Government will commence massive development drilling for Tk 592 Crore in Sylhet Gas Fields adding 30 MMCFD Gas to Grid by next year'
    const trimmedH = enforceHeadlineLength(longHeadline, 104)
    expect(trimmedH.length).toBeLessThanOrEqual(104)

    const longDeck = 'Petrobangla and BAPEX have officially confirmed that two new development wells will be drilled in the Sylhet gas field under an extensive emergency exploration program delivering 30 MMCFD gas to the national grid by 2026 at an estimated investment cost of Tk 592 crore.'
    const trimmedD = enforceDeckLength(longDeck, 200)
    expect(trimmedD.length).toBeLessThanOrEqual(200)
  })

  it('generates clean URL slug under 80 characters', () => {
    const headline = 'Official: Two New Wells to Add 30 MMCFD Gas to Grid for Tk 592 Crore'
    const slug = generateSlug(headline, 80)
    expect(slug).toBe('official-two-new-wells-to-add-30-mmcfd-gas-to-grid-for-tk-592-crore')
    expect(slug.length).toBeLessThanOrEqual(80)
  })

  it('translates Bengali news story into English with SEO fields and full body', async () => {
    const res = await translateNewsArticle({
      title: '৫৯২ কোটি টাকায় নতুন দুটি কূপ খনন, গ্রিডে দৈনিক ৩০ মিলিয়ন ঘনফুট গ্যাস',
      deck: 'সিলেট গ্যাস ক্ষেত্রে উন্নয়ন কূপ খনন প্রকল্প বাস্তবায়ন করবে বাপেক্স ও পেট্রোবাংলা।',
      paragraphs: [
        'সিলেট গ্যাস ফিল্ডসের দুটি উন্নয়ন কূপ খনন প্রকল্পে ব্যয় ধরা হয়েছে ৫৯২ কোটি টাকা।',
        'প্রকল্পটি সম্পন্ন হলে জাতীয় গ্রিডে দৈনিক ৩০ মিলিয়ন ঘনফুট গ্যাস সরবরাহ বাড়বে।',
      ],
    })

    expect(res.headline.length).toBeLessThanOrEqual(104)
    expect(res.headline).toContain('592')
    expect(res.deck.length).toBeLessThanOrEqual(200)
    expect(res.slug.length).toBeLessThanOrEqual(80)
    expect(res.metaTitle.length).toBeLessThanOrEqual(60)
    expect(res.metaDescription.length).toBeLessThanOrEqual(160)
    expect(res.body.length).toBeGreaterThan(20)
    expect(res.body).toContain('592')
  })

  it('translates multiple paragraphs in a single high-speed batch preserving structure', async () => {
    const inputParagraphs = [
      'সিলেট গ্যাস ফিল্ডসের কৈলাশটিলা ও রশীদপুর ক্ষেত্রে নতুন অনুসন্ধান কূপ খনন করা হবে।',
      'প্রকল্পের প্রাথমিক ব্যয় নির্ধারণ করা হয়েছে ৫৯২ কোটি টাকা।',
      'জ্বালানি বিশেষজ্ঞগণ জানান, নতুন গ্যাসে জাতীয় সঞ্চালন গ্রিড শক্তিশালী হবে।',
    ]

    const translated = await translateParagraphsBatch(inputParagraphs)
    expect(translated.length).toBe(3)
    expect(translated[0].length).toBeGreaterThan(10)
    expect(translated[1]).toContain('592')
    expect(translated[2].length).toBeGreaterThan(10)
  })

  it('strips reporter prefixes, datelines, and bracketed agency tags from paragraph leads', () => {
    expect(cleanParagraphLead('নিজস্ব প্রতিবেদক, ঢাকা: পেট্রোবাংলা ও বাপেক্স দুটি নতুন উন্নয়ন কূপ খনন করবে।')).toBe('পেট্রোবাংলা ও বাপেক্স দুটি নতুন উন্নয়ন কূপ খনন করবে।')
    expect(cleanParagraphLead('(ঢাকা, ২৩ অক্টোবর) — জ্বালানি খাতের সংস্কার শুরু হয়েছে।')).toBe('জ্বালানি খাতের সংস্কার শুরু হয়েছে।')
    expect(cleanParagraphLead('অনলাইন ডেস্ক: গ্যাস সংকট দূরীকরণে নতুন উদ্যোগ নেওয়া হয়েছে।')).toBe('গ্যাস সংকট দূরীকরণে নতুন উদ্যোগ নেওয়া হয়েছে।')
    expect(cleanParagraphLead('সিলেট, ২৩ অক্টোবর (বাসস) : কৈলাশটিলা গ্যাস ফিল্ডে নতুন গ্যাস পাওয়া গেছে।')).toBe('কৈলাশটিলা গ্যাস ফিল্ডে নতুন গ্যাস পাওয়া গেছে।')
  })

  it('strictly derives SEO fields only from English translation', () => {
    const englishHeadline = 'BAPEX to Drill Two New Development Wells for Tk 592 Crore'
    const englishDeck = 'Delivering 30 MMCFD gas to the national grid from Sylhet fields.'
    const englishBody = 'Petrobangla and BAPEX confirmed the investment.'

    const seo = buildSeoFromEnglishStory(englishHeadline, englishDeck, englishBody)
    expect(seo.slug).toBe('bapex-to-drill-two-new-development-wells-for-tk-592-crore')
    expect(seo.slug.length).toBeLessThanOrEqual(80)
    expect(seo.metaTitle).toContain('BAPEX')
    expect(seo.metaTitle).toContain('| ESB PowerLine')
    expect(seo.metaTitle.length).toBeLessThanOrEqual(60)
    expect(seo.metaDescription.length).toBeLessThanOrEqual(160)
    expect(seo.focusKeywords).toContain('Petrobangla')
    expect(seo.focusKeywords).toContain('BAPEX')
    expect(/[\u0980-\u09FF]/.test(seo.slug)).toBe(false)
    expect(/[\u0980-\u09FF]/.test(seo.metaTitle)).toBe(false)
  })

  it('resolves relative, protocol-relative, data-src, and JSON-LD image URLs against article base URL', () => {
    const html = `
      <!DOCTYPE html>
      <html>
        <head>
          <meta property="og:title" content="BAPEX drills two wells in Sylhet" />
          <meta property="og:image" content="/uploads/2026/10/sylhet-well-lead.jpg" />
          <script type="application/ld+json">
            {
              "@context": "https://schema.org",
              "@type": "NewsArticle",
              "image": ["//cdn.bonikbarta.net/photos/bapex-rig.webp"]
            }
          </script>
        </head>
        <body>
          <article>
            <p>Petrobangla and BAPEX have started drilling operations in the Sylhet gas field to add 30 MMCFD gas.</p>
            <img data-src="/media/inline-rig.png" alt="Drilling rig" />
          </article>
        </body>
      </html>
    `
    const parsed = parseArticleDocument(html, 'https://bonikbarta.net/bangladesh/news-123')
    expect(parsed.images.map((i) => i.src)).toContain('https://bonikbarta.net/uploads/2026/10/sylhet-well-lead.jpg')
    expect(parsed.images.map((i) => i.src)).toContain('https://cdn.bonikbarta.net/photos/bapex-rig.webp')
    expect(parsed.images.map((i) => i.src)).toContain('https://bonikbarta.net/media/inline-rig.png')
  })
})

describe('Editorial Desk — Live esbpowerline.com CMS & Supabase Bridge', () => {
  it('maps category names to design token category IDs', async () => {
    const { matchCategoryNameToId } = await import('../../src/editorial/editorialStore')
    expect(matchCategoryNameToId('Fossil Fuels & Commodities')).toBe('03')
    expect(matchCategoryNameToId('Renewables & Alternative Energy')).toBe('04')
    expect(matchCategoryNameToId('Nuclear Energy')).toBe('06')
    expect(matchCategoryNameToId('Power Generation')).toBe('02')
    expect(matchCategoryNameToId('Energy Policy & Regulators')).toBe('01')
  })

  it('builds compliant CmsArticlePayload adhering to official character budgets', async () => {
    const { buildCmsArticlePayload } = await import('../../src/editorial/siteApi')
    const payload = buildCmsArticlePayload({
      headline: 'Tk 592 Crore Gas Drilling Project Added to National Grid to Boost Capacity Ahead of Winter',
      deck: 'Petrobangla and BAPEX officially commissioned two development wells in the Sylhet gas field.',
      slug: 'tk-592-crore-gas-drilling-project-added-to-national-grid-ahead-of-winter',
      body: 'Full story text about the gas exploration and grid integration project.',
      category: 'Fossil Fuels & Commodities',
      credit: 'ESB PowerLine',
      byline: 'Mehedi Hasan Hamim',
    })

    expect(payload.title.length).toBeLessThanOrEqual(104)
    expect(payload.excerpt.length).toBeLessThanOrEqual(200)
    expect(payload.slug.length).toBeLessThanOrEqual(80)
    expect(payload.status).toBe('PUBLISHED')
    expect(payload.category).toBe('Fossil Fuels & Commodities')
  })

  it('provides verified database mappings for all 10 CMS categories and staff authors', async () => {
    const { ESB_CATEGORIES, ESB_AUTHORS, generateCuid } = await import('../../src/editorial/siteApi')
    expect(Object.keys(ESB_CATEGORIES).length).toBe(10)
    expect(ESB_CATEGORIES['Fossil Fuels & Commodities'].id).toBe('cmqv473nh0006vk555w03ngbq')
    expect(ESB_CATEGORIES['Consumers & Tariffs'].id).toBe('cmqv473nh000avk55ur3yty0p')
    expect(ESB_CATEGORIES['Renewables & Nuclear'].id).toBe('cmqv473nh0007vk55fyfwonza')

    expect(ESB_AUTHORS['hamim2964@gmail.com'].id).toBe('cmqv471bq0001vk55aw07256e')
    expect(ESB_AUTHORS['hamim2964@gmail.com'].name).toBe('Mehedi Hasan Hamim')
    expect(ESB_AUTHORS['admin@esbpowerline.com'].role).toBe('SUPER_ADMIN')

    const cuid = generateCuid()
    expect(cuid.length).toBe(25)
    expect(cuid.startsWith('cmv')).toBe(true)
  })
})

describe('Editorial Desk — Intake robustness', () => {
  it('keeps prose that merely mentions roads, blocks or Gulshan, and drops real address lines', async () => {
    const { isBoilerplateParagraph } = await import('../../src/editorial/extract')
    expect(isBoilerplateParagraph('A transmission tower near the Gulshan substation will be rebuilt as part of the work on the Mohakhali road, officials said.')).toBe(false)
    expect(isBoilerplateParagraph('গুলশান এলাকার একটি উপকেন্দ্র থেকে নতুন লাইন টানার পরিকল্পনাও রয়েছে বলে সংশ্লিষ্ট সূত্র জানিয়েছে।')).toBe(false)
    expect(isBoilerplateParagraph('শুক্রবার সকালে প্রকল্প এলাকা পরিদর্শন করেন পিজিসিবির ব্যবস্থাপনা পরিচালক, যিনি কাজের অগ্রগতিতে সন্তোষ প্রকাশ করেন।')).toBe(false)
    expect(isBoilerplateParagraph('The Example Standard, House 36/1, Road 1, Block A, Mirpur, Dhaka-1216. Phone: +880 1711 000000')).toBe(true)
    expect(isBoilerplateParagraph('বার্তা ও বাণিজ্যিক কার্যালয়: বিডিবিএল ভবন (লেভেল ১৭), ১২ কারওয়ান বাজার, ঢাকা-১২১৫')).toBe(true)
    expect(isBoilerplateParagraph('শুক্রবার, ২৩ অক্টোবর ২০২৬')).toBe(true)
  })

  it('splits a JSON-LD articleBody into paragraphs by blank lines, line breaks, or sentence groups', async () => {
    const { splitBodyText } = await import('../../src/editorial/extract')
    expect(splitBodyText('প্রথম।\n\nদ্বিতীয়।')).toEqual(['প্রথম।', 'দ্বিতীয়।'])
    expect(splitBodyText('<p>One.</p><p>Two.</p>')).toEqual(['One.', 'Two.'])
    const long = Array.from({ length: 9 }, (_, i) => `Sentence number ${i + 1} of a long single-string body that has to be regrouped for the desk to read it comfortably.`).join(' ')
    const parts = splitBodyText(long)
    expect(parts.length).toBe(3)
    expect(parts.join(' ').replace(/\s+/g, ' ')).toBe(long)
  })

  it('shows one chip per distinct fact even when the figure appears in headline and body', async () => {
    const { extractFactTable } = await import('../../src/editorial/facts')
    const table = extractFactTable('৫৯২ কোটি টাকায় দুটি কূপ, ৩০ এমএমসিএফডি গ্যাস\n\nপ্রকল্পে ৫৯২ কোটি টাকা ব্যয় হবে এবং ৩০ এমএমসিএফডি গ্যাস মিলবে।')
    const keys = table.map((f) => `${f.kind}|${f.normalized}`)
    expect(new Set(keys).size).toBe(keys.length)
    expect(table.filter((f) => f.normalized === '30 MMCFD').length).toBe(1)
    expect(table.find((f) => f.normalized === '30 MMCFD')?.sourceOffset).toBeLessThan(60)
  })

  it('turns net-guard codes into an honest message and offers the paste fallback where it applies', async () => {
    const { IntakeError, describeIntakeError } = await import('../../src/editorial/automation')
    const blocked = describeIntakeError(new IntakeError('blocked', 'HTTP 403', 'https://www.example-news.test/x'))
    expect(blocked.title).toContain('example-news.test')
    expect(blocked.canPaste).toBe(true)
    expect(describeIntakeError(new IntakeError('private_address', 'rejected', 'http://10.0.0.1/')).canPaste).toBe(false)
    expect(describeIntakeError(new IntakeError('invalid_url', 'bad', 'nope')).canPaste).toBe(false)
    expect(describeIntakeError(new IntakeError('dns_error', 'ENOTFOUND', 'https://blocked.invalid/story')).title).toContain('could not be found')
    expect(describeIntakeError(new Error('boom')).detail).toBe('boom')
  })
})
