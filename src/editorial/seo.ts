// SEO for the Editorial desk: keyphrase suggestions drawn from the story itself, and the checks a news SEO plugin
// runs (Yoast / Rank Math style) — computed from the draft, never guessed. Everything here is pure and unit-tested.
//
// The checks follow what esbpowerline.com actually emits (app/(public)/articles/[slug]/page.tsx, lib/seo.ts):
//   <title>        seo.metaTitle, else the headline — with NO " | ESB PowerLine" suffix. The site dropped it in stage 5
//                  of its SEO fix log because it cost ~15 of the ~60 visible characters on 121 of 161 titles.
//   description    seo.metaDescription, else the excerpt (deck), cleaned and cut at 160 characters.
//   og:image alt   seo.heroImage.alt, else the headline. seo.heroImage.caption is printed under the photo.

const STOP = new Set(('a an and are as at be been being but by can could did do does for from had has have he her his how i if in into is it its '
  + 'may might more most new no not of on or our out over said says she should so some such than that the their them then there these '
  + 'they this those through to under up was we were what when where which while who will with would also after before about against '
  + 'between during since until per via amid among across around just very much many any each other both all one two three first last '
  + 'year years day days week month months today yesterday tomorrow time officials official sources source according told added noted '
  + 'meanwhile however therefore thus already still yet again further well even only within without upon along').split(' '))

/** Words that never make a keyphrase on their own: reporting verbs, filler and generic nouns. */
const GENERIC = new Set(('said says statement report reports reported news story people country government ministry issue issues '
  + 'matter matters process plan plans project projects initiative step steps work works system part number amount level levels '
  + 'percent crore lakh million billion tk taka usd per cent increase decrease rise fall total').split(' '))

/** A plain word-pair that starts with one of these is an action ("add gas", "boost supply"), not a topic. */
const VERB_LEAD = new Set(('add adds added adding boost boosts boosted drill drills drilled drilling cut cuts raise raises raised increase '
  + 'increases increased reduce reduces reduced ease eases eased take takes took make makes made give gives set sets start starts '
  + 'started begin begins launch launches launched sign signs signed approve approves approved expect expects face faces hit hits '
  + 'hike hikes hiked meet meets ensure ensures supply supplies supplied import imports imported export exports keep keeps bring '
  + 'brings help helps go goes went get gets got see sees continue continues need needs face run runs').split(' '))

/**
 * Inflected verbs that end a topic wherever they sit: "Interconnection Raises Rooppur" is a headline fragment, not
 * something anyone searches. Only unambiguous forms — "supply", "cut" and "import" are nouns too and stay usable.
 */
const VERB_ANY = new Set(('raises raised boosts boosted adds added hikes hiked signs signed approves approved expects expected '
  + 'launches launched begins began starts started says said tells told plans planned eases eased reduces reduced increases '
  + 'increased drops dropped falls fell rises rose reaches reached remains remained becomes became gets got sees saw warns '
  + 'warned urges urged calls called seeks sought wants wanted aims aimed faces faced slashes slashed doubles doubled halts '
  + 'halted resumes resumed wins won loses lost owes owed pays paid buys bought sells sold to will would could should may might '
  + 'is are was were be been being has have had').split(' '))

/** Energy-sector names and topics worth surfacing whenever the story mentions them. */
const LEXICON = [
  'Petrobangla', 'BAPEX', 'BPDB', 'BERC', 'PGCB', 'Power Division', 'Energy and Mineral Resources Division', 'EMRD', 'BREB',
  'DESCO', 'DPDC', 'NESCO', 'WZPDCO', 'BPC', 'RPGCL', 'SREDA', 'Titas Gas', 'Bakhrabad Gas', 'Jalalabad Gas', 'Karnaphuli Gas',
  'Sylhet Gas Fields', 'BGFCL', 'Bibiyana', 'Rashidpur', 'Kailashtila', 'Bhola', 'Rooppur', 'Matarbari', 'Payra', 'Rampal',
  'Barapukuria', 'Adani', 'Summit', 'Chevron', 'QatarEnergy', 'Excelerate', 'Moheshkhali',
  'LNG', 'LPG', 'FSRU', 'spot LNG', 'gas exploration', 'gas field', 'gas supply', 'gas crisis', 'gas price', 'well drilling',
  'load shedding', 'power generation', 'power plant', 'power import', 'electricity tariff', 'electricity price', 'fuel oil',
  'renewable energy', 'solar power', 'rooftop solar', 'wind power', 'energy security', 'national grid', 'transmission line',
  'capacity payment', 'subsidy', 'tariff hike', 'coal-fired', 'nuclear power', 'hydropower', 'energy efficiency',
]

