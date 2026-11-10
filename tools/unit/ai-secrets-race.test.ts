// @vitest-environment jsdom
// The encrypted AI keys load asynchronously. A save made before they land (the desk saving its settings at launch)
// must never write empty keys over the stored ones — that wiped the editor's key after every update.
import { afterEach, describe, expect, it, vi } from 'vitest'

type Esb = { secretGet: (k: string) => Promise<string | null>; secretSet: (k: string, v: string) => Promise<boolean> }

async function boot(stored: Record<string, string>) {
  vi.resetModules()
  localStorage.clear()
  let release!: () => void
  const gate = new Promise<void>((r) => { release = r })
  const writes: string[] = []
  const esb: Esb = {
    secretGet: async () => { await gate; return JSON.stringify(stored) },
    secretSet: async (_k, v) => { writes.push(v); return true },
  }
  ;(window as unknown as { esb: Esb }).esb = esb
  const mod = await import('../../src/editorial/aiProviders')
  return { mod, release, writes }
}

afterEach(() => { delete (window as unknown as { esb?: Esb }).esb })

describe('AI keys and the launch race', () => {
  it('a save before the keys load keeps every stored key the caller had not seen', async () => {
    const { mod, release, writes } = await boot({ gemini: 'g-real', anthropic: 'a-real', openai: '', openrouter: '' })
    const early = mod.loadAiSettings()
    expect(early.keys.gemini).toBe('') // not loaded yet
    mod.saveAiSettings({ ...early, paused: true }) // e.g. a toggle at launch
    expect(writes).toHaveLength(0) // nothing written while the keys are unknown
    release()
    await vi.waitFor(() => expect(writes.length).toBeGreaterThan(0))
    const saved = JSON.parse(writes.at(-1)!)
    expect(saved.gemini).toBe('g-real')
    expect(saved.anthropic).toBe('a-real')
    expect(mod.loadAiSettings().paused).toBe(true)
  })

  it('after the keys load, a deliberate removal is honoured', async () => {
    const { mod, release, writes } = await boot({ gemini: 'g-real', anthropic: '', openai: '', openrouter: '' })
    release()
    await vi.waitFor(() => expect(mod.aiSecretsLoaded()).toBe(true))
    const s = mod.loadAiSettings()
    expect(s.keys.gemini).toBe('g-real')
    mod.saveAiSettings({ ...s, keys: { ...s.keys, gemini: '' } })
    expect(JSON.parse(writes.at(-1)!).gemini).toBe('')
  })

  it('tells the desk when the keys arrive', async () => {
    const { release } = await boot({ gemini: 'g-real', anthropic: '', openai: '', openrouter: '' })
    const seen = new Promise<boolean>((r) => window.addEventListener('esb-ai-secrets-ready', () => r(true), { once: true }))
    release()
    expect(await seen).toBe(true)
  })
})
