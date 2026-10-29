import { describe, expect, it, beforeEach, vi, afterEach } from 'vitest'
import { askAssistant, applyAssistantAction, type OperatorContext } from '../../src/outreach/operator'
import * as aiProviders from '../../src/editorial/aiProviders'
import { engineClient } from '../../src/outreach/engineClient'

describe('AI Operator (operator.ts)', () => {
  const baseContext: OperatorContext = {
    campaignsCount: 2,
    activeCampaignId: 'cmp-1',
    activeCampaignName: 'Autumn Campaign',
    runningJobsCount: 0,
    todaySent: 15,
    todayFailed: 0,
    autonomy: 'suggest',
    availableCommands: [],
  }

  beforeEach(() => {
    // Stub AI provider configuration
    vi.spyOn(aiProviders, 'aiPaused').mockReturnValue(false)
    vi.spyOn(aiProviders, 'aiFor').mockReturnValue({
      provider: 'gemini',
      key: 'test-api-key',
      model: 'gemini-2.5-flash',
    })
    // Spy on engine logEvent
    vi.spyOn(engineClient, 'logEvent').mockResolvedValue({ ok: true })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('Hostile model output handling', () => {
    it('refuses dangerous commands suggested by model and logs refusal', async () => {
      vi.spyOn(aiProviders, 'aiJson').mockResolvedValue({
        data: {
          say: 'I will delete your campaign and forget your password.',
          actions: JSON.stringify([
            { command: 'deleteCampaign', args: { campaignId: 'cmp-1' } },
            { command: 'forgetPassword', args: {} },
          ]),
        },
        model: 'gemini-2.5-flash',
      })

      const res = await askAssistant('Delete everything', baseContext)
      expect(res.actions.length).toBe(2)
      expect(res.actions[0].status).toBe('refused')
      expect(res.actions[0].error).toContain('cannot be executed by the AI assistant')
      expect(res.actions[1].status).toBe('refused')
      expect(res.actions[1].error).toContain('cannot be executed by the AI assistant')
      expect(engineClient.logEvent).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'ai.action', status: 'refused' })
      )
    })

    it('limits actions to at most 8 even if model returns 50', async () => {
      const fiftyActions = Array.from({ length: 50 }, (_, i) => ({
        command: 'summary',
        args: {},
      }))

      vi.spyOn(aiProviders, 'aiJson').mockResolvedValue({
        data: {
          say: 'Here are 50 summary checks',
          actions: JSON.stringify(fiftyActions),
        },
        model: 'gemini-2.5-flash',
      })

      const res = await askAssistant('Give me summaries', baseContext)
      expect(res.actions.length).toBe(8)
    })

    it('handles malformed JSON gracefully', async () => {
      vi.spyOn(aiProviders, 'aiJson').mockResolvedValue({
        data: {
          say: 'Something went wrong with formatting',
          actions: 'MALFORMED { NOT JSON } [',
        },
        model: 'gemini-2.5-flash',
      })

      const res = await askAssistant('Status check', baseContext)
      expect(res.actions.length).toBe(0)
      expect(res.say).toBe('Something went wrong with formatting')
    })

    it('refuses commands with extra keys or invalid args', async () => {
      vi.spyOn(aiProviders, 'aiJson').mockResolvedValue({
        data: {
          say: 'Adjusting settings',
          actions: JSON.stringify([
            { command: 'summary', args: { extraInjectedKey: 'attack' } },
          ]),
        },
        model: 'gemini-2.5-flash',
      })

      const res = await askAssistant('Run summary', baseContext)
      expect(res.actions.length).toBe(1)
      expect(res.actions[0].status).toBe('refused')
      expect(res.actions[0].error).toContain('Unexpected extra argument')
    })
  })

  describe('Autonomy Matrix', () => {
    it('suggest mode: proposes read, safe, and confirm actions without executing', async () => {
      vi.spyOn(aiProviders, 'aiJson').mockResolvedValue({
        data: {
          say: 'Here are recommended actions',
          actions: JSON.stringify([
            { command: 'summary', args: {} },
            { command: 'pauseAll', args: { on: true } },
            { command: 'setWindow', args: { from: '09:00', to: '17:00' } },
          ]),
        },
        model: 'gemini-2.5-flash',
      })

      const res = await askAssistant('What should I do?', { ...baseContext, autonomy: 'suggest' })
      expect(res.actions.length).toBe(3)
      expect(res.actions[0].status).toBe('proposed')
      expect(res.actions[1].status).toBe('proposed')
      expect(res.actions[2].status).toBe('proposed')
    })

    it('confirm mode: proposes all actions for user Apply', async () => {
      vi.spyOn(aiProviders, 'aiJson').mockResolvedValue({
        data: {
          say: 'Proposing pause',
          actions: JSON.stringify([{ command: 'pauseAll', args: { on: true } }]),
        },
        model: 'gemini-2.5-flash',
      })

      const res = await askAssistant('Pause sending', { ...baseContext, autonomy: 'confirm' })
      expect(res.actions.length).toBe(1)
      expect(res.actions[0].status).toBe('proposed')
    })

    it('auto-safe mode: executes read and safe actions immediately, keeps confirm proposed', async () => {
      vi.spyOn(aiProviders, 'aiJson').mockResolvedValue({
        data: {
          say: 'Executing safe operations',
          actions: JSON.stringify([
            { command: 'summary', args: {} },
            { command: 'addNote', args: { text: 'Automated note' } },
            { command: 'setWindow', args: { from: '09:00', to: '17:00' } },
          ]),
        },
        model: 'gemini-2.5-flash',
      })

      const res = await askAssistant('Do what is needed', { ...baseContext, autonomy: 'auto-safe' })
      expect(res.actions.length).toBe(3)
      // summary (read) executed
      expect(res.actions[0].status).toBe('executed')
      // addNote (safe) executed
      expect(res.actions[1].status).toBe('executed')
      // setWindow (confirm) remains proposed
      expect(res.actions[2].status).toBe('proposed')
    })
  })

  describe('User applying actions', () => {
    it('executes a proposed confirm action when user calls applyAssistantAction', async () => {
      const action = {
        id: 'act-1',
        command: 'setWindow',
        args: { from: '09:00', to: '17:00' },
        risk: 'confirm' as const,
        describe: 'Set send window',
        status: 'proposed' as const,
      }

      // Stub engineClient saveSettings
      vi.spyOn(engineClient, 'saveSettings').mockResolvedValue({ ok: true, settings: {} as any })

      const applied = await applyAssistantAction(action)
      expect(applied.status).toBe('executed')
      expect(engineClient.logEvent).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'ai.action', status: 'executed' })
      )
    })
  })
})
