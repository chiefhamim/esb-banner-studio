import { aiFor, aiJson, aiPaused, providerMeta, type AiSchema } from '../editorial/aiProviders'
import type { Contact, OutreachBlueprint, OutreachBlueprintId, OutreachLang, Source, TalkingPoint } from './types'
import { PLACEHOLDERS } from './compose'
import { unsourcedNumbers } from './checks'

export const OUTREACH_BLUEPRINTS: OutreachBlueprint[] = [
  {
    id: 'magazine_distribution',
    label: 'Magazine Distribution',
    tag: 'Distribution',
    defaultSubject: 'Complimentary Executive Copy: ESB PowerLine Bangladesh Energy Directory & Magazine ({organization})',
    defaultBody: `Dear {name},

Greetings from ESB PowerLine (https://esbpowerline.com).

In your capacity as {designation} at {organization}, we are pleased to present the latest executive edition of ESB PowerLine Magazine, featuring our comprehensive census of Bangladesh's national energy ecosystem.

Our editorial and technical research desk has cataloged strategic developments across power generation, transmission reliability, regional distribution, and clean energy transitions. As a key institutional stakeholder in {sector}, we would be honoured to provide your leadership desk with ongoing complimentary print and digital editions.

Please find our editorial prospectus attached. Should you wish to update your official institutional listing or nominate key colleagues to receive future issues, please feel free to reply directly.

With highest regards,

Executive Outreach Desk
ESB PowerLine — Express Broadcast and Communication Ltd.
Dhaka, Bangladesh | https://esbpowerline.com`,
    bengaliSubject: 'ইএসবি পাওয়ারলাইন ম্যাগাজিন ও বাংলাদেশ এনার্জি ডিরেক্টরি — সম্মানিত কপি প্রদান ({organization})',
    bengaliBody: `শ্রদ্ধেয় {name},

আসসালামু আলাইকুম।

{organization}-এর {designation} হিসেবে জাতীয় জ্বালানি ও বিদ্যুৎ খাতে আপনার সার্বিক নেতৃত্ব অত্যন্ত প্রশংসনীয়।

দেশের বিদ্যুৎ, জ্বালানি ও নবায়নযোগ্য শক্তি খাতের সামগ্রিক নীতি-উন্নয়ন, মেগা প্রকল্প ও প্রযুক্তিগত অগ্রগতির বস্তুনিষ্ঠ তথ্যচিত্র তুলে ধরতে ‘ইএসবি পাওয়ারলাইন’ (https://esbpowerline.com) নিয়মিতভাবে বিশ্লেষণধর্মী বিশেষ প্রতিবেদন ও সমন্বিত ইন্ডাস্ট্রি ডিরেক্টরি প্রকাশ করে আসছে।

{sector}-এর সম্মানিত নীতি-নির্ধারক ও শীর্ষ ব্যক্তিত্ব হিসেবে আপনার সদয় অবগতির জন্য আমাদের সাম্প্রতিক বিশেষ সংখ্যার একটি অনুলিপি ও প্রস্পেক্টাস সংযুক্ত করা হলো। আপনার দপ্তরের সম্মানিত কর্মকর্তাদের জন্য নিয়মিত প্রকাশনা নিশ্চিত করতে অথবা কোনো মতামত জানাতে অনুগ্রহপূর্বক এই ইমেইলে প্রত্যুত্তর প্রদান করুন।

শ্রদ্ধা ও শুভকামনাসহ,

আউটরিচ ও জনসংযোগ সেল
ইএসবি পাওয়ারলাইন (ESB PowerLine)
ঢাকা, বাংলাদেশ | https://esbpowerline.com`,
  },
  {
    id: 'corporate_sponsorship',
    label: 'Corporate Sponsorship & Rate Card',
    tag: 'Sponsorship',
    defaultSubject: 'Partnership & Institutional Brand Feature: ESB PowerLine Energy Directory ({organization})',
    defaultBody: `Dear {name},

On behalf of ESB PowerLine (https://esbpowerline.com), Bangladesh's premier energy and infrastructure publishing platform, we invite {organization} to partner with us for our upcoming national energy supplement.

As {designation}, your perspective on industry modernization and sustainable infrastructure aligns directly with the themes of our high-circulation print annual and web portal. We are offering exclusive institutional profile spreads, technical advertorials, and prominent leadership placements to showcase {organization}'s achievements before key decision-makers at MPEMR, BERC, utilities, and international development partners.

Our comprehensive Media Kit, Editorial Calendar, and Corporate Rate Card are attached for your review. We welcome an exploratory dialogue with your communications team at your earliest convenience.

Sincerely,

Strategic Partnerships Desk
ESB PowerLine | Dhaka, Bangladesh`,
    bengaliSubject: 'কর্পোরেট পার্টনারশিপ ও ব্র্যান্ড প্রোফাইল সুযোগ: ইএসবি পাওয়ারলাইন ({organization})',
    bengaliBody: `শ্রদ্ধেয় {name},

শুভেচ্ছা গ্রহণ করবেন।

বাংলাদেশের বিদ্যুৎ ও জ্বালানি খাতের শীর্ষ নীতিনির্ধারক, করপোরেট প্রতিষ্ঠান ও উন্নয়ন সহযোগীদের মাঝে সেতুবন্ধন রচনায় ‘ইএসবি পাওয়ারলাইন’ নিয়মিতভাবে বিশেষ ক্রোড়পত্র ও ডিরেক্টরি প্রকাশ করে থাকে।

{organization}-এর অভূতপূর্ব অগ্রগতি ও মাইলফলকসমূহ জাতীয় ও আন্তর্জাতিক মহলে তুলে ধরার লক্ষ্যে আমাদের আসন্ন বিশেষ সংখ্যায় প্রাতিষ্ঠানিক অংশীদারিত্ব ও ব্র্যান্ড স্পনসরশিপের জন্য আপনাদের সাদর আমন্ত্রণ জানাচ্ছি। আমাদের পূর্ণাঙ্গ রেটকার্ড ও মিডিয়া কিট সংযুক্ত রয়েছে।

আপনার সুবিধাজনক সময়ে এ বিষয়ে সংক্ষিপ্ত আলোচনার অনুরোধ জানাচ্ছি।

বিনীত,
পার্টনারশিপ ডেস্ক
ইএসবি পাওয়ারলাইন | ঢাকা, বাংলাদেশ`,
  },
  {
    id: 'executive_interview',
    label: 'Executive Interview & Feature',
    tag: 'Editorial',
    defaultSubject: 'Editorial Interview Invitation: Leadership Perspective ({name}, {organization})',
    defaultBody: `Dear {name},

ESB PowerLine's editorial board cordially requests the privilege of an exclusive interview with you regarding your vision and operational milestones as {designation} at {organization}.

Our flagship sector review covers critical macro themes including power sector financial sustainability, transmission wheeling, and grid digitalization. An in-depth conversation featuring your insights will provide invaluable clarity to sovereign regulators, EPC contractors, and multilateral stakeholders following Bangladesh's power landscape.

The interview can be arranged at your office in Dhaka or via videoconference according to your schedule. A brief concept note with proposed thematic questions is attached.

With sincere respect,

Chief Editor / Senior Energy Desk
ESB PowerLine — https://esbpowerline.com`,
    bengaliSubject: 'সাক্ষাৎকার গ্রহণের সশ্রদ্ধ অনুরোধ: {organization}-এর উন্নয়ন অগ্রযাত্রা ({name})',
    bengaliBody: `শ্রদ্ধেয় {name},

{organization}-এর {designation} হিসেবে আপনার বলিষ্ঠ নেতৃত্বে চলমান প্রকল্প ও ভবিষ্যৎ রূপরেখা বিষয়ে ‘ইএসবি পাওয়ারলাইন’-এর জন্য আপনার একটি বিশেষ সাক্ষাৎকার গ্রহণের সশ্রদ্ধ অনুরোধ জানাচ্ছি।

জাতীয় জ্বালানি নিরাপত্তা ও প্রাতিষ্ঠানিক উদ্ভাবন নিয়ে আপনার মূল্যবান ভাবনা দেশের নীতিনির্ধারক ও অংশীজনদের পথনির্দেশনা দেবে। আপনার সুবিধাজনক সময়ে সরাসরি অথবা ভার্চুয়ালি এই আলাপচারিতা আয়োজন করা সম্ভব।

বিষয়সংক্রান্ত সংক্ষিপ্ত ধারণাপত্র সংযুক্ত করা হলো। আপনার সদয় সম্মতি প্রত্যাশা করছি।

শ্রদ্ধাবনত,
সম্পাদকীয় বিভাগ
ইএসবি পাওয়ারলাইন | https://esbpowerline.com`,
  },
  {
    id: 'breaking_intelligence',
    label: 'Sectoral Intelligence Alert',
    tag: 'Intelligence',
    defaultSubject: 'Energy Sector Intelligence Alert: Policy & Infrastructure Analysis ({organization})',
    defaultBody: `Dear {name},

ESB PowerLine has released an exclusive technical brief regarding current macroeconomic, tariff, and infrastructural shifts impacting {sector} and entities like {organization}.

As {designation}, we believe this verified intelligence report will assist your executive planning desk. The complete research brief and high-resolution infographics from our graphics studio are enclosed.

You may access further verified data at https://esbpowerline.com.

Warm regards,
Energy Research Group | ESB PowerLine`,
    bengaliSubject: 'বিশেষ জ্বালানি ও বিদ্যুৎ খাত বিশ্লেষণ প্রতিবেদন: {organization}',
    bengaliBody: `শ্রদ্ধেয় {name},

{sector} ও জাতীয় জ্বালানি কাঠামোর সাম্প্রতিক রূপান্তর বিষয়ে ইএসবি পাওয়ারলাইনের গবেষণা সেল একটি বিশদ কারিগরি প্রতিবেদন প্রস্তুত করেছে। {organization}-এর শীর্ষ নেতৃত্বের সিদ্ধান্ত গ্রহণ প্রক্রিয়ায় সহায়ক হিসেবে এই সারসংক্ষেপ আপনার জন্য প্রেরণ করা হলো।

বিস্তারিত তথ্য ও গ্রাফিক্স ডিরেক্টরি সংযুক্ত রয়েছে।

শুভকামনাসহ,
রিসার্চ অ্যান্ড অ্যানালিটিক্স ডেস্ক
ইএসবি পাওয়ারলাইন | https://esbpowerline.com`,
  },
  {
    id: 'institutional_dialogue',
    label: 'Institutional Dialogue',
    tag: 'Policy',
    defaultSubject: 'Institutional Dialogue & Collaborative Forum: ESB PowerLine & {organization}',
    defaultBody: `Dear {name},

We write to explore avenues for formal institutional engagement and policy dialogue between {organization} and ESB PowerLine.

Our directory initiative catalogs over 200 sovereign, utility, and private energy entities across Bangladesh. We invite {organization} to participate in our upcoming executive roundtable and contribute editorial insights to our quarterly statutory review.

Please let us know if we may coordinate with your executive office to arrange an introductory briefing.

Best regards,
Institutional Relations Desk
ESB PowerLine | Dhaka`,
    bengaliSubject: 'প্রাতিষ্ঠানিক সংলাপ ও পারস্পরিক সহযোগিতা প্রসঙ্গে: {organization}',
    bengaliBody: `শ্রদ্ধেয় {name},

জাতীয় জ্বালানি খাতের টেকসই নীতি প্রণয়ন ও প্রাতিষ্ঠানিক মেলবন্ধন রচনার লক্ষ্যে {organization}-এর সাথে ‘ইএসবি পাওয়ারলাইন’-এর মতবিনিময় ও সহযোগিতার দ্বার উন্মোচনের বিনীত প্রস্তাব জানাচ্ছি।

আমাদের যৌথ গোলটেবিল ও নীতিনির্ধারণী প্রকাশনায় আপনাদের সক্রিয় অংশগ্রহণ অত্যন্ত তাৎপর্যপূর্ণ ভূমিকা রাখবে।

আপনার দপ্তরের সুবিধাজনক সময়ে একটি সূচনামূলক সভার সুযোগ কামনা করছি।

আন্তরিক শুভেচ্ছাসহ,
প্রাতিষ্ঠানিক সংযোগ সেল
ইএসবি পাওয়ারলাইন`,
  },
  {
    id: 'custom_pitch',
    label: 'Custom Promotional Pitch',
    tag: 'Custom',
    defaultSubject: 'ESB PowerLine Outreach: Initiative & Collaboration ({organization})',
    defaultBody: `Dear {name},

Greetings from ESB PowerLine (https://esbpowerline.com).

We are reaching out to you in your capacity as {designation} at {organization} regarding our specialized energy sector outreach and publishing initiatives.

Our team would be delighted to connect with your desk to discuss mutually beneficial collaboration.

Kind regards,
Outreach Desk | ESB PowerLine`,
    bengaliSubject: 'ইএসবি পাওয়ারলাইন — সহযোগিতার প্রস্তাব ({organization})',
    bengaliBody: `শ্রদ্ধেয় {name},

{organization}-এর {designation} হিসেবে আপনার সার্বিক সাফল্য কামনা করি।

ইএসবি পাওয়ারলাইনের পক্ষ থেকে বিশেষ প্রাতিষ্ঠানিক যোগাযোগ ও সহযোগিতার প্রস্তাব নিয়ে আপনার সদয় দৃষ্টি আকর্ষণ করছি।

ধন্যবাদান্তে,
ইএসবি পাওয়ারলাইন ডেস্ক`,
  },
]

