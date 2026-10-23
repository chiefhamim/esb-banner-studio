// SEO for the Editorial desk: keyphrase suggestions drawn from the story itself, and the checks a news SEO plugin
// runs (Yoast / Rank Math style) — computed from the draft, never guessed. Everything here is pure and unit-tested.

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

  // Runs of capitalised words (skipping the sentence-initial word unless it is part of a longer run)
  for (const sentence of all.split(/(?<=[.!?:;])\s+|\n+/)) {
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
      if (/^[A-Z]/.test(w) && !STOP.has(norm(w))) run.push(w)
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
        if (gram.some((w) => STOP.has(norm(w)) || /^\d/.test(w))) continue
        if (gram.every((w) => GENERIC.has(norm(w)))) continue
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
    // a plain n-gram has to recur, or sit in the headline, to count as what the story is about
    if (bonus === 0 && mentions < 2 && !inHead) continue
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
export interface SeoCheck { id: string; group: 'Keyphrase' | 'Search snippet' | 'Content'; status: SeoStatus; label: string; detail: string }

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
  /** Titles of stories already on the site, to catch two articles chasing the same keyphrase. */
  publishedTitles?: string[]
}

export const SITE_SUFFIX = ' | ESB PowerLine'
export const effectiveTitle = (i: Pick<SeoInput, 'metaTitle' | 'headline'>) => (i.metaTitle.trim() || `${i.headline.trim()}${SITE_SUFFIX}`)
export const effectiveDescription = (i: Pick<SeoInput, 'metaDescription' | 'deck'>) => (i.metaDescription.trim() || i.deck.trim())

