// The Outreach desk, in the Editorial frame: menus and the open campaign in the header with the AI chip, the sender
// and one primary action on the right; Contacts · Campaigns · Sources (left), the letter (centre), Send · Contact ·
// Review (right); the mail server and the AI engines in the status bar. The first version opened a fixed workbook path
// on start (W:\E-Mail Marketing\…) through a bridge that read any file on the PC; the list is now always picked by
// the editor.

import { useEffect, useMemo, useRef, useState } from 'react'
import { WorkspaceSwitcher } from '../shell/WorkspaceRail'
import { ContactsTab } from './ContactsTab'
import { CampaignsTab, STATUS_TEXT } from './CampaignsTab'
import { SourcesTab } from './SourcesTab'
import { OutreachComposer } from './OutreachComposer'
import { OutreachInspector } from './OutreachInspector'
import { SenderDialog } from './SenderDialog'
import { ActivityDesk } from './ActivityDesk'
import { AutopilotDialog } from './AutopilotDialog'
import { SegmentsDialog } from './SegmentsDialog'
import { SubjectVersionsDialog } from './SubjectVersionsDialog'
import { AssistantDialog } from './AssistantDialog'
import { AskDialog, FollowUpDialog, FooterDialog, HeaderDialog, HousePromptDialog, NameDialog, ReviewSendDialog, SignaturesDialog, TemplatesDialog } from './OutreachDialogs'
import { DEFAULT_FONT_FAMILY, DEFAULT_FOOTER_LINE, useOutreachStore, useDesk } from './outreachStore'
import { ask, useOutreachUi, type LeftTab } from './outreachUi'
import { downloadText, eligible, inAudience, resultsCsv, resumeBatch } from './campaign'
import { useEngineStore } from './engineStore'
import { describeRun, fmtDay } from './activityFormat'
import { applyDesignFile } from './designImport'
import { useCloud } from './cloudStore'
import { CloudPill } from './CloudPill'
import { AiSettingsDialog } from '../editorial/AiSettingsDialog'
import { EngineStatus } from '../editorial/EngineStatus'
import { ProviderMark } from '../editorial/ProviderMark'
import { useEditorialStore } from '../editorial/editorialStore'
import { aiFor, providerMeta } from '../editorial/aiProviders'
import { useStore } from '../store'
import { Icon } from '../ui/Icon'
import { MenuBar, Tabs, Seg, type MenuDef } from '../ui/controls'
import { useHelpMenu } from '../ui/HelpMenu'
import { AccountButton } from '../shell/AccountButton'
import { fmtTime, useClockFormat } from '../ui/time'
import { mailFailView } from './mailCheck'