// ------------------------------------------------------------------ which letter fits an audience
// The workbook tags each contact with what they are on the list for (MAGAZINE_DISTRIBUTION, SPONSORSHIP, …). Each tag
// belongs to one blueprint; the audience's most common tag picks the letter. A tag not listed here suggests nothing.
const PURPOSE_BLUEPRINT: Record<string, OutreachBlueprintId> = {
  MAGAZINE_DISTRIBUTION: 'magazine_distribution', VIP_CIRCULATION: 'magazine_distribution', RESEARCH_DISTRIBUTION: 'magazine_distribution',
  SPONSORSHIP: 'corporate_sponsorship', ADVERTISING: 'corporate_sponsorship', ADVERTISING_PROSPECT: 'corporate_sponsorship', CORPORATE_SUBSCRIPTION: 'corporate_sponsorship', PARTNERSHIP: 'corporate_sponsorship',
  HIGH_LEVEL_ENGAGEMENT: 'executive_interview', EXPERT_SOURCE: 'executive_interview', EXPERT_COMMENTARY: 'executive_interview', EDITORIAL_SOURCE: 'executive_interview', EDITORIAL_CONTRIBUTOR: 'executive_interview', MEDIA_INQUIRY: 'executive_interview',
  GENERAL_INTELLIGENCE: 'breaking_intelligence', INTERNATIONAL_INTELLIGENCE: 'breaking_intelligence', DATA_PLATFORM: 'breaking_intelligence', GRID_EXPLORER: 'breaking_intelligence', PRESS_RELEASE: 'breaking_intelligence',
  INSTITUTIONAL_RELATIONS: 'institutional_dialogue', DIPLOMATIC_ENGAGEMENT: 'institutional_dialogue', POLICY_DIALOGUE: 'institutional_dialogue', PROJECT_FINANCING: 'institutional_dialogue', GENERAL_CORPORATE_COMMUNICATION: 'institutional_dialogue',
}

