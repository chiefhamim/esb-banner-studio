// Connections: YouTube (the owner's own Google Cloud client, signed in through the browser on this PC) and the Facebook
// Page already connected in Editorial. Nothing secret is shown or returned; main holds the tokens sealed with the OS.
import { useCallback, useEffect, useState } from 'react'
import { getFacebook } from '../../editorial/facebook'

interface Status {
  ok: boolean
  dryRun?: boolean
  credentials?: { encryption: boolean; youtube: { clientSaved: boolean; connected: boolean; scopes: string[]; channelTitle: string | null }; facebook: { connected: boolean; pageId: string | null; pageName: string | null } }
  engine?: { ytUploadsToday: number; ytDailyLimit: number; reels24h: number; reelsLimit: number }
  error?: string
}
type Esb = Record<string, (...a: unknown[]) => Promise<Status & { metaAppId?: string | null }>>
const esb = () => (window as unknown as { esb?: Esb }).esb

export function usePublishStatus() {
  const [status, setStatus] = useState<Status | null>(null)
  const refresh = useCallback(async () => { try { setStatus((await esb()?.vpubStatus?.()) ?? { ok: false, error: 'Publishing needs the desktop app.' }) } catch (e) { setStatus({ ok: false, error: (e as Error).message }) } }, [])
  useEffect(() => { void refresh() }, [refresh])
  return { status, setStatus, refresh }
}

