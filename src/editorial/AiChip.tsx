// The header AI chip, one component for every desk that calls an AI (Editorial, Outreach, Graphics' Fetch & Translate,
// Video's AI). It names the provider of the desk's job; dashed "Connect AI" until a key is saved; "AI OFF" when the
// master switch is off. Clicking opens the AI settings — the desk's own handler, or the shared dialog here.

import { useState } from 'react'
import { useEditorialStore } from './editorialStore'
import { aiFor, providerMeta, type AiRole } from './aiProviders'
import { ProviderMark } from './ProviderMark'
import { AiSettingsDialog } from './AiSettingsDialog'
import { Icon } from '../ui/Icon'

export function AiChip({ role = 'main', onClick, tip, onToast }: { role?: AiRole; onClick?: () => void; tip?: string; onToast?: (m: string) => void }) {
  const ai = useEditorialStore((e) => e.ai)
  const [open, setOpen] = useState(false)
  const job = aiFor(role, ai)
  const name = job ? providerMeta(job.provider).name : ''
  const text = tip ?? (ai.paused ? 'AI is OFF — click to open the AI settings, or turn it ON in the Engine panel' : job ? `AI — ${name}. Click to change` : 'Connect an AI — add a Gemini, Claude, OpenAI or OpenRouter key')
  return (
    <>
      <button type="button" className={'ed-ai-chip' + (job ? ' on' : '') + (ai.paused ? ' paused' : '')} data-provider={job?.provider} onClick={onClick ?? (() => setOpen(true))} aria-label="AI keys and roles" data-tip={text}>
        {ai.paused ? <Icon name="power" size={14} /> : job ? <ProviderMark id={job.provider} size={18} /> : <Icon name="link" size={14} />}
        <span className="ed-ai-label">{ai.paused ? 'AI OFF' : job ? name : 'Connect AI'}</span>
      </button>
      {open && <AiSettingsDialog onClose={() => setOpen(false)} onToast={onToast ?? (() => undefined)} />}
    </>
  )
}
