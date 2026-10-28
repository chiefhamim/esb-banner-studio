// AI settings: a key (and model) per provider, which provider does which job — Main, SEO, Social — and the translation
// prompt. Keys stay on this machine; each is sent only to its own provider, and a job only ever calls its own provider.

import { useEffect, useState } from 'react'
import { Dialog, Field, Select, Seg } from '../ui/controls'
import { Icon } from '../ui/Icon'
import { useEditorialStore } from './editorialStore'
import { AI_PROVIDERS, listModels, providerMeta, roleProvider, testAiKey } from './aiProviders'
import type { AiModelInfo, AiProviderId, AiRole, AiSettings } from './aiProviders'
import { JOURNALISTIC_TRANSLATOR_PROMPT } from './translator'

const JOBS: { role: AiRole; name: string; note: string }[] = [
  { role: 'main', name: 'Story', note: 'Translation, headline, deck, story and tags' },
  { role: 'seo', name: 'SEO', note: 'Write with AI on the SEO tab' },
  { role: 'social', name: 'Social', note: 'Write with AI on the captions' },
  { role: 'outreach', name: 'Letter', note: 'Outreach: writes and rewrites the email' },
  { role: 'research', name: 'Research', note: 'Outreach: talking points from your sources' },
  { role: 'review', name: 'Review', note: 'Outreach: checks an email before it is sent' },
]

export function AiSettingsDialog({ onClose, onToast }: { onClose: () => void; onToast: (msg: string) => void }) {
  const saved = useEditorialStore((s) => s.ai)
  const setAiSettings = useEditorialStore((s) => s.setAiSettings)
  const setAiPaused = useEditorialStore((s) => s.setAiPaused)
  const [draft, setDraft] = useState<AiSettings>(() => ({ ...saved, prompt: saved.prompt || JOURNALISTIC_TRANSLATOR_PROMPT }))
  const [editing, setEditing] = useState<AiProviderId>(saved.provider)
  const [models, setModels] = useState<Partial<Record<AiProviderId, AiModelInfo[]>>>({})
  const [status, setStatus] = useState<{ ok: boolean; msg: string } | null>(null)
  const [testing, setTesting] = useState(false)
  const p = editing
  const meta = providerMeta(p)
  const key = draft.keys[p]
  const list = models[p] ?? []
  const hasKey = (id: AiProviderId) => !!draft.keys[id].trim()

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
    const main = providerMeta(draft.provider)
    onToast(hasKey(draft.provider) ? `${main.name} is the main AI` : `${main.name} has no key — using the free translation services`)
  }
  const chosen = draft.models[p]
  const custom = draft.prompt.trim() !== JOURNALISTIC_TRANSLATOR_PROMPT.trim()
  const roleOptions = (role: AiRole) => [
    ...(role === 'main' ? [] : [{ value: '', label: 'Same as Story' }]),
    ...AI_PROVIDERS.map((x) => ({ value: x.id as string, label: hasKey(x.id) ? x.name : `${x.name} — no key yet`, swatch: x.color })),
  ]
  const unkeyed = JOBS.filter((j) => !hasKey(roleProvider(draft, j.role)))

  return (
    <Dialog
      title="AI keys and roles"
      kicker="AI MODELS"
      width={640}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={() => void check()} disabled={testing || !key.trim()}>
            <Icon name={testing ? 'refresh' : 'check'} size={14} className={testing ? 'spin' : ''} />
            <span>{testing ? 'Checking…' : `Check ${meta.name} key`}</span>
          </button>
          <div className="spacer" />
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="button" className="btn primary" onClick={save}>Save</button>
        </>
      }
    >
      <div className="stack ai-settings" data-provider={p} style={{ gap: 16 }}>
        <section className="ai-section">
          {saved.paused && (
            <div className="callout warn">
              <Icon name="power" size={14} />
              <span>AI is OFF, so none of this is used and nothing is sent. Your keys and choices are kept.</span>
              <button type="button" className="btn sm primary" onClick={() => { setAiPaused(false); onToast('AI is ON') }}>Turn AI ON</button>
            </div>
          )}
          <h4 className="ai-h">Who does what</h4>
          <div className="ai-roles">
            {JOBS.map((j) => (
              <Field key={j.role} label={j.name} className="ai-role">
                <Select<string>
                  value={j.role === 'main' ? draft.provider : draft[j.role]}
                  options={roleOptions(j.role)}
                  onChange={(v) => patch((d) => ({ ...d, [j.role === 'main' ? 'provider' : j.role]: v }))}
                />
                <span className="hint">{j.note}</span>
              </Field>
            ))}
          </div>
          {unkeyed.length > 0 && (
            <div className="callout warn">
              <Icon name="info" size={14} />
              <span>{unkeyed.map((j) => `${j.name} uses ${providerMeta(roleProvider(draft, j.role)).name}`).join(' · ')} — no key yet, so {unkeyed.length > 1 ? 'those jobs stay' : 'that job stays'} off. Add the key below.</span>
            </div>
          )}
        </section>

        <section className="ai-section">
          <h4 className="ai-h">Keys</h4>
          <Seg<AiProviderId>
            className="ai-provider-seg"
            value={p}
            onChange={(v) => { setEditing(v); setStatus(null); patch((d) => ({ ...d, provider: v })) }}  /* picking a company here makes it the main AI, as in the Engine panel; SEO and Social keep their own choice */
            options={AI_PROVIDERS.map((x) => ({ value: x.id, label: x.name, tip: hasKey(x.id) ? `${x.name} — key saved` : `${x.name} — no key yet` }))}
          />
          <p className="sub">
            {meta.help}{' '}
            <a className="ai-key-link" href={meta.keyUrl} target="_blank" rel="noopener noreferrer">Get a {meta.name} key<Icon name="link" size={12} /></a>
          </p>
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
          <Field label="Model" className="ai-model-field">
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
        </section>

        <section className="ai-section">
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
            <textarea className="input ai-prompt" rows={8} spellCheck={false} value={draft.prompt} onChange={(e) => { const v = e.target.value; patch((d) => ({ ...d, prompt: v })) }} />
          </Field>
          <p className="hint">The Main provider follows this prompt for the translation, word for word; only the answer's layout is fixed — headline, deck, slug, keywords, meta title and description, and the complete body (with headings, bullet points, tables and highlights where the story calls for them, plus chart ideas built only from the source's own numbers) — and the desk holds those to the site's limits. Keys are kept on this computer and sent only to their own provider.</p>
        </section>
      </div>
    </Dialog>
  )
}