export interface Keyphrase { phrase: string; score: number }

const words = (t: string) => t.match(/[A-Za-z][A-Za-z0-9'’&.-]*[A-Za-z0-9]|[A-Za-z]/g) ?? []
const norm = (t: string) => t.toLowerCase().replace(/[’']/g, "'")
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
export const countPhrase = (text: string, phrase: string) => phrase.trim()
  ? (text.match(new RegExp(`(?<![A-Za-z0-9])${escapeRe(phrase.trim())}(?![A-Za-z0-9])`, 'gi')) ?? []).length
  : 0

/**
 * Keyphrases a reader would search for, best first. Candidates are the sector lexicon, runs of capitalised words
 * (organisations, places, projects) and 2–3-word noun phrases free of stop words; each is scored by where it appears
 * (headline ×3, deck ×2, first paragraph ×1.5, then every further mention) and how specific it is. Bare numbers and
 * money amounts are never keyphrases. A phrase inside a stronger one is dropped ("Sylhet" under "Sylhet gas field").
 */
export function suggestKeyphrases(headline: string, deck: string, body: string, max = 6): Keyphrase[] {
  const paras = body.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean)
  const all = [headline, deck, body].join('\n')
  const cand = new Map<string, { phrase: string; bonus: number }>()
  const add = (p: string, bonus = 0) => {
    const phrase = p.replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9]+$/g, '').replace(/\s+/g, ' ')
    if (phrase.length < 3 || /^\d/.test(phrase)) return
    const ws = phrase.split(' ')
    if (STOP.has(norm(ws[0])) || STOP.has(norm(ws[ws.length - 1]))) return
    if (ws.length === 1 && (GENERIC.has(norm(phrase)) || STOP.has(norm(phrase)))) return
    const k = norm(phrase)
    const cur = cand.get(k)
    if (!cur || cur.bonus < bonus) cand.set(k, { phrase: cur?.phrase && /[A-Z]/.test(cur.phrase) ? cur.phrase : phrase, bonus })
  }

  for (const ent of LEXICON) if (countPhrase(all, ent)) add(ent, 2)

  // Runs of capitalised words (skipping the sentence-initial word unless it is part of a longer run). A headline in
  // Title Case capitalises every word, so its runs say nothing about names — they are read from the deck and body.
  const titleCase = (() => { const ws = words(headline).filter((w) => !STOP.has(norm(w))); return ws.length >= 3 && ws.filter((w) => /^[A-Z]/.test(w)).length / ws.length > 0.7 })()
  for (const sentence of (titleCase ? [deck, body].join('\n') : all).split(/(?<=[.!?:;])\s+|\n+/)) {
    const ws = words(sentence)
    let run: string[] = []
    const flush = () => {
      if (run.length) {
        const phrase = run.join(' ')
        if (run.length > 1 || /^[A-Z]{2,}$/.test(run[0]) || sentence.indexOf(run[0]) > 0) add(phrase, run.length > 1 ? 1.5 : 1)
      }
      run = []
    }
    for (const w of ws) {
      if (/^[A-Z]/.test(w) && !STOP.has(norm(w)) && !VERB_ANY.has(norm(w))) run.push(w)
      else if (run.length && /^(of|and|for)$/i.test(w) && run.length < 4) run.push(w)
      else flush()
    }
    flush()
  }

  // 2- and 3-word phrases without stop words, from the headline, deck and body
  for (const text of [headline, deck, ...paras]) {
    const ws = words(text)
    for (let n = 2; n <= 3; n++) {
      for (let i = 0; i + n <= ws.length; i++) {
        const gram = ws.slice(i, i + n)
        if (gram.some((w) => STOP.has(norm(w)) || VERB_ANY.has(norm(w)) || /^\d/.test(w))) continue
        if (gram.every((w) => GENERIC.has(norm(w)))) continue
        if (new Set(gram.map(norm)).size < gram.length) continue // "gas gas", a stutter, never a topic
        if (VERB_LEAD.has(norm(gram[0]))) continue
        add(gram.join(' '), 0)
      }
    }
  }

  const first = paras[0] ?? ''
  const scored: Keyphrase[] = []
  for (const { phrase, bonus } of cand.values()) {
    const inBody = countPhrase(body, phrase)
    const inHead = countPhrase(headline, phrase)
    const inDeck = countPhrase(deck, phrase)
    const inFirst = countPhrase(first, phrase)
    const mentions = inBody + inHead + inDeck
    // a plain n-gram has to recur, or sit in the headline, to count as what the story is about — and in a Title Case
    // headline any run of words looks like a name, so there it must also appear in the deck or body
    if (bonus === 0 && mentions < 2 && !inHead) continue
    if (bonus === 0 && titleCase && !inBody && !inDeck) continue
    const len = phrase.split(' ').length
    const score = inHead * 3 + inDeck * 2 + inFirst * 1.5 + Math.min(inBody, 6) + bonus + (len >= 2 ? 1 : 0) + (len === 3 ? 0.5 : 0)
    if (score > 0) scored.push({ phrase, score: Math.round(score * 10) / 10 })
  }
  scored.sort((a, b) => b.score - a.score || b.phrase.length - a.phrase.length)

  // One entry per idea: a phrase inside a kept one is dropped, and a longer phrase that is nearly as strong replaces the
  // shorter one it contains ("Sylhet gas field" over "gas field").
  const out: Keyphrase[] = []
  for (const k of scored) {
    const kn = norm(k.phrase)
    if (out.some((o) => norm(o.phrase).includes(kn))) continue
    const sub = out.findIndex((o) => kn.includes(norm(o.phrase)))
    if (sub >= 0) {
      if (k.score >= out[sub].score * 0.6) out[sub] = { phrase: k.phrase, score: Math.max(k.score, out[sub].score) }
      continue
    }
    out.push(k)
  }
  // a replacement can duplicate an idea already in the list; keep the first
  const seen: string[] = []
  return out.filter((o) => { const n = norm(o.phrase); if (seen.some((x) => x.includes(n) || n.includes(x))) return false; seen.push(n); return true }).slice(0, max)
}

// ---------------------------------------------------------------- checks

export type SeoStatus = 'good' | 'warn' | 'bad'
export interface SeoCheck {
  id: string
  group: 'Keyphrase' | 'Search snippet' | 'Content'
  status: SeoStatus
  label: string
  detail: string
  /** Why it matters, in a line, and where the rule comes from. */
  why?: string
  /** 'google': stated in Google Search Central's documentation. 'practice': current newsroom SEO practice. */
  src?: 'google' | 'practice'
  /** What can repair it: the SEO fields, the story's wording/structure (no new facts), a photo (manual), or reporting (manual). */
  fix?: 'fields' | 'body' | 'photo' | 'reporting'
}

const CHECK_META: Record<string, { why: string; src: 'google' | 'practice'; fix: 'fields' | 'body' | 'photo' | 'reporting' }> = {
  'kp-set': { why: 'Write for the words readers actually search for (Google SEO Starter Guide).', src: 'google', fix: 'fields' },
  'kp-h1': { why: 'The page heading is a title-link source: it should say what the page is about (Google, title links).', src: 'google', fix: 'fields' },
  'kp-title': { why: 'Google builds the result title from the <title>; the main phrase belongs in the part that shows (Google, title links).', src: 'google', fix: 'fields' },
  'kp-desc': { why: 'Google bolds the words a reader searched for in the snippet (Google, snippets).', src: 'google', fix: 'fields' },
  'kp-slug': { why: 'Readable words in the URL help readers and appear in results (Google, URL structure).', src: 'google', fix: 'fields' },
  'kp-intro': { why: 'The opening paragraph should state the topic plainly (people-first, inverted-pyramid news writing).', src: 'practice', fix: 'body' },
  'kp-density': { why: 'No ideal density exists; stuffing breaks Google’s spam policies, so use it naturally.', src: 'google', fix: 'body' },
  'kp-unique': { why: 'Two stories chasing one query compete with each other.', src: 'practice', fix: 'fields' },
  'title-len': { why: 'Titles should be concise and descriptive; Google cuts long ones (Google, title links).', src: 'google', fix: 'fields' },
  'desc-len': { why: 'No set limit, but Google truncates to the device width; the site cuts at 160 (Google, snippets).', src: 'google', fix: 'fields' },
  'desc-own': { why: 'A description written for the page is more accurate than a sentence Google picks (Google, snippets).', src: 'google', fix: 'fields' },
  'slug': { why: 'Short, readable, lowercase words joined by hyphens (Google, URL structure).', src: 'google', fix: 'fields' },
  'length': { why: 'Google sets no minimum word count: cover the story fully, for people first (Google Search Essentials).', src: 'google', fix: 'reporting' },
  'lede': { why: 'A news lede answers who, what and where at once; it helps readers and snippets.', src: 'practice', fix: 'body' },
  'sentences': { why: 'Clear, well-organised writing is the people-first standard (Google SEO Starter Guide).', src: 'google', fix: 'body' },
  'paragraphs': { why: 'Short paragraphs read better on a phone, where most readers are.', src: 'practice', fix: 'body' },
  'image': { why: 'A sharp photo near the text with short descriptive alt text (Google, image SEO).', src: 'google', fix: 'fields' },
  'tags': { why: 'A few specific tags name the organisations, places and topic for readers and topic pages.', src: 'practice', fix: 'fields' },
}

export interface SeoInput {
  headline: string
  deck: string
  body: string
  slug: string
  metaTitle: string
  metaDescription: string
  keyphrase: string
  tags: string[]
  hasImage: boolean
  /** The featured image's alt text (seo.heroImage.alt); empty means the site falls back to the headline. */
  imageAlt?: string
  /** Titles of stories already on the site, to catch two articles chasing the same keyphrase. */
  publishedTitles?: string[]
}

/** The <title> the site renders: the editor's SEO title, else the headline. No site-name suffix (see the header). */
export const effectiveTitle = (i: Pick<SeoInput, 'metaTitle' | 'headline'>) => (i.metaTitle.trim() || i.headline.trim())
/** The description the site renders: the editor's meta description, else the deck — cut at 160 like lib/seo.ts. */
export const effectiveDescription = (i: Pick<SeoInput, 'metaDescription' | 'deck'>) => cleanDescription(i.metaDescription.trim() || i.deck.trim())

/** esbpowerline.com lib/seo.ts DESCRIPTION_MAX: the site cuts anything longer. */
export const DESCRIPTION_MAX = 160
/** Google's desktop result shows about 580 px of a 20 px Arial title before it cuts with "…". */
export const TITLE_MAX_PX = 580

/** The site's cleanDescription: cut at the last sentence end past half the limit, else the last word, with "…". */
export function cleanDescription(text: string, max = DESCRIPTION_MAX): string {
  const t = text.replace(/\s+/g, ' ').trim()
  if (t.length <= max) return t
  const cut = t.slice(0, max)
  const sentence = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? '))
  if (sentence >= max * 0.5) return cut.slice(0, sentence + 1)
  const word = cut.lastIndexOf(' ')
  return (word > 0 ? cut.slice(0, word) : cut).replace(/[,;:\-–—]$/, '') + '…'
}

let measureCtx: CanvasRenderingContext2D | null | undefined
/** Width of a title as Google sets it (20 px Arial). Without a canvas (tests), ~9.4 px a character is the average. */
export function titlePixels(t: string): number {
  if (measureCtx === undefined) {
    try { measureCtx = typeof document !== 'undefined' ? document.createElement('canvas').getContext('2d') : null } catch { measureCtx = null }
    if (measureCtx) measureCtx.font = '20px Arial, Helvetica, sans-serif'
  }
  return measureCtx ? measureCtx.measureText(t).width : t.length * 9.4
}

/** The title as Google shows it: whole if it fits, else cut at a word with " …". */
export function visibleTitle(t: string, maxPx = TITLE_MAX_PX): string {
  if (titlePixels(t) <= maxPx) return t
  const ws = t.split(' ')
  while (ws.length > 1 && titlePixels(ws.join(' ') + ' …') > maxPx) ws.pop()
  return ws.join(' ').replace(/[,:;–—-]+$/, '') + ' …'
}

const sentencesOf = (t: string) => t.split(/(?<=[.!?])\s+(?=[A-Z"“‘(])/).map((s) => s.trim()).filter((s) => s.length > 1)

/** Words a slug leaves out (buildSlug), so the slug check must not ask for them either. */
const SLUG_STOP = new Set('a an the and or but of in on at to for from by with as is are was were be been will would has have had its into that this than over under after says said tk taka bdt crore lakh'.split(' '))
const slugWordsOf = (t: string) => words(t).map((w) => norm(w).replace(/[^a-z0-9]/g, '')).filter((w) => w && !SLUG_STOP.has(w) && !/^\d/.test(w))

export function analyzeSeo(i: SeoInput): SeoCheck[] {
  const checks: SeoCheck[] = []
  const add = (c: SeoCheck) => checks.push(c)
  const kp = i.keyphrase.trim()
  const title = effectiveTitle(i)
  const desc = effectiveDescription(i)
  const paras = i.body.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean)
  const bodyWords = words(i.body).length
  const slugWords = i.slug.split('-').filter(Boolean)
  const shown = visibleTitle(title)
  const titleCut = shown !== title

  // Keyphrase
  if (!kp) {
    add({ id: 'kp-set', group: 'Keyphrase', status: 'bad', label: 'Focus keyphrase', detail: 'Pick the phrase readers would search for — the suggestions come from this story.' })
  } else {
    const kpWords = kp.split(/\s+/).length
    add({ id: 'kp-set', group: 'Keyphrase', status: kpWords > 4 ? 'warn' : 'good', label: 'Focus keyphrase', detail: kpWords > 4 ? `${kpWords} words — searches are 1–4 words; pick the core of it.` : `“${kp}”` })
    add({ id: 'kp-h1', group: 'Keyphrase', status: countPhrase(i.headline, kp) ? 'good' : 'warn', label: 'In the headline', detail: countPhrase(i.headline, kp) ? 'The headline (the page’s H1) uses it.' : 'The headline does not use it — the H1 is the strongest signal on the page.' })
    // what matters for a title is whether the keyphrase is in the part Google shows, not which half it is in
    const inTitle = countPhrase(title, kp) > 0
    const inShown = countPhrase(shown.replace(/ …$/, ''), kp) > 0
    add({ id: 'kp-title', group: 'Keyphrase', status: !inTitle ? 'bad' : inShown ? 'good' : 'warn', label: 'In the SEO title', detail: !inTitle ? 'The SEO title does not contain it.' : inShown ? 'In the part of the title Google shows.' : 'Only after the point where Google cuts the title — move it earlier.' })
    add({ id: 'kp-desc', group: 'Keyphrase', status: countPhrase(desc, kp) ? 'good' : 'bad', label: 'In the meta description', detail: countPhrase(desc, kp) ? 'Search engines bold it in the snippet.' : 'Add it to the description — Google bolds the words a reader searched for.' })
    const need = slugWordsOf(kp)
    const missing = need.filter((w) => !slugWords.includes(w))
    add({ id: 'kp-slug', group: 'Keyphrase', status: !need.length || !missing.length ? 'good' : 'warn', label: 'In the URL slug', detail: !missing.length ? 'The slug carries it.' : `The slug lacks “${missing.join('”, “')}”.` })
    add({ id: 'kp-intro', group: 'Keyphrase', status: countPhrase(paras[0] ?? '', kp) ? 'good' : 'warn', label: 'In the first paragraph', detail: countPhrase(paras[0] ?? '', kp) ? 'The opening paragraph names it.' : 'Mention it in the opening paragraph.' })
    const n = countPhrase(i.body, kp)
    const density = bodyWords ? (n * kpWords * 100) / bodyWords : 0
    add({ id: 'kp-density', group: 'Keyphrase', status: n === 0 ? 'bad' : density > 3 ? 'warn' : 'good', label: 'Used in the story', detail: n === 0 ? 'The story body never uses it.' : `${n} time${n === 1 ? '' : 's'} (${density.toFixed(1)}% of words)${density > 3 ? ' — that reads as stuffing.' : '.'}` })
    const clash = (i.publishedTitles ?? []).find((t) => countPhrase(t, kp) > 0)
    add({ id: 'kp-unique', group: 'Keyphrase', status: clash ? 'warn' : 'good', label: 'Not already targeted', detail: clash ? `A published story already uses it: “${clash}”.` : 'No published story on the site uses it in its title.' })
  }

  // Search snippet — measured the way the site renders it and Google shows it
  const px = Math.round(titlePixels(title))
  add({ id: 'title-len', group: 'Search snippet', status: !title ? 'bad' : titleCut || title.length < 30 ? 'warn' : 'good', label: 'SEO title length', detail: !title ? 'No title yet.' : titleCut ? `${title.length} characters (${px} px) — Google cuts it after “${shown.replace(/ …$/, '').split(' ').slice(-3).join(' ')}”.` : title.length < 30 ? `${title.length} characters — short; there is room for more of the story.` : `${title.length} characters, fits in the result.` })
  const typed = (i.metaDescription.trim() || i.deck.trim()).replace(/\s+/g, ' ')
  const dl = desc.length
  add({ id: 'desc-len', group: 'Search snippet', status: dl === 0 ? 'bad' : typed.length > DESCRIPTION_MAX || dl < 120 ? 'warn' : 'good', label: 'Meta description length', detail: dl === 0 ? 'Empty — Google will pick a sentence itself.' : typed.length > DESCRIPTION_MAX ? `${typed.length} characters — the site cuts it at ${DESCRIPTION_MAX}; aim for 120–${DESCRIPTION_MAX}.` : dl < 120 ? `${dl} characters — short; aim for 120–${DESCRIPTION_MAX}.` : `${dl} characters.` })
  if (!i.metaDescription.trim() && dl) add({ id: 'desc-own', group: 'Search snippet', status: 'warn', label: 'Written for search', detail: 'No meta description — the site uses the deck. Build one that names the keyphrase.' })
  const slugOk = /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(i.slug)
  add({ id: 'slug', group: 'Search snippet', status: !i.slug ? 'bad' : !slugOk || i.slug.length > 75 || slugWords.length > 10 ? 'warn' : 'good', label: 'URL slug', detail: !i.slug ? 'No slug yet.' : !slugOk ? 'Use lowercase words joined by hyphens.' : i.slug.length > 75 ? `${i.slug.length} characters — shorter URLs are easier to share.` : slugWords.length > 10 ? `${slugWords.length} words — trim it to the essentials.` : `${slugWords.length} words, ${i.slug.length} characters.` })

  // Content
  add({ id: 'length', group: 'Content', status: bodyWords < 80 ? 'bad' : bodyWords < 150 ? 'warn' : 'good', label: 'Story length', detail: `${bodyWords} words${bodyWords < 80 ? ' — too thin to cover the story; report more.' : bodyWords < 150 ? ' — short; add the context a reader would ask for (Google sets no minimum).' : '.'}` })
  const lede = words(paras[0] ?? '').length
  add({ id: 'lede', group: 'Content', status: !lede ? 'warn' : lede > 60 ? 'warn' : 'good', label: 'Lede', detail: !lede ? 'No opening paragraph yet.' : lede > 60 ? `${lede} words — a news lede reads best under 45; move detail down.` : `${lede} words.` })
  const sents = sentencesOf(i.body)
  const long = sents.filter((x) => words(x).length > 25).length
  const longPct = sents.length ? Math.round((long * 100) / sents.length) : 0
  add({ id: 'sentences', group: 'Content', status: longPct > 30 ? 'warn' : 'good', label: 'Sentence length', detail: sents.length ? `${longPct}% of sentences run over 25 words${longPct > 30 ? ' — split some for easier reading.' : '.'}` : 'No sentences yet.' })
  const bigPara = paras.filter((p) => words(p).length > 150).length
  add({ id: 'paragraphs', group: 'Content', status: bigPara ? 'warn' : 'good', label: 'Paragraph length', detail: bigPara ? `${bigPara} paragraph${bigPara === 1 ? ' is' : 's are'} over 150 words — break ${bigPara === 1 ? 'it' : 'them'} up.` : 'Every paragraph is under 150 words.' })
  const alt = (i.imageAlt ?? '').trim()
  add({ id: 'image', group: 'Content', status: !i.hasImage ? 'warn' : !alt ? 'warn' : 'good', label: 'Featured image', detail: !i.hasImage ? 'No featured image — stories with one get more clicks from search and social.' : !alt ? 'No alt text — the site falls back to the headline. Describe what the photo shows.' : `Alt text: “${alt.length > 70 ? alt.slice(0, 68) + '…' : alt}”.` })
  add({ id: 'tags', group: 'Content', status: i.tags.length >= 3 && i.tags.length <= 8 ? 'good' : 'warn', label: 'Tags', detail: `${i.tags.length} tag${i.tags.length === 1 ? '' : 's'}${i.tags.length < 3 ? ' — add 3 to 8 that name the organisations, places and topic.' : i.tags.length > 8 ? ' — keep it to the 8 that matter most.' : '.'}` })
  return checks.map((c) => {
    const m = CHECK_META[c.id]
    // no photo cannot be fixed by writing: it needs a picture
    return m ? { ...c, ...m, fix: c.id === 'image' && !i.hasImage ? 'photo' : m.fix } : c
  })
}

/**
 * An SEO title that Google shows whole (≤ 60 characters and ≤ 580 px) and that carries the keyphrase. In order: the
 * headline itself; the headline cut at a clause boundary ("… in Sylhet gas field | for Tk 592 crore"); the keyphrase
 * leading a shortened headline; a word-boundary cut. No site-name suffix — the site does not render one.
 */
export function buildMetaTitle(headline: string, keyphrase: string): string {
  const h = headline.replace(/\s+/g, ' ').trim()
  const kp = keyphrase.trim()
  const fits = (t: string) => t.length <= 60 && titlePixels(t) <= TITLE_MAX_PX
  const has = (t: string) => !kp || countPhrase(t, kp) > 0
  if (fits(h) && has(h)) return h
  // clause boundaries, longest prefix first: a title that stops at "for Tk 592 crore" still reads as a sentence
  const cuts: string[] = []
  const re = /,\s|\s[–—:-]\s|:\s|\s(?=(?:as|after|amid|while|despite|with|following|ahead of|for|by|in|on|over|under|to|from|at)\s)/g
  for (let m; (m = re.exec(h)); ) cuts.push(h.slice(0, m.index).replace(/[,:;–—-]+$/, '').trim())
  for (const c of cuts.sort((a, b) => b.length - a.length)) if (c.split(' ').length >= 4 && fits(c) && has(c)) return c
  const kpLed = (() => {
    if (!kp) return h
    const pos = norm(h).indexOf(norm(kp))
    const rest = pos >= 0 ? (h.slice(0, pos) + h.slice(pos + kp.length)).replace(/\s+(in|at|for|on|of|to)\s*$/i, '').replace(/\s{2,}/g, ' ').trim() : h
    return `${kp.charAt(0).toUpperCase()}${kp.slice(1)}: ${rest}`
  })()
  if (fits(kpLed)) return kpLed
  const ws = kpLed.split(' ')
  while (ws.length > 3 && !fits(ws.join(' '))) ws.pop()
  while (ws.length > 3 && (STOP.has(norm(ws[ws.length - 1])) || VERB_LEAD.has(norm(ws[ws.length - 1])) || VERB_ANY.has(norm(ws[ws.length - 1])))) ws.pop()
  return ws.join(' ').replace(/[,:;–—-]+$/, '')
}

/** 120–160 characters, from the deck and the opening of the story, containing the keyphrase when the story does. */
export function buildMetaDescription(deck: string, body: string, keyphrase: string): string {
  // Lead with the deck if it names the keyphrase, else with the story's first sentence that does; then add whole
  // sentences while they fit, so the snippet ends on a full stop rather than mid-word.
  const pieces = [deck.replace(/\s+/g, ' ').trim(), ...sentencesOf(body)].filter(Boolean)
  const lead = (keyphrase && pieces.find((p) => countPhrase(p, keyphrase))) || pieces[0] || ''
  let d = lead
  for (const p of pieces) {
    if (p === lead || d.includes(p)) continue
    if (d.length >= 120) break
    if (d.length + 1 + p.length <= DESCRIPTION_MAX) d = `${d} ${p}`
  }
  return cleanDescription(d)
}

/** Short, keyphrase-first slug: lowercase words, no stop words, at most 8 words / 75 characters. */

export function buildSlug(headline: string, keyphrase: string): string {
  // a slug keeps meaning words ("two new wells") and drops grammar and currency words; amounts do not belong in URLs
  const pick = slugWordsOf
  const out: string[] = []
  for (const w of [...pick(keyphrase), ...pick(headline)]) if (!out.includes(w)) out.push(w)
  let slug = out.slice(0, 8).join('-')
  while (slug.length > 75) slug = slug.slice(0, slug.lastIndexOf('-'))
  return slug
}
