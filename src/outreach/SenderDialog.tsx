// The sending account. The password / API key goes to the main process once, is encrypted there with the operating
// system's keychain and is never shown or read back; the field stays empty after saving.
// Any SMTP service (2026-11-09): Gmail / Google Workspace, Microsoft 365, Zoho, Resend, Amazon SES, Brevo, Mailgun,
// SendGrid or a custom server — presets fill the server, port and login; main (electron/mailer.cjs PROVIDERS) checks
// the server belongs to the chosen service. A relay (Resend, SES, …) has no inbox: replies go to the Reply-To, and are
// read here only when that mailbox's IMAP server and password are given.
// The pace (emails per day, gaps, sending hours) is NOT edited here since 2026-11-02: it lives only in Sending
// settings (AutopilotDialog.tsx). This dialog shows it in one line with a link there. The mailer's validator still
// wants a pacing triple in outreach-smtp.json, so the engine's numbers are passed through unchanged.

import { useEffect, useState } from 'react'
import { Dialog, Field } from '../ui/controls'
import { Icon } from '../ui/Icon'
import { useOutreachStore } from './outreachStore'
import { useEngineStore } from './engineStore'
import { engineClient } from './engineClient'
import { useOutreachUi } from './outreachUi'
import { fmtGapRange } from './activityFormat'
import { fmtWallClock } from '../ui/time'
import type { EsbMailProvider } from '../esb'

interface Preset {
  label: string
  host: string
  port: number
  /** Fixed SMTP user name; '' = typed (or the sending address). */
  login: string | null
  /** The account has its own inbox (replies read there). */
  mailbox: boolean
  imap?: string
  secret: string
  hint: string
  loginLabel?: string
}

// mirrors electron/mailer.cjs PROVIDERS (main re-checks every value)
const PRESETS: Record<EsbMailProvider, Preset> = {
  gmail: { label: 'Gmail / Google Workspace', host: 'smtp.gmail.com', port: 465, login: null, mailbox: true, imap: 'imap.gmail.com', secret: 'Google app password', hint: 'Not your Google password: an app password made for this computer (myaccount.google.com → App passwords; needs 2-step verification). A personal Gmail allows about 500 a day.' },
  m365: { label: 'Microsoft 365 / Outlook', host: 'smtp.office365.com', port: 587, login: null, mailbox: true, imap: 'outlook.office365.com', secret: 'Password or app password', hint: 'Your Microsoft 365 admin must allow "Authenticated SMTP" for this mailbox (Exchange admin → mailbox → Email apps). With MFA on, use an app password.' },
  zoho: { label: 'Zoho Mail', host: 'smtp.zoho.com', port: 465, login: null, mailbox: true, imap: 'imap.zoho.com', secret: 'Zoho app-specific password', hint: 'Use your region\'s server (smtp.zoho.eu, smtp.zoho.in, …; smtppro.zoho.com for a paid domain) and an app-specific password from Zoho → Security.' },
  resend: { label: 'Resend', host: 'smtp.resend.com', port: 465, login: 'resend', mailbox: false, secret: 'Resend API key', hint: 'The sending address must be on a domain verified in Resend. The user name is always "resend".' },
  ses: { label: 'Amazon SES', host: 'email-smtp.us-east-1.amazonaws.com', port: 465, login: '', mailbox: false, secret: 'SES SMTP password', loginLabel: 'SES SMTP user name', hint: 'SES → SMTP settings → Create SMTP credentials gives a user name and password (not your AWS keys). Use the endpoint of the region your identity is verified in.' },
  brevo: { label: 'Brevo', host: 'smtp-relay.brevo.com', port: 587, login: '', mailbox: false, secret: 'Brevo SMTP key', loginLabel: 'Brevo SMTP login', hint: 'Brevo → SMTP & API → SMTP: the login shown there and an SMTP key. The sending address must be a verified sender.' },
  mailgun: { label: 'Mailgun', host: 'smtp.mailgun.org', port: 587, login: '', mailbox: false, secret: 'Mailgun SMTP password', loginLabel: 'Mailgun SMTP login', hint: 'Mailgun → Sending → Domain settings → SMTP credentials (e.g. postmaster@mg.yourdomain). EU domains use smtp.eu.mailgun.org.' },
  sendgrid: { label: 'SendGrid', host: 'smtp.sendgrid.net', port: 465, login: 'apikey', mailbox: false, secret: 'SendGrid API key', hint: 'An API key with Mail Send permission. The user name is always "apikey"; the sending address must be a verified sender.' },
  custom: { label: 'Custom SMTP', host: '', port: 587, login: '', mailbox: true, secret: 'Password', loginLabel: 'SMTP user name (if not the sending address)', hint: 'Any SMTP server with TLS: port 465 (TLS) or 587 / 2525 / 25 (STARTTLS required).' },
}

