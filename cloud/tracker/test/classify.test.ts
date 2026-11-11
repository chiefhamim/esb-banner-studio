import { describe, expect, it } from 'vitest'
import { classify, type HitFacts } from '../src/classify'
import { UA } from './helpers'

const H = 3_600_000
const open = (ua: string, asn: number | null = 24389, since = H, method = 'GET'): HitFacts => ({ type: 'open', ua, asn, sinceSendMs: since, method })
const click = (ua: string, asn: number | null = 24389, since = H, method = 'GET'): HitFacts => ({ type: 'click', ua, asn, sinceSendMs: since, method })

describe('classify: opens', () => {
  const cases: [string, HitFacts, string, string | null][] = [
    ['Chrome on Windows (webmail)', open(UA.chromeWin), 'human', 'Chrome'],
    ['Outlook desktop', open(UA.outlookDesktop), 'human', 'Outlook'],
    ['Apple Mail on Mac, home network', open(UA.appleMailMac), 'human', 'Apple Mail'],
    ['Apple Mail on iPhone', open(UA.appleMailIphone), 'human', 'Apple Mail'],
    ['Thunderbird', open(UA.thunderbird), 'human', 'Thunderbird'],
    ['Gmail image proxy', open(UA.gmailProxy, 15169), 'proxy', 'Gmail'],
    ['Yahoo proxy', open(UA.yahooProxy, 36647), 'proxy', 'Yahoo Mail'],
    ['Apple MPP bare UA', open(UA.appleMpp, 13335), 'prefetch', 'Apple Mail'],
    ['Apple MPP from Apple network', open(UA.appleMailMac, 714), 'prefetch', 'Apple Mail'],
    ['Outlook.com via Microsoft network', open(UA.chromeWin, 8075), 'proxy', 'Chrome'],
    ['opened 5 s after sending', open(UA.chromeWin, 24389, 5_000), 'prefetch', 'Chrome'],
    ['curl', open(UA.curl), 'scanner', null],
    ['python', open(UA.python), 'scanner', null],
    ['from AWS', open(UA.chromeWin, 16509), 'scanner', 'Chrome'],
    ['from Proofpoint', open(UA.chromeWin, 22843), 'scanner', 'Chrome'],
    ['no user agent', open(''), 'bot', null],
  ]
  for (const [name, facts, cls, client] of cases) {
    it(name, () => {
      const v = classify(facts)
      expect(v.cls).toBe(cls)
      expect(v.client).toBe(client)
    })
  }
  it('Gmail proxy wins even when it comes soon after sending (Gmail fetches on open)', () => {
    expect(classify(open(UA.gmailProxy, 15169, 2_000)).cls).toBe('proxy')
  })
})

describe('classify: clicks', () => {
  it('a person in a browser', () => expect(classify(click(UA.chromeWin)).cls).toBe('human'))
  it('Safe Links / Defender (Microsoft network)', () => expect(classify(click(UA.chromeWin, 8075)).cls).toBe('scanner'))
  it('a click 3 s after sending', () => expect(classify(click(UA.chromeWin, 24389, 3_000)).cls).toBe('scanner'))
  it('HEAD request', () => expect(classify(click(UA.chromeWin, 24389, H, 'HEAD')).cls).toBe('scanner'))
  it('Office existence discovery', () => expect(classify(click(UA.msDiscovery)).cls).toBe('scanner'))
  it('Slack link preview', () => expect(classify(click(UA.slack)).cls).toBe('scanner'))
  it('Mimecast network', () => expect(classify(click(UA.chromeWin, 30031)).why).toBe('asn:30031'))
  it('devices', () => {
    expect(classify(click(UA.androidChrome)).device).toBe('Android')
    expect(classify(click(UA.safariMac)).client).toBe('Safari')
    expect(classify(click(UA.appleMailIphone)).device).toBe('iPhone')
  })
})
