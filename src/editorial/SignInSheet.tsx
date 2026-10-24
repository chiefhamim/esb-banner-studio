// Sign in to esbpowerline.com with a newsroom account — the same email and password as the site's staff login —
// and, once signed in, open the site's CMS as that editor. The Studio keeps the session the site's auth service
// issues; the password is sent to that service and nowhere else, and is never stored.

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useEditorialStore } from './editorialStore'
import { SITE_BASE_URL, openSiteCms } from './siteApi'
import { runConnectionCheck } from './siteConnect'
import type { ConnectionCheck } from './siteConnect'
import { Icon } from '../ui/Icon'
import siteIcon from '../assets/images/site/site-icon.png'

const ROLE_LABEL: Record<string, string> = { SUPER_ADMIN: 'Super admin', ADMIN: 'Admin', EDITOR: 'Editor', AUTHOR: 'Author', CONTRIBUTOR: 'Contributor' }
const isDesktop = () => typeof window !== 'undefined' && !!(window as unknown as { esb?: { openSiteAs?: unknown } }).esb?.openSiteAs

export function SignInSheet({ onClose, onToast }: { onClose: () => void; onToast: (m: string) => void }) {
  const session = useEditorialStore((s) => s.staffSession)
  const loginStaff = useEditorialStore((s) => s.loginStaff)
  const logoutStaff = useEditorialStore((s) => s.logoutStaff)
  const [email, setEmail] = useState(session?.email ?? '')
  const [password, setPassword] = useState('')
  const [show, setShow] = useState(false)
  const [busy, setBusy] = useState(false)
  const [opening, setOpening] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const apiKey = useEditorialStore((s) => s.apiKey)
  const [checks, setChecks] = useState<ConnectionCheck[] | null>(null)
  const [checking, setChecking] = useState(false)
  const emailRef = useRef<HTMLInputElement>(null)

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
    try { setChecks(await runConnectionCheck(session, apiKey, setChecks)) } finally { setChecking(false) }
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
          <div className="signin-body">
            <div className="signin-avatar" aria-hidden>{initials}</div>
            <h2>{session.name}</h2>
            <p className="signin-sub">{session.email}</p>
            <div className="signin-badges">
              <span className="signin-badge ok"><i />Connected to esbpowerline.com</span>
              <span className="signin-badge">{session.role ? ROLE_LABEL[session.role] ?? session.role : 'Role confirmed by the site'}</span>
            </div>

            <div className="signin-actions">
              <button type="button" className="btn primary signin-submit" onClick={() => void openCms('/cms/articles/new')} disabled={opening}>
                <Icon name="externalLink" size={14} />
                <span>{opening ? 'Opening…' : 'New article in the CMS'}</span>
              </button>
              <button type="button" className="btn signin-wide" onClick={() => void openCms('/cms')} disabled={opening}>
                <Icon name="globe" size={14} />
                <span>Open the CMS dashboard</span>
              </button>
            </div>
            <p className="signin-note">
              {isDesktop()
                ? `The CMS opens in its own window, already signed in as ${session.name.split(' ')[0]}.`
                : 'This browser preview cannot share your session with the site; the CMS will ask you to sign in there. The desktop app opens it signed in.'}
              {expires && <> Session renews automatically (current token until {expires.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}).</>}
            </p>
            <div className="conn">
              <div className="conn-head">
                <span>Connection check</span>
                {checks && !checking && <em className={failed ? 'bad' : 'good'}>{failed ? `${failed} to fix` : 'All clear'}</em>}
                <button type="button" className="btn sm conn-run" onClick={() => void check()} disabled={checking}>{checking ? 'Checking…' : checks ? 'Run again' : 'Run check'}</button>
              </div>
              {checks && checks.length > 0 && (
                <ul className="conn-list" aria-live="polite">
                  {checks.map((c) => (
                    <li key={c.id} className={'conn-row ' + c.status} data-check={c.id}>
                      <Icon name={c.status === 'ok' ? 'check' : c.status === 'fail' ? 'x' : 'minus'} size={12} />
                      <span className="conn-label">{c.label}</span>
                      <span className="conn-detail">{c.detail}</span>
                    </li>
                  ))}
                </ul>
              )}
              {!checks && <p className="conn-hint">Checks the site, sign-in, your role, the articles table, media upload and your AI key — reads only, nothing is published.</p>}
            </div>

            {error && <div className="signin-error" role="alert"><Icon name="info" size={14} /><span>{error}</span></div>}
            <button type="button" className="btn ghost signin-signout" onClick={() => { logoutStaff(); onToast('Signed out of esbpowerline.com') }}>Sign out</button>
          </div>
        )}
      </div>
    </div>,
    document.body,
  )
}
