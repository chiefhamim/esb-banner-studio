import { describe, expect, it, beforeEach, vi, afterEach } from 'vitest'
import { classifyReply, sanitizeReplyText, classifyCampaignReplies } from '../../src/outreach/replyAi'
import * as aiProviders from '../../src/editorial/aiProviders'
import { useOutreachStore, newCampaign } from '../../src/outreach/outreachStore'

describe('Reply Classification AI (replyAi.ts)', () => {
  beforeEach(() => {
    vi.spyOn(aiProviders, 'aiPaused').mockReturnValue(false)
    vi.spyOn(aiProviders, 'aiFor').mockReturnValue({
      provider: 'gemini',
      key: 'test-key',
      model: 'gemini-2.5-flash',
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  describe('Sanitization and hostile inputs', () => {
    it('truncates large (1 MB) inputs to at most 1,200 characters', () => {
      const hugeInput = 'A'.repeat(1_000_000)
      const sanitized = sanitizeReplyText(hugeInput)
      expect(sanitized.length).toBe(1200)
    })

    it('strips non-printable ASCII control characters', () => {
      const hostile = 'Hello\u0000\u0007World\u001F!'
      const sanitized = sanitizeReplyText(hostile)
      expect(sanitized).toBe('Hello  World !')
    })
  })

  describe('Classification mapping', () => {
    it('maps valid AI classification response to proper label and summary', async () => {
      vi.spyOn(aiProviders, 'aiJson').mockResolvedValue({
        data: {
          label: 'interested',
          summary: 'The client requested a meeting next Tuesday.',
        },
        model: 'gemini-2.5-flash',
      })

      const res = await classifyReply(
        'client@example.com',
        'We would love to discuss this further. Are you available Tuesday?',
        'Re: ESB PowerLine Services'
      )

      expect(res.email).toBe('client@example.com')
      expect(res.label).toBe('interested')
      expect(res.summary).toBe('The client requested a meeting next Tuesday.')
    })

    it('falls back to "other" if the AI returns an unknown or invalid label', async () => {
      vi.spyOn(aiProviders, 'aiJson').mockResolvedValue({
        data: {
          label: 'hallucinated_category',
          summary: 'Some response',
        },
        model: 'gemini-2.5-flash',
      })

      const res = await classifyReply('user@example.com', 'Thanks for the info')
      expect(res.label).toBe('other')
    })

    it('does not opt-out the address even if classified as unsubscribe', async () => {
      vi.spyOn(aiProviders, 'aiJson').mockResolvedValue({
        data: {
          label: 'unsubscribe',
          summary: 'Recipient asked not to receive marketing emails.',
        },
        model: 'gemini-2.5-flash',
      })

      const c = newCampaign({ id: 'cmp-test', name: 'Test Campaign' })
      useOutreachStore.setState({
        campaigns: [c],
        activeId: c.id,
        optOut: [],
      })

      const res = await classifyReply('user@example.com', 'Please take me off your distribution')
      expect(res.label).toBe('unsubscribe')

      // Assert that optOut array is untouched by the model classification
      expect(useOutreachStore.getState().optOut).not.toContain('user@example.com')
    })
  })

  describe('Campaign batch classification and setting guard', () => {
    it('refuses when setting is off (outreachReplyTexts returns empty)', async () => {
      // Stub window.esb with aiReadsReply turned off (returns empty array)
      vi.stubGlobal('window', {
        esb: {
          outreachReplyTexts: vi.fn(async () => []),
        },
      })

      const c = newCampaign({
        id: 'cmp-replies',
        replied: { 'john@example.com': Date.now() },
      })
      useOutreachStore.setState({
        campaigns: [c],
        activeId: c.id,
      })

      const count = await classifyCampaignReplies('cmp-replies')
      expect(count).toBe(0)
    })

    it('classifies unclassified replies when bridge returns reply texts', async () => {
      vi.stubGlobal('window', {
        esb: {
          outreachReplyTexts: vi.fn(async () => [
            {
              email: 'john@example.com',
              at: Date.now(),
              subject: 'Re: Inquiry',
              ownWords: 'What is your pricing model?',
            },
          ]),
        },
      })

      vi.spyOn(aiProviders, 'aiJson').mockResolvedValue({
        data: {
          label: 'question',
          summary: 'John inquired about the pricing model.',
        },
        model: 'gemini-2.5-flash',
      })

      const c = newCampaign({
        id: 'cmp-replies',
        replied: { 'john@example.com': Date.now() },
      })
      useOutreachStore.setState({
        campaigns: [c],
        activeId: c.id,
      })

      const count = await classifyCampaignReplies('cmp-replies')
      expect(count).toBe(1)

      const updated = useOutreachStore.getState().campaigns.find((x) => x.id === 'cmp-replies')
      expect(updated?.replyLabels?.['john@example.com']?.label).toBe('question')
      expect(updated?.replyLabels?.['john@example.com']?.summary).toBe('John inquired about the pricing model.')
    })
  })
})