const SES_REGIONS = ['us-east-1', 'us-east-2', 'us-west-2', 'eu-west-1', 'eu-west-2', 'eu-central-1', 'ap-south-1', 'ap-southeast-1', 'ap-southeast-2', 'ap-northeast-1', 'ca-central-1', 'sa-east-1']

export function SenderDialog({ onClose }: { onClose: () => void }) {
  const mail = useOutreachStore((s) => s.mail)
  const refresh = useOutreachStore((s) => s.refreshMail)
  const addLog = useOutreachStore((s) => s.addLog)
  const cur = mail?.settings
  const pacing = useEngineStore((x) => x.settings)
  const [f, setF] = useState({
    provider: (cur?.provider ?? 'gmail') as EsbMailProvider,
    name: cur?.name ?? 'ESB Power Line',
    user: cur?.user ?? '',
    login: cur?.login ?? '',
    replyTo: cur?.replyTo ?? '',
    host: cur?.host ?? 'smtp.gmail.com',
    imapHost: cur?.imapHost ?? '',
    imapUser: cur?.imapUser ?? '',
    port: cur?.port ?? 465,
  })
  useEffect(() => { if (!pacing) void engineClient.settings() }, [pacing])
  const ui = useOutreachUi()
  const [password, setPassword] = useState('')
  const [imapPassword, setImapPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const up = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }))
  const p = PRESETS[f.provider]
  const relay = !p.mailbox
  const pick = (id: EsbMailProvider) => {
    const n = PRESETS[id]
    setF((x) => ({ ...x, provider: id, host: n.host, port: n.port, login: n.login ?? '', imapHost: '' }))
  }
  const sesRegion = /^email-smtp\.([a-z0-9-]+)\.amazonaws\.com$/.exec(f.host)?.[1] ?? 'us-east-1'

  const save = async () => {
    const b = window.esb
    if (!b?.outreachSave) return
    // the main process drops a saved password whenever the account, the service or either server changes, so ask for
    // it here rather than saving a sender that silently has none
    const moved = !!cur && (cur.user !== f.user.trim() || cur.host !== f.host.trim() || (cur.imapHost || '') !== f.imapHost.trim().toLowerCase() || cur.port !== Number(f.port) || (cur.provider ?? 'gmail') !== f.provider || (cur.login || '') !== (p.login ?? f.login.trim()))
    if (mail?.hasPassword && moved && !password.trim()) { setError(`The account, service or a server changed, so type the ${p.secret.toLowerCase()} again. It is only kept for the servers it was saved with.`); return }
    // the mailer's file still carries a pacing triple (its validator wants one); it is the engine's, untouched
    const dailyLimit = pacing?.dailyLimit ?? cur?.dailyLimit ?? 100
    const minDelaySec = pacing?.minDelaySec ?? cur?.minDelaySec ?? 180
    const maxDelaySec = pacing?.maxDelaySec ?? cur?.maxDelaySec ?? 480
    setSaving(true)
    setError(null)
    const r = await b.outreachSave({
      provider: f.provider, name: f.name, user: f.user.trim(), login: (p.login ?? f.login).trim(), replyTo: f.replyTo.trim(),
      host: f.host.trim(), imapHost: f.imapHost.trim(), imapUser: f.imapUser.trim(), port: Number(f.port), dailyLimit, minDelaySec, maxDelaySec,
    }, password || undefined, imapPassword || undefined)
    setSaving(false)
    if (!r.ok) { setError(r.error); return }
    addLog('info', `Sender saved: ${f.user} via ${p.label}${password ? ' (secret stored, encrypted)' : ''}`)
    await refresh()
    onClose()
  }

  const imapGuess = p.imap ?? (f.host.trim() ? f.host.trim().toLowerCase().replace(/^smtp\./, 'imap.') : 'imap.example.com')

  return (
    <Dialog
      title="Sender"
      kicker="OUTREACH"
      width={560}
      onClose={onClose}
      footer={<>
        {mail?.hasPassword && <button type="button" className="btn" onClick={async () => { await window.esb?.outreachForgetPassword?.(); await refresh(); addLog('info', 'Sending password removed') }}>Remove password</button>}
        <div className="spacer" />
        <button type="button" className="btn" onClick={onClose}>Cancel</button>
        <button type="button" className="btn primary" onClick={() => void save()} disabled={saving || !f.user.trim()}>{saving ? 'Saving' : 'Save'}</button>
      </>}
    >
      <div className="stack or-sender-form" style={{ gap: 12 }}>
        <Field label="Sending service">
          <select className="input" value={f.provider} onChange={(e) => pick(e.target.value as EsbMailProvider)} aria-label="Sending service">
            {(Object.keys(PRESETS) as EsbMailProvider[]).map((id) => <option key={id} value={id}>{PRESETS[id].label}</option>)}
          </select>
        </Field>
        <div className="grid2">
          <Field label="From name"><input className="input" value={f.name} onChange={(e) => up('name', e.target.value)} /></Field>
          <Field label="Sending address (From)"><input className="input" type="email" placeholder="desk@esbpowerline.com" value={f.user} onChange={(e) => up('user', e.target.value)} /></Field>
        </div>
        {p.login === '' && (
          <Field label={p.loginLabel ?? 'SMTP user name'}>
            <input className="input" autoComplete="off" spellCheck={false} placeholder={f.provider === 'custom' ? 'the sending address' : ''} value={f.login} onChange={(e) => up('login', e.target.value)} />
          </Field>
        )}
        <Field label={mail?.hasPassword ? `${p.secret} — saved; type a new one to replace it` : p.secret}>
          <input className="input" type="password" autoComplete="new-password" placeholder={mail?.hasPassword ? '••••••••  (saved)' : ''} value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        <p className="hint">{p.hint} Encrypted with Windows' own key store and never shown again.{mail && !mail.encryption ? ' This computer cannot encrypt it, so it cannot be saved here.' : ''}</p>
        <div className="grid2">
          {f.provider === 'ses'
            ? <Field label="SES region">
                <select className="input" value={sesRegion} onChange={(e) => up('host', `email-smtp.${e.target.value}.amazonaws.com`)} aria-label="SES region">
                  {[...new Set([sesRegion, ...SES_REGIONS])].map((r) => <option key={r} value={r}>{r}</option>)}
                </select>
              </Field>
            : <Field label="SMTP server"><input className="input" value={f.host} onChange={(e) => up('host', e.target.value)} placeholder="smtp.example.com" /></Field>}
          <Field label="Port"><input className="input" type="number" value={f.port} onChange={(e) => up('port', Number(e.target.value))} /></Field>
        </div>
        <Field label="Reply-To (optional) — where answers should go">
          <input className="input" type="email" placeholder={relay ? 'a mailbox you read, e.g. desk@esbpowerline.com' : f.user || 'same as the sending address'} value={f.replyTo} onChange={(e) => up('replyTo', e.target.value)} />
        </Field>
        {relay && !f.imapHost.trim() && (
          <div className="callout"><Icon name="info" size={14} /><span>{p.label} only sends: it has no inbox. Replies go to {f.replyTo.trim() || f.user.trim() || 'the sending address'}. To have replies and bounces read here, give that mailbox's IMAP server below.</span></div>
        )}
        <div className="grid2">
          <Field label="Inbox server (IMAP) — where replies and bounces are read">
            <input className="input" placeholder={relay ? 'e.g. imap.gmail.com (optional)' : `${imapGuess} (automatic)`} value={f.imapHost} onChange={(e) => up('imapHost', e.target.value)} />
          </Field>
          {(relay || f.imapHost.trim()) && (
            <Field label="Inbox user (if not the sending address)">
              <input className="input" autoComplete="off" spellCheck={false} placeholder={f.replyTo.trim() || f.user.trim()} value={f.imapUser} onChange={(e) => up('imapUser', e.target.value)} />
            </Field>
          )}
        </div>
        {(relay || f.imapHost.trim()) && f.imapHost.trim() && (
          <Field label={mail?.hasImapPassword ? 'Inbox password — saved; type a new one to replace it' : `Inbox password${relay ? '' : ' (only if it differs from the one above)'}`}>
            <input className="input" type="password" autoComplete="new-password" value={imapPassword} onChange={(e) => setImapPassword(e.target.value)} />
          </Field>
        )}
        <p className="hint">The inbox is opened read-only: nothing is marked read, moved or deleted, and only answers from people this desk emailed are looked at.{f.provider === 'gmail' ? ' In Gmail, IMAP is on by default for Workspace; for a personal account check Settings → Forwarding and POP/IMAP.' : ''}</p>
        <div className="or-pace-link" data-testid="or-sender-pace">
          <Icon name="sliders" size={14} />
          <span>{pacing ? `Sending pace: ${pacing.dailyLimit} a day · ${fmtGapRange(pacing.minDelaySec, pacing.maxDelaySec)} apart · ${pacing.window?.enabled ? `${fmtWallClock(pacing.window.from)}–${fmtWallClock(pacing.window.to)}` : 'any hour'}` : 'Sending pace'}</span>
          <button type="button" className="or-link-btn" onClick={() => { onClose(); ui.set({ sheet: 'autopilot' }) }}>Change in Sending settings</button>
        </div>
        <p className="hint">Staying well under the service's limit keeps the address out of spam folders. The same address is never emailed twice within 7 days. Addresses that bounced before are never written to again; there is no "does this mailbox exist" probe (servers treat it as abuse), so check role addresses (info@, admin@) by hand.</p>
        {error && <div className="callout warn"><Icon name="info" size={14} /><span>{error}</span></div>}
      </div>
    </Dialog>
  )
}
