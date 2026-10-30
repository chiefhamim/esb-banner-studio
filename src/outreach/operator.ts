import { aiFor, aiJson, aiPaused, type AiSchema } from '../editorial/aiProviders'
import { COMMANDS, executeCommand, type CommandRisk } from './commands'
import { useEngineStore } from './engineStore'
import { useOutreachStore } from './outreachStore'
import { engineClient } from './engineClient'

export interface AssistantActionItem {
  id: string
  command: string
  args: Record<string, unknown>
  risk: CommandRisk
  describe: string
  status: 'proposed' | 'executed' | 'refused' | 'failed'
  result?: unknown
  error?: string
}

export interface OperatorContext {
  campaignsCount: number
  activeCampaignId: string | null
  activeCampaignName: string | null
  runningJobsCount: number
  todaySent: number
  todayFailed: number
  autonomy: 'suggest' | 'confirm' | 'auto-safe'
  availableCommands: Array<{ name: string; risk: CommandRisk; describe: string }>
}

export interface OperatorResponse {
  say: string
  actions: AssistantActionItem[]
  error?: string
}

const ASSISTANT_SCHEMA: AiSchema = {
  type: 'object',
  properties: {
    say: { type: 'string', description: 'Helpful markdown answer or advice to the user' },
    actions: {
      type: 'string',
      description:
        'JSON array of objects with command and args, e.g. [{"command":"summary","args":{}}]. Max 8 actions.',
    },
  },
  required: ['say', 'actions'],
}

/**
 * Builds context without exposing private data (no recipient emails, no letter contents, no reply texts).
 */
export function buildOperatorContext(): OperatorContext {
  const outreach = useOutreachStore.getState()
  const engine = useEngineStore.getState()
  const active = outreach.campaign()

  const commandsList = Object.entries(COMMANDS).map(([name, def]) => ({
    name,
    risk: def.risk,
    describe: def.describe,
  }))

  return {
    campaignsCount: outreach.campaigns.length,
    activeCampaignId: active?.id ?? null,
    activeCampaignName: active?.name ?? null,
    runningJobsCount: engine.jobs.filter((j) => j.status === 'running' || j.status === 'waiting').length,
    todaySent: engine.stats?.totals?.sent ?? 0,
    todayFailed: engine.stats?.totals?.failed ?? 0,
    autonomy: engine.settings?.aiAutonomy || 'suggest',
    availableCommands: commandsList,
  }
}

function parseModelActions(raw: unknown): Array<{ command: string; args: Record<string, unknown> }> {
  if (Array.isArray(raw)) {
    return raw as Array<{ command: string; args: Record<string, unknown> }>
  }
  if (typeof raw === 'string') {
    const trimmed = raw.trim()
    if (!trimmed || trimmed === '[]') return []
    try {
      const parsed = JSON.parse(trimmed)
      if (Array.isArray(parsed)) return parsed
    } catch {
      // Try extracting json array slice
      const a = trimmed.indexOf('[')
      const b = trimmed.lastIndexOf(']')
      if (a >= 0 && b > a) {
        try {
          const parsed = JSON.parse(trimmed.slice(a, b + 1))
          if (Array.isArray(parsed)) return parsed
        } catch {}
      }
    }
  }
  return []
}

/**
 * Dispatches a user query to the AI Assistant and processes recommended actions according to autonomy settings.
 */
