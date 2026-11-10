// AI settings: a key (and model) per provider, which provider does which job — Main, SEO, Social — and the translation
// prompt. Keys stay on this machine; each is sent only to its own provider, and a job only ever calls its own provider.

import { useEffect, useState } from 'react'
import { Dialog, Field, Select, Seg } from '../ui/controls'
import type { AiEffort } from './aiProviders'
import { Icon } from '../ui/Icon'
import { useEditorialStore } from './editorialStore'
import { AI_PROVIDERS, geminiLabel, listModels, providerMeta, roleProvider, setCustomAi, testAiKey } from './aiProviders'
import type { AiModelInfo, AiProviderId, AiRole, AiSettings } from './aiProviders'
import { JOURNALISTIC_TRANSLATOR_PROMPT } from './translator'
import { ProviderMark } from './ProviderMark'

type AiTab = 'keys' | 'jobs' | 'writing'

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
  // three short pages instead of one long scroll: keys first (nothing works without one), then jobs, then writing
  const [tab, setTab] = useState<AiTab>('keys')
  const p = editing
  const meta = providerMeta(p)
  const key = draft.keys[p]
  const list = models[p] ?? []
  const hasKey = (id: AiProviderId) => !!draft.keys[id].trim() || (id === 'custom' && !!draft.custom?.url.trim())
  /** The company's name; the custom service goes by the name the editor gave it. */
  const nameOf = (id: AiProviderId) => (id === 'custom' ? draft.custom?.name.trim() || 'Custom AI' : providerMeta(id).name)
  /** The model in words, whole: the listed label when known, Gemini ids made readable, "Auto" spelled out. */
  const modelName = (id: AiProviderId) => {
    const m = draft.models[id]
    if (!m || m === 'auto') return id === 'custom' ? 'No model chosen' : providerMeta(id).autoLabel
    return models[id]?.find((x) => x.id === m)?.label ?? (id === 'gemini' ? geminiLabel(m) : m)
  }
  // checks and model lists use the custom address being typed, not the saved one; closing restores the saved one
  useEffect(() => { setCustomAi(draft.custom) }, [draft.custom])
  useEffect(() => () => setCustomAi(useEditorialStore.getState().ai.custom), [])

  // a saved key lists its models as soon as its tab opens, so the picker is never empty for a working key
  useEffect(() => {
    if ((!key.trim() && !(p === 'custom' && draft.custom?.url)) || models[p]) return
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
    ...AI_PROVIDERS.map((x) => ({ value: x.id as string, label: hasKey(x.id) ? nameOf(x.id) : `${nameOf(x.id)} — no key yet`, swatch: x.color })),
  ]
  const unkeyed = JOBS.filter((j) => !hasKey(roleProvider(draft, j.role)))

  return (
    <Dialog
      title="AI keys and roles"
      kicker="AI MODELS"
      width={720}
      onClose={onClose}
      footer={
        <>
          {tab === 'keys' && (
            <button type="button" className="btn" onClick={() => void check()} disabled={testing || !hasKey(p)}>
              <Icon name={testing ? 'refresh' : 'check'} size={14} className={testing ? 'spin' : ''} />
              <span>{testing ? 'Checking' : p === 'custom' ? `Check ${nameOf(p)}` : `Check ${meta.name} key`}</span>
            </button>
          )}
          <div className="spacer" />
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="button" className="btn primary" onClick={save}>Save</button>
        </>
      }
    >
      <div className="ai-settings" data-provider={p}>
        <Seg<AiTab> className="ai-tabs" label="AI settings" value={tab} onChange={setTab} options={[
          { value: 'keys', label: 'Keys & models', icon: 'link' },
          { value: 'jobs', label: unkeyed.length ? `Jobs · ${unkeyed.length} off` : 'Jobs', icon: 'users' },
          { value: 'writing', label: 'Writing', icon: 'edit' },
        ]} />
        {saved.paused && (
          <div className="callout warn">
            <Icon name="power" size={14} />
            <span>AI is OFF, so none of this is used and nothing is sent. Your keys and choices are kept.</span>
            <button type="button" className="btn sm primary" onClick={() => { setAiPaused(false); onToast('AI is ON') }}>Turn AI ON</button>
          </div>
        )}

        {tab === 'keys' && (
          <div className="ai-keys">
            {/* one row per company: its mark, whether a key is saved and which model it uses; the row opens its key */}
            <div className="ai-prov-list" role="tablist" aria-label="AI companies">
              {AI_PROVIDERS.map((x) => {
                const custom = x.id === 'custom'
                const unset = custom && !hasKey('custom') && !draft.custom?.name
                return (
                  <button key={x.id} type="button" role="tab" aria-selected={p === x.id} data-provider={x.id}
                    className={'ai-prov' + (p === x.id ? ' on' : '') + (unset ? ' is-add' : '')}
                    onClick={() => { setEditing(x.id); setStatus(null) }}>
                    <span className="ai-prov-logo">{unset ? <Icon name="plus" size={16} /> : <ProviderMark id={x.id} size={17} />}</span>
                    <span className="ai-prov-text">
                      <b>{unset ? 'Add another AI' : nameOf(x.id)}{draft.provider === x.id && <em className="ai-prov-main" data-tip="Writes the stories">Story</em>}</b>
                      {unset ? <small>Any OpenAI-compatible service</small> : <span className="ai-prov-model">{modelName(x.id)}</span>}
                      {!unset && <small className={'ai-prov-state' + (hasKey(x.id) ? ' ok' : '')}><i aria-hidden />{hasKey(x.id) ? (custom && !draft.keys.custom.trim() ? 'Ready · no key needed' : 'Key saved') : 'Not connected'}</small>}
                    </span>
                  </button>
                )
              })}
            </div>
            <div className="ai-prov-detail">
              <div className="ai-prov-head" data-provider={p}>
                <span className="ai-prov-logo"><ProviderMark id={p} size={18} /></span>
                <b>{nameOf(p)}</b>
                {draft.provider === p && <em className="ai-prov-main">Writes the stories</em>}
              </div>
              <p className="sub">
                {meta.help}{' '}
                {meta.keyUrl && <a className="ai-key-link" href={meta.keyUrl} target="_blank" rel="noopener noreferrer">Get a {meta.name} key<Icon name="link" size={12} /></a>}
              </p>
              {p === 'custom' && (
                <div className="ai-pair">
                  <Field label="Name">
                    <input className="input" placeholder="e.g. DeepSeek" maxLength={40} value={draft.custom?.name ?? ''}
                      onChange={(e) => { const v = e.target.value; patch((d) => ({ ...d, custom: { name: v, url: d.custom?.url ?? '' } })) }} />
                  </Field>
                  <Field label="API address">
                    <input className="input" placeholder="https://api.deepseek.com/v1" spellCheck={false} value={draft.custom?.url ?? ''}
                      onChange={(e) => { const v = e.target.value; patch((d) => ({ ...d, custom: { name: d.custom?.name ?? '', url: v } })); setModels((x) => ({ ...x, custom: undefined })); setStatus(null) }} />
                  </Field>
                </div>
              )}
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
              {p === 'custom' ? (
                <Field label="Model" className="ai-model-field">
                  <input className="input" list="ai-custom-models" placeholder={list.length ? 'Pick or type a model' : 'e.g. deepseek-chat'} spellCheck={false}
                    value={chosen === 'auto' ? '' : chosen} onChange={(e) => { const v = e.target.value.trim(); patch((d) => ({ ...d, models: { ...d.models, custom: v || 'auto' } })) }} />
                  <datalist id="ai-custom-models">{list.map((m) => <option key={m.id} value={m.id} />)}</datalist>
                </Field>
              ) : (
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
              )}
              {!list.length && p !== 'custom' && <p className="hint">{key.trim() ? 'Check the key to load the models it can use.' : `Paste a ${meta.name} key to choose a model.`}</p>}
              {status && (
                <div className={`callout ${status.ok ? 'good' : 'warn'}`}>
                  <Icon name={status.ok ? 'check' : 'info'} size={14} />
                  <span>{status.msg}</span>
                </div>
              )}
              {draft.provider !== p && (
                <button type="button" className="btn sm ai-make-main" onClick={() => patch((d) => ({ ...d, provider: p }))}>
                  <Icon name="check" size={13} /><span>Use {nameOf(p)} for stories</span>
                </button>
              )}
            </div>
          </div>
        )}

        {tab === 'jobs' && (
          <section className="ai-section">
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
                <span>{unkeyed.map((j) => j.name).join(', ')} {unkeyed.length > 1 ? 'have' : 'has'} no key yet, so {unkeyed.length > 1 ? 'those jobs stay' : 'that job stays'} off. Add the key under Keys &amp; models.</span>
              </div>
            )}
          </section>
        )}

        {tab === 'writing' && (
          <section className="ai-section">
          {/* how hard the story writer thinks: Claude's effort, OpenAI's reasoning effort, Gemini's thinking budget */}
          <Field label={<span className="ai-label">Writing effort <span className="hint">{(draft.effort ?? 'balanced') === 'fast' ? 'Quickest, lowest cost' : (draft.effort ?? 'balanced') === 'thorough' ? 'Slower and costlier: the most careful rewrite' : 'The newsroom default'}</span></span>}>
            <Seg<AiEffort> label="Writing effort" value={draft.effort ?? 'balanced'} onChange={(v) => patch((d) => ({ ...d, effort: v }))}
              options={[{ value: 'fast', label: 'Fast', tip: 'Least thinking: fastest and cheapest' }, { value: 'balanced', label: 'Balanced', tip: 'The default: careful enough for a full story' }, { value: 'thorough', label: 'Thorough', tip: 'Most thinking: the strongest rewrite and structure, slower and costlier' }]} />
          </Field>
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
        )}
      </div>
    </Dialog>
  )
}