/** The blueprint the audience's purposes point to, with how many contacts carry that purpose; null when none map. */
export function suggestBlueprint(contacts: Contact[], chosen: string[] = []): { id: OutreachBlueprintId; purpose: string; count: number } | null {
  const counts = new Map<string, number>()
  for (const c of contacts) for (const p of c.purposes) if (PURPOSE_BLUEPRINT[p] && (!chosen.length || chosen.includes(p))) counts.set(p, (counts.get(p) ?? 0) + 1)
  const top = [...counts].sort((a, b) => b[1] - a[1])[0]
  return top ? { id: PURPOSE_BLUEPRINT[top[0]], purpose: top[0], count: top[1] } : null
}

// ------------------------------------------------------------------ shared
const need = (role: 'outreach' | 'research' | 'review', what: string) => {
  if (aiPaused()) throw new Error('AI is turned off (the AI switch). Turn it on to use it.')
  const ai = aiFor(role)
  if (!ai) throw new Error(`No AI provider has a key for ${what}. Add one in the AI dialog.`)
  return ai
}
const squash = (t: string) => t.replace(/\s+/g, ' ').trim()
/** True when `quote` is the source's own words (whitespace and curly quotes aside). */
export const quoteInSource = (quote: string, text: string) => {
  const n = (x: string) => squash(x).replace(/[“”]/g, '"').replace(/[‘’]/g, "'").toLowerCase()
  const q = n(quote)
  return q.length >= 12 && n(text).includes(q)
}
const sourceBrief = (sources: Source[]) => sources.flatMap((s) => s.points.filter((p) => p.use).map((p) => `- ${p.text} (source: ${s.title}${s.url ? `, ${s.url}` : ''}; it says: "${p.quote}")`)).join('\n')

