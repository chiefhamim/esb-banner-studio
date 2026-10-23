import { describe, it, expect } from 'vitest'
import { dateParts } from './templates'
import { detectCategory, parseArticleHtml, suggestHighlight } from './newsroom'
import { fileNameFor, makeZip, planJobs } from '../export'
import { defaultDoc } from './templates'
import type { ExportSettings } from '../export'

describe('Pure core functions characterisation tests', () => {
  describe('dateParts', () => {
    it('extracts day number, month-year and weekday from ISO string', () => {
      const parts = dateParts('2026-10-22')
      expect(parts.num).toBe('22')
      expect(parts.monthYear).toBe('OCTOBER 2026')
      expect(parts.weekday).toBe('THURSDAY')
    })

    it('handles first day of year correctly', () => {
      const parts = dateParts('2025-01-01')
      expect(parts.num).toBe('1')
      expect(parts.monthYear).toBe('JANUARY 2025')
      expect(parts.weekday).toBe('WEDNESDAY')
    })
  })

  describe('suggestHighlight', () => {
    it('picks currency figure from headline', () => {
      const hl = 'Govt approves Tk 592 crore gas development project'
      const suggestion = suggestHighlight(hl)
      expect(suggestion).toBe('Tk 592 crore')
    })

    it('picks percentage with verb prefix from headline', () => {
      const hl = 'Power generation rises 14.5% across solar farms'
      const suggestion = suggestHighlight(hl)
      expect(suggestion).toBe('rises 14.5%')
    })

    it('returns empty string for empty headline', () => {
      expect(suggestHighlight('')).toBe('')
      expect(suggestHighlight('   ')).toBe('')
    })

    it('falls back to picking middle phrase when no numbers exist', () => {
      const hl = 'Ministers meet to discuss transmission network roadmap'
      const suggestion = suggestHighlight(hl)
      expect(suggestion).toBe('discuss transmission')
    })
  })

  describe('detectCategory', () => {
    it('detects power grid category from transmission keywords (category 05)', () => {
      const cat = detectCategory('National grid sub-station capacity expanded')
      expect(cat).toBe('05')
    })

    it('detects renewables category from solar/wind keywords (category 04)', () => {
      const cat = detectCategory('Huge solar farm commissioned in Rooppur')
      expect(cat).toBe('04')
    })

    it('detects fossil fuels category from gas keywords (category 03)', () => {
      const cat = detectCategory('New gas well exploration begins in Sylhet')
      expect(cat).toBe('03')
    })

    it('returns undefined when no known keywords match', () => {
      const cat = detectCategory('General announcement without energy domain keywords')
      expect(cat).toBeUndefined()
    })
  })

  describe('parseArticleHtml', () => {
    it('extracts title and og tags from sample HTML', () => {
      const html = `
        <!DOCTYPE html>
        <html>
          <head>
            <meta property="og:title" content="Petrobangla Signs Major LNG Deal" />
            <meta property="og:description" content="Agreement signed for long-term gas import." />
            <meta property="og:image" content="https://example.com/photo.jpg" />
            <meta name="pubdate" content="2026-10-20" />
          </head>
          <body>
            <h1>Petrobangla Signs Major LNG Deal</h1>
            <p>Full article body text goes here.</p>
          </body>
        </html>
      `
      const parsed = parseArticleHtml(html, 'https://example.com/story')
      expect(parsed.headline).toContain('Petrobangla Signs Major LNG Deal')
      expect(parsed.description).toContain('Agreement signed for long-term gas import')
      expect(parsed.imageUrl).toBe('https://example.com/photo.jpg')
    })
  })

  describe('fileNameFor and planJobs', () => {
    it('generates predictable clean filenames for banners', () => {
      const doc = defaultDoc()
      doc.content.categoryId = '01'
      doc.content.date = '2026-10-22'
      const s: Pick<ExportSettings, 'pattern' | 'type'> = {
        pattern: 'ESB_{cat}-{category}_{date}_{format}{scale}',
        type: 'png',
      }
      const name = fileNameFor(doc, 'fb45', 1, s)
      expect(name).toBe('ESB_01-energy-policy-and-regulators_2026-10-22_Facebook.png')

      const name2x = fileNameFor(doc, 'fb45', 2, s)
      expect(name2x).toBe('ESB_01-energy-policy-and-regulators_2026-10-22_Facebook@2x.png')
    })

    it('plans jobs with expected format and scale breakdown', () => {
      const doc = defaultDoc()
      const s: ExportSettings = {
        formats: ['fb45', 'web'],
        scales: [1, 2],
        type: 'png',
        quality: 92,
        pattern: 'ESB_{cat}_{format}{scale}',
        zip: false,
        saveProject: false,
        dir: null,
        openAfter: false,
      }
      const jobs = planJobs(doc, s)
      expect(jobs.length).toBe(4)
      expect(jobs.map((j) => j.format)).toEqual(['fb45', 'fb45', 'web', 'web'])
      expect(jobs.map((j) => j.scale)).toEqual([1, 2, 1, 2])
    })
  })

  describe('makeZip', () => {
    it('creates a binary ZIP buffer with standard PK headers', () => {
      const files = [
        { name: 'hello.txt', data: new TextEncoder().encode('Hello World') },
        { name: 'test.dat', data: new Uint8Array([1, 2, 3, 4]) },
      ]
      const zip = makeZip(files)
      expect(zip instanceof Uint8Array).toBe(true)
      expect(zip.length).toBeGreaterThan(60)

      // ZIP local file signature: 0x50 0x4B 0x03 0x04 ("PK\x03\x04")
      expect(zip[0]).toBe(0x50)
      expect(zip[1]).toBe(0x4b)
      expect(zip[2]).toBe(0x03)
      expect(zip[3]).toBe(0x04)

      // Contains file names in the binary stream
      const text = new TextDecoder('latin1').decode(zip)
      expect(text).toContain('hello.txt')
      expect(text).toContain('test.dat')
      expect(text).toContain('Hello World')
    })
  })
})