export async function askAssistant(
  userQuery: string,
  overrideContext?: OperatorContext
): Promise<OperatorResponse> {
  if (aiPaused()) {
    return {
      say: 'AI is currently paused or off. Connect an AI in Settings to use the assistant.',
      actions: [],
      error: 'AI is paused',
    }
  }

  const ai = aiFor('outreach')
  if (!ai) {
    return {
      say: 'Connect an AI provider (e.g. Anthropic, Gemini) in Settings to use the assistant.',
      actions: [],
      error: 'No AI provider configured for outreach',
    }
  }

  const ctx = overrideContext ?? buildOperatorContext()

  const system = [
    'You are the AI Assistant for the Outreach desk of ESB Power Line.',
    'You help operators manage campaigns, check metrics, inspect skip reasons, adjust send windows, and run safe actions.',
    'You MUST return valid JSON adhering to the provided schema with "say" and "actions".',
    'CRITICAL RULES:',
    '1. "actions" must be a JSON array string containing at most 8 action objects: [{"command": string, "args": object}].',
    '2. You may only suggest commands from the provided available commands list.',
    '3. You MUST NEVER suggest danger commands (e.g. deleteCampaign, resend, raiseDailyLimit, changeSender, forgetPassword, removeOptOut, approveVersion, editSignature). If requested, politely explain why in "say".',
    '4. Do not invent fake commands or hallucinate unknown parameters.',
    '5. Keep "say" concise, professional, and friendly.',
  ].join('\n')

  const user = [
    `Context:`,
    `- Total campaigns: ${ctx.campaignsCount}`,
    `- Active campaign: ${ctx.activeCampaignName || 'None'} (id: ${ctx.activeCampaignId || 'none'})`,
    `- Running jobs: ${ctx.runningJobsCount}`,
    `- Today sent: ${ctx.todaySent}, Today failed: ${ctx.todayFailed}`,
    `- Current Autonomy level: ${ctx.autonomy}`,
    ``,
    `Available Commands:`,
    JSON.stringify(ctx.availableCommands, null, 2),
    ``,
    `Operator Query: "${userQuery}"`,
  ].join('\n')

  let rawData: { say?: string; actions?: string }
  try {
    const res = await aiJson<{ say: string; actions: string }>({
      provider: ai.provider,
      key: ai.key,
      model: ai.model,
      system,
      user,
      schema: ASSISTANT_SCHEMA,
      maxTokens: 3000,
      effort: 'low',
    })
    rawData = res.data
  } catch (e: any) {
    return {
      say: `The assistant encountered an error: ${e?.message || 'AI request failed'}`,
      actions: [],
      error: e?.message || 'AI error',
    }
  }

  const say = typeof rawData.say === 'string' ? rawData.say : 'Here is the assistant response.'
  const parsedActions = parseModelActions(rawData.actions).slice(0, 8)
  const results: AssistantActionItem[] = []

  const autonomy = ctx.autonomy

  for (let i = 0; i < parsedActions.length; i++) {
    const act = parsedActions[i]
    const actionId = `act-${Date.now()}-${i}`

    if (!act || typeof act !== 'object' || typeof act.command !== 'string') {
      continue
    }

    const cmdName = act.command
    const cmd = COMMANDS[cmdName]

    if (!cmd) {
      const item: AssistantActionItem = {
        id: actionId,
        command: cmdName,
        args: act.args || {},
        risk: 'danger',
        describe: `Unknown command '${cmdName}'`,
        status: 'refused',
        error: `Unknown command '${cmdName}'`,
      }
      results.push(item)
      await logAssistantEvent(item, 'refused')
      continue
    }

    const args = act.args && typeof act.args === 'object' && !Array.isArray(act.args) ? act.args : {}

    // Refuse danger commands for AI
    if (cmd.risk === 'danger') {
      const item: AssistantActionItem = {
        id: actionId,
        command: cmdName,
        args,
        risk: cmd.risk,
        describe: cmd.describe,
        status: 'refused',
        error: `Danger command '${cmdName}' cannot be executed by the AI assistant`,
      }
      results.push(item)
      await logAssistantEvent(item, 'refused')
      continue
    }

    // Validate arguments
    const v = cmd.args(args)
    if (!v.ok) {
      const item: AssistantActionItem = {
        id: actionId,
        command: cmdName,
        args,
        risk: cmd.risk,
        describe: cmd.describe,
        status: 'refused',
        error: v.error,
      }
      results.push(item)
      await logAssistantEvent(item, 'refused')
      continue
    }

    // Autonomy dispatch:
    // suggest: all actions proposed
    // confirm: all actions proposed
    // auto-safe: read and safe executed immediately; confirm proposed
    if (autonomy === 'auto-safe' && (cmd.risk === 'read' || cmd.risk === 'safe')) {
      const exec = await executeCommand(cmdName, v.data, { by: 'ai' })
      const item: AssistantActionItem = {
        id: actionId,
        command: cmdName,
        args: v.data,
        risk: cmd.risk,
        describe: cmd.describe,
        status: exec.ok ? 'executed' : 'failed',
        result: exec.result,
        error: exec.error,
      }
      results.push(item)
      await logAssistantEvent(item, item.status)
    } else {
      // Proposed action for user review / approval
      const item: AssistantActionItem = {
        id: actionId,
        command: cmdName,
        args: v.data,
        risk: cmd.risk,
        describe: cmd.describe,
        status: 'proposed',
      }
      results.push(item)
      await logAssistantEvent(item, 'proposed')
    }
  }

  return {
    say,
    actions: results,
  }
}

/**
 * Manually applies a proposed action upon user confirmation.
 */
export async function applyAssistantAction(action: AssistantActionItem): Promise<AssistantActionItem> {
  const cmd = COMMANDS[action.command]
  if (!cmd) {
    const res: AssistantActionItem = { ...action, status: 'failed', error: 'Unknown command' }
    await logAssistantEvent(res, 'failed')
    return res
  }

  const exec = await executeCommand(action.command, action.args, { by: 'user', confirmed: true })
  const updated: AssistantActionItem = {
    ...action,
    status: exec.ok ? 'executed' : 'failed',
    result: exec.result,
    error: exec.error,
  }
  await logAssistantEvent(updated, updated.status)
  return updated
}

async function logAssistantEvent(item: AssistantActionItem, status: string): Promise<void> {
  try {
    await engineClient.logEvent({
      type: 'ai.action',
      text: `${item.command}: ${item.describe} [${status}]`,
      command: item.command,
      status,
    })
  } catch {}
}