export interface LetterContext {
  blueprint: OutreachBlueprintId | 'template' | 'blank'
  lang: OutreachLang
  housePrompt: string
  sources: Source[]
  example?: Contact
}

const RULES = (lang: OutreachLang, extraFields: string[] = []) => `Placeholders: use exactly ${[...PLACEHOLDERS, ...extraFields].map((p) => `{${p}}`).join(', ')} (or with fallbacks like {key|fallback text}, e.g. {designation|Representative} or {opener|}) where each recipient's details go. Never write a real person's or organisation's name into the template.

Facts: use only what you are given — the reference letter, the talking points from the editor's sources, and the recipient's role. Do not invent figures, circulation or readership numbers, rankings, awards, projects, dates, meetings, prices or quotes, about ESB PowerLine or the recipient. A figure must appear in a talking point or the reference letter exactly as written there. If the reference letter mentions an attachment, keep that sentence; otherwise do not mention one.

Style: courteous, direct, no hype, no emojis. ${lang === 'bn' ? 'Write in formal Bangla (আনুষ্ঠানিক সরকারি ও করপোরেট শিষ্টাচার) with proper honorifics.' : 'Write in clear British English.'} Blank lines between paragraphs. You may use these marks, sparingly: "## " for a short heading, "- " bullets, **bold** for one key phrase, [words](https://link) for a link that appears in the sources or reference. No other markdown. Do not add a signature or an unsubscribe line; the app adds both.`

