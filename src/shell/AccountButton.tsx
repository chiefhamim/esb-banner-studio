// The one account entry: an avatar at the same place in every desk header (before the desk's output button). It
// opens the one account sheet (SignInSheet: sign-in, Connections — esbpowerline.com, Facebook Page, AI, Mail sender —
// and the connection check). Signed out it is a plain round avatar, not a "Sign in" word.

import { useState } from 'react'
import { useEditorialStore } from '../editorial/editorialStore'
import { UserAvatar } from '../editorial/avatar'
import { SignInSheet } from '../editorial/SignInSheet'
import { Icon } from '../ui/Icon'

export function AccountButton({ onOpen, onToast }: { onOpen?: () => void; onToast?: (m: string) => void }) {
  const session = useEditorialStore((s) => s.staffSession)
  const [open, setOpen] = useState(false)
  return (
    <>
      <button type="button" className={'ed-account in' + (session ? '' : ' anon')} onClick={onOpen ?? (() => setOpen(true))}
        aria-label={session ? `Account — ${session.name || session.email}` : 'Account — sign in'}
        data-tip={session ? `${session.name || session.email} · ${session.email} — account and connections` : 'Sign in with your esbpowerline.com newsroom account'}>
        {session
          ? <UserAvatar name={session.name || session.email} className="ed-avatar" />
          : <span className="ed-avatar ed-avatar-anon" aria-hidden><Icon name="user" size={15} /></span>}
      </button>
      {open && <SignInSheet onClose={() => setOpen(false)} onToast={onToast ?? (() => undefined)} />}
    </>
  )
}
