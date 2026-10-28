import { aiFor, aiJson, aiPaused, providerMeta, type AiSchema } from '../editorial/aiProviders'
import type { Contact, OutreachBlueprint, OutreachBlueprintId, OutreachLang } from './types'
import { PLACEHOLDERS } from './compose'

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

export interface AiOutreachDraft { subject: string; body: string; variants: string[]; model: string }

/**
 * The Outreach provider writes the campaign's TEMPLATE — one letter for every recipient, with {name}, {designation},
 * {organization} and {sector} where their details go — not a letter to the one contact on screen (the first version
 * did that, so a batch would have sent one person's name to everyone). It may use only what it is given: the
 * blueprint's own letter (what ESB PowerLine is offering) and the recipient's role. It may not invent figures,
 * circulation, rankings, awards, projects, meetings or quotes, for ESB PowerLine or for the recipient.
 */
export async function writeOutreachWithAi(blueprintId: OutreachBlueprintId, lang: OutreachLang, example: Contact | undefined, directive = ''): Promise<AiOutreachDraft> {
  if (aiPaused()) throw new Error('AI is turned off (the AI switch). Turn it on to write with AI.')
  const ai = aiFor('outreach')
  if (!ai) throw new Error('No AI provider has a key for Outreach. Add one in the AI dialog.')
  const bp = OUTREACH_BLUEPRINTS.find((b) => b.id === blueprintId) ?? OUTREACH_BLUEPRINTS[0]
  const reference = lang === 'bn' ? bp.bengaliBody : bp.defaultBody

  const system = `You write outreach emails for ESB PowerLine (esbpowerline.com), a Bangladesh energy and power news publisher, to officials and executives in the sector.

Write ONE email template for a whole mailing list. Use these placeholders exactly where each recipient's details go: ${PLACEHOLDERS.map((p) => `{${p}}`).join(', ')}. Never write a real person's or organisation's name into the template.

Facts: use only what you are given — the reference letter below (what ESB PowerLine is offering) and the recipient's role. Do not invent figures, circulation or readership numbers, rankings, awards, projects, dates, meetings, prices or quotes, about ESB PowerLine or the recipient. If the reference letter mentions an attachment, keep that sentence; otherwise do not mention one.

Style: courteous, direct and short (120–220 words), no hype, no emojis, no markdown. ${lang === 'bn' ? 'Write in formal Bangla (আনুষ্ঠানিক সরকারি ও করপোরেট শিষ্টাচার) with proper honorifics.' : 'Write in clear British English.'} Plain text with blank lines between paragraphs, ending with the sender block from the reference letter. Do not add an unsubscribe line; the app adds one.

Reference letter (${bp.label}):
"""
${reference}
"""`

  const user = `Example recipient (for tone only — do not put these details in the template):
Designation: ${example?.designation || 'unknown'}
Sector: ${example?.sectorGroup || 'unknown'}
${directive ? `Editor's note: ${directive}\n` : ''}Write the template.`

  const schema: AiSchema = {
    type: 'object',
    properties: {
      subject: { type: 'string', description: 'Subject line, at most 70 characters, may use {organization}' },
      body: { type: 'string', description: 'The email body as plain text with the placeholders' },
      variants: { type: 'string', description: 'Three other subject lines, one per line' },
    },
    required: ['subject', 'body', 'variants'],
  }
  const res = await aiJson<Record<string, string>>({ provider: ai.provider, key: ai.key, model: ai.model, system, user, schema, maxTokens: 4096, effort: 'medium' })
  // a model that wrote the example recipient's details in after all would send them to everyone: refuse that draft
  const body = String(res.data.body || '').trim()
  for (const v of [example?.personName, example?.organization, example?.email].filter((x): x is string => !!x && x.length > 3)) {
    if (body.includes(v)) throw new Error(`The draft names ${v} instead of using a placeholder — write it again`)
  }
  return {
    subject: String(res.data.subject || '').replace(/\s+/g, ' ').trim(),
    body,
    variants: String(res.data.variants || '').split('\n').map((x) => x.replace(/^[-*•\d.)\s]+/, '').trim()).filter(Boolean).slice(0, 3),
    model: `${providerMeta(ai.provider).name} · ${res.model}`,
  }
}