export interface AiOutreachDraft { subject: string; body: string; variants: string[]; model: string; unsourced: string[] }

const draftSchema: AiSchema = {
  type: 'object',
  properties: {
    subject: { type: 'string', description: 'Subject line, at most 70 characters, may use {organization}' },
    body: { type: 'string', description: 'The email body with the placeholders, without signature' },
    variants: { type: 'string', description: 'Three other subject lines, one per line' },
  },
  required: ['subject', 'body', 'variants'],
}

function finish(data: Record<string, string>, ctx: LetterContext, reference: string, model: string): AiOutreachDraft {
  // a model that wrote the example recipient's details in after all would send them to everyone: refuse that draft
  const body = String(data.body || '').trim()
  const subject = squash(String(data.subject || ''))
  if (!body) throw new Error('The model returned an empty letter')
  const ex = ctx.example
  for (const v of [ex?.personName, ex?.organization, ex?.email].filter((x): x is string => !!x && x.length > 3)) {
    if (body.includes(v) || subject.includes(v)) throw new Error(`The draft names ${v} instead of using a placeholder — write it again`)
  }
  return {
    subject,
    body,
    variants: String(data.variants || '').split('\n').map((x) => x.replace(/^[-*•\d.)\s]+/, '').trim()).filter(Boolean).slice(0, 3),
    model,
    unsourced: unsourcedNumbers(body, ctx.sources, reference),
  }
}

