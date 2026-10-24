// AI settings: which service translates (Gemini, Claude, OpenAI, OpenRouter), the key and model for each, and the
// translation prompt the model is given. Keys stay on this machine; each is sent only to its own provider.

import { useEffect, useState } from 'react'
import { Dialog, Field, Select, Seg } from '../ui/controls'
import { Icon } from '../ui/Icon'
import { useEditorialStore } from './editorialStore'
import { AI_PROVIDERS, listModels, providerMeta, testAiKey } from './aiProviders'
import type { AiModelInfo, AiProviderId, AiSettings } from './aiProviders'
import { JOURNALISTIC_TRANSLATOR_PROMPT } from './translator'

export function AiSettingsDialog({ onClose, onToast }: { onClose: () => void; onToast: (msg: string) => void }) {
  const saved = useEditorialStore((s) => s.ai)
  const setAiSettings = useEditorialStore((s) => s.setAiSettings)
  const [draft, setDraft] = useState<AiSettings>(() => ({ ...saved, prompt: saved.prompt || JOURNALISTIC_TRANSLATOR_PROMPT }))
  const [models, setModels] = useState<Partial<Record<AiProviderId, AiModelInfo[]>>>({})
  const [status, setStatus] = useState<{ ok: boolean; msg: string } | null>(null)
  const [testing, setTesting] = useState(false)
  const p = draft.provider
  const meta = providerMeta(p)
  const key = draft.keys[p]
  const list = models[p] ?? []

  // a saved key lists its models as soon as its tab opens, so the picker is never empty for a working key
  useEffect(() => {
    if (!key.trim() || models[p]) return
    let live = true
    listModels(p, key).then((m) => { if (live) setModels((x) => ({ ...x, [p]: m })) }).catch(() => {})
    return () => { live = false }
  }, [p, key, models])

  const patch = (fn: (d: AiSettings) => AiSettings) => setDraft((d) => fn(d))
  const check = async () => {
    setTesting(true)
    setStatus(null)
    const res = await testAiKey(p, key, draft.models[p])
    setTesting(false)
    if (res.models) setModels((x) => ({ ...x, [p]: res.models }))
    setStatus(res.ok ? { ok: true, msg: `Key works — ${res.models?.length ?? 0} models, answered on ${res.model}.` } : { ok: false, msg: res.error || 'The key did not work.' })
  }
  const save = () => {
    const prompt = draft.prompt.trim() === JOURNALISTIC_TRANSLATOR_PROMPT.trim() ? '' : draft.prompt
    setAiSettings({ ...draft, prompt })
    onClose()
    const m = draft.models[p]
    const label = m === 'auto' ? meta.autoLabel.replace(/^Auto — /, '') : list.find((x) => x.id === m)?.label ?? m
    onToast(key.trim() ? `${meta.name} on · ${label}` : `${meta.name} has no key — using the free translation services`)
  }
  const chosen = draft.models[p]
  const custom = draft.prompt.trim() !== JOURNALISTIC_TRANSLATOR_PROMPT.trim()

  return (
    <Dialog
      title="AI translation"
      kicker="AI MODEL"
      width={600}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={() => void check()} disabled={testing || !key.trim()}>
            <Icon name={testing ? 'refresh' : 'check'} size={14} className={testing ? 'spin' : ''} />
            <span>{testing ? 'Checking…' : 'Check key & load models'}</span>
          </button>
          <div className="spacer" />
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="button" className="btn primary" onClick={save}>Save</button>
        </>
      }
    >
      <div className="stack ai-settings" style={{ gap: 14 }}>
        <Seg<AiProviderId>
          className="ai-provider-seg"
          value={p}
          onChange={(v) => { patch((d) => ({ ...d, provider: v })); setStatus(null) }}
          options={AI_PROVIDERS.map((x) => ({ value: x.id, label: x.name, tip: draft.keys[x.id] ? `${x.name} — key saved` : `${x.name} — no key yet` }))}
        />
        <p className="sub">{meta.help} <span className="ai-key-host">{meta.keyUrl}</span></p>
        <Field label={<span className="ai-label">API key {key.trim() && <i className="ai-key-dot" aria-label="saved" />}</span>}>
          <input
            type="password"
            className="input"
            autoComplete="off"
            spellCheck={false}
            placeholder={meta.keyPlaceholder}
            value={key}
            onChange={(e) => { const v = e.target.value; patch((d) => ({ ...d, keys: { ...d.keys, [p]: v } })); setModels((x) => ({ ...x, [p]: undefined })); setStatus(null) }}
          />
        </Field>
        <Field label="Model">
          <Select
            value={chosen}
            options={[
              { value: 'auto', label: meta.autoLabel },
              ...list.map((m) => ({ value: m.id, label: m.label, hint: m.hint })),
              ...(chosen !== 'auto' && !list.some((m) => m.id === chosen) ? [{ value: chosen, label: chosen }] : []),
            ]}
            onChange={(v) => patch((d) => ({ ...d, models: { ...d.models, [p]: String(v) } }))}
          />
        </Field>
        {!list.length && <p className="hint">{key.trim() ? 'Check the key to load the models it can use.' : `Paste a ${meta.name} key to choose a model.`}</p>}
        {status && (
          <div className={`callout ${status.ok ? 'good' : 'warn'}`}>
            <Icon name={status.ok ? 'check' : 'info'} size={14} />
            <span>{status.msg}</span>
          </div>
        )}
        <Field
          className="ai-prompt-field"
          label={
            <span className="ai-label ai-prompt-label">
              Translation prompt
              <span className="hint">{custom ? 'Your own prompt' : 'Newsroom default'}</span>
              {custom && <button type="button" className="btn-link" onClick={() => patch((d) => ({ ...d, prompt: JOURNALISTIC_TRANSLATOR_PROMPT }))}>Reset to default</button>}
            </span>
          }
        >
          <textarea className="input ai-prompt" rows={9} spellCheck={false} value={draft.prompt} onChange={(e) => { const v = e.target.value; patch((d) => ({ ...d, prompt: v })) }} />
        </Field>
        <p className="hint">The prompt goes to whichever model translates. However it is worded, the reply must fill the same fields — headline, deck, slug, keywords, meta title and description, and the complete body — and the desk still holds those to the site's limits. Keys are kept on this computer and sent only to their own provider.</p>
      </div>
    </Dialog>
  )
}