const sentencesOf = (t: string) => t.split(/(?<=[.!?])\s+(?=[A-Z"“‘(])/).map((s) => s.trim()).filter((s) => s.length > 1)

export function analyzeSeo(i: SeoInput): SeoCheck[] {
  const checks: SeoCheck[] = []
  const add = (c: SeoCheck) => checks.push(c)
  const kp = i.keyphrase.trim()
  const title = effectiveTitle(i)
  const desc = effectiveDescription(i)
  const paras = i.body.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean)
  const bodyWords = words(i.body).length
  const slugWords = i.slug.split('-').filter(Boolean)

  // Keyphrase
  if (!kp) {
    add({ id: 'kp-set', group: 'Keyphrase', status: 'bad', label: 'Focus keyphrase', detail: 'Pick the phrase readers would search for — the suggestions come from this story.' })
  } else {
    const kpWords = kp.split(/\s+/).length
    add({ id: 'kp-set', group: 'Keyphrase', status: kpWords > 4 ? 'warn' : 'good', label: 'Focus keyphrase', detail: kpWords > 4 ? `"${kp}" is ${kpWords} words; 1–4 words is what people type.` : `"${kp}"` })
    const inTitle = countPhrase(title, kp) > 0
    const titleLead = norm(title).indexOf(norm(kp))
    add({ id: 'kp-title', group: 'Keyphrase', status: inTitle ? (titleLead <= title.length / 2 ? 'good' : 'warn') : 'bad', label: 'In the SEO title', detail: inTitle ? (titleLead <= title.length / 2 ? 'Appears in the first half of the title.' : 'Appears late in the title — move it nearer the start.') : 'The SEO title does not contain the keyphrase.' })
    add({ id: 'kp-desc', group: 'Keyphrase', status: countPhrase(desc, kp) ? 'good' : 'bad', label: 'In the meta description', detail: countPhrase(desc, kp) ? 'Search engines bold it in the snippet.' : 'Add the keyphrase to the description.' })
    const slugHas = kp.toLowerCase().split(/\s+/).every((w) => slugWords.includes(w.replace(/[^a-z0-9]/g, '')))
    add({ id: 'kp-slug', group: 'Keyphrase', status: slugHas ? 'good' : 'warn', label: 'In the URL slug', detail: slugHas ? 'The slug carries the keyphrase.' : 'The slug does not contain every word of the keyphrase.' })
    add({ id: 'kp-intro', group: 'Keyphrase', status: countPhrase(paras[0] ?? '', kp) ? 'good' : 'warn', label: 'In the first paragraph', detail: countPhrase(paras[0] ?? '', kp) ? 'The opening paragraph names it.' : 'Mention it in the opening paragraph.' })
    const n = countPhrase(i.body, kp)
    const density = bodyWords ? (n * kpWords * 100) / bodyWords : 0
    add({ id: 'kp-density', group: 'Keyphrase', status: n === 0 ? 'bad' : density > 3 ? 'warn' : 'good', label: 'Used in the story', detail: n === 0 ? 'The story body never uses it.' : `${n} time${n === 1 ? '' : 's'} (${density.toFixed(1)}% of words)${density > 3 ? ' — that reads as stuffing.' : '.'}` })
    const clash = (i.publishedTitles ?? []).find((t) => countPhrase(t, kp) > 0)
    add({ id: 'kp-unique', group: 'Keyphrase', status: clash ? 'warn' : 'good', label: 'Not already targeted on the site', detail: clash ? `A published story also uses it: "${clash}".` : 'No published story on the site uses it in its title.' })
  }

  // Search snippet
  const tl = title.length
  add({ id: 'title-len', group: 'Search snippet', status: tl > 60 ? 'warn' : tl < 30 ? 'warn' : 'good', label: 'SEO title length', detail: `${tl} characters${tl > 60 ? ' — Google cuts titles at about 60.' : tl < 30 ? ' — short; there is room for more of the story.' : '.'}` })
  const dl = desc.length
  add({ id: 'desc-len', group: 'Search snippet', status: dl === 0 ? 'bad' : dl < 120 || dl > 158 ? 'warn' : 'good', label: 'Meta description length', detail: dl === 0 ? 'Empty — Google will pick a sentence itself.' : `${dl} characters${dl > 158 ? ' — will be cut off; aim for 120–158.' : dl < 120 ? ' — short; aim for 120–158.' : '.'}` })
  const slugOk = /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(i.slug)
  add({ id: 'slug', group: 'Search snippet', status: !i.slug ? 'bad' : !slugOk || i.slug.length > 75 ? 'warn' : slugWords.length > 10 ? 'warn' : 'good', label: 'URL slug', detail: !i.slug ? 'No slug yet.' : !slugOk ? 'Use lowercase words joined by hyphens.' : i.slug.length > 75 ? `${i.slug.length} characters — shorter URLs are easier to share.` : slugWords.length > 10 ? `${slugWords.length} words — trim it to the essentials.` : `${slugWords.length} words, ${i.slug.length} characters.` })

  // Content
  add({ id: 'length', group: 'Content', status: bodyWords < 150 ? 'bad' : bodyWords < 300 ? 'warn' : 'good', label: 'Story length', detail: `${bodyWords} words${bodyWords < 150 ? ' — very short for search; add context or background.' : bodyWords < 300 ? ' — fine for a brief; 300+ ranks better.' : '.'}` })
  const sents = sentencesOf(i.body)
  const long = sents.filter((s) => words(s).length > 25).length
  const longPct = sents.length ? Math.round((long * 100) / sents.length) : 0
  add({ id: 'sentences', group: 'Content', status: longPct > 30 ? 'warn' : 'good', label: 'Sentence length', detail: sents.length ? `${longPct}% of sentences run over 25 words${longPct > 30 ? ' — split some for easier reading.' : '.'}` : 'No sentences yet.' })
  const bigPara = paras.filter((p) => words(p).length > 150).length
  add({ id: 'paragraphs', group: 'Content', status: bigPara ? 'warn' : 'good', label: 'Paragraph length', detail: bigPara ? `${bigPara} paragraph${bigPara === 1 ? ' is' : 's are'} over 150 words — break ${bigPara === 1 ? 'it' : 'them'} up.` : 'Every paragraph is under 150 words.' })
  add({ id: 'image', group: 'Content', status: i.hasImage ? 'good' : 'warn', label: 'Featured image', detail: i.hasImage ? 'Set; its alt text is the headline.' : 'No featured image — stories with one get more clicks from search and social.' })
  add({ id: 'tags', group: 'Content', status: i.tags.length >= 3 && i.tags.length <= 8 ? 'good' : 'warn', label: 'Tags', detail: `${i.tags.length} tag${i.tags.length === 1 ? '' : 's'}${i.tags.length < 3 ? ' — add 3 to 8 that name the organisations, places and topic.' : i.tags.length > 8 ? ' — keep it to the 8 that matter most.' : '.'}` })
  return checks
}

/** SEO title led by the keyphrase where the headline allows, within 60 characters including the site name. */
export function buildMetaTitle(headline: string, keyphrase: string): string {
  // Google shows about 60 characters and prints the site name above the result anyway, so the " | ESB PowerLine"
  // suffix is the first thing to go when space is short — never the keyphrase, and never mid-phrase.
  const h = headline.replace(/\s+/g, ' ').trim()
  const kp = keyphrase.trim()
  const fits = (t: string) => t.length <= 60
  const has = (t: string) => !kp || countPhrase(t, kp) > 0
  const kpLed = (() => {
    if (!kp) return h
    const pos = norm(h).indexOf(norm(kp))
    const rest = pos >= 0 ? (h.slice(0, pos) + h.slice(pos + kp.length)).replace(/\s+(in|at|for|on|of|to)\s*$/i, '').replace(/\s{2,}/g, ' ').trim() : h
    return `${kp.charAt(0).toUpperCase()}${kp.slice(1)}: ${rest}`
  })()
  for (const t of [h + SITE_SUFFIX, h, kpLed + SITE_SUFFIX, kpLed]) if (fits(t) && has(t)) return t
  // still too long: cut at a word boundary and drop dangling small words ("to", "two", "of")
  const ws = kpLed.slice(0, 61).split(' ')
  ws.pop()
  while (ws.length > 3 && (STOP.has(norm(ws[ws.length - 1])) || VERB_LEAD.has(norm(ws[ws.length - 1])))) ws.pop()
  return ws.join(' ').replace(/[,:;–—-]+$/, '')
}

/** 120–158 characters, from the deck and the opening of the story, containing the keyphrase when the story does. */
export function buildMetaDescription(deck: string, body: string, keyphrase: string): string {
  // Lead with the deck if it names the keyphrase, else with the story's first sentence that does; then add whole
  // sentences while they fit, so the snippet ends on a full stop rather than mid-word.
  const pieces = [deck.replace(/\s+/g, ' ').trim(), ...sentencesOf(body)].filter(Boolean)
  const lead = (keyphrase && pieces.find((p) => countPhrase(p, keyphrase))) || pieces[0] || ''
  let d = lead
  for (const p of pieces) {
    if (p === lead || d.includes(p)) continue
    if (d.length >= 120) break
    if (d.length + 1 + p.length <= 158) d = `${d} ${p}`
  }
  if (d.length > 158) {
    const cut = d.slice(0, 157)
    d = cut.slice(0, cut.lastIndexOf(' ')).replace(/[,:;–—-]+$/, '') + '…'
  }
  return d
}

/** Short, keyphrase-first slug: lowercase words, no stop words, at most 8 words / 75 characters. */
const SLUG_STOP = new Set('a an the and or but of in on at to for from by with as is are was were be been will would has have had its into that this than over under after says said tk taka bdt crore lakh'.split(' '))

export function buildSlug(headline: string, keyphrase: string): string {
  // a slug keeps meaning words ("two new wells") and drops grammar and currency words; amounts do not belong in URLs
  const pick = (t: string) => words(t).map((w) => norm(w).replace(/[^a-z0-9]/g, '')).filter((w) => w && !SLUG_STOP.has(w) && !/^\d/.test(w))
  const out: string[] = []
  for (const w of [...pick(keyphrase), ...pick(headline)]) if (!out.includes(w)) out.push(w)
  let slug = out.slice(0, 8).join('-')
  while (slug.length > 75) slug = slug.slice(0, slug.lastIndexOf('-'))
  return slug
}
