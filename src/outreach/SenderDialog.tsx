// The sending account. The app password goes to the main process once, is encrypted there with the operating
// system's keychain and is never shown or read back; the field stays empty after saving.
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

export function SenderDialog({ onClose }: { onClose: () => void }) {
  const mail = useOutreachStore((s) => s.mail)
  const refresh = useOutreachStore((s) => s.refreshMail)
  const addLog = useOutreachStore((s) => s.addLog)
  const cur = mail?.settings
  const pacing = useEngineStore((x) => x.settings)
  const [f, setF] = useState({
    name: cur?.name ?? 'ESB Power Line',
    user: cur?.user ?? '',
    host: cur?.host ?? 'smtp.gmail.com',
    imapHost: cur?.imapHost ?? '',
    port: cur?.port ?? 587,
  })
  useEffect(() => { if (!pacing) void engineClient.settings() }, [pacing])
  const ui = useOutreachUi()
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const up = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }))

  const save = async () => {
    const b = window.esb
    if (!b?.outreachSave) return
    // the main process drops a saved password whenever the account or either server changes, so ask for it here rather
    // than saving a sender that silently has none
    const moved = !!cur && (cur.user !== f.user.trim() || cur.host !== f.host.trim() || (cur.imapHost || '') !== f.imapHost.trim().toLowerCase() || cur.port !== Number(f.port))
    if (mail?.hasPassword && moved && !password.trim()) { setError('The account or a server changed, so type the app password again. It is only kept for the servers it was saved with.'); return }
    // the mailer's file still carries a pacing triple (its validator wants one); it is the engine's, untouched
    const dailyLimit = pacing?.dailyLimit ?? cur?.dailyLimit ?? 100
    const minDelaySec = pacing?.minDelaySec ?? cur?.minDelaySec ?? 180
    const maxDelaySec = pacing?.maxDelaySec ?? cur?.maxDelaySec ?? 480
    setSaving(true)
    setError(null)
    const r = await b.outreachSave({ name: f.name, user: f.user.trim(), host: f.host.trim(), imapHost: f.imapHost.trim(), port: Number(f.port), dailyLimit, minDelaySec, maxDelaySec }, password || undefined)
    setSaving(false)
    if (!r.ok) { setError(r.error); return }
    addLog('info', `Sender saved: ${f.user}${password ? ' (app password stored, encrypted)' : ''}`)
    await refresh()
    onClose()
  }

  return (
    <Dialog
      title="Sender"
      kicker="OUTREACH"
      width={520}
      onClose={onClose}
      footer={<>
        {mail?.hasPassword && <button type="button" className="btn" onClick={async () => { await window.esb?.outreachForgetPassword?.(); await refresh(); addLog('info', 'App password removed') }}>Remove password</button>}
        <div className="spacer" />
        <button type="button" className="btn" onClick={onClose}>Cancel</button>
        <button type="button" className="btn primary" onClick={() => void save()} disabled={saving || !f.user.trim()}>{saving ? 'Saving' : 'Save'}</button>
      </>}
    >
      <div className="stack or-sender-form" style={{ gap: 12 }}>
        <div className="grid2">
          <Field label="Name recipients see"><input className="input" value={f.name} onChange={(e) => up('name', e.target.value)} /></Field>
          <Field label="Sending address"><input className="input" type="email" placeholder="desk@esbpowerline.com" value={f.user} onChange={(e) => up('user', e.target.value)} /></Field>
        </div>
        <Field label={mail?.hasPassword ? 'App password — saved; type a new one to replace it' : 'Google app password'}>
          <input className="input" type="password" autoComplete="new-password" placeholder={mail?.hasPassword ? '•••• •••• •••• ••••  (saved)' : '16 letters, from myaccount.google.com → App passwords'} value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        <p className="hint">Not your Google password: an app password made for this computer (needs 2-step verification on the account). It is encrypted with Windows' own key store and never shown again.{mail && !mail.encryption ? ' This computer cannot encrypt it, so it cannot be saved here.' : ''}</p>
        <div className="grid2">
          <Field label="SMTP server"><input className="input" value={f.host} onChange={(e) => up('host', e.target.value)} /></Field>
          <Field label="Port"><input className="input" type="number" value={f.port} onChange={(e) => up('port', Number(e.target.value))} /></Field>
        </div>
        <Field label="Inbox server (IMAP) — where replies and bounces are read">
          <input className="input" placeholder={f.host.trim().toLowerCase() === 'smtp.gmail.com' ? 'imap.gmail.com (automatic)' : f.host.trim() ? `${f.host.trim().replace(/^smtp\./i, 'imap.')} (automatic)` : 'imap.example.com'} value={f.imapHost} onChange={(e) => up('imapHost', e.target.value)} />
        </Field>
        <p className="hint">Opened read-only with the same app password: nothing is marked read, moved or deleted, and only answers from people this desk emailed are looked at. In Gmail, IMAP is on by default for Workspace; for a personal account check Settings → Forwarding and POP/IMAP.</p>
        <div className="or-pace-link" data-testid="or-sender-pace">
          <Icon name="sliders" size={14} />
          <span>{pacing ? `Sending pace: ${pacing.dailyLimit} a day · ${fmtGapRange(pacing.minDelaySec, pacing.maxDelaySec)} apart · ${pacing.window?.enabled ? `${fmtWallClock(pacing.window.from)}–${fmtWallClock(pacing.window.to)}` : 'any hour'}` : 'Sending pace'}</span>
          <button type="button" className="or-link-btn" onClick={() => { onClose(); ui.set({ sheet: 'autopilot' }) }}>Change in Sending settings</button>
        </div>
        <p className="hint">A personal Gmail account allows about 500 a day; staying well under keeps the address out of spam folders. The same address is never emailed twice within 7 days.</p>
        {error && <div className="callout warn"><Icon name="info" size={14} /><span>{error}</span></div>}
      </div>
    </Dialog>
  )
}
