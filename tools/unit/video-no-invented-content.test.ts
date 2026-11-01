// Non-negotiable 1: no preset, sample or default in the Video desk may put a made-up name, title, figure or date on
// screen. This reads every source file in src/video and fails on the fabricated values the old demo carried, on any
// honorific + name, and on any energy figure (a number with MW, MMCFD, crore, …) written into a string.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const dir = path.resolve(import.meta.dirname, '../../src/video')
const files = fs.readdirSync(dir).filter((f) => /\.(ts|tsx)$/.test(f))
const source = Object.fromEntries(files.map((f) => [f, fs.readFileSync(path.join(dir, f), 'utf8')]))
// string literals only (comments may describe what was removed)
const strings = (code: string) => (code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').match(/(['"`])(?:\\.|(?!\1)[^\\])*\1/g) ?? []).join('\n')

describe('Video desk ships no invented content', () => {
  it('has source files to check', () => expect(files.length).toBeGreaterThan(5))

  it.each(['Rezwanul', 'Chairman', 'Power Development Board', 'Petrobangla', 'MMCFD', '16,500', 'মিলিয়ন', '৩০', 'Gas Drilling Rig', 'Power Substation', 'Voiceover Take 01', 'Offshore Drilling', 'সরাসরি'])('no "%s" anywhere in src/video', (needle) => {
    for (const [f, code] of Object.entries(source)) expect(code.includes(needle), `${f} contains ${needle}`).toBe(false)
  })

  it('no honorific + name and no energy figure in any string', () => {
    for (const [f, code] of Object.entries(source)) {
      const s = strings(code)
      expect(s, f).not.toMatch(/\b(Engr|Dr|Mr|Mrs|Ms|Prof)\.\s+[A-Z]/)
      expect(s, f).not.toMatch(/\b\d[\d,.]*\s*(MW|MWh|GW|MMCFD|mmcfd|crore|lakh|kV|BCF|Tk)\b/)
      expect(s, f).not.toMatch(/[০-৯]+\s*(মেগাওয়াট|কোটি|ঘনফুট)/)
    }
  })

  it('a new project has no clips, and the ESB bug has no REC/live sign', () => {
    expect(source['timeline.ts']).toMatch(/clips: \[\],/)
    expect(strings(source['compositor.ts'])).not.toMatch(/\bREC\b|\bLIVE\b/)
    expect(source['compositor.ts']).not.toMatch(/Math\.sin\(time/)
  })
})
