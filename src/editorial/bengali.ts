// Deterministic Bengali digit, currency, date, and unit normalisation.
// Pure functions, 100% offline, zero dependencies.

export const BENGALI_DIGITS: Record<string, string> = {
  '০': '0', '১': '1', '২': '2', '৩': '3', '৪': '4',
  '৫': '5', '৬': '6', '৭': '7', '৮': '8', '৯': '9',
}

export const ASCII_TO_BENGALI_DIGITS: Record<string, string> = {
  '0': '০', '1': '১', '2': '২', '3': '৩', '4': '৪',
  '5': '৫', '6': '৬', '7': '৭', '8': '৮', '9': '৯',
}

/** Convert all Bengali numerals (০-৯) in text to ASCII digits (0-9). */
export function bengaliToAsciiDigits(text: string): string {
  return text.replace(/[০-৯]/g, (ch) => BENGALI_DIGITS[ch] ?? ch)
}

/** Convert all ASCII digits (0-9) in text to Bengali numerals (০-৯). */
export function asciiToBengaliDigits(text: string): string {
  return text.replace(/[0-9]/g, (ch) => ASCII_TO_BENGALI_DIGITS[ch] ?? ch)
}

export const BENGALI_MONTHS: Record<string, number> = {
  // English calendar in Bengali transliteration
  'জানুয়ারি': 1, 'জানুয়ারি': 1, 'ফেব্রুয়ারি': 2, 'ফেব্রুয়ারি': 2,
  'মার্চ': 3, 'এপ্রিল': 4, 'মে': 5, 'জুন': 6,
  'জুলাই': 7, 'আগস্ট': 8, 'সেপ্টেম্বর': 9, 'অক্টোবর': 10,
  'নভেম্বর': 11, 'ডিসেম্বর': 12,
  // Traditional Bengali calendar
  'বৈশাখ': 1, 'জ্যৈষ্ঠ': 2, 'আষাঢ়': 3, 'শ্রাবণ': 4,
  'ভাদ্র': 5, 'আশ্বিন': 6, 'কার্তিক': 7, 'অগ্রহায়ণ': 8,
  'পৌষ': 9, 'মাঘ': 10, 'ফাল্গুন': 11, 'চৈত্র': 12,
}

export interface ExtractedAmount {
  raw: string
  normalized: string
  value: number
  unit: 'crore' | 'lakh' | 'thousand' | 'unit'
  currency: 'BDT' | 'USD' | null
}

/**
 * Normalise Bengali currency figures like "৫৯২ কোটি টাকা" or "Tk 592 crore" or "৳৫০ লাখ".
 */
export function parseBengaliAmount(phrase: string): ExtractedAmount | null {
  const ascii = bengaliToAsciiDigits(phrase).trim()

  const currencyMatch = /^(?:টাকা|৳|Tk\.?|BDT|\$|USD)\s*/i.test(ascii)
    ? (/\$|USD/i.test(ascii) ? 'USD' : 'BDT')
    : /(?:টাকা|৳|Tk\.?|BDT|\$|USD)/i.test(ascii)
      ? (/\$|USD/i.test(ascii) ? 'USD' : 'BDT')
      : null

  // Check for crore (কোটি) / lakh (লাখ/লক্ষ) / thousand (হাজার)
  const numMatch = ascii.match(/([0-9]+(?:[,.][0-9]+)?)/)
  if (!numMatch) return null

  const num = parseFloat(numMatch[1].replace(/,/g, ''))
  let multiplier = 1
  let unit: ExtractedAmount['unit'] = 'unit'

  if (/কোটি|crore/i.test(ascii)) {
    multiplier = 1e7
    unit = 'crore'
  } else if (/লাখ|লক্ষ|lakh/i.test(ascii)) {
    multiplier = 1e5
    unit = 'lakh'
  } else if (/হাজার|thousand/i.test(ascii)) {
    multiplier = 1e3
    unit = 'thousand'
  }

  const value = num * multiplier
  const currPrefix = currencyMatch === 'USD' ? '$' : 'Tk '
  const unitSuffix = unit === 'crore' ? ' crore' : unit === 'lakh' ? ' lakh' : ''

  return {
    raw: phrase,
    normalized: `${currPrefix}${num}${unitSuffix}`,
    value,
    unit,
    currency: currencyMatch,
  }
}
