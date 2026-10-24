import { describe, it, expect } from 'vitest'
import { readdirSync, statSync } from 'node:fs'
import path from 'node:path'

// Windows and macOS file systems ignore case, Linux does not. StoryQueue.tsx beside storyQueue.ts built and passed
// every suite on Linux and failed `tsc` on Windows (TS1149/TS1261), so no two modules in one folder may differ only
// in case — counted without the extension, because an import names neither.
function walk(dir: string, out: string[] = []) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.')) continue
    const p = path.join(dir, name)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (/\.(tsx?|mjs|cjs|js)$/.test(name)) out.push(p)
  }
  return out
}

describe('file names', () => {
  it('no two modules in a folder differ only in case', () => {
    const seen = new Map<string, string>()
    const clashes: string[] = []
    for (const root of ['src', 'electron', 'tools']) {
      for (const f of walk(path.resolve(import.meta.dirname, '../..', root))) {
        const key = f.replace(/\.(d\.)?(tsx?|mjs|cjs|js)$/, '').toLowerCase()
        const prev = seen.get(key)
        if (prev && prev !== f) clashes.push(`${prev} ↔ ${f}`)
        seen.set(key, f)
      }
    }
    expect(clashes).toEqual([])
  })
})
