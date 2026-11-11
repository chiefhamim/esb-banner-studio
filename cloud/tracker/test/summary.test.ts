import { describe, expect, it } from 'vitest'
import { summarize, DEDUPE_MS, type EventRow } from '../src/summary'

const K = 'AAECAwQFBgcICQoLDA0ODw'
let id = 0
const T0 = 1_762_000_000_000
const ev = (p: Partial<EventRow>): EventRow => ({
  id: ++id, key: K, type: 'open', target: null, at: T0, sent_at: T0 - 3_600_000, cls: 'human', why: null,
  client: 'Chrome', device: 'Windows', ua: 'UA', asn: 24389, as_org: 'GP', country: 'BD', city: 'Dhaka', colo: 'DAC', ip_hash: 'aa', ...p,
})

describe('summarize', () => {
  it('nothing yet', () => {
    const s = summarize(K, [])
    expect(s).toMatchObject({ opened: false, opens: 0, forwarded: 'unknown' })
  })

  it('counts people and proxies, never machines', () => {
    const s = summarize(K, [
      ev({ cls: 'prefetch', at: T0 }), ev({ cls: 'scanner', at: T0 + 1 }), ev({ cls: 'bot', at: T0 + 2 }),
      ev({ cls: 'proxy', client: 'Gmail', ip_hash: 'g1', at: T0 + 60_000 }),
      ev({ cls: 'human', at: T0 + 120_000 }),
    ])
    expect(s).toMatchObject({ opened: true, opens: 2, humanOpens: 1, proxyOpens: 1, machineOpens: 3, firstOpen: T0 + 60_000, lastOpen: T0 + 120_000 })
  })

  it('folds a reload within the dedupe window, keeps a real re-open', () => {
    const s = summarize(K, [ev({ at: T0 }), ev({ at: T0 + 2_000 }), ev({ at: T0 + DEDUPE_MS + 3_000 }), ev({ at: T0 + 3_600_000 })])
    expect(s.opens).toBe(3)
  })

  it('clicks per link; a click proves an open even with pictures off', () => {
    const s = summarize(K, [
      ev({ type: 'click', target: 'https://esbpowerline.com/a', at: T0 }),
      ev({ type: 'click', target: 'https://esbpowerline.com/a', at: T0 + 60_000 }),
      ev({ type: 'click', target: 'https://esbpowerline.com/b', at: T0 + 90_000 }),
      ev({ type: 'click', target: 'https://esbpowerline.com/b', cls: 'scanner', at: T0 + 1 }),
    ])
    expect(s.opened).toBe(true)
    expect(s.opens).toBe(0)
    expect(s.firstOpen).toBe(T0)
    expect(s.clicks).toBe(3)
    expect(s.machineClicks).toBe(1)
    expect(s.links).toEqual([{ url: 'https://esbpowerline.com/a', clicks: 2, first: T0 }, { url: 'https://esbpowerline.com/b', clicks: 1, first: T0 + 90_000 }])
  })

  it('downloads per file', () => {
    const s = summarize(K, [ev({ type: 'file', target: 'f1-aaaaaaaa' }), ev({ type: 'file', target: 'f1-aaaaaaaa', at: T0 + 86_400_000 })])
    expect(s.files).toEqual([{ id: 'f1-aaaaaaaa', downloads: 2, first: T0 }])
  })

  it('forwarded: likely when read in two countries', () => {
    const s = summarize(K, [ev({}), ev({ at: T0 + 86_400_000, country: 'GB', city: 'London', asn: 2856, ip_hash: 'bb' })])
    expect(s.forwarded).toBe('likely')
  })
  it('forwarded: likely from three networks', () => {
    const s = summarize(K, [ev({}), ev({ asn: 1, ip_hash: 'b', at: T0 + 1e6 }), ev({ asn: 2, ip_hash: 'c', at: T0 + 2e6 })])
    expect(s.forwarded).toBe('likely')
  })
  it('forwarded: only "possible" for office desktop + phone', () => {
    const s = summarize(K, [ev({}), ev({ asn: 24432, device: 'iPhone', client: 'Apple Mail', ip_hash: 'm', at: T0 + 1e6 })])
    expect(s.forwarded).toBe('possible')
  })
  it('forwarded: unknown when only Gmail proxies saw it', () => {
    const s = summarize(K, [ev({ cls: 'proxy', client: 'Gmail' })])
    expect(s.forwarded).toBe('unknown')
  })
  it('ignores other letters', () => {
    expect(summarize(K, [ev({ key: 'BBECAwQFBgcICQoLDA0ODw' })]).opened).toBe(false)
  })
})
