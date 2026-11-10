// One Help menu for every desk, always the last title in the menu bar: Welcome screen, Keyboard shortcuts, About.
// It used to live in Graphics alone (with the About dialog); the other desks had no Help at all. A desk with its own
// shortcut sheet (Video) passes `onShortcuts`; the others pass their groups and get the shared sheet, which always
// ends with the shortcuts that work everywhere.

import { DESKS, setDeskNav, useDeskNav } from '../shell/WorkspaceRail'
import { useCallback, useState, type ReactNode } from 'react'
import logoUrl from '../assets/images/esb-logo.png'
import { Dialog, type MenuDef } from './controls'
import { Icon } from './Icon'
import { DESK_LINES, WelcomeModal } from './WelcomeModal'

export interface ShortcutGroup { group: string; rows: [string, string][] }

/** Shortcuts that work on every desk. */
export const EVERYWHERE: ShortcutGroup = { group: 'Everywhere', rows: [['Ctrl + Q', 'Quit ESB AI Studio']] }

export function ShortcutsDialog({ groups, onClose }: { groups: ShortcutGroup[]; onClose: () => void }) {
  return (
    <Dialog title="Keyboard shortcuts" kicker="Reference" onClose={onClose} width={900}>
      <div className="keys-groups">
        {[...groups, EVERYWHERE].map((g) => (
          <section key={g.group}>
            <h4>{g.group}</h4>
            {g.rows.map(([k, d]) => <div key={k} className="krow"><span>{d}</span><kbd>{k}</kbd></div>)}
          </section>
        ))}
      </div>
    </Dialog>
  )
}

export function AboutDialog({ onClose }: { onClose: () => void }) {
  return (
    <Dialog title="About ESB AI Studio" kicker="ESB Power Line" onClose={onClose} width={560}>
      <div className="about2">
        <div className="about2-hero">
          <span className="logo-wrap big"><img src={logoUrl} alt="ESB Power Line" /></span>
          <div className="about2-stripe" aria-hidden><i /><i /><i /></div>
          <h3>ESB AI <span>Studio</span></h3>
          <p>Where stories are written, imagination is designed and reality is cut.</p>
          <span className="about2-ver">Version {__APP_VERSION__}</span>
        </div>
        <ol className="about2-desks">
          {DESKS.map((d) => (
            <li key={d.id}><Icon name={d.icon} size={16} /><b>{d.label}</b><small>{DESK_LINES[d.id]?.line}</small></li>
          ))}
        </ol>
        <p className="about2-credit">The News desk carries EnergyWatch by Yeasin Fiyaz.</p>
        <div className="about2-author">
          <div className="about-avatar">HR</div>
          <div className="about-meta">
            <span className="kicker">Designed &amp; engineered by</span>
            <b>Hamim Ruwayfi</b>
            <small>Editorial &amp; Newsroom Workflow</small>
          </div>
          <a className="about2-link" href="https://facebook.com/chiefhamim" target="_blank" rel="noopener noreferrer"><Icon name="link" size={14} />Facebook</a>
        </div>
        <p className="about2-foot">Fonts, artwork and templates are bundled; your AI keys, Facebook token and mail password are encrypted by Windows on this PC. AI, translation, mail and publishing only go out when you use them. © ESB Power Line, Express Broadcast and Communication Ltd.</p>
      </div>
    </Dialog>
  )
}

/** The shared Help menu and the dialogs it opens. Put `menu` last in the desk's MenuBar and render `dialogs`. */
export function useHelpMenu({ shortcuts = [], onShortcuts }: { shortcuts?: ShortcutGroup[]; onShortcuts?: () => void } = {}): { menu: MenuDef; dialogs: ReactNode } {
  const [open, setOpen] = useState<null | 'welcome' | 'keys' | 'about'>(null)
  const deskNav = useDeskNav()
  const close = useCallback(() => setOpen(null), [])
  const menu: MenuDef = { label: 'Help', items: [
    { label: 'Welcome screen', icon: 'home', onClick: () => setOpen('welcome') },
    { label: 'Keyboard shortcuts', icon: 'keyboard', shortcut: '?', onClick: () => (onShortcuts ? onShortcuts() : setOpen('keys')) },
    { divider: true },
    { label: 'Desks on the left', icon: 'grid', checked: deskNav === 'left', onClick: () => setDeskNav(deskNav === 'left' ? 'top' : 'left') },
    { divider: true },
    { label: 'About ESB AI Studio', icon: 'info', onClick: () => setOpen('about') },
  ] }
  const dialogs = (
    <>
      {open === 'welcome' && <WelcomeModal onClose={close} />}
      {open === 'keys' && <ShortcutsDialog groups={shortcuts} onClose={close} />}
      {open === 'about' && <AboutDialog onClose={close} />}
    </>
  )
  return { menu, dialogs }
}
