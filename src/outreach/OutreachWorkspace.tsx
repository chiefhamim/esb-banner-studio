// The Outreach desk, in the Editorial frame: menus and the open campaign in the header with the AI chip, the sender
// and one primary action on the right; Contacts · Campaigns · Sources (left), the letter (centre), Send · Contact ·
// Review (right); the mail server and the AI engines in the status bar. The first version opened a fixed workbook path
// on start (W:\E-Mail Marketing\…) through a bridge that read any file on the PC; the list is now always picked by
// the editor.

import { useEffect, useMemo, useRef } from 'react'
import { WorkspaceSwitcher } from '../shell/WorkspaceRail'
import { ContactsTab } from './ContactsTab'
import { CampaignsTab, STATUS_TEXT } from './CampaignsTab'
import { SourcesTab } from './SourcesTab'
import { OutreachComposer } from './OutreachComposer'
import { OutreachInspector } from './OutreachInspector'
import { SenderDialog } from './SenderDialog'
import { HousePromptDialog, NameDialog, ReviewSendDialog, SignaturesDialog } from './OutreachDialogs'
import { useOutreachStore } from './outreachStore'
import { useOutreachUi, type LeftTab } from './outreachUi'
import { downloadText, eligible, inAudience, resultsCsv } from './campaign'
import { AiSettingsDialog } from '../editorial/AiSettingsDialog'
import { EngineStatus } from '../editorial/EngineStatus'
import { ProviderMark } from '../editorial/ProviderMark'
import { useEditorialStore } from '../editorial/editorialStore'
import { aiFor, providerMeta } from '../editorial/aiProviders'
import { useStore } from '../store'
import { Icon } from '../ui/Icon'
import { MenuBar, Tabs, type MenuDef } from '../ui/controls'

