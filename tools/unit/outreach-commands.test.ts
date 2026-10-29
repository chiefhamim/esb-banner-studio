import { describe, expect, it, beforeEach, vi, afterEach } from 'vitest'
import { COMMANDS, executeCommand } from '../../src/outreach/commands'
import { useOutreachStore, newCampaign } from '../../src/outreach/outreachStore'

describe('Outreach Command Registry (commands.ts)', () => {
  beforeEach(() => {
    // Stub window.esb for renderer bridge
    vi.stubGlobal('window', {
      esb: {
        outreachSettingsSave: vi.fn(async (s) => ({ ok: true, settings: s })),
        outreachPlan: vi.fn(async (q) => ({ days: 1, firstAt: Date.now(), lastAt: Date.now(), perDay: [q.count], notes: [] })),
        outreachCheckAddresses: vi.fn(async () => ({})),
        outreachLogEvent: vi.fn(async () => ({ ok: true })),
        outreachJobSubmit: vi.fn(async () => ({ ok: true, jobId: 'job-123', rejected: [] })),
        outreachJobControl: vi.fn(async () => ({ ok: true })),
        outreachPauseAll: vi.fn(async () => ({ ok: true })),
        outreachOptOut: vi.fn(async () => ({ ok: true })),
        outreachForgetPassword: vi.fn(async () => ({ ok: true })),
      },
    })

    // Reset store to known state
    const c1 = newCampaign({ id: 'cmp-test-1', name: 'Test Campaign 1' })
    useOutreachStore.setState({
      campaigns: [c1],
      activeId: c1.id,
      contacts: [],
      optOut: ['suppressed@example.com'],
      bouncedAddrs: {},
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  describe('Registry structure and definitions', () => {
    it('defines all required read, safe, confirm, and danger commands', () => {
      const readCmds = ['summary', 'listCampaigns', 'getPlan', 'explainSkipped', 'activityToday']
      const safeCmds = ['pauseRun', 'pauseAll', 'holdRecipient', 'addNote']
      const confirmCmds = [
        'startRun',
        'scheduleRun',
        'resumeRun',
        'stopRun',
        'setWindow',
        'setCooldown',
        'selectAudience',
        'checkAddresses',
        'draftSegments',
        'rewriteSegment',
        'approveReviewed',
        'exportReport',
      ]
      const dangerCmds = [
        'deleteCampaign',
        'resend',
        'raiseDailyLimit',
        'changeSender',
        'forgetPassword',
        'removeOptOut',
        'approveVersion',
        'editSignature',
      ]

      for (const name of readCmds) {
        expect(COMMANDS[name], `missing ${name}`).toBeDefined()
        expect(COMMANDS[name].risk).toBe('read')
      }
      for (const name of safeCmds) {
        expect(COMMANDS[name], `missing ${name}`).toBeDefined()
        expect(COMMANDS[name].risk).toBe('safe')
      }
      for (const name of confirmCmds) {
        expect(COMMANDS[name], `missing ${name}`).toBeDefined()
        expect(COMMANDS[name].risk).toBe('confirm')
      }
      for (const name of dangerCmds) {
        expect(COMMANDS[name], `missing ${name}`).toBeDefined()
        expect(COMMANDS[name].risk).toBe('danger')
      }
    })
  })

  describe('Argument validation (no extra keys, types, ranges)', () => {
    it('rejects unexpected extra arguments', async () => {
      const res = await executeCommand('summary', { extraBogusParam: 123 }, { by: 'user' })
      expect(res.ok).toBe(false)
      expect(res.error).toContain('Unexpected extra argument')
    })

    it('rejects wrong argument types', async () => {
      const res = await executeCommand('holdRecipient', { email: 12345 }, { by: 'user' })
      expect(res.ok).toBe(false)
      expect(res.error).toContain('must be a non-empty string')
    })

    it('rejects out of range numbers', async () => {
      const res = await executeCommand('raiseDailyLimit', { limit: 999999 }, { by: 'user' })
      expect(res.ok).toBe(false)
      expect(res.error).toContain('cannot be greater than')
    })

    it('rejects invalid email formats', async () => {
      const res = await executeCommand('holdRecipient', { email: 'not-an-email' }, { by: 'user' })
      expect(res.ok).toBe(false)
      expect(res.error).toContain('Invalid email address format')
    })

    it('rejects invalid time format in setWindow', async () => {
      const res = await executeCommand('setWindow', { from: '25:99', to: '17:00' }, { by: 'user', confirmed: true })
      expect(res.ok).toBe(false)
      expect(res.error).toContain('must be in HH:MM format')
    })
  })

  describe('Security: Danger command authorization', () => {
    const dangerCommands = [
      { name: 'deleteCampaign', args: { campaignId: 'cmp-test-1' } },
      { name: 'resend', args: { email: 'user@example.com' } },
      { name: 'raiseDailyLimit', args: { limit: 150 } },
      { name: 'changeSender', args: { sender: 'new@example.com' } },
      { name: 'forgetPassword', args: {} },
      { name: 'removeOptOut', args: { email: 'suppressed@example.com' } },
      { name: 'approveVersion', args: { segmentKey: '1:press' } },
      { name: 'editSignature', args: { id: 'sig-default', text: 'New Signature' } },
    ]

    for (const { name, args } of dangerCommands) {
      it(`refuses AI caller on danger command '${name}'`, async () => {
        const res = await executeCommand(name, args, { by: 'ai' })
        expect(res.ok).toBe(false)
        expect(res.error).toMatch(/Refused|cannot be executed by AI/i)
      })
    }

    it('allows user caller on danger commands (e.g. deleteCampaign)', async () => {
      const res = await executeCommand('deleteCampaign', { campaignId: 'cmp-test-1' }, { by: 'user' })
      expect(res.ok).toBe(true)
      expect(useOutreachStore.getState().campaigns.length).toBe(0)
    })
  })

  describe('Security: Confirm command gating', () => {
    it('refuses unconfirmed AI calls for confirm commands', async () => {
      const res = await executeCommand('setWindow', { from: '09:00', to: '17:00' }, { by: 'ai' })
      expect(res.ok).toBe(false)
      expect(res.requiresConfirmation).toBe(true)
      expect(res.error).toContain('requires explicit confirmation')
    })

    it('allows AI calls for confirm commands when explicitly confirmed', async () => {
      const res = await executeCommand('setWindow', { from: '09:00', to: '17:00' }, { by: 'ai', confirmed: true })
      expect(res.ok).toBe(true)
    })
  })

  describe('Read and Safe commands', () => {
    it('executes read commands cleanly for AI and user', async () => {
      const sum = await executeCommand('summary', {}, { by: 'ai' })
      expect(sum.ok).toBe(true)
      expect(sum.result?.totalCampaigns).toBe(1)

      const list = await executeCommand('listCampaigns', {}, { by: 'ai' })
      expect(list.ok).toBe(true)
      expect(list.result?.campaigns.length).toBe(1)
    })

    it('executes safe commands without confirmation token', async () => {
      const hold = await executeCommand('holdRecipient', { email: 'valid@example.com' }, { by: 'ai' })
      expect(hold.ok).toBe(true)
      expect(hold.result?.held).toBe(true)
    })
  })
})
