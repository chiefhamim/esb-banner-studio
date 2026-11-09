// Extraction and the free-translation polish must never change what a story says (2026-11-09 news audit).
import { describe, it, expect } from 'vitest'
import { cleanParagraphLead, isBoilerplateParagraph, extractCatchSentence, splitBodyText } from '../../src/editorial/extract'
import { polishJournalisticBody } from '../../src/editorial/translator'

describe('datelines', () => {
  it('keeps a hyphenated place name that opens a sentence', () => {
    expect(cleanParagraphLead('ঢাকা-চট্টগ্রাম মহাসড়কে যান চলাচল বন্ধ')).toBe('ঢাকা-চট্টগ্রাম মহাসড়কে যান চলাচল বন্ধ')
  })
  it('still strips a real dateline and reporter lead', () => {
    expect(cleanParagraphLead('ঢাকা, ২৩ অক্টোবর (বাসস) : বিদ্যুৎ সরবরাহ')).toBe('বিদ্যুৎ সরবরাহ')
    expect(cleanParagraphLead('নিজস্ব প্রতিবেদক, ঢাকা — বিদ্যুৎ সরবরাহ')).toBe('বিদ্যুৎ সরবরাহ')
    expect(cleanParagraphLead('সিলেট: গ্যাসক্ষেত্রে নতুন কূপ')).toBe('গ্যাসক্ষেত্রে নতুন কূপ')
  })
})

describe('boilerplate', () => {
  it('keeps story sentences that mention a publisher word', () => {
    expect(isBoilerplateParagraph('According to a report published by IEEFA on Monday, Bangladesh spent heavily on idle capacity payments across the year, the think tank said in its latest analysis.')).toBe(false)
    expect(isBoilerplateParagraph('পেট্রোবাংলার চেয়ারম্যান বণিক বার্তাকে বলেন, আগামী মাস থেকে এলএনজি আমদানি বাড়ানো হবে এবং শিল্পে গ্যাস সরবরাহ স্বাভাবিক হবে বলে আশা করা হচ্ছে। তিনি আরও বলেন, নতুন চুক্তির আলোচনা চলছে।')).toBe(false)
    expect(isBoilerplateParagraph('Water level 3 of the Kaptai reservoir fell below the rule curve')).toBe(false)
  })
  it('still drops footers and read-more lines', () => {
    expect(isBoilerplateParagraph('সর্বস্বত্ব সংরক্ষিত © বণিক বার্তা')).toBe(true)
    expect(isBoilerplateParagraph('আরও পড়ুন: গ্যাস সংকটে শিল্প উৎপাদন ব্যাহত')).toBe(true)
    expect(isBoilerplateParagraph('Copyright © 2026 All rights reserved')).toBe(true)
  })
})

describe('sentences', () => {
  it('does not end a sentence inside a decimal', () => {
    expect(extractCatchSentence('Bangladesh added 3.5 GW of solar capacity this year. More is planned.')).toBe('Bangladesh added 3.5 GW of solar capacity this year.')
  })
  it('splits a long articleBody without cutting numbers', () => {
    const parts = splitBodyText('The plant cost Tk 1.2 crore to repair. '.repeat(40))
    expect(parts.length).toBeGreaterThan(1)
    expect(parts.every((p) => !/\d\.$/.test(p))).toBe(true)
  })
})

describe('free-translation polish', () => {
  it('never rewrites currencies, units or phrasing', () => {
    const s = 'Adani billed Rs 500 crore worth of power for 30 million cubic feet; the RSS feed said bpdb.'
    expect(polishJournalisticBody(s)).toBe('Adani billed Rs 500 crore worth of power for 30 million cubic feet; the RSS feed said BPDB.')
  })
})