export function PublishConnections() {
  const { status, setStatus } = usePublishStatus()
  const [clientId, setClientId] = useState('')
  const [secret, setSecret] = useState('')
  const [captions, setCaptions] = useState(false)
  const [appId, setAppId] = useState('')
  const [busy, setBusy] = useState('')
  const [msg, setMsg] = useState('')
  const [err, setErr] = useState('')
  const [help, setHelp] = useState(false)

  useEffect(() => { void esb()?.vpubConfigGet?.().then((r) => setAppId(r?.metaAppId ?? '')).catch(() => {}) }, [])

  const run = async (label: string, fn: () => Promise<Status | undefined> | undefined, done?: string) => {
    setBusy(label); setErr(''); setMsg('')
    try {
      const r = await fn()
      if (r && r.ok === false) setErr(r.error ?? 'That did not work.')
      else { if (r) setStatus(r); if (done) setMsg(done) }
    } catch (e) { setErr((e as Error).message) } finally { setBusy('') }
  }

  if (!status) return <p className="vw-hint">Checking…</p>
  if (!status.ok && !status.credentials) return <p className="vw-hint vw-error" role="alert">{status.error ?? 'Publishing is not available.'}</p>
  const c = status.credentials!
  const fb = getFacebook()
  const hasCaptionScope = c.youtube.scopes.some((s) => s.endsWith('/youtube.force-ssl'))

  return (
    <div className="vw-pub-conn">
      {status.dryRun && <p className="vw-hint vw-warn" role="note">TEST RUN: every connection points at a fake local server. Nothing leaves this PC.</p>}
      {!c.encryption && <p className="vw-hint vw-error" role="alert">This computer cannot encrypt saved tokens, so nothing can be connected here.</p>}

      <section className="vw-sec" aria-label="YouTube">
        <div className="vw-sec-head"><h4 className="vw-sec-title">YouTube</h4><span className={`vw-tag${c.youtube.connected ? ' ok' : ''}`}>{c.youtube.connected ? `Connected${c.youtube.channelTitle ? ': ' + c.youtube.channelTitle : ''}` : 'Not connected'}</span></div>
        <p className="vw-hint">Uploads go to your own channel through a Google Cloud app you create once. Posts start private or unlisted until you choose otherwise.</p>
        <div className="vw-transcript-actions"><button type="button" className="btn xs" onClick={() => setHelp((h) => !h)} aria-expanded={help}>{help ? 'Hide the steps' : 'Show the setup steps'}</button></div>
        {help && (
          <ol className="vw-pub-steps">
            <li>Open <b>console.cloud.google.com</b> and create a project (any name).</li>
            <li>APIs and services → Library → enable <b>YouTube Data API v3</b>.</li>
            <li>OAuth consent screen → type <b>External</b>. Add your own Google account under <b>Test users</b>, and the scope <b>youtube.upload</b>.</li>
            <li>While the app is in <b>Testing</b>, Google can expire the sign-in after 7 days. Choose <b>Publish app</b> on the consent screen to stop that (it does not need a review for your own use).</li>
            <li>Credentials → Create credentials → OAuth client ID → type <b>Desktop app</b>. Copy the client ID and secret into the boxes below.</li>
          </ol>
        )}
        <label className="vw-cut-row"><span className="vw-cut-label">Client ID</span><input type="text" autoComplete="off" spellCheck={false} value={clientId} onChange={(e) => setClientId(e.target.value)} placeholder={c.youtube.clientSaved ? 'Saved (paste to replace)' : '…apps.googleusercontent.com'} aria-label="Google OAuth client ID" /></label>
        <label className="vw-cut-row"><span className="vw-cut-label">Secret</span><input type="password" autoComplete="off" value={secret} onChange={(e) => setSecret(e.target.value)} placeholder={c.youtube.clientSaved ? 'Saved' : 'Client secret'} aria-label="Google OAuth client secret" /></label>
        <div className="vw-transcript-actions">
          <button type="button" className="btn xs" disabled={!!busy || !clientId.trim()} onClick={() => void run('client', () => esb()?.vpubYtClient?.({ clientId, clientSecret: secret }), 'Saved. Now connect.').then(() => { setClientId(''); setSecret('') })}>Save client</button>
          <button type="button" className="btn xs primary" disabled={!!busy || !c.youtube.clientSaved} onClick={() => void run('connect', () => esb()?.vpubYtConnect?.({ captions }), 'Connected.')}>{busy === 'connect' ? 'Waiting for the browser…' : c.youtube.connected ? 'Connect again' : 'Connect YouTube'}</button>
          {c.youtube.connected && <button type="button" className="btn xs" disabled={!!busy} onClick={() => void run('forget', () => esb()?.vpubForget?.('youtube'), 'Disconnected.')}>Disconnect</button>}
        </div>
        <label className="vw-cut-row vw-check"><input type="checkbox" checked={captions} onChange={(e) => setCaptions(e.target.checked)} /><span>Also allow uploading captions (asks for one more permission)</span></label>
        {c.youtube.connected && captions && !hasCaptionScope && <p className="vw-hint">Press Connect again to grant the captions permission.</p>}
        <p className="vw-hint">Today: {status.engine?.ytUploadsToday ?? 0} of {status.engine?.ytDailyLimit ?? 100} uploads (Google’s daily allowance for this app).</p>
      </section>

      <section className="vw-sec" aria-label="Facebook">
        <div className="vw-sec-head"><h4 className="vw-sec-title">Facebook Page</h4><span className={`vw-tag${c.facebook.connected ? ' ok' : ''}`}>{c.facebook.connected ? `Connected: ${c.facebook.pageName ?? c.facebook.pageId}` : 'Not connected'}</span></div>
        <p className="vw-hint">Uses the Page token you already saved for banner posts (Editorial → Account). It needs <b>pages_show_list</b>, <b>pages_read_engagement</b> and <b>pages_manage_posts</b>. Reels start as a draft.</p>
        <div className="vw-transcript-actions">
          <button type="button" className="btn xs primary" disabled={!!busy || !fb} onClick={() => void run('fb', () => esb()?.vpubFbUsePage?.({ pageId: fb!.pageId, token: fb!.token, pageName: fb!.pageName }), 'The Page is connected for video.')}>{c.facebook.connected ? 'Use the saved Page again' : 'Use the Page saved in Editorial'}</button>
          {c.facebook.connected && <button type="button" className="btn xs" disabled={!!busy} onClick={() => void run('fbforget', () => esb()?.vpubForget?.('facebook'), 'Disconnected.')}>Disconnect</button>}
        </div>
        {!fb && <p className="vw-hint">No Page is saved in Editorial yet. Connect it there first.</p>}
        <label className="vw-cut-row"><span className="vw-cut-label">Meta app ID</span><input type="text" inputMode="numeric" value={appId} onChange={(e) => setAppId(e.target.value.replace(/\D/g, ''))} placeholder="Only for feed videos" aria-label="Meta app ID" /></label>
        <div className="vw-transcript-actions"><button type="button" className="btn xs" disabled={!!busy} onClick={() => void run('app', async () => { const r = await esb()?.vpubConfig?.({ metaAppId: appId }); return r?.ok === false ? r : undefined }, 'Saved.')}>Save app ID</button></div>
        <p className="vw-hint">Reels today: {status.engine?.reels24h ?? 0} of {status.engine?.reelsLimit ?? 30} in the last 24 hours (Facebook’s limit per Page).</p>
      </section>

      {err && <p className="vw-hint vw-error" role="alert">{err}</p>}
      {msg && <p className="vw-hint" role="status">{msg}</p>}
    </div>
  )
}
