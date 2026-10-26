// @vitest-environment jsdom
// The AI master switch: while it is off no AI company is contacted by anything.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AI_OFF_MESSAGE, aiFor, aiJson, listModels, loadAiSettings, saveAiSettings, testAiKey } from '../../src/editorial/aiProviders'

const withKeys = () => {
  const s = loadAiSettings()
  saveAiSettings({ ...s, keys: { ...s.keys, gemini: 'test-key', anthropic: 'test-key' } })
}

describe('AI switched off', () => {
  beforeEach(() => { localStorage.clear(); withKeys() })

  it('is on by default and a keyed job gets its provider', () => {
    expect(loadAiSettings().paused).toBe(false)
    expect(aiFor('main')?.provider).toBe('gemini')
  })

  it('gives no provider to any job, and sends nothing, once paused', async () => {
    saveAiSettings({ ...loadAiSettings(), paused: true })
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    expect(aiFor('main')).toBeNull()
    expect(aiFor('seo')).toBeNull()
    expect(await listModels('gemini', 'test-key')).toEqual([])
    expect(await testAiKey('gemini', 'test-key', 'auto')).toMatchObject({ ok: false, error: AI_OFF_MESSAGE })
    await expect(aiJson({ provider: 'gemini', key: 'test-key', model: 'm', system: '', user: '', schema: { type: 'object', properties: {}, required: [] } })).rejects.toThrow(/AI is OFF/)
    expect(fetchSpy).not.toHaveBeenCalled()
    fetchSpy.mockRestore()
  })

  it('keeps keys and choices while off, and works again when turned on', () => {
    saveAiSettings({ ...loadAiSettings(), paused: true })
    expect(loadAiSettings().keys.gemini).toBe('test-key')
    saveAiSettings({ ...loadAiSettings(), paused: false })
    expect(aiFor('main')?.key).toBe('test-key')
  })
})
