import { describe, it, expect } from 'vitest'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const guard = require('../../electron/outreach-guard.cjs')

describe('outreach-guard: IPC boundary argument validation (§1.7, Appendix A)', () => {
  describe('validateJobSpec', () => {
    it('keeps a designed letter\'s per-recipient words (vars) on each message', () => {
      const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='
      const res = guard.validateJobSpec({
        campaignId: 'cmp-design', kind: 'first',
        shared: { design: { html: '<p>Dear {name|Reader},</p><img src="cid:esb-d1">', images: [{ cid: 'esb-d1', dataUrl: png }] } },
        messages: [
          { to: 'rahim@example.com', subject: 'S', body: 'Dear {name|Reader},', vars: { name: 'Rahim Uddin' } },
          { to: 'noname@example.com', subject: 'S', body: 'Dear {name|Reader},' },
        ],
      })
      expect(res.ok).toBe(true)
      expect(res.cleaned.messages[0].vars).toEqual({ name: 'Rahim Uddin' })
      expect(res.cleaned.messages[1].vars).toBeUndefined()
    })
    it('accepts valid job spec and normalizes fields', () => {
      const spec = {
        campaignId: 'cmp-100',
        campaignName: 'Test Campaign',
        kind: 'first',
        shared: { signature: 'ESB Studio', lang: 'en', letterhead: true, officialPad: false },
        attachments: [],
        messages: [
          { to: 'alice@example.com', subject: 'Subject 1', body: 'Hello Alice' },
          { to: 'bob@example.com', subject: 'Subject 2', body: 'Hello Bob' },
        ],
        startAt: 1730000000000,
        autoResume: true,
      }

      const res = guard.validateJobSpec(spec)
      expect(res.ok).toBe(true)
      expect(res.cleaned.campaignId).toBe('cmp-100')
      expect(res.cleaned.messages.length).toBe(2)
      expect(res.rejected.length).toBe(0)
    })

    it('refuses more than 20,000 messages in one job', () => {
      const msgs = Array.from({ length: 20001 }, () => ({
        to: 'u@example.com',
        subject: 's',
        body: 'b',
      }))

      const res = guard.validateJobSpec({
        campaignId: 'cmp-too-large',
        messages: msgs,
      })

      expect(res.ok).toBe(false)
      expect(res.error).toContain('20,000 messages')
    })

    it('rejects hostile prototype pollution in job spec', () => {
      const hostile = JSON.parse(
        '{"__proto__":{"polluted":true},"campaignId":"cmp-bad","messages":[{"to":"a@ex.com","subject":"s","body":"b"}]}'
      )
      const res = guard.validateJobSpec(hostile)
      expect(res.ok).toBe(false)
      expect(res.error).toContain('disallowed properties')
    })

    it('ignores renderer-supplied dry flag', () => {
      const spec = {
        campaignId: 'cmp-dry',
        dry: true,
        messages: [{ to: 'a@ex.com', subject: 's', body: 'b' }],
      }
      const res = guard.validateJobSpec(spec)
      expect(res.ok).toBe(true)
      expect(res.cleaned.dry).toBeUndefined()
    })

    it('refuses attachment containing a path field on disk', () => {
      const spec = {
        campaignId: 'cmp-attach',
        attachments: [{ name: 'file.pdf', path: 'C:\\Windows\\System32\\calc.exe' }],
        messages: [{ to: 'a@ex.com', subject: 's', body: 'b' }],
      }
      const res = guard.validateJobSpec(spec)
      expect(res.ok).toBe(false)
      expect(res.error).toContain('path')
    })

    it('collects invalid messages in rejected[] rather than throwing', () => {
      const spec = {
        campaignId: 'cmp-partially-valid',
        messages: [
          { to: 'valid@example.com', subject: 'Hello', body: 'Body' },
          { to: 'invalid-email', subject: 'Hello', body: 'Body' },
          { to: 'two@ex.com, bad@ex.com', subject: 'Multi', body: 'Body' },
          { to: 'crlf@ex.com', subject: 'Subject\r\nInjected: Header', body: 'Body' },
          { to: 'emptybody@ex.com', subject: 'Sub', body: '' },
        ],
      }
      const res = guard.validateJobSpec(spec)
      expect(res.ok).toBe(true)
      expect(res.cleaned.messages.length).toBe(1)
      expect(res.cleaned.messages[0].to).toBe('valid@example.com')
      expect(res.rejected.length).toBe(4)
      expect(res.rejected[0].index).toBe(1)
      expect(res.rejected[1].index).toBe(2)
      expect(res.rejected[2].index).toBe(3)
      expect(res.rejected[3].index).toBe(4)
    })

    it('refuses job if all messages are invalid', () => {
      const spec = {
        campaignId: 'cmp-all-invalid',
        messages: [{ to: 'not-an-email', subject: 'Hi', body: 'Body' }],
      }
      const res = guard.validateJobSpec(spec)
      expect(res.ok).toBe(false)
      expect(res.error).toContain('No valid messages')
      expect(res.rejected.length).toBe(1)
    })
  })

  describe('validateControl', () => {
    it('accepts valid control actions and IDs', () => {
      expect(guard.validateControl('job-123_abc', 'pause').ok).toBe(true)
      expect(guard.validateControl('job-123_abc', 'resume').ok).toBe(true)
      expect(guard.validateControl('job-123_abc', 'stop').ok).toBe(true)
      expect(guard.validateControl('job-123_abc', 'hold', 'user@example.com').ok).toBe(true)
      expect(guard.validateControl('job-123_abc', 'release', 42).ok).toBe(true)
    })

    it('refuses invalid action or path-traversing jobId', () => {
      expect(guard.validateControl('../job-123', 'pause').ok).toBe(false)
      expect(guard.validateControl('job/123', 'pause').ok).toBe(false)
      expect(guard.validateControl('job-123', 'destroy' as any).ok).toBe(false)
      expect(guard.validateControl('job-123', 'hold', 'evil@ex.com\r\nBcc: evil2@ex.com').ok).toBe(false)
    })
  })

  describe('validateDomains', () => {
    it('accepts valid domain names and deduplicates', () => {
      const res = guard.validateDomains(['example.com', 'SUB.DOM.ORG', 'example.com'])
      expect(res.ok).toBe(true)
      expect(res.domains).toEqual(['example.com', 'sub.dom.org'])
    })

    it('refuses IP literals (v4 and v6)', () => {
      expect(guard.validateDomains(['127.0.0.1']).ok).toBe(false)
      expect(guard.validateDomains(['192.168.1.1']).ok).toBe(false)
      expect(guard.validateDomains(['::1']).ok).toBe(false)
    })

    it('refuses domain arrays over 2,000 items', () => {
      const domains = Array.from({ length: 2001 }, (_, i) => `dom${i}.com`)
      const res = guard.validateDomains(domains)
      expect(res.ok).toBe(false)
      expect(res.error).toContain('2,000 domains')
    })

    it('refuses invalid domain labels or CRLF injection', () => {
      expect(guard.validateDomains(['example.com\r\ninjected.com']).ok).toBe(false)
      expect(guard.validateDomains(['-bad-.com']).ok).toBe(false)
      expect(guard.validateDomains(['']).ok).toBe(false)
    })
  })

  describe('validateLogEvent', () => {
    it('accepts ai.action and note types and strips control characters', () => {
      const res1 = guard.validateLogEvent({
        type: 'ai.action',
        text: 'Generated subject lines\x00\x07 for campaign',
        command: 'suggest-subjects',
        campaignId: 'c1',
      })
      expect(res1.ok).toBe(true)
      expect(res1.event.type).toBe('ai.action')
      expect(res1.event.text).toBe('Generated subject lines for campaign')

      const res2 = guard.validateLogEvent({
        type: 'note',
        text: 'User paused run',
      })
      expect(res2.ok).toBe(true)
      expect(res2.event.type).toBe('note')
    })

    it('refuses any other event type', () => {
      expect(guard.validateLogEvent({ type: 'send.ok' as any, text: 'Test' }).ok).toBe(false)
      expect(guard.validateLogEvent({ type: 'system' as any, text: 'Test' }).ok).toBe(false)
    })

    it('clamps text to 500 characters', () => {
      const longText = 'A'.repeat(600)
      const res = guard.validateLogEvent({ type: 'note', text: longText })
      expect(res.ok).toBe(true)
      expect(res.event.text.length).toBe(500)
    })
  })

  describe('validateEventsQuery & validateStatsQuery & validatePlanQuery', () => {
    it('validates events query parameters and rejects NaN/Infinity', () => {
      expect(guard.validateEventsQuery({ from: NaN }).ok).toBe(false)
      expect(guard.validateEventsQuery({ to: Infinity }).ok).toBe(false)
      expect(guard.validateEventsQuery({ limit: -5 }).ok).toBe(false)
      expect(guard.validateEventsQuery({ limit: 500 }).ok).toBe(true)
    })

    it('validates stats query bounds', () => {
      expect(guard.validateStatsQuery({ from: 100, to: 200 }).ok).toBe(true)
      expect(guard.validateStatsQuery({ from: NaN, to: 200 }).ok).toBe(false)
    })

    it('validates plan query count bounds', () => {
      expect(guard.validatePlanQuery({ count: 500 }).ok).toBe(true)
      expect(guard.validatePlanQuery({ count: 0 }).ok).toBe(false)
      expect(guard.validatePlanQuery({ count: 100001 }).ok).toBe(false)
    })
  })
})
