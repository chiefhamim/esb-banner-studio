import { describe, it, expect, beforeEach } from 'vitest'
import { logPublishJob } from '../../src/video/publish/activityLog'
import { useJobLog } from '../../src/editorial/jobLog'

const mem = new Map<string, string>()
;(globalThis as { localStorage?: unknown }).localStorage = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => { mem.set(k, v) }, removeItem: (k: string) => { mem.delete(k) } }

const job = (over: Record<string, unknown> = {}) => ({
  id: 'j1', status: 'done', title: 'Two new wells', dryRun: false,
  destinations: [{ kind: 'youtube', state: 'done', error: null, result: { url: 'https://youtu.be/abc' } }, { kind: 'facebook_reel', state: 'done', error: null, result: { url: 'https://facebook.com/reel/1' } }],
  ...over,
})

describe('posts in Activity', () => {
  beforeEach(() => { mem.clear(); useJobLog.setState({ jobs: [] }) })

  it('a finished post is logged once, with each destination and its link', () => {
    expect(logPublishJob(job())).toBe(true)
    expect(logPublishJob(job())).toBe(false)
    const [entry] = useJobLog.getState().jobs
    expect(entry.kind).toBe('publish')
    expect(entry.title).toContain('Two new wells')
    const text = entry.steps.map((s) => s.label).join(' | ')
    expect(text).toContain('https://youtu.be/abc')
    expect(text).toContain('Facebook Reel')
    expect(entry.error).toBeUndefined()
  })

  it('a failed destination turns the entry red with the platform’s own words', () => {
    logPublishJob(job({ status: 'failed', destinations: [{ kind: 'youtube', state: 'failed', error: 'YouTube said: quotaExceeded', result: null }] }))
    const entry = useJobLog.getState().jobs[0]
    expect(entry.error).toContain('quotaExceeded')
  })

  it('a running post is not logged yet; a retry that ends differently is a new line', () => {
    expect(logPublishJob(job({ status: 'running' }))).toBe(false)
    expect(logPublishJob(job({ status: 'failed', destinations: [{ kind: 'youtube', state: 'failed', error: 'x', result: null }] }))).toBe(true)
    expect(logPublishJob(job())).toBe(true)
    expect(useJobLog.getState().jobs).toHaveLength(2)
  })
})
