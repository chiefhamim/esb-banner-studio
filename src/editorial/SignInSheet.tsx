// Sign in to esbpowerline.com with a newsroom account — the same email and password as the site's staff login —
// and, once signed in, open the site's CMS as that editor. The Studio keeps the session the site's auth service
// issues; the password is sent to that service and nowhere else, and is never stored.

import { useEffect, useRef, useState } from 'react'
import type * as React from 'react'
import { createPortal } from 'react-dom'
import { useEditorialStore } from './editorialStore'
import { SITE_BASE_URL, openSiteCms } from './siteApi'
import { runConnectionCheck } from './siteConnect'
import type { ConnectionCheck } from './siteConnect'
import { Icon } from '../ui/Icon'
import { FacebookDialog } from './FacebookDialog'
import { getFacebook, verifyFacebook } from './facebook'
import siteIcon from '../assets/images/site/site-icon.png'

/** The role colours esbpowerline.com uses (lib/constants.ts ROLES), so the badge matches the site's own RoleBadge. */
const ROLE_COLOR: Record<string, string> = { SUPER_ADMIN: '#ff3b6f', ADMIN: '#8b5cf6', EDITOR: '#3b82f6', AUTHOR: '#10b981', CONTRIBUTOR: '#f59e0b' }
const ROLE_LABEL: Record<string, string> = { SUPER_ADMIN: 'Super admin', ADMIN: 'Admin', EDITOR: 'Editor', AUTHOR: 'Author', CONTRIBUTOR: 'Contributor' }
const isDesktop = () => typeof window !== 'undefined' && !!(window as unknown as { esb?: { openSiteAs?: unknown } }).esb?.openSiteAs