export function OutreachWorkspace() {
  const s = useOutreachStore()
  const ui = useOutreachUi()
  const ai = useEditorialStore((e) => e.ai)
  const theme = useStore((x) => x.theme)
  const c = s.campaign()
  const file = useRef<HTMLInputElement>(null)
  const letterAi = aiFor('outreach', ai)
  const idle = s.run === 'idle'

  // the sender's own server answers for the status bar: on open, on focus and every five minutes (main caches 60 s)
  useEffect(() => {
    void s.refreshMail().then(() => { if (useOutreachStore.getState().mail?.hasPassword) void useOutreachStore.getState().checkSmtp() })
    const again = () => { if (useOutreachStore.getState().mail?.hasPassword) void useOutreachStore.getState().checkSmtp() }
    const t = setInterval(again, 5 * 60_000)
    window.addEventListener('focus', again)
    return () => { clearInterval(t); window.removeEventListener('focus', again) }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const audience = useMemo(() => s.contacts.filter((x) => inAudience(x, c?.audience)), [s.contacts, c?.audience])
  const ready = useMemo(() => (c ? eligible(s.contacts, c.subject, c.body, c.audience).length : 0), [s.contacts, c])
  const sent = c ? Object.keys(c.sent).length : 0
  const failures = s.log.filter((l) => l.level === 'error').length
  const set = s.mail?.settings
  const desktop = !!window.esb?.outreachSend

  const openTab = (left: LeftTab) => ui.set({ left })
  const menus: MenuDef[] = [
    { label: 'Campaign', items: [
      { label: 'New campaign', icon: 'plus', disabled: !idle, onClick: () => void s.createCampaign() },
      { label: 'New email to addresses', icon: 'mail', disabled: !idle, onClick: () => void s.createCampaign({ kind: 'direct', name: 'New email', listId: null, sheet: '', blueprint: 'blank', subject: '', body: '' }) },
      { label: 'Duplicate', icon: 'copy', disabled: !c || !idle, onClick: () => c && void s.duplicateCampaign(c.id) },
      { label: 'Rename…', icon: 'edit', disabled: !c, onClick: () => ui.set({ sheet: 'rename' }) },
      { divider: true },
      { label: 'Review & send…', icon: 'send', disabled: !c || !idle, onClick: () => ui.set({ sheet: 'review-send' }) },
      { label: 'Export results (CSV)', icon: 'download', disabled: !c || !s.contacts.length, onClick: () => c && downloadText(`${c.name.replace(/[^\w-]+/g, '-')}-results.csv`, resultsCsv(c, s.contacts)) },
      { divider: true },
      { label: 'Delete campaign', icon: 'trash', danger: true, disabled: !c || !idle, onClick: () => { if (c && confirm(`Delete “${c.name}”?`)) void s.deleteCampaign(c.id) } },
    ] },
    { label: 'Letter', items: [
      { label: 'Save as template…', icon: 'filePlus', disabled: !c?.body.trim(), onClick: () => ui.set({ sheet: 'save-template' }) },
      ...s.templates.slice(0, 8).map((t) => ({ label: t.name, hint: 'Apply', icon: 'folder' as const, disabled: !c, onClick: () => { if (confirm(`Replace the letter with “${t.name}”?`)) s.applyTemplate(t.id) } })),
      ...(s.templates.length ? [{ label: 'Delete a template…', icon: 'trash' as const, onClick: () => { const n = prompt(`Template to delete:\n${s.templates.map((t) => t.name).join('\n')}`); const t = s.templates.find((x) => x.name === n?.trim()); if (t) s.deleteTemplate(t.id) } }] : []),
      { divider: true },
      { label: 'Signatures…', icon: 'edit', onClick: () => ui.set({ sheet: 'signatures' }) },
      { label: 'ESB letterhead', checked: !!c?.letterhead, disabled: !c, onClick: () => s.patch({ letterhead: !c?.letterhead }) },
      { label: 'House prompt…', icon: 'sparkle', hint: s.housePrompt ? 'Set' : 'None', onClick: () => ui.set({ sheet: 'prompt' }) },
    ] },
    { label: 'List', items: [
      { label: 'Import a list…', icon: 'upload', disabled: !idle, onClick: () => file.current?.click() },
      ...(s.lists.length ? [{ heading: 'On this computer' }] : []),
      ...s.lists.slice(0, 6).map((l) => ({ label: l.fileName, hint: `${l.sheets.reduce((n, x) => n + x.contacts, 0)} rows`, checked: c?.listId === l.id, disabled: !c || !idle || c.kind === 'direct', onClick: () => void s.useList(l.id) })),
      { divider: true },
      { label: 'Contacts', checked: ui.left === 'contacts', onClick: () => openTab('contacts') },
      { label: 'Sender account…', icon: 'mail', disabled: !desktop, onClick: () => ui.set({ sheet: 'sender' }) },
    ] },
    { label: 'View', items: [
      { label: 'Contacts', checked: ui.left === 'contacts', onClick: () => openTab('contacts') },
      { label: 'Campaigns', checked: ui.left === 'campaigns', onClick: () => openTab('campaigns') },
      { label: 'Sources', checked: ui.left === 'sources', onClick: () => openTab('sources') },
      { divider: true },
      { label: 'Edit the letter', checked: ui.view === 'edit', onClick: () => ui.set({ view: 'edit' }) },
      { label: 'Preview as sent', checked: ui.view === 'preview', onClick: () => ui.set({ view: 'preview' }) },
      { label: 'Log', checked: ui.showLog, onClick: () => ui.set({ showLog: !ui.showLog }) },
      { divider: true },
      { heading: 'Appearance' },
      { label: 'Light', icon: 'sun', checked: theme !== 'dark', onClick: () => useStore.getState().setTheme('light') },
      { label: 'Dark', icon: 'moon', checked: theme === 'dark', onClick: () => useStore.getState().setTheme('dark') },
    ] },
  ]

  const smtp = s.smtp
  const smtpOn = !!set && !!s.mail?.hasPassword && smtp.state !== 'bad'
  const smtpText = !desktop ? 'Desktop app only' : !set ? 'No sender' : !s.mail?.hasPassword ? 'No app password' : smtp.state === 'busy' ? 'Checking…' : smtp.state === 'bad' ? 'Login failed' : smtp.state === 'ok' ? <><span className="sb-text">{set.user}</span><span className="sb-ms">{smtp.ms} ms</span></> : <span className="sb-text">{set.user}</span>

  return (
    <div className="outreach-workspace">
      <header className="topbar ed-head or-head">
        <WorkspaceSwitcher />
        <MenuBar menus={menus} />
        <div className="spacer" />
        {c && (
          <button type="button" className="pv-btn or-camp-chip" onClick={() => openTab('campaigns')} data-tip={`${c.name} — ${STATUS_TEXT[c.status]}. Click for every campaign`}>
            <i className={'or-dot cs-' + c.status} aria-hidden />
            <span className="or-camp-name">{c.name}</span>
            <span className="dpc-tag">{c.kind === 'direct' ? `${audience.length} to` : `${ready} ready`}</span>
          </button>
        )}
        <div className="spacer" />
        <button type="button" className={'pv-btn or-log-btn' + (ui.showLog ? ' on' : '')} aria-pressed={ui.showLog} onClick={() => ui.set({ showLog: !ui.showLog })} data-tip="What the desk did: imports, sends, refusals">
          <Icon name="activity" size={15} />{s.log.length > 0 && <span className={'or-badge' + (failures ? ' bad' : '')}>{s.log.length}</span>}
        </button>
        <button type="button" className={'ed-ai-chip' + (letterAi ? ' on' : '') + (ai.paused ? ' paused' : '')} data-provider={letterAi?.provider} onClick={() => ui.set({ sheet: 'ai' })} aria-label="AI keys and roles"
          data-tip={ai.paused ? 'AI is OFF — click to open the AI settings, or turn it ON in the Engine panel' : letterAi ? `Letter, Research and Review AI — ${providerMeta(letterAi.provider).name}. Click to change` : 'Connect an AI to write, research and review letters'}>
          {ai.paused ? <Icon name="power" size={14} /> : letterAi ? <ProviderMark id={letterAi.provider} size={18} /> : <Icon name="link" size={14} />}
          <span className="ed-ai-label">{ai.paused ? 'AI OFF' : letterAi ? providerMeta(letterAi.provider).name : 'Connect AI'}</span>
        </button>
        <button type="button" className={'ed-account' + (set ? ' in' : '')} onClick={() => ui.set({ sheet: 'sender' })} disabled={!desktop} aria-label="Sender account" data-tip={set ? `Sending as ${set.name} · ${set.user}` : desktop ? 'Set up the account that sends' : 'Sending needs the desktop app'}>
          {set ? <span className="ed-avatar">{(set.name || set.user).split(/[\s@.]+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join('')}</span> : <><Icon name="mail" size={14} /><span className="ed-account-label">Sender</span></>}
        </button>
        {idle ? (
          <button type="button" className="btn primary" onClick={() => ui.set({ sheet: 'review-send' })} disabled={!c} data-tip="Review the campaign and send it now or at a time">
            <Icon name="send" size={15} /><span>Send</span>
          </button>
        ) : (
          <button type="button" className="btn primary or-running" onClick={() => ui.set({ right: 'send' })} data-tip="The batch is running — see Send">
            <Icon name="refresh" size={15} className={s.run === 'running' ? 'spin' : ''} /><span>{s.runSent}/{s.runTotal}</span>
          </button>
        )}
        <input ref={file} type="file" accept=".xlsx,.csv,.xls" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void s.importList(f); e.target.value = '' }} />
      </header>

      {ui.showLog && (
        <div className="or-log" role="log" aria-label="Outreach log">
          {s.log.length === 0 ? <p className="or-muted">Nothing yet.</p> : [...s.log].reverse().map((l, i) => (
            <div key={i} className={'or-log-line ' + l.level}><time>{new Date(l.t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</time><span>{l.text}</span></div>
          ))}
        </div>
      )}

      <div className="or-body">
        <aside className="or-left" aria-label="Contacts, campaigns and sources">
          <Tabs<LeftTab> className="or-tabs" value={ui.left} onChange={openTab} options={[
            { value: 'contacts', label: 'Contacts', icon: 'users' },
            { value: 'campaigns', label: 'Campaigns', icon: 'send' },
            { value: 'sources', label: 'Sources', icon: 'quote' },
          ]} />
          {ui.left === 'contacts' ? <ContactsTab /> : ui.left === 'campaigns' ? <CampaignsTab /> : <SourcesTab />}
        </aside>
        <OutreachComposer />
        <OutreachInspector />
      </div>

      <footer className="statusbar ed-statusbar or-status">
        <button type="button" className={'sb-cms ' + (smtpOn ? 'on' : 'off')} onClick={() => { if (s.mail?.hasPassword) void s.checkSmtp(true); else if (desktop) ui.set({ sheet: 'sender' }) }}
          data-tip={smtp.state === 'bad' ? `${smtp.error} — click to try again` : smtp.state === 'ok' ? `Signed in to ${set?.host} · checked ${new Date(smtp.at).toLocaleTimeString()} — click to check again` : set ? 'Click to sign in to the mail server now' : 'Set up the account that sends'}>
          <span className="sb-k">Mail</span>
          <span className="sb-pill"><i className="sb-dot" aria-hidden />{smtpText}</span>
        </button>
        <div className="sep" />
        <EngineStatus ai={ai} offline={false} onAddKey={() => ui.set({ sheet: 'ai' })} roles={['outreach', 'research', 'review']} />
        <div className="spacer" />
        <span>{c?.kind === 'direct' ? `${audience.length} recipient${audience.length === 1 ? '' : 's'}` : `${audience.length} in audience`} · {ready} ready · {sent} sent</span>
        {set && <><div className="sep" /><span>{s.mail?.sent24h ?? 0} of {set.dailyLimit} today</span></>}
        {!idle && <><div className="sep" /><span className="or-status-run">{s.run === 'running' ? 'Sending' : 'Paused'} · {s.runSent}/{s.runTotal}</span></>}
      </footer>

      {ui.sheet === 'sender' && <SenderDialog onClose={() => { ui.set({ sheet: null }); void s.checkSmtp(true) }} />}
      {ui.sheet === 'ai' && <AiSettingsDialog onClose={() => ui.set({ sheet: null })} onToast={(m) => s.addLog('info', m)} />}
      {ui.sheet === 'signatures' && <SignaturesDialog />}
      {ui.sheet === 'prompt' && <HousePromptDialog />}
      {ui.sheet === 'review-send' && c && <ReviewSendDialog />}
      {(ui.sheet === 'rename' || ui.sheet === 'save-template') && c && <NameDialog mode={ui.sheet} />}
    </div>
  )
}
