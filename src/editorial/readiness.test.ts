import { describe, expect, it } from 'vitest'
import { buildReadiness, triage } from './readiness'
import type { ReadyInput } from './readiness'

const ok: ReadyInput = { headline: 'Petrobangla to drill two new wells in Sylhet', deck: 'Two wells at Tk 592 crore.', body: 'x', words: 400, hasImage: true, imageAlt: 'A rig', tagCount: 4, unverified: 0, seo: [{ status: 'good', label: 'a' }], signedIn: true, siteOnline: true, canUpload: true }

describe('buildReadiness', () => {
  it('is ready when everything checks out', () => {
    const r = buildReadiness(ok)
    expect(r.state).toBe('ready')
    expect(r.blockers + r.warnings).toBe(0)
    expect(r.ok).toBe(r.total)
  })
  it('blocks on a missing headline, an over-long deck, a thin story, Bengali, no sign-in or an offline site', () => {
    expect(buildReadiness({ ...ok, headline: '' }).checks.find((c) => c.id === 'headline')?.fix).toBe('headline')
    expect(buildReadiness({ ...ok, deck: 'x'.repeat(201) }).state).toBe('blocked')
    expect(buildReadiness({ ...ok, words: 12 }).state).toBe('blocked')
    expect(buildReadiness({ ...ok, body: 'পেট্রোবাংলা' }).checks.find((c) => c.id === 'bengali')?.status).toBe('bad')
    expect(buildReadiness({ ...ok, signedIn: false }).checks.find((c) => c.id === 'signin')?.fix).toBe('sign-in')
    expect(buildReadiness({ ...ok, siteOnline: false }).blockers).toBe(1)
  })
  it('only asks for a look at quality items, and says where to fix each', () => {
    const r = buildReadiness({ ...ok, unverified: 2, hasImage: false, tagCount: 1, seo: [{ status: 'bad', label: 'a' }, { status: 'good', label: 'b' }] })
    expect(r.state).toBe('review')
    expect(r.blockers).toBe(0)
    expect(r.checks.filter((c) => c.status !== 'ok').map((c) => c.fix).sort()).toEqual(['facts', 'photo', 'seo', 'tags'])
    expect(r.checks.find((c) => c.id === 'facts')?.detail).toContain('2 figures');
  })
  it('asks for alt text when the photo is set without it, and notes the browser cannot upload', () => {
    expect(buildReadiness({ ...ok, imageAlt: '' }).checks.find((c) => c.id === 'photo')?.detail).toMatch(/alt text/)
    expect(buildReadiness({ ...ok, canUpload: false }).checks.find((c) => c.id === 'upload')?.status).toBe('warn')
  })
})

describe('triage', () => {
  const bad = buildReadiness({ ...ok, signedIn: false, hasImage: false })
  it('counts open items until the editor ignores them', () => {
    const t = triage(bad, new Set())
    expect(t.state).toBe('blocked')
    expect(t.open.map((c) => c.id).sort()).toEqual(['photo', 'signin'])
  })
  it('stops counting what is ignored, and keeps it listed to restore', () => {
    const t = triage(bad, new Set(['signin', 'photo']))
    expect(t.state).toBe('ready')
    expect(t.open).toHaveLength(0)
    expect(t.ignored.map((c) => c.id).sort()).toEqual(['photo', 'signin'])
    expect(t.done).toBe(bad.total)
  })
  it('lets a required item be ignored on its own, leaving the quality items to review', () => {
    expect(triage(bad, new Set(['signin'])).state).toBe('review')
  })
})
