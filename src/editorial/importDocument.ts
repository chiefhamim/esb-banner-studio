// Read a story out of a PDF or Word file, as plain text the desk can translate.
// Everything runs here in the renderer: the file never leaves the computer until the editor's own AI provider is asked to
// write the English story from the text. No OCR: a scanned PDF has no text, and the desk says so instead of guessing.
import type { PDFDocumentProxy } from 'pdfjs-dist'

export type DocKind = 'pdf' | 'docx'

export interface ImportedDocument {
  kind: DocKind
  name: string
  text: string
  pages?: number
  words: number
  /** A PDF whose own text cannot be used (a scan, an old Bangla font, or glyphs saved out of order): the AI can read the pages instead. */
  needsVision?: 'scanned' | 'legacy' | 'scrambled'
  /** Things the editor should know before trusting the text. */
  warnings: string[]
}

export class DocumentImportError extends Error {}

export const MAX_DOCUMENT_BYTES = 25 * 1024 * 1024

export function documentKind(name: string, type = ''): DocKind | null {
  const n = name.toLowerCase()
  if (n.endsWith('.pdf') || type === 'application/pdf') return 'pdf'
  if (n.endsWith('.docx') || type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') return 'docx'
  return null
}

const BENGALI = /[ঀ-৿]/g
const LEGACY_MARKS = /[\u0080-ÿŒœŠšŸŽžƒˆ˜–-›]/g

/**
 * Old Bangla PDFs (Bijoy / SutonnyMJ) store the glyph codes of an ASCII font, so the "text" is Latin-1 noise such as
 * "‡K›`ªxq e¨vsK". That cannot be translated and must not be sent to the AI as if it were the story.
 */
export function looksLikeLegacyBangla(text: string): boolean {
  const sample = text.slice(0, 6000)
  const letters = (sample.match(/[A-Za-z\u0080-ÿঀ-৿]/g) ?? []).length
  if (letters < 40) return false
  const bn = (sample.match(BENGALI) ?? []).length
  const odd = (sample.match(LEGACY_MARKS) ?? []).length
  return bn / letters < 0.05 && odd / letters > 0.08
}

/**
 * PDFs made by print engines (Chrome, many Word exports) often save Bangla glyphs in screen order, so the "text" has vowel signs
 * ahead of their consonants and unmapped glyphs (NUL). No Bangla word starts with a vowel sign.
 */
export function looksScrambledBangla(text: string): boolean {
  if (text.includes('\u0000')) return true
  const words = text.split(/\s+/).filter((w) => /[\u0980-\u09FF]/.test(w))
  if (words.length < 8) return false
  const bad = words.filter((w) => /^[\u09BF\u09C7\u09C8]/.test(w)).length
  return bad / words.length > 0.03
}

const wordCount = (t: string) => (t.match(/[\p{L}\p{N}]+/gu) ?? []).length

/** Tidy what a file gives: one paragraph per block, no soft hyphen / zero-width debris, no runs of blank lines. */
export function tidyExtractedText(raw: string): string {
  return raw
    .replace(/\r\n?/g, '\n')
    .replace(/[­​﻿]/g, '')
    .replace(/ /g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

interface Frag { str: string; x: number; y: number; h: number; eol: boolean }
interface Line { text: string; y: number; h: number }

/** Group a page's text fragments into lines (top to bottom, left to right), then lines into paragraphs by the gap above. */
export function pageParagraphs(frags: Frag[]): { lines: Line[]; paragraphs: string[] } {
  const items = frags.filter((f) => f.str.trim() || f.eol)
  const sorted = [...items].sort((a, b) => (Math.abs(b.y - a.y) > Math.max(2, Math.min(a.h, b.h) * 0.4) ? b.y - a.y : a.x - b.x))
  const lines: Line[] = []
  for (const f of sorted) {
    const last = lines[lines.length - 1]
    if (last && Math.abs(last.y - f.y) <= Math.max(2, Math.min(last.h, f.h || last.h) * 0.4)) {
      last.text += (last.text && !/\s$/.test(last.text) && !/^\s/.test(f.str) ? ' ' : '') + f.str
      last.h = Math.max(last.h, f.h)
    } else if (f.str.trim()) lines.push({ text: f.str, y: f.y, h: f.h || 10 })
  }
  for (const l of lines) l.text = l.text.replace(/\s+/g, ' ').trim()
  const real = lines.filter((l) => l.text)
  const gaps: number[] = []
  for (let i = 1; i < real.length; i++) gaps.push(real[i - 1].y - real[i].y)
  // the line spacing inside a paragraph is the smallest common gap (a quarter of the way up), not the median, which a few headings skew
  const typical = gaps.length ? [...gaps].sort((a, b) => a - b)[Math.floor(gaps.length / 4)] : 0
  const paragraphs: string[] = []
  let cur = ''
  real.forEach((l, i) => {
    const gap = i ? real[i - 1].y - l.y : 0
    const newPara = i === 0 || (typical > 0 && gap > typical * 1.45)
    if (newPara && cur) { paragraphs.push(cur); cur = '' }
    cur += (cur ? (/[-‐]$/.test(cur) ? '' : ' ') : '') + l.text
  })
  if (cur) paragraphs.push(cur)
  return { lines: real, paragraphs }
}

/** A line that is only a page number ("3", "- 3 -", "পৃষ্ঠা ৩", "Page 3 of 9"). */
const PAGE_NUMBER = /^[\s\-–—]*(?:(?:page|পৃষ্ঠা)\s*)?[\d০-৯]{1,4}(?:\s*(?:of|\/)\s*[\d০-৯]{1,4})?[\s\-–—]*$/i

/** Headers and footers: a paragraph that opens or closes most pages, and page numbers. Only runs on multi-page files. */
export function dropRunningHeads(pages: string[][]): string[][] {
  const cleaned = pages.map((p) => p.filter((t) => !PAGE_NUMBER.test(t)))
  if (cleaned.length < 3) return cleaned
  const count = new Map<string, number>()
  for (const p of cleaned) for (const t of new Set([p[0], p[p.length - 1]].filter(Boolean) as string[])) count.set(t, (count.get(t) ?? 0) + 1)
  const repeated = new Set([...count].filter(([t, n]) => n >= Math.max(3, Math.ceil(cleaned.length * 0.6)) && t.length < 140).map(([t]) => t))
  return cleaned.map((p) => p.filter((t) => !repeated.has(t)))
}

let pdfjsReady: Promise<typeof import('pdfjs-dist')> | null = null
function loadPdfjs() {
  pdfjsReady ??= (async () => {
    const [pdfjs, worker] = await Promise.all([import('pdfjs-dist'), import('pdfjs-dist/build/pdf.worker.min.mjs?url')])
    pdfjs.GlobalWorkerOptions.workerSrc = worker.default
    return pdfjs
  })()
  return pdfjsReady
}

async function readPdf(data: ArrayBuffer, name: string): Promise<ImportedDocument> {
  const pdfjs = await loadPdfjs()
  let pdf: PDFDocumentProxy
  try {
    pdf = await pdfjs.getDocument({ data: new Uint8Array(data) }).promise
  } catch (e) {
    const msg = (e as { name?: string; message?: string })?.name === 'PasswordException'
      ? 'This PDF is password-protected. Remove the password and add it again.'
      : 'This PDF could not be opened. It may be damaged; try saving it again from the original program.'
    throw new DocumentImportError(msg)
  }
  try {
    const perPage: string[][] = []
    for (let n = 1; n <= pdf.numPages; n++) {
      const page = await pdf.getPage(n)
      const content = await page.getTextContent()
      const frags: Frag[] = []
      for (const it of content.items) {
        if (!('str' in it)) continue
        frags.push({ str: it.str, x: it.transform[4], y: it.transform[5], h: it.height || Math.abs(it.transform[3]) || 10, eol: !!it.hasEOL })
      }
      perPage.push(pageParagraphs(frags).paragraphs)
      page.cleanup()
    }
    const text = tidyExtractedText(dropRunningHeads(perPage).map((p) => p.join('\n\n')).filter(Boolean).join('\n\n'))
    const warnings: string[] = []
    if (pdf.numPages > 30) warnings.push(`${pdf.numPages} pages — check that only the story you want is in it.`)
    const needsVision = !text || wordCount(text) < 5 ? 'scanned' : looksLikeLegacyBangla(text) ? 'legacy' : looksScrambledBangla(text) ? 'scrambled' : undefined
    return { kind: 'pdf', name, text: needsVision ? '' : text, pages: pdf.numPages, words: needsVision ? 0 : wordCount(text), warnings, needsVision }
  } finally {
    void pdf.cleanup()
  }
}

async function readDocx(data: ArrayBuffer, name: string): Promise<ImportedDocument> {
  const mammoth = (await import('mammoth/mammoth.browser')).default as { extractRawText(o: { arrayBuffer: ArrayBuffer }): Promise<{ value: string; messages: { type: string; message: string }[] }> }
  let res: { value: string; messages: { type: string; message: string }[] }
  try {
    res = await mammoth.extractRawText({ arrayBuffer: data })
  } catch {
    throw new DocumentImportError('This Word file could not be opened. Only .docx works (not the old .doc): in Word, use Save As → Word Document (.docx).')
  }
  const text = tidyExtractedText(res.value)
  if (!text || wordCount(text) < 5) throw new DocumentImportError('This Word file has no text in it.')
  if (looksLikeLegacyBangla(text)) {
    throw new DocumentImportError('This Word file is typed in an old Bangla font (Bijoy / SutonnyMJ). Convert it to Unicode first, then paste it into "Paste Bengali Story".')
  }
  const warnings = res.messages.filter((m) => m.type === 'warning').length ? ['Some formatting (pictures, text boxes) was skipped; only the text is used.'] : []
  return { kind: 'docx', name, text, words: wordCount(text), warnings }
}

export async function readDocument(file: File): Promise<ImportedDocument> {
  const kind = documentKind(file.name, file.type)
  if (!kind) throw new DocumentImportError('Only PDF and Word (.docx) files can be added here.')
  if (file.size > MAX_DOCUMENT_BYTES) throw new DocumentImportError(`This file is ${(file.size / 1048576).toFixed(0)} MB; the limit is ${MAX_DOCUMENT_BYTES / 1048576} MB.`)
  const data = await file.arrayBuffer()
  return kind === 'pdf' ? readPdf(data, file.name) : readDocx(data, file.name)
}

export const MAX_VISION_BYTES = 18 * 1024 * 1024
export const MAX_VISION_PAGES = 60

const VISION_REASON = {
  scanned: 'it is a scan or picture with no selectable text',
  legacy: 'it is typed in an old Bangla font (Bijoy / SutonnyMJ)',
  scrambled: 'its text is saved out of order',
} as const

const READ_SCHEMA = {
  type: 'object' as const,
  properties: {
    headline: { type: 'string' as const, description: "The story's own headline, exactly as printed, in the document's language. Empty if it has none." },
    body: { type: 'string' as const, description: 'Every paragraph of the story, in order, exactly as printed, separated by blank lines.' },
  },
  required: ['headline', 'body'],
}

const READ_PROMPT = `You are a careful copy-typist for a newsroom. The attached PDF holds a news report or press release, most likely in Bangla. Type out its text exactly as printed, in the language it is written in (Bangla in Unicode).

Rules:
- Do not translate, summarise, correct, reorder or add anything. Keep every number, name, quotation and unit exactly as shown.
- Return the story's headline in "headline" and every paragraph of the story, in reading order, in "body", separated by blank lines.
- Leave out page numbers, running headers and footers, letterheads, logos, ads, contact blocks and copyright lines.
- Type the story on every page, to its end; a continuation on a later page belongs to the story. Only if the document clearly holds several unrelated stories, type just the first one.
- If something is unreadable, write [illegible] in its place; never guess.`

/** The AI reads the PDF pages itself, then the desk translates that transcription like any pasted text. */
export async function readPdfWithAi(file: File, reason: NonNullable<ImportedDocument['needsVision']>, pages: number, onStatus?: (s: string) => void): Promise<ImportedDocument> {
  const { aiFor, aiJson, providerMeta, resolveModel, listModels } = await import('./aiProviders')
  const ai = aiFor('main')
  const why = `This PDF's own text cannot be used (${VISION_REASON[reason]}).`
  if (!ai) throw new DocumentImportError(`${why} Add an AI key (the AI chip, top right) and choose Claude or Gemini as the main AI — it can read the pages — or convert the file to text and use "Paste Bengali Story".`)
  if (ai.provider !== 'anthropic' && ai.provider !== 'gemini') throw new DocumentImportError(`${why} ${providerMeta(ai.provider).name} cannot read PDF pages here: choose Claude or Gemini as the main AI (Engine panel, bottom of the window), or convert the file to text and use "Paste Bengali Story".`)
  if (file.size > MAX_VISION_BYTES) throw new DocumentImportError(`${why} It is also too big for the AI to read directly (${(file.size / 1048576).toFixed(0)} MB; the limit is ${MAX_VISION_BYTES / 1048576} MB).`)
  if (pages > MAX_VISION_PAGES) throw new DocumentImportError(`${why} It also has ${pages} pages; the AI can read up to ${MAX_VISION_PAGES}. Split out the story's pages first.`)
  const bytes = new Uint8Array(await file.arrayBuffer())
  let bin = ''
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  const data = btoa(bin)
  let listed: Awaited<ReturnType<typeof listModels>> = []
  try { listed = await listModels(ai.provider, ai.key) } catch { /* the call below reports the real error */ }
  const model = resolveModel(ai.provider, ai.model, listed)
  onStatus?.(`Reading the PDF with ${providerMeta(ai.provider).name}…`)
  const { data: out } = await aiJson<Record<string, string>>({
    provider: ai.provider, key: ai.key, model,
    system: READ_PROMPT,
    user: 'Type out the story in this PDF.',
    attachment: { mime: 'application/pdf', data },
    schema: READ_SCHEMA,
    maxTokens: 24000,
    effort: 'low',
    timeoutMs: 240_000,
  })
  const text = tidyExtractedText([String(out.headline ?? '').trim(), String(out.body ?? '').trim()].filter(Boolean).join('\n\n'))
  if (!text || wordCount(text) < 5) throw new DocumentImportError('The AI could not find a story in this PDF.')
  const warnings = [`Read by ${providerMeta(ai.provider).name} from the page images — check the figures against the PDF.`]
  if (/\[illegible\]/i.test(text)) warnings.push('Some words were illegible and are marked [illegible].')
  return { kind: 'pdf', name: file.name, text, pages, words: wordCount(text), warnings }
}
