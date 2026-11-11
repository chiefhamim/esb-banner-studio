// Many hits at once: every one must be stored, exactly once, and the cursor must hand each out exactly once.
import { describe, expect, it } from 'vitest'
import { api, hit, letter, rows, UA } from './helpers'

describe('load', () => {
  it('500 opens of one letter at the same moment = 500 rows', async () => {
    const l = await letter()
    const res = await Promise.all(Array.from({ length: 500 }, () => hit(l.pixel)))
    expect(res.every((r) => r.status === 200)).toBe(true)
    expect(await rows(l.key)).toHaveLength(500)
  })

  it('300 letters × (open, open, click) interleaved = exact counts per letter', async () => {
    const letters = await Promise.all(Array.from({ length: 300 }, () => letter()))
    const jobs: Promise<Response>[] = []
    for (const l of letters) {
      jobs.push(hit(l.pixel, { ua: UA.gmailProxy, asn: 15169 }))
      jobs.push(hit(l.pixel, { ua: UA.outlookDesktop }))
      jobs.push(l.click('https://esbpowerline.com/x').then((u) => hit(u)))
    }
    // shuffle so letters are mixed together
    await Promise.all(jobs.sort(() => Math.random() - 0.5))
    const keys = letters.map((l) => l.key)
    type S = { key: string; opens: number; clicks: number }
    const summaries: S[] = []
    for (let i = 0; i < keys.length; i += 100) {
      const r = (await (await api(`/api/summary?keys=${keys.slice(i, i + 100).join(',')}`)).json()) as { summaries: S[] }
      summaries.push(...r.summaries)
    }
    expect(summaries).toHaveLength(300)
    for (const s of summaries) expect([s.opens, s.clicks]).toEqual([2, 1])
  })

  it('paging 2,345 events through the cursor returns each exactly once, in order', async () => {
    const l = await letter()
    for (let i = 0; i < 2345; i += 200) await Promise.all(Array.from({ length: Math.min(200, 2345 - i) }, () => hit(l.pixel)))
    const seen: number[] = []
    let after = 0, more = true, pages = 0
    while (more) {
      const p = (await (await api(`/api/events?after=${after}&limit=333`)).json()) as { events: { id: number; key: string }[]; next: number; more: boolean }
      seen.push(...p.events.filter((e) => e.key === l.key).map((e) => e.id))
      after = p.next
      more = p.more
      if (++pages > 100) throw new Error('cursor never ends')
    }
    expect(seen).toHaveLength(2345)
    expect(new Set(seen).size).toBe(2345)
    expect([...seen].sort((a, b) => a - b)).toEqual(seen)
  })
})
