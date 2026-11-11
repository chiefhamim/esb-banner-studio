// A name from a mailing list often carries the office's own bookkeeping: "মোঃ মাহফুজার রহমান (২০৩৯৯)", "A. Karim - 1042".
// The number must never reach a greeting. electron/person-name.cjs is the engine's copy, and tools/unit/person-name.test.ts
// holds the two to the same answers.

// Latin and Bangla digits: JavaScript's \d knows only the Latin ones, which is how ২০৩৯৯ got past the old check
const DIGIT = '0-9\\u09E6-\\u09EF'
const HAS_DIGIT = new RegExp(`[${DIGIT}]`)
const IN_BRACKETS = new RegExp(`\\s*[(\\[{（][^)\\]}）]*[${DIGIT}][^)\\]}）]*[)\\]}）]`, 'g')
const AT_END = new RegExp(`[\\s,;:|/#-]*[${DIGIT}][${DIGIT}\\s/.-]*$`)
const AT_START = new RegExp(`^[${DIGIT}]+[\\s.):-]+`)

export const nameHasNumber = (name: string | undefined | null): boolean => HAS_DIGIT.test(String(name || ''))

/** The name without its numbers; '' when nothing of a name is left. A number in the middle of the words stays. */
export function cleanPersonName(raw: string | undefined | null): string {
  return String(raw || '').normalize('NFC')
    .replace(IN_BRACKETS, ' ')
    .replace(AT_END, '')
    .replace(AT_START, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/[\s,;:|/-]+$/, '')
    .trim()
}
