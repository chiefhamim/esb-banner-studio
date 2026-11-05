// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'

const session = { email: 'editor@example.com', name: 'Test Editor', role: 'EDITOR', token: 't', userId: 'u-1', authenticatedAt: '', authType: 'supabase' as const }
vi.mock('../../src/editorial/editorialStore', () => ({ useEditorialStore: Object.assign(() => null, { getState: () => ({ staffSession: session }) }) }))
vi.mock('../../src/editorial/siteApi', () => ({
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_ANON_KEY: 'anon',
  ensureFreshSession: async () => session,
}))
const { AVATAR_REMOTE, AVATAR_SETS, displayUrl, presetSetOf, presetUrl, useAvatar } = await import('../../src/editorial/avatar')

const reply = (rows: unknown, ok = true) => ({ ok, json: async () => rows }) as Response

describe('profile picture', () => {
  beforeEach(() => { localStorage.clear(); useAvatar.setState({ userId: null, url: null, saving: null }); vi.restoreAllMocks() })

  it('preset URLs point at the site bucket and draw from the bundled copy', () => {
    expect(AVATAR_SETS).toHaveLength(12)
    const u = presetUrl('islamic', 3)
    expect(u).toBe(`${AVATAR_REMOTE}/islamic/03.png`)
    expect(displayUrl(u)).toBe('./avatars/presets/islamic/03.png')
    expect(presetSetOf(u)).toBe('islamic')
    expect(displayUrl('https://cdn.example.com/me.png')).toBe('https://cdn.example.com/me.png')
    expect(displayUrl('javascript:alert(1)')).toBeNull()
    expect(presetSetOf('https://cdn.example.com/me.png')).toBeNull()
  })

  it('loads the saved picture for the signed-in account and caches it', async () => {
    const f = vi.spyOn(globalThis, 'fetch').mockResolvedValue(reply([{ avatar_url: presetUrl('micah', 2) }]))
    await useAvatar.getState().load(session)
    expect(f.mock.calls[0]![0]).toContain('profiles?id=eq.u-1&select=avatar_url')
    expect(useAvatar.getState().url).toBe(presetUrl('micah', 2))
    expect(localStorage.getItem('esb-banner-studio/avatar/u-1')).toBe(presetUrl('micah', 2))
  })

  it('a choice counts only when the site writes it back', async () => {
    useAvatar.setState({ userId: 'u-1', url: null })
    const f = vi.spyOn(globalThis, 'fetch').mockResolvedValue(reply([{ avatar_url: presetUrl('glass', 1) }]))
    expect(await useAvatar.getState().choose(presetUrl('glass', 1))).toBe(true)
    const [, init] = f.mock.calls[0]!
    expect((init as RequestInit).method).toBe('PATCH')
    expect(JSON.parse((init as RequestInit).body as string).avatar_url).toBe(presetUrl('glass', 1))
    expect(useAvatar.getState().url).toBe(presetUrl('glass', 1))
  })

  it('a refused or empty save puts the old picture back (no fake success)', async () => {
    useAvatar.setState({ userId: 'u-1', url: presetUrl('notionists', 1) })
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(reply([], true)).mockResolvedValueOnce(reply({}, false)).mockRejectedValueOnce(new Error('offline'))
    for (let i = 0; i < 3; i++) {
      expect(await useAvatar.getState().choose(presetUrl('thumbs', 4))).toBe(false)
      expect(useAvatar.getState().url).toBe(presetUrl('notionists', 1))
      expect(useAvatar.getState().saving).toBeNull()
    }
  })

  it('signing out clears the picture', async () => {
    useAvatar.setState({ userId: 'u-1', url: presetUrl('micah', 1) })
    await useAvatar.getState().load(null)
    expect(useAvatar.getState()).toMatchObject({ userId: null, url: null })
  })
})