const referenceOf = (ctx: LetterContext, current?: { subject: string; body: string }) => {
  const bp = OUTREACH_BLUEPRINTS.find((b) => b.id === ctx.blueprint)
  return bp ? (ctx.lang === 'bn' ? bp.bengaliBody : bp.defaultBody) : current?.body ?? ''
}

/**
 * The Letter job writes the campaign's TEMPLATE — one letter for every recipient, with placeholders — not a letter
 * to the one contact on screen (the first version did that, so a batch would have sent one person's name to
 * everyone). It may use only the blueprint's own offer, the talking points the editor kept and the recipient's role.
 */
export async function writeOutreachWithAi(ctx: LetterContext, directive = ''): Promise<AiOutreachDraft> {
  const ai = need('outreach', 'the Letter job')
  const bp = OUTREACH_BLUEPRINTS.find((b) => b.id === ctx.blueprint) ?? OUTREACH_BLUEPRINTS[0]
  const reference = ctx.lang === 'bn' ? bp.bengaliBody : bp.defaultBody
  const points = sourceBrief(ctx.sources)
  const system = `You write outreach emails for ESB PowerLine (esbpowerline.com), a Bangladesh energy and power news publisher, to officials and executives in the sector.

Write ONE email template for a whole mailing list, 120–220 words.

${RULES(ctx.lang)}
${ctx.housePrompt.trim() ? `\nThe editor's house style (follow it unless it conflicts with the facts rule):\n${ctx.housePrompt.trim()}\n` : ''}
Reference letter (${bp.label}):
"""
${reference}
"""`
  const user = `${points ? `Talking points the editor chose (use the ones that fit):\n${points}\n\n` : ''}Example recipient (for tone only — do not put these details in the template):
Designation: ${ctx.example?.designation || 'unknown'}
Sector: ${ctx.example?.sectorGroup || 'unknown'}
${directive ? `Editor's note: ${directive}\n` : ''}Write the template.`
  const res = await aiJson<Record<string, string>>({ provider: ai.provider, key: ai.key, model: ai.model, system, user, schema: draftSchema, maxTokens: 4096, effort: 'medium' })
  return finish(res.data, ctx, reference, `${providerMeta(ai.provider).name} · ${res.model}`)
}

export type RewriteAction = 'shorter' | 'formal' | 'warmer' | 'clearer' | 'translate' | 'custom'
export const REWRITES: { id: RewriteAction; label: string; hint: string }[] = [
  { id: 'shorter', label: 'Make it shorter', hint: 'About half the length, same offer' },
  { id: 'formal', label: 'More formal', hint: 'Official register for ministries and boards' },
  { id: 'warmer', label: 'Warmer', hint: 'Personal, still professional' },
  { id: 'clearer', label: 'Clearer ask', hint: 'Put the one thing you want them to do up front' },
  { id: 'translate', label: 'Translate', hint: 'English ⇄ বাংলা, placeholders kept' },
]

/** Rewrite the letter the editor already has. The same facts rule; the result is a draft the editor accepts or not. */
export async function rewriteLetter(action: RewriteAction, current: { subject: string; body: string }, ctx: LetterContext, custom = ''): Promise<AiOutreachDraft & { lang: OutreachLang }> {
  const ai = need('outreach', 'the Letter job')
  const to: OutreachLang = action === 'translate' ? (ctx.lang === 'en' ? 'bn' : 'en') : ctx.lang
  const ask: Record<RewriteAction, string> = {
    shorter: 'Make it about half as long. Keep the offer, the ask and every placeholder; drop repetition and pleasantries.',
    formal: 'Make the register more formal, as for a secretary of a ministry or the chair of a board. Same content.',
    warmer: 'Make it warmer and more personal while staying professional. Same content.',
    clearer: 'Put the single action you want the reader to take in the first two sentences, and make it unmistakable. Same facts.',
    translate: to === 'bn' ? 'Translate into formal Bangla. Keep every placeholder exactly as it is ({name} etc.) and every link.' : 'Translate into clear British English. Keep every placeholder exactly as it is ({name} etc.) and every link.',
    custom: custom.trim() || 'Improve it.',
  }
  const reference = referenceOf(ctx, current)
  const points = sourceBrief(ctx.sources)
  const system = `You edit outreach emails for ESB PowerLine (esbpowerline.com), a Bangladesh energy and power news publisher.

${RULES(to)}
${ctx.housePrompt.trim() ? `\nThe editor's house style:\n${ctx.housePrompt.trim()}\n` : ''}
Do not add any fact, figure, name, date or claim that is not already in the letter or in the talking points below.`
  const user = `${points ? `Talking points:\n${points}\n\n` : ''}The letter:
Subject: ${current.subject}

${current.body}

Task: ${ask[action]}`
  const res = await aiJson<Record<string, string>>({ provider: ai.provider, key: ai.key, model: ai.model, system, user, schema: draftSchema, maxTokens: 4096, effort: 'low' })
  // figures may come from the editor's own letter as well as the sources
  const d = finish(res.data, { ...ctx, lang: to }, `${reference}\n${current.body}`, `${providerMeta(ai.provider).name} · ${res.model}`)
  return { ...d, lang: to }
}

/**
 * Fix all with AI: the same Letter job, told exactly which problems a checklist found — the free deterministic
 * checks (checks.ts) and/or the AI Review's own notes — and nothing else. Mirrors Editorial's "Fix all with AI" for
 * SEO (seoFix.ts): fix only what is named, touch nothing else, same facts-locked guard as every other Letter call
 * (`finish()` refuses a draft that names the example recipient instead of a placeholder).
 */
export interface LetterProblem { text: string; quote?: string }

export async function fixLetterWithAi(current: { subject: string; body: string }, problems: LetterProblem[], ctx: LetterContext): Promise<AiOutreachDraft> {
  const ai = need('outreach', 'the Letter job')
  if (!problems.length) throw new Error('Nothing to fix')
  const reference = referenceOf(ctx, current)
  const points = sourceBrief(ctx.sources)
  const list = problems.map((p, i) => `${i + 1}. ${p.text}${p.quote ? ` — "${p.quote}"` : ''}`).join('\n')
  const system = `You edit outreach emails for ESB PowerLine (esbpowerline.com), a Bangladesh energy and power news publisher.

${RULES(ctx.lang)}
${ctx.housePrompt.trim() ? `\nThe editor's house style:\n${ctx.housePrompt.trim()}\n` : ''}
A checklist found problems in this letter. Fix ONLY the problems listed below; change nothing else in wording, tone or length beyond what each fix needs. Do not add any fact, figure, name, date or claim that is not already in the letter or in the talking points below.`
  const user = `${points ? `Talking points:\n${points}\n\n` : ''}The letter:
Subject: ${current.subject}

${current.body}

Problems to fix:
${list}`
  const res = await aiJson<Record<string, string>>({ provider: ai.provider, key: ai.key, model: ai.model, system, user, schema: draftSchema, maxTokens: 4096, effort: 'low' })
  return finish(res.data, ctx, `${reference}\n${current.body}`, `${providerMeta(ai.provider).name} · ${res.model}`)
}

// ------------------------------------------------------------------ Research: sources → talking points
/**
 * The Research job reads one source and lists what an outreach letter could use from it. Every point must carry the
 * source's own sentence; a point whose quote is not in the source is dropped, not shown, so nothing reaches the
 * letter that the source does not say.
 */
export async function researchSource(src: Source, purpose: string): Promise<{ points: TalkingPoint[]; dropped: number; model: string }> {
  const ai = need('research', 'the Research job')
  const system = `You are the research desk of ESB PowerLine, a Bangladesh energy news publisher. From the document, list 3 to 6 facts an outreach email about "${purpose}" could cite. Each point is one short sentence in English. Each must come with "quote": a sentence copied character for character from the document that states it (no paraphrase, no ellipsis, no translation). Use only what the document says. If it has nothing useful, return an empty list.`
  const schema: AiSchema = { type: 'object', properties: { points: { type: 'string', description: 'JSON array of {"text": string, "quote": string}' } }, required: ['points'] }
  const res = await aiJson<Record<string, string>>({ provider: ai.provider, key: ai.key, model: ai.model, system, user: `Document: ${src.title}\n"""\n${src.text.slice(0, 24000)}\n"""`, schema, maxTokens: 3000, effort: 'low' })
  let raw: unknown = []
  try { raw = JSON.parse(String(res.data.points || '[]')) } catch { throw new Error('The model did not return a list of points') }
  const list = Array.isArray(raw) ? raw as { text?: unknown; quote?: unknown }[] : []
  const points: TalkingPoint[] = []
  let dropped = 0
  for (const p of list) {
    const text = squash(String(p.text ?? '')), quote = squash(String(p.quote ?? ''))
    if (!text || !quoteInSource(quote, src.text)) { dropped++; continue }
    points.push({ id: `pt-${points.length}-${Date.now().toString(36)}`, text, quote, use: true })
  }
  return { points, dropped, model: `${providerMeta(ai.provider).name} · ${res.model}` }
}

// ------------------------------------------------------------------ Review: a second reader
export interface ReviewNote { level: 'bad' | 'warn' | 'ok'; text: string; quote: string }

/** The Review job reads the letter as a cautious senior editor would before it goes to officials. Advice only. */
export async function reviewLetter(current: { subject: string; body: string; signature: string }, ctx: LetterContext): Promise<{ notes: ReviewNote[]; model: string }> {
  const ai = need('review', 'the Review job')
  const system = `You are a senior editor at ESB Power Line checking an outreach email before it goes to government officials and energy-sector executives in Bangladesh. {name}, {designation}, {organization} and {sector} are placeholders filled per recipient — do not flag them.

Report at most 8 notes, most important first: claims or figures that are not supported by the talking points, anything that could embarrass the publisher or offend an official, an unclear ask, tone, length, subject line quality, and likely spam-filter problems. Each note: "level" bad (must fix), warn (should fix) or ok (a strength worth keeping), "text" one sentence of advice, "quote" the exact words of the letter it is about ('' if general). Do not rewrite the letter.`
  const schema: AiSchema = { type: 'object', properties: { notes: { type: 'string', description: 'JSON array of {"level": "bad"|"warn"|"ok", "text": string, "quote": string}' } }, required: ['notes'] }
  const points = sourceBrief(ctx.sources)
  const res = await aiJson<Record<string, string>>({ provider: ai.provider, key: ai.key, model: ai.model, system, schema, maxTokens: 2500, effort: 'low',
    user: `${ctx.housePrompt.trim() ? `House style: ${ctx.housePrompt.trim()}\n\n` : ''}${points ? `Talking points (the only sourced facts):\n${points}\n\n` : 'No sources were given.\n\n'}Subject: ${current.subject}\n\n${current.body}\n\n${current.signature}` })
  let raw: unknown = []
  try { raw = JSON.parse(String(res.data.notes || '[]')) } catch { throw new Error('The model did not return a list of notes') }
  const full = `${current.subject}\n${current.body}\n${current.signature}`
  const notes = (Array.isArray(raw) ? raw : []).slice(0, 8).map((n: { level?: unknown; text?: unknown; quote?: unknown }) => {
    const quote = squash(String(n.quote ?? ''))
    return { level: (['bad', 'warn', 'ok'].includes(String(n.level)) ? n.level : 'warn') as ReviewNote['level'], text: squash(String(n.text ?? '')), quote: quote && squash(full).includes(quote) ? quote : '' }
  }).filter((n) => n.text)
  return { notes, model: `${providerMeta(ai.provider).name} · ${res.model}` }
}