export function SignInSheet({ onClose, onToast }: { onClose: () => void; onToast: (m: string) => void }) {
  const session = useEditorialStore((s) => s.staffSession)
  const loginStaff = useEditorialStore((s) => s.loginStaff)
  const logoutStaff = useEditorialStore((s) => s.logoutStaff)
  const siteStatus = useEditorialStore((s) => s.siteStatus)
  const [email, setEmail] = useState(session?.email ?? '')
  const [password, setPassword] = useState('')
  const [show, setShow] = useState(false)
  const [busy, setBusy] = useState(false)
  const [opening, setOpening] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [checks, setChecks] = useState<ConnectionCheck[] | null>(null)
  const [checking, setChecking] = useState(false)
  const emailRef = useRef<HTMLInputElement>(null)
  // the Facebook Page connection: checked against Facebook each time the sheet opens, and on demand
  const [fb, setFb] = useState(() => getFacebook())
  const [fbState, setFbState] = useState<{ s: 'idle' | 'checking' | 'ok' | 'bad'; msg?: string }>({ s: 'idle' })
  const [fbDialog, setFbDialog] = useState(false)
  const checkFb = async (cfg = fb, fresh = false) => {
    if (!cfg) { setFbState({ s: 'idle' }); return }
    setFbState({ s: 'checking' })
    const r = await verifyFacebook(cfg.pageId, cfg.token, fresh)
    setFbState(r.ok ? { s: 'ok', msg: r.name } : { s: 'bad', msg: r.error })
  }
  useEffect(() => { void checkFb() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // the website connection, checked for real each time the sheet opens and on demand: the site answers, the sign-in
  // service is up, this session is still accepted, the role may write, the articles table reads, uploads are allowed
  const [siteCheck, setSiteCheck] = useState<{ s: 'idle' | 'checking' | 'ok' | 'bad'; checks: ConnectionCheck[]; at?: Date }>({ s: 'idle', checks: [] })
  const checkSite = async () => {
    setSiteCheck((c) => ({ ...c, s: 'checking' }))
    const [checks] = await Promise.all([
      runConnectionCheck(useEditorialStore.getState().staffSession, undefined, 'site').catch(() => [] as ConnectionCheck[]),
      useEditorialStore.getState().checkConnection().catch(() => {}),
    ])
    setSiteCheck({ s: checks.length && !checks.some((c) => c.status === 'fail') ? 'ok' : 'bad', checks, at: new Date() })
  }
  useEffect(() => { if (session) void checkSite() }, []) // eslint-disable-line react-hooks/exhaustive-deps
  const siteBad = siteCheck.checks.filter((c) => c.status === 'fail')

  // Focus the email field once, when the sheet opens. This used to sit in an effect keyed on `onClose` — a new function
  // on every parent render — so a status refresh or a toast moved the cursor back to the email field while the editor
  // was typing the password.
  const closeRef = useRef(onClose)
  useEffect(() => { closeRef.current = onClose }, [onClose])
  useEffect(() => {
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); closeRef.current() } }
    window.addEventListener('keydown', key, true)
    return () => window.removeEventListener('keydown', key, true)
  }, [])
  useEffect(() => {
    if (session) return
    const t = setTimeout(() => { if (!document.activeElement?.closest('.signin')) emailRef.current?.focus() }, 60)
    return () => clearTimeout(t)
  }, [session])

  const submit = async () => {
    if (busy) return
    setBusy(true)
    setError(null)
    const res = await loginStaff(email, password)
    setBusy(false)
    if (res.success) { setPassword(''); onToast('Signed in to esbpowerline.com') }
    else setError(res.error || 'Sign-in failed.')
  }

  const openCms = async (path: string) => {
    setOpening(true)
    try {
      const how = await openSiteCms(session, path)
      onToast(how === 'signed-in' ? 'Opened the CMS — signed in as you' : 'Opened the CMS in your browser — sign in there')
    } catch {
      setError('Could not open the CMS window.')
    } finally {
      setOpening(false)
    }
  }

  // every link a publish depends on, checked live; the result is what each service actually answered
  const check = async () => {
    setChecking(true)
    setChecks([])
    try { setChecks(await runConnectionCheck(session, setChecks)) } finally { setChecking(false) }
  }
  const failed = checks?.filter((c) => c.status === 'fail').length ?? 0

  const initials = (session?.name || session?.email || '?').split(/[\s@.]+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join('')
  const expires = session?.expiresAt ? new Date(session.expiresAt * 1000) : null

  return createPortal(
    <div className="modal-bg" onPointerDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="dialog signin" role="dialog" aria-modal="true" aria-label={session ? 'esbpowerline.com account' : 'Sign in to esbpowerline.com'}>
        <button type="button" className="signin-close ibtn" aria-label="Close" onClick={onClose}><Icon name="x" size={15} /></button>

        {!session ? (
          <form className="signin-body" onSubmit={(e) => { e.preventDefault(); void submit() }}>
            <img className="signin-mark" src={siteIcon} alt="" />
            <h2>Sign in to esbpowerline.com</h2>
            <p className="signin-sub">Use your newsroom account — the same email and password as the site's staff sign-in.</p>

            <label className="signin-field">
              <span>Email</span>
              <input ref={emailRef} type="email" name="email" autoComplete="username" inputMode="email" spellCheck={false} placeholder="name@esbpowerline.com" value={email} onChange={(e) => setEmail(e.target.value)} required />
            </label>
            <label className="signin-field">
              <span>Password</span>
              <div className="signin-pass">
                <input type={show ? 'text' : 'password'} name="password" autoComplete="current-password" placeholder="Your password" value={password} onChange={(e) => setPassword(e.target.value)} required />
                <button type="button" className="signin-eye" onClick={() => setShow((v) => !v)} aria-label={show ? 'Hide password' : 'Show password'} aria-pressed={show}>
                  <Icon name={show ? 'eyeOff' : 'eye'} size={15} />
                </button>
              </div>
            </label>

            {error && <div className="signin-error" role="alert"><Icon name="info" size={14} /><span>{error}</span></div>}

            <button type="submit" className="btn primary signin-submit" disabled={busy || !email.trim() || !password}>
              {busy ? <><span className="signin-spin" aria-hidden />Signing in…</> : 'Sign in'}
            </button>
            <div className="signin-foot">
              <span>Your password goes only to the site's sign-in service. The Studio keeps the session, not the password.</span>
              <a href={`${SITE_BASE_URL}/login`} target="_blank" rel="noopener noreferrer">Forgot password?</a>
            </div>
          </form>
        ) : (
          <div className="acct">
            <header className="acct-head">
              <div className="signin-avatar" aria-hidden>{initials}</div>
              <div className="acct-id">
                <div className="acct-name"><h2>{session.name}</h2><span className="acct-role" style={{ ['--role' as string]: (session.role && ROLE_COLOR[session.role]) || '#6b7280' } as React.CSSProperties}>{session.role ? ROLE_LABEL[session.role] ?? session.role : 'Staff'}</span></div>
                <p>{session.email}</p>
              </div>
            </header>

            <section className="acct-sec" aria-label="Connections">
              <h3>Connections</h3>

              <div className={'acct-card ' + (siteCheck.s === 'checking' ? 'checking' : siteCheck.s === 'bad' || !siteStatus.connected ? 'bad' : 'ok')}>
                <img className="acct-logo" src={siteIcon} alt="" />
                <div className="acct-main">
                  <div className="acct-title"><b>esbpowerline.com</b><span className={'acct-pill ' + (siteCheck.s === 'checking' ? 'checking' : siteCheck.s === 'bad' || !siteStatus.connected ? 'bad' : 'ok')}><i />{siteCheck.s === 'checking' ? 'Checking…' : !siteStatus.connected ? 'Unreachable' : siteCheck.s === 'bad' ? 'Needs attention' : `Connected · ${siteStatus.latencyMs} ms`}</span></div>
                  <p>CMS and article database · signed in as {session.email}</p>
                  {siteCheck.s === 'bad' && siteBad.map((c) => <p key={c.id} className="acct-err">{c.label}: {c.detail}</p>)}
                  {siteCheck.at && siteCheck.s !== 'checking' && <p className="acct-fine">{siteCheck.checks.filter((c) => c.status === 'ok').length} checks passed{siteCheck.checks.some((c) => c.status === 'skip') ? ', ' + siteCheck.checks.filter((c) => c.status === 'skip').length + ' skipped' : ''} · {siteCheck.at.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</p>}
                  {expires && <p className="acct-fine">Session renews automatically · current token until {expires.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</p>}
                  <div className="acct-actions">
                    <button type="button" className="btn sm primary" onClick={() => void openCms('/cms/articles/new')} disabled={opening}><Icon name="externalLink" size={13} /><span>{opening ? 'Opening…' : 'New article'}</span></button>
                    <button type="button" className="btn sm" onClick={() => void openCms('/cms')} disabled={opening}><Icon name="globe" size={13} /><span>CMS dashboard</span></button>
                    <button type="button" className="btn sm" onClick={() => void checkSite()} disabled={siteCheck.s === 'checking'}><Icon name="refresh" size={13} className={siteCheck.s === 'checking' ? 'spin' : ''} /><span>{siteCheck.s === 'checking' ? 'Checking…' : 'Check again'}</span></button>
                  </div>
                </div>
              </div>

              <div className={'acct-card ' + (!fb ? 'none' : fbState.s)}>
                {fb ? (
                  <img className="acct-logo round" src={`https://graph.facebook.com/${fb.pageId}/picture?type=square`} alt="" onError={(e) => { (e.currentTarget as HTMLImageElement).style.visibility = 'hidden' }} />
                ) : (
                  <span className="acct-logo fbmark" aria-hidden>f</span>
                )}
                <div className="acct-main">
                  <div className="acct-title">
                    <b>{fb ? fbState.s === 'ok' && fbState.msg ? fbState.msg : fb.pageName || 'Facebook Page' : 'Facebook Page'}</b>
                    <span className={'acct-pill ' + (!fb ? 'none' : fbState.s)}><i />{!fb ? 'Not connected' : fbState.s === 'checking' ? 'Checking…' : fbState.s === 'ok' ? 'Connected' : fbState.s === 'bad' ? 'Needs attention' : 'Saved'}</span>
                  </div>
                  <p>{fb ? `Page ID ${fb.pageId} · posts the 4:5 banner when you publish` : 'Connect the ESB Page to post the banner to Facebook when you publish.'}</p>
                  {fb && fbState.s === 'bad' && fbState.msg && <p className="acct-err">{fbState.msg}</p>}
                  {fb && fbState.s !== 'bad' && <p className="acct-fine">{fb.permanent ? 'Token does not expire.' : 'Token from the Graph API Explorer: it can stop within an hour. Open Change Page, then “Make it permanent”.'}</p>}
                  <div className="acct-actions">
                    <button type="button" className={'btn sm' + (fb ? '' : ' primary')} onClick={() => setFbDialog(true)}><Icon name="link" size={13} /><span>{fb ? 'Change Page or token' : 'Connect Page'}</span></button>
                    {fb && <button type="button" className="btn sm" onClick={() => void checkFb(fb, true)} disabled={fbState.s === 'checking'}><Icon name="refresh" size={13} /><span>{fbState.s === 'checking' ? 'Checking…' : 'Check again'}</span></button>}
                  </div>
                </div>
              </div>
            </section>

            <section className="acct-sec" aria-label="Connection check">
              <div className="acct-sec-head">
                <h3>Connection check</h3>
                {checks && !checking && <em className={failed ? 'bad' : 'good'}>{failed ? `${failed} to fix` : 'All clear'}</em>}
                <button type="button" className="btn sm conn-run" onClick={() => void check()} disabled={checking}>{checking ? 'Checking…' : checks ? 'Run again' : 'Run check'}</button>
              </div>
              {checks && checks.length > 0 ? (
                <ul className="conn-list" aria-live="polite">
                  {checks.map((c) => (
                    <li key={c.id} className={'conn-row ' + c.status} data-check={c.id}>
                      <Icon name={c.status === 'ok' ? 'check' : c.status === 'fail' ? 'x' : 'minus'} size={12} />
                      <span className="conn-label">{c.label}</span>
                      <span className="conn-detail">{c.detail}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="conn-hint">Tests the site, your sign-in and role, the articles table, media upload and your AI key. Reads only; nothing is published.</p>
              )}
            </section>

            {error && <div className="signin-error" role="alert"><Icon name="info" size={14} /><span>{error}</span></div>}
            <footer className="acct-foot">
              <p>{isDesktop() ? 'The CMS opens in its own window, already signed in as you.' : 'This preview cannot share your session; the CMS will ask you to sign in there.'}</p>
              <button type="button" className="btn sm ghost signin-signout" onClick={() => { logoutStaff(); onToast('Signed out of esbpowerline.com') }}>Sign out</button>
            </footer>
          </div>
        )}
      </div>
      {fbDialog && <FacebookDialog onClose={() => setFbDialog(false)} onChange={() => { const c = getFacebook(); setFb(c); void checkFb(c) }} />}
    </div>,
    document.body,
  )
}
