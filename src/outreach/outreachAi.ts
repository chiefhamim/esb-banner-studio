import { aiFor, aiJson, aiPaused, type AiSchema } from '../editorial/aiProviders'
import type { Contact, OutreachBlueprint, OutreachBlueprintId } from './types'

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

export type AiOutreachGenerationResult = {
  subject: string
  preheader: string
  bodyHtml: string
  bodyText: string
  keyHook: string
  subjectVariants: string[]
  [key: string]: unknown
}

/**
 * Calls Claude / active AI provider to generate promotional email copy tailored specifically to the recipient.
 */
export async function generateAiOutreachCopy(
  contact: Contact,
  blueprintId: OutreachBlueprintId,
  language: 'en' | 'bn' | 'bilingual' = 'en',
  customDirective = ''
): Promise<AiOutreachGenerationResult> {
  if (aiPaused()) {
    throw new Error('AI is currently turned off in Settings (AI master switch is paused).')
  }

  const ai = aiFor('outreach')
  if (!ai) {
    throw new Error('No AI provider configured for Outreach. Please add a Claude (Anthropic) or Gemini API key in Settings.')
  }

  const blueprint = OUTREACH_BLUEPRINTS.find((b) => b.id === blueprintId) || OUTREACH_BLUEPRINTS[0]

  const system = `You are the Principal Communications Director & Elite Institutional Outreach Strategist for ESB PowerLine (https://esbpowerline.com), Bangladesh's premier sovereign, public, and private energy newsroom and directory system.

Your job is to generate a world-class, high-converting, deeply respectful, and mathematically precise promotional outreach email addressed to a specific high-level official in the Bangladesh energy sector.

NON-NEGOTIABLE STANDARDS:
1. Tone must be authoritative, diplomatic, polished, and free of hype, emojis, or AI slop.
2. If language is Bengali, write immaculate, formal Secretariat-grade protocol (আনুষ্ঠানিক সরকারি ও করপোরেট শিষ্টাচার) with proper honorifics. Rendered in Hind Siliguri typography.
3. If language is English, write executive energy-sector English with accurate units (MW, MMCFD, Tk Crore, PPA, grid stability).
4. If language is Bilingual, provide the primary message in English followed by an elegant, formal Bengali summary.
5. Personalize the key opening hook to the recipient's specific organization and sector role.
6. The HTML body should use clean, semantic tags (<p>, <strong>, <em>, <ul>, <li>, <br/>) with inline styling suitable for corporate Outlook, Gmail, and government webmail (.gov.bd).
7. Generate 5 distinct, high-open-rate subject lines.`

  const user = `RECIPIENT DOSSIER:
- Name: ${contact.personName}
- Designation: ${contact.designation}
- Organization: ${contact.organization}
- Sector Group: ${contact.sectorGroup}
- Approved Purpose: ${contact.purpose}

CAMPAIGN BLUEPRINT: ${blueprint.label} (${blueprint.tag})
LANGUAGE REQUIREMENT: ${language.toUpperCase()}
ADDITIONAL DIRECTIVE: ${customDirective || 'Focus on high executive credibility and long-term institutional relationship.'}

Generate an email proposal tailored to this official.`

  const schema: AiSchema = {
    type: 'object',
    properties: {
      subject: { type: 'string', description: 'Primary subject line, <= 68 characters, personalized' },
      preheader: { type: 'string', description: 'Preheader preview text for inbox, <= 110 characters' },
      bodyHtml: { type: 'string', description: 'Full formatted HTML body with inline styling' },
      bodyText: { type: 'string', description: 'Plain text fallback matching the HTML' },
      keyHook: { type: 'string', description: 'One sentence explaining the personalized angle for this entity' },
      subjectVariants: { type: 'string', description: '5 alternative A/B testable subject lines, separated by newlines' },
    },
    required: ['subject', 'preheader', 'bodyHtml', 'bodyText', 'keyHook', 'subjectVariants'],
  }

  const res = await aiJson<Record<string, unknown>>({
    provider: ai.provider,
    key: ai.key,
    model: ai.model,
    system,
    user,
    schema,
    maxTokens: 4096,
    effort: 'medium',
  })

  const rawVariants = res.data.subjectVariants
  const variants: string[] = typeof rawVariants === 'string'
    ? rawVariants.split('\n').map((s) => s.trim().replace(/^[-*•\d.]+\s*/, '')).filter(Boolean)
    : Array.isArray(rawVariants) ? (rawVariants as string[]) : []

  return {
    subject: String(res.data.subject || ''),
    preheader: String(res.data.preheader || ''),
    bodyHtml: String(res.data.bodyHtml || ''),
    bodyText: String(res.data.bodyText || ''),
    keyHook: String(res.data.keyHook || ''),
    subjectVariants: variants,
  }
}