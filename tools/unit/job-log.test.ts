import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { useJobLog } from '../../src/editorial/jobLog'

const log = () => useJobLog.getState()

beforeEach(() => { useJobLog.setState({ jobs: [] }); vi.useFakeTimers(); vi.setSystemTime(1_000) })
afterEach(() => vi.useRealTimers())

describe('The activity history', () => {
  it('times each step and the whole job', () => {
    const id = log().begin('seo', 'SEO', 'Choosing the model')
    vi.setSystemTime(1_400); log().step(id, 'Writing with Gemini')
    vi.setSystemTime(2_700); log().step(id, "Checking it against the site's rules")
    vi.setSystemTime(2_750); log().finish(id, { by: 'Gemini · gemini-3-flash' })
    const j = log().jobs[0]
    expect(j.steps.map((s) => (s.end! - s.start))).toEqual([400, 1300, 50])
    expect(j.end! - j.start).toBe(1_750)
    expect(j.by).toBe('Gemini · gemini-3-flash')
    expect(j.error).toBeUndefined()
  })

  it('keeps story, SEO and social jobs side by side, newest first, and they never mix', () => {
    const a = log().begin('story', 'Story translation', 'Translating')
    const b = log().begin('seo', 'SEO', 'Choosing the model')
    log().step(b, 'Writing')
    log().finish(a, { by: 'Claude · claude-sonnet-5-5' })
    expect(log().jobs.map((j) => j.kind)).toEqual(['seo', 'story'])
    expect(log().jobs[0].end).toBeUndefined()
    expect(log().jobs[1].end).toBeDefined()
    expect(log().jobs[0].steps).toHaveLength(2)
  })

  it('records a failure with its message and the provider that failed', () => {
    const id = log().begin('social', 'Social captions', 'Choosing the model')
    log().finish(id, { by: 'Gemini', error: 'Gemini rejected this key' })
    expect(log().jobs[0]).toMatchObject({ by: 'Gemini', error: 'Gemini rejected this key' })
  })

  it('a finished job cannot be changed, a repeated step is not duplicated, and old jobs drop off at 12', () => {
    const id = log().begin('seo', 'SEO', 'Same')
    log().step(id, 'Same')
    expect(log().jobs[0].steps).toHaveLength(1)
    log().finish(id)
    vi.setSystemTime(9_000)
    log().step(id, 'Late'); log().finish(id, { error: 'late' })
    expect(log().jobs[0].steps).toHaveLength(1)
    expect(log().jobs[0].error).toBeUndefined()
    for (let i = 0; i < 20; i++) log().begin('seo', 'SEO ' + i, 'x')
    expect(log().jobs).toHaveLength(12)
  })

  it('clearing the history keeps a job that is still running', () => {
    const done = log().begin('seo', 'SEO', 'x'); log().finish(done)
    const running = log().begin('story', 'Story translation', 'x')
    log().clear()
    expect(log().jobs.map((j) => j.id)).toEqual([running])
  })
})
