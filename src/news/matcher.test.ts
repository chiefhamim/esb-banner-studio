// EnergyWatch's own matcher cases (Yeasin, scripts/test-matcher.mjs, office copy of 2026-11-05), unchanged, run against
// the keyword list bundled in ewSources.ts (the office server's live list).
import { describe, expect, it } from 'vitest'
import { buildMatcher } from './matcher'
import { EW_KEYWORDS } from './ewSources'

const match = buildMatcher(EW_KEYWORDS)
const KEEP = true
const DROP = false
const cases: [string, boolean][] = [
  // --- energy ---
  ['বিদ্যুতের দাম বাড়ছে না: বিদ্যুৎ উপদেষ্টা', KEEP],
  ['লোডশেডিংয়ে নাকাল গ্রামের মানুষ', KEEP],
  ['তিতাসের গ্যাস সংযোগ বিচ্ছিন্ন', KEEP],
  ['Petrobangla to buy two more LNG cargoes', KEEP],
  ['Bangladesh to import LNG from Qatar', KEEP],
  ['US firm to supply LNG to Bangladesh', KEEP],
  ['Load shedding returns as gas supply falls', KEEP],
  ['Adani power supply resumes after payment', KEEP],
  ['ভারত থেকে বিদ্যুৎ আমদানি বাড়ছে', KEEP],
  ['নেপাল থেকে বিদ্যুৎ আসছে নভেম্বরে', KEEP],
  ['রাশিয়া থেকে জ্বালানি তেল কিনবে সরকার', KEEP],
  ['আজ টানা ৯ ঘণ্টা বিদ্যুৎ থাকবে না যেসব এলাকায়', KEEP],
  ['Iran gas field hit by strike', KEEP],
  ['European gas prices fall sharply', DROP],   // no energy keyword (plain "gas" is not one)
  ['কলকাতায় ফের বাড়ল বাণিজ্যিক গ্যাসের দাম', KEEP],
  ['পবিত্র মদিনায় মসজিদে নববিতে বিদ্যুৎ সরবরাহকারী কেন্দ্রে ড্রোন হামলা', KEEP],
  ['শীতকালে এলএনজির মজুদ নিশ্চিতে প্রতিযোগিতায় ইউরোপ ও এশিয়ার দেশগুলো', KEEP],
  ['শিক্ষার্থীদের ওপর কাঁদানে গ্যাস নিক্ষেপ', DROP],
  ['এলপিজি দাম', DROP],                                  // tag page, not a headline
  // --- Bangladesh PM / President ---
  ['প্রধানমন্ত্রী তারেক রহমানের সঙ্গে বৈঠক', KEEP],
  ['প্রধানমন্ত্রীর কার্যালয়ে মন্ত্রিসভার বৈঠক', KEEP],
  ['মোদির সঙ্গে বৈঠক করবেন প্রধানমন্ত্রী তারেক রহমান', KEEP],
  ['মোদির সঙ্গে বৈঠক করবেন প্রধানমন্ত্রী', KEEP],
  ['যুক্তরাষ্ট্র সফরে যাচ্ছেন প্রধানমন্ত্রী', KEEP],
  ['প্রধানমন্ত্রী ভারতের সঙ্গে চুক্তি করবেন', KEEP],
  ['রাষ্ট্রপতির সঙ্গে প্রধান বিচারপতির সাক্ষাৎ', KEEP],
  ['President Shahabuddin addresses parliament', KEEP],
  ['PM Tarique Rahman inaugurates power plant', KEEP],
  ['PM leaves for India on Monday', KEEP],
  ['US envoy meets PM at Secretariat', KEEP],
  ['Kushtia teacher freed on PM’s intervention', KEEP],
  ['‘Look at your own house first’: PM Tarique tells ‘covert group’', KEEP],
  ['Indian PM Modi to visit Dhaka next month', KEEP],  // Bangladesh context
  // --- foreign / non-government ---
  ['ভারতের প্রধানমন্ত্রী মোদির সঙ্গে ট্রাম্পের ফোনালাপ', DROP],
  ['জাপানের নতুন প্রধানমন্ত্রী শপথ নিলেন', DROP],
  ['প্রধানমন্ত্রী মোদি বললেন, সন্ত্রাস বরদাশত নয়', DROP],
  ['ভারতের রাষ্ট্রপতি দ্রৌপদী মুর্মু হাসপাতালে', DROP],
  ['US President Trump signs order', DROP],
  ['President Trump to visit the region', DROP],
  ['Iraqi PM sets June 30 deadline for proIran factions to disarm', DROP],
  ['Pakistan PM Shehbaz arrives in Riyadh', DROP],
  ['BGMEA president urges policy support', DROP],
  ['DCCI President calls for tax reforms', DROP],
  ['Vice-President of the club elected', DROP],
  ['Rally ends at 5 PM today', DROP],
  ['Rally ends at 5 pm today', DROP],
  // --- unrelated ---
  ['প্রাচীন মসজিদ সংস্কার শুরু হচ্ছে', DROP],
  ['ক্রিকেটে বাংলাদেশের বড় জয়', DROP],
];
// --- foreign prime ministers / presidents are dropped (only Bangladesh's own leaders are wanted) ---
cases.push(
  ['Samoa PM apologizes for Nazi gesture, ‘Heil Hitler’ remark in 2007 video', DROP],
  ['Fiji Prime Minister visits flood-hit island', DROP],
  ['French President opens new nuclear plant', DROP],
  ['Former Serbia President Boris Tadić visits NCP office', DROP],
  ["'President of the Unites States': Typo spotted in Trump's White House accord", DROP],
  ['Thousands march towards Pakistan capital demanding ex-PM Imran Khan’s release', DROP],
  ['Cornell president vows review in wake of alleged student gang rape', DROP],
  ['PM Tarique Rahman opens new power plant in Matarbari', KEEP],
  ['PM urges quick work on gas field projects', KEEP],
  ['Bangladesh PM inaugurates solar project', KEEP],
  ['PM shares photo with Trump from New York dinner', KEEP],
  ['Prime Minister orders probe into load shedding', KEEP],
  ['ex-PM Hasina verdict on power deals due Monday', KEEP],
  ['PM Seeks More British Support To Boost Power Sector Investment', KEEP],
  ['প্রধানমন্ত্রীর সঙ্গে বিদ্যুৎ উপদেষ্টার বৈঠক', KEEP],
  ['ঢাকা ক্লাবের প্রেসিডেন্ট নির্বাচিত হলেন কামরুল', DROP],
  ['বিশ্বব্যাংকের প্রেসিডেন্ট ঢাকায় আসছেন', DROP],
  ['এডিবির প্রেসিডেন্টের সঙ্গে অর্থ উপদেষ্টার বৈঠক', DROP],
  ['বিজিএমইএর প্রেসিডেন্ট বললেন রপ্তানি বাড়ছে', DROP],
);


describe('EnergyWatch matcher', () => {
  it.each(cases)('%s', (title, want) => {
    expect(!!match(title)).toBe(want)
  })
})
