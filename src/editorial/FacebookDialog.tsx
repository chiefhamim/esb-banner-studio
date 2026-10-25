// Connect a Facebook Page: paste the Page ID and a Page access token, check them against Facebook, keep them on this
// machine. The token is never shown again once saved (only the Page name), and never leaves for anywhere but facebook.com.

import { useState } from 'react'
import { Dialog, Field } from '../ui/controls'
import { Icon } from '../ui/Icon'
import { clearFacebook, getFacebook, saveFacebook, verifyFacebook } from './facebook'

export function FacebookDialog({ onClose, onChange }: { onClose: () => void; onChange: (connected: boolean) => void }) {
  const current = getFacebook()
  const [pageId, setPageId] = useState(current?.pageId ?? '')
  const [token, setToken] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const connect = async () => {
    setBusy(true); setError(null)
    const t = token.trim() || current?.token || ''
    const r = await verifyFacebook(pageId.trim(), t)
    setBusy(false)
    if (!r.ok) { setError(r.error); return }
    saveFacebook({ pageId: pageId.trim(), token: t, pageName: r.name })
    onChange(true)
    onClose()
  }

  return (
    <Dialog
      title="Connect your Facebook Page"
      kicker="FACEBOOK"
      width={560}
      onClose={onClose}
      footer={
        <>
          {current && <button type="button" className="btn" onClick={() => { clearFacebook(); onChange(false); onClose() }}>Disconnect</button>}
          <div className="spacer" />
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="button" className="btn primary" onClick={() => void connect()} disabled={busy || !/^\d{5,}$/.test(pageId.trim()) || !(token.trim() || current)}>
            <Icon name={busy ? 'refresh' : 'check'} size={14} /><span>{busy ? 'Checking…' : 'Check & connect'}</span>
          </button>
        </>
      }
    >
      <div className="stack">
        {current && <div className="callout good"><Icon name="check" size={15} /><span>Connected to <b>{current.pageName || current.pageId}</b>. Paste a new token below only to replace it.</span></div>}
        <Field label="Page ID">
          <input className="input mono" inputMode="numeric" value={pageId} onChange={(e) => setPageId(e.target.value)} placeholder="e.g. 1234567890" spellCheck={false} />
        </Field>
        <Field label="Page access token">
          <input className="input mono" type="password" autoComplete="off" value={token} onChange={(e) => setToken(e.target.value)} placeholder={current ? 'Saved — leave empty to keep it' : 'Paste the token'} spellCheck={false} />
        </Field>
        {error && <div className="callout warn" role="alert"><Icon name="info" size={15} /><span>{error}</span></div>}
        <p className="hint">
          In Meta for Developers, create an app, add the Page, and generate a Page access token with <b>pages_manage_posts</b>, <b>pages_read_engagement</b> and <b>pages_manage_engagement</b> (the last one lets the Studio add the article link as the first comment).
          It is kept only on this computer and sent only to facebook.com, with each post.
        </p>
      </div>
    </Dialog>
  )
}