export function OutreachWorkspace() {
  useClockFormat() // re-render when Home → Settings → Time format changes
  const s = useDesk()
  const ui = useOutreachUi()
  const ai = useEditorialStore((e) => e.ai)
  const theme = useStore((x) => x.theme)
  const c = s.campaign()
  const file = useRef<HTMLInputElement>(null)
  const designFile = useRef<HTMLInputElement>(null)
  const letterAi = aiFor('outreach', ai)
  const idle = s.run === 'idle'

  // the sender's own server answers for the status bar: on open, on focus and every five minutes (main caches 60 s)
  useEffect(() => {
    void s.refreshMail().then(() => { if (useOutreachStore.getState().mail?.hasPassword) void useOutreachStore.getState().checkSmtp() })
    const again = () => { if (useOutreachStore.getState().mail?.hasPassword) void useOutreachStore.getState().checkSmtp() }
    const t = setInterval(again, 5 * 60_000)
    // the network came back: if the mail server was unreachable, check again now (a moment later, so DNS is up too)
    let onlineT: ReturnType<typeof setTimeout> | undefined
    const online = () => {
      clearTimeout(onlineT)
      onlineT = setTimeout(() => {
        const st = useOutreachStore.getState()
        if (st.mail?.hasPassword && st.smtp.state === 'bad' && st.smtp.kind === 'network') void st.checkSmtp(true)
      }, 2000)
    }
    window.addEventListener('focus', again)
    window.addEventListener('online', online)
    return () => { clearInterval(t); clearTimeout(onlineT); window.removeEventListener('focus', again); window.removeEventListener('online', online) }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const audience = useMemo(() => s.contacts.filter((x) => inAudience(x, c?.audience)), [s.contacts, c?.audience])
  const ready = useMemo(() => (c ? eligible(s.contacts, c.subject, c.body, c.audience).length : 0), [s.contacts, c])
  const sent = c ? Object.keys(c.sent).length : 0
  const totalReplies = s.campaigns.reduce((n, x) => n + Object.keys(x.replied).length, 0)
  const set = s.mail?.settings
  const desktop = !!window.esb?.outreachSend
  const engine = useEngineStore()
  const job = engine.jobForCampaign(c?.id)
  const settings = engine.settings
  const desc = describeRun(job, settings)
  // the status-bar countdown ("Sending 3/282 · 2:14") redraws once a second while a next send is scheduled; the
  // desk no longer re-renders on every store change, so it needs its own tick
  const [, tickPill] = useState(0)
  useEffect(() => {
    if (!job?.until) return
    const t = setInterval(() => tickPill((n) => n + 1), 1000)
    return () => clearInterval(t)
  }, [job?.until])

  let banner: React.ReactNode = null
  if (job?.status === 'paused' && job.reason === 'circuit') {
    banner = (
      <div className="or-banner-row danger" role="status">
        <span>Sending paused to protect your account — addresses were refused.</span>
        <button type="button" className="or-banner-action" onClick={() => void resumeBatch()}>Resume</button>
      </div>
    )
  } else if (job?.status === 'paused' && job.reason === 'bounces') {
    banner = (
      <div className="or-banner-row danger" role="status">
        <span>Sending paused — {job.wait?.max ? `${job.wait.count ?? 0} of ${job.wait.max} letters bounced` : 'too many letters bounced'} (over 3%). Check the bounced addresses (Activity → Overview) before resuming; resuming re-pauses only on a new bounce.</span>
        <button type="button" className="or-banner-action" onClick={() => void resumeBatch()}>Resume</button>
      </div>
    )
  } else if (job?.status === 'paused' && job.reason === 'auth') {
    banner = (
      <div className="or-banner-row danger" role="status">
        <span>Sign-in problem — sending is paused. Open the sender account.</span>
        <button type="button" className="or-banner-action" onClick={() => ui.set({ sheet: 'sender' })}>Open sender account</button>
      </div>
    )
  } else if (settings?.dryRun || job?.dry) {
    banner = (
      <div className="or-banner-row warning" role="status">
        <span>Test run — nothing is really sent.</span>
      </div>
    )
  }

  const openTab = (left: LeftTab) => ui.set({ left })
  const help = useHelpMenu({ shortcuts: [{ group: 'Letter', rows: [['Ctrl + B', 'Bold'], ['Ctrl + I', 'Italic'], ['Ctrl + K', 'Link']] }] })
  const menus: MenuDef[] = [
    { label: 'Campaign', items: [
      { label: 'New campaign', icon: 'plus', disabled: !idle, onClick: () => void s.createCampaign() },
      { label: 'New email to addresses', icon: 'mail', disabled: !idle, onClick: () => void s.createCampaign({ kind: 'direct', name: 'New email', listId: null, sheet: '', blueprint: 'blank', subject: '', body: '' }) },
      { label: 'Duplicate', icon: 'copy', disabled: !c || !idle, onClick: () => c && void s.duplicateCampaign(c.id) },
      { label: 'Rename', icon: 'edit', disabled: !c, onClick: () => ui.set({ sheet: 'rename' }) },
      { divider: true },
      { label: 'Review & send', icon: 'send', disabled: !c || !idle, onClick: () => ui.set({ sheet: 'review-send' }) },
      { label: 'Check the inbox for replies', icon: 'inbox', disabled: !desktop || !s.mail?.hasPassword || s.inbox.state === 'busy', onClick: () => void s.checkInbox(true) },
      { label: 'Export results (CSV)', icon: 'download', disabled: !c || !s.contacts.length, onClick: () => c && downloadText(`${c.name.replace(/[^\w-]+/g, '-')}-results.csv`, resultsCsv(c, s.contacts, useCloud.getState().engagement[c.id] ?? {})) },
      { label: 'Ask the assistant', icon: 'sparkle', onClick: () => ui.set({ sheet: 'assistant' }) },
      { label: 'Sending settings', icon: 'sliders', onClick: () => ui.set({ sheet: 'autopilot' }) },
      { divider: true },
      { label: 'Delete campaign', icon: 'trash', danger: true, disabled: !c || !idle, onClick: async () => { if (c && await ask({ title: `Delete “${c.name}”?`, body: 'Its letter, sources and results go with it. Addresses it already emailed stay protected by the 7-day rule.', ok: 'Delete', danger: true })) void s.deleteCampaign(c.id) } },
    ] },
    { label: 'Letter', items: [
      { label: 'Versions by sector', icon: 'layers', disabled: !c, onClick: () => ui.set({ sheet: 'segments' }) },
      { label: 'Subject versions', icon: 'edit', disabled: !c, onClick: () => ui.set({ sheet: 'subject-versions' }) },
      { divider: true },
      { label: 'Save as template', icon: 'filePlus', disabled: !c?.body.trim(), onClick: () => ui.set({ sheet: 'save-template' }) },
      { label: 'Templates', icon: 'folder', hint: s.templates.length ? String(s.templates.length) : 'None yet', onClick: () => ui.set({ sheet: 'templates' }) },
      { label: 'Follow-up letter', icon: 'refresh', disabled: !c, onClick: () => ui.set({ sheet: 'follow-up' }) },
      { divider: true },
      { label: c?.design ? 'Replace the designed HTML' : 'Designed HTML', icon: 'image', hint: c?.design ? 'In use' : 'File', disabled: !c, onClick: () => designFile.current?.click() },
      ...(c?.design ? [{ label: 'Back to a written letter', icon: 'edit' as const, onClick: async () => { if (await ask({ title: 'Stop using the designed letter?', body: `${c.design!.name} is set aside; its plain-text version stays as the letter to edit. Pick the HTML file again to bring it back.`, ok: 'Use a written letter' })) void s.clearDesign() } }] : []),
      { divider: true },
      { label: 'Signatures', icon: 'edit', onClick: () => ui.set({ sheet: 'signatures' }) },
      { label: 'ESB letterhead', checked: !!c?.letterhead && !c?.officialPad, disabled: !c || !!c?.officialPad, onClick: () => s.patch({ letterhead: !c?.letterhead }) },
      { label: 'Footer text', icon: 'edit', hint: s.footerBg || s.footerLine !== DEFAULT_FOOTER_LINE ? 'Edited' : s.footerLine ? 'Default' : 'Off', onClick: () => ui.set({ sheet: 'footer' }) },
      { label: 'Header & fonts', icon: 'edit', hint: s.headerBg || s.stripeColors || s.fontFamily !== DEFAULT_FONT_FAMILY ? 'Edited' : 'Default', onClick: () => ui.set({ sheet: 'header' }) },
      { label: 'Official pad (gold rail + contact QR)', checked: !!c?.officialPad, disabled: !c, onClick: () => s.patch({ officialPad: !c?.officialPad }) },
      { label: 'House prompt', icon: 'sparkle', hint: s.housePrompt ? 'Set' : 'None', onClick: () => ui.set({ sheet: 'prompt' }) },
    ] },
    { label: 'List', items: [
      { label: 'Import a list', icon: 'upload', disabled: !idle, onClick: () => file.current?.click() },
      ...(s.lists.length ? [{ heading: 'On this computer' }] : []),
      ...s.lists.slice(0, 6).map((l) => ({ label: l.fileName, hint: `${l.sheets.reduce((n, x) => n + x.contacts, 0)} rows`, checked: c?.listId === l.id, disabled: !c || !idle || c.kind === 'direct', onClick: () => void s.useList(l.id) })),
      { divider: true },
      { label: 'Contacts', checked: ui.left === 'contacts', onClick: () => openTab('contacts') },
      { label: 'Sender account', icon: 'mail', disabled: !desktop, onClick: () => ui.set({ sheet: 'sender' }) },
    ] },
    { label: 'View', items: [
      { label: 'Compose desk', icon: 'edit', checked: ui.desk === 'compose', onClick: () => ui.set({ desk: 'compose' }) },
      { label: 'Activity desk', icon: 'activity', checked: ui.desk === 'activity', onClick: () => ui.set({ desk: 'activity' }) },
      { divider: true },
      { label: 'Contacts', checked: ui.left === 'contacts', onClick: () => openTab('contacts') },
      { label: 'Campaigns', checked: ui.left === 'campaigns', onClick: () => openTab('campaigns') },
      { label: 'Sources', checked: ui.left === 'sources', onClick: () => openTab('sources') },
      { divider: true },
      { label: 'Edit the letter', checked: ui.view === 'edit', onClick: () => ui.set({ view: 'edit' }) },
      { label: 'Preview as sent', checked: ui.view === 'preview', onClick: () => ui.set({ view: 'preview' }) },
      { divider: true },
      { heading: 'Appearance' },
      { label: 'Light', icon: 'sun', checked: theme !== 'dark', onClick: () => useStore.getState().setTheme('light') },
      { label: 'Dark', icon: 'moon', checked: theme === 'dark', onClick: () => useStore.getState().setTheme('dark') },
    ] },
    help.menu,
  ]

  const smtp = s.smtp
  const smtpFail = smtp.state === 'bad' ? mailFailView(smtp.kind, smtp.error, { host: set?.host, retryAtText: smtp.retryAt ? fmtTime(smtp.retryAt, { seconds: true }) : undefined }) : null
  const smtpTone = !set || !s.mail?.hasPassword ? 'off' : smtpFail ? smtpFail.tone : 'on'
  const smtpText = !desktop ? 'Desktop app only' : !set ? 'No sender' : !s.mail?.hasPassword ? 'No app password' : smtp.state === 'busy' ? 'Checking' : smtpFail ? smtpFail.text : smtp.state === 'ok' ? <><span className="sb-text">{set.user}</span><span className="sb-ms">{smtp.ms} ms</span></> : <span className="sb-text">{set.user}</span>

  return (
    <div className="outreach-workspace">
      <header className="topbar ed-head or-head">
        <WorkspaceSwitcher />
        <MenuBar menus={menus} />
        {c && (
          <button type="button" className="pv-btn or-camp-chip" onClick={() => openTab('campaigns')} data-tip={`${c.name} — ${STATUS_TEXT[c.status]}. Click for every campaign`}>
            <i className={'or-dot cs-' + c.status} aria-hidden />
            <span className="or-camp-name">{c.name}</span>
            <span className="dpc-tag">{c.kind === 'direct' ? `${audience.length} to` : `${ready} ready`}</span>
          </button>
        )}
        <div className="spacer" />
        <Seg<'compose' | 'activity'>
          value={ui.desk}
          onChange={(desk) => ui.set({ desk })}
          className="or-desk-seg"
          options={[
            { value: 'compose', label: 'Compose', icon: 'edit', tip: 'Compose desk — contacts, letters and sending' },
            { value: 'activity', label: 'Activity', icon: 'activity', tip: 'Activity desk — overview, charts, logs and reports' },
          ]}
        />
        <div className="spacer" />
        <button type="button" className={'ed-ai-chip' + (letterAi ? ' on' : '') + (ai.paused ? ' paused' : '')} data-provider={letterAi?.provider} onClick={() => ui.set({ sheet: 'ai' })} aria-label="AI keys and roles"
          data-tip={ai.paused ? 'AI is OFF — click to open the AI settings, or turn it ON in the Engine panel' : letterAi ? `Letter, Research and Review AI — ${providerMeta(letterAi.provider).name}. Click to change` : 'Connect an AI to write, research and review letters'}>
          {ai.paused ? <Icon name="power" size={14} /> : letterAi ? <ProviderMark id={letterAi.provider} size={18} /> : <Icon name="link" size={14} />}
          <span className="ed-ai-label">{ai.paused ? 'AI OFF' : letterAi ? providerMeta(letterAi.provider).name : 'Connect AI'}</span>
        </button>
        <AccountButton onToast={(m) => s.addLog('info', m)} />
        <input ref={file} type="file" accept=".xlsx,.csv,.xls" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void s.importList(f); e.target.value = '' }} />
        <input ref={designFile} type="file" accept=".html,.htm,text/html" hidden onChange={(e) => { void applyDesignFile(e.target.files?.[0]); e.target.value = '' }} />
      </header>

      {banner}

      {ui.desk === 'activity' ? (
        <ActivityDesk />
      ) : (
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
      )}

      <footer className="statusbar ed-statusbar or-status">
        <button type="button" className={'sb-cms ' + smtpTone} onClick={() => { if (s.mail?.hasPassword && !smtpFail?.fixInSender) void s.checkSmtp(true); else if (desktop) ui.set({ sheet: 'sender' }) }}
          data-tip={smtpFail ? (smtpFail.fixInSender ? `${smtpFail.tip} — click to open Sender` : smtpFail.tip) : smtp.state === 'ok' ? `Signed in to ${set?.host} · checked ${fmtTime(smtp.at)} — click to check again` : set ? 'Click to sign in to the mail server now' : 'Set up the account that sends'}>
          <span className="sb-k">Mail</span>
          <span className="sb-pill"><i className="sb-dot" aria-hidden />{smtpText}</span>
        </button>
        {desktop && set && s.mail?.hasPassword && <>
          <div className="sep" />
          <button type="button" className={'sb-cms or-sb-inbox ' + (s.inbox.state === 'bad' ? 'off' : 'on')} onClick={() => void s.checkInbox(true)}
            data-tip={s.inbox.state === 'bad' ? `${s.inbox.error} — click to try again` : `Replies, unsubscribes and bounces read from ${s.mail.imapHost || 'the inbox'} (read-only). Click to read it now`}>
            <span className="sb-k">Inbox</span>
            <span className="sb-pill"><i className="sb-dot" aria-hidden />{s.inbox.state === 'busy' ? 'Reading' : s.inbox.state === 'bad' ? 'Not read' : s.inbox.state === 'ok' ? <span className="sb-text">{totalReplies} repl{totalReplies === 1 ? 'y' : 'ies'} · {fmtTime(s.inbox.at)}</span> : 'Not read yet'}</span>
          </button>
        </>}
        <div className="sep" />
        <CloudPill />
        <div className="sep" />
        <button
          type="button"
          className={'sb-cms or-sb-autopilot ' + (desc.status === 'problem' ? 'off' : 'on')}
          onClick={() => ui.set({ desk: 'activity' })}
          data-tip={`Autopilot — ${desc.reason ? `${desc.nextInText ?? 'Waiting'} — ${desc.reason}` : desc.sentence}. Click to open full Activity`}
        >
          <span className="sb-k">Autopilot</span>
          <span className="sb-pill">
            <i className={'sb-dot ' + (desc.status === 'sending' ? 'cs-sending' : desc.status === 'waiting' || desc.status === 'paused' ? 'cs-paused' : desc.status === 'problem' ? 'bad' : '')} aria-hidden />
            <span className="sb-text or-ap-full-text">
              {desc.status === 'sending' || (desc.status === 'waiting' && job?.why === 'gap')
                ? `Sending ${job?.sent ?? 0}/${job?.total ?? 0}${desc.nextInText ? ` · ${desc.nextInText.replace('Next in ', '')}` : ''}`
                : desc.status === 'waiting'
                ? (job?.why === 'window' ? `Waiting · opens ${fmtDay(job.until || Date.now(), settings?.window?.tz)}` : job?.why === 'domain' && job.wait?.domain && desc.nextInText ? `${desc.nextInText} · ${job.wait.domain} ${job.wait.kind === 'limit' ? 'daily limit' : 'spacing'}` : desc.sentence)
                : desc.status === 'paused'
                ? 'Paused'
                : 'Idle'}
            </span>
            <span className="sb-text or-ap-short-text">
              {desc.status === 'sending' ? `${job?.sent ?? 0}/${job?.total ?? 0}` : desc.label}
            </span>
          </span>
        </button>
        <div className="sep" />
        <EngineStatus ai={ai} offline={false} onAddKey={() => ui.set({ sheet: 'ai' })} roles={['outreach', 'research', 'review']} />
        <div className="spacer" />
        <span>{c?.kind === 'direct' ? `${audience.length} recipient${audience.length === 1 ? '' : 's'}` : `${audience.length} in audience`} · {ready} ready · {sent} sent</span>
        {set && <><div className="sep" /><span>{s.mail?.sentToday ?? s.mail?.sent24h ?? 0} of {set.dailyLimit} today</span></>}
      </footer>

      {ui.sheet === 'sender' && <SenderDialog onClose={() => { ui.set({ sheet: null }); void s.checkSmtp(true) }} />}
      {ui.sheet === 'autopilot' && <AutopilotDialog onClose={() => ui.set({ sheet: null })} />}
      {ui.sheet === 'ai' && <AiSettingsDialog onClose={() => ui.set({ sheet: null })} onToast={(m) => s.addLog('info', m)} />}
      {ui.sheet === 'signatures' && <SignaturesDialog />}
      {ui.sheet === 'prompt' && <HousePromptDialog />}
      {ui.sheet === 'footer' && <FooterDialog />}
      {ui.sheet === 'header' && <HeaderDialog />}
      {ui.sheet === 'review-send' && c && <ReviewSendDialog />}
      {(ui.sheet === 'rename' || ui.sheet === 'save-template') && c && <NameDialog mode={ui.sheet} />}
      {ui.sheet === 'follow-up' && c && <FollowUpDialog />}
      {ui.sheet === 'templates' && <TemplatesDialog />}
      {ui.sheet === 'segments' && c && <SegmentsDialog onClose={() => ui.set({ sheet: null })} />}
      {ui.sheet === 'subject-versions' && c && <SubjectVersionsDialog onClose={() => ui.set({ sheet: null })} />}
      {ui.sheet === 'assistant' && <AssistantDialog onClose={() => ui.set({ sheet: null })} />}
      <AskDialog />
      {help.dialogs}
    </div>
  )
}
