// Profile picture: a preset avatar saved to the signed-in editor's esbpowerline.com profile (Supabase
// public.profiles.avatar_url, which the site already shows as the account's picture). The same 12 sets × 16 PNGs
// (256 px) ship in public/avatars/presets and sit in the site's public media bucket at media/avatars/presets/<set>/NN.png;
// the public URL is what gets saved, so the picture is the same here, in ESB Studio Phone and on the website. A preset is
// drawn from the bundled copy (instant, offline); any other URL is drawn as it is.
// Mirrors esb-studio-phone src/mobile/shell/avatar.tsx (store and URLs are the same; the picker is the desktop's).
import { useEffect, useState } from 'react'
import { create } from 'zustand'
import { SUPABASE_ANON_KEY, SUPABASE_URL, ensureFreshSession } from './siteApi'
import type { StaffSession } from './siteApi'
import { useEditorialStore } from './editorialStore'
import { Icon } from '../ui/Icon'

export const AVATAR_REMOTE = `${SUPABASE_URL}/storage/v1/object/public/media/avatars/presets`
const LOCAL = './avatars/presets'
export const AVATAR_SETS = [
  { id: 'notionists', name: 'Notionists', by: 'Zoish', license: 'CC0' },
  { id: 'islamic', name: 'Islamic', by: 'Pablo Stanley (Avataaars, Open Peeps)', license: 'CC0 · free for commercial use' },
  { id: 'asian', name: 'Asian', by: 'Pablo Stanley, Draftbit (Personas)', license: 'CC0 · CC BY 4.0' },
  { id: 'lorelei', name: 'Lorelei', by: 'Lisa Wischofsky', license: 'CC0' },
  { id: 'personas', name: 'Personas', by: 'Draftbit', license: 'CC BY 4.0' },
  { id: 'micah', name: 'Micah', by: 'Micah Lanier', license: 'CC BY 4.0' },
  { id: 'open-peeps', name: 'Open Peeps', by: 'Pablo Stanley', license: 'CC0' },
  { id: 'adventurer', name: 'Adventurer', by: 'Lisa Wischofsky', license: 'CC BY 4.0' },
  { id: 'avataaars', name: 'Avataaars', by: 'Pablo Stanley', license: 'free for commercial use' },
  { id: 'thumbs', name: 'Thumbs', by: 'DiceBear', license: 'CC0' },
  { id: 'shapes', name: 'Shapes', by: 'DiceBear', license: 'CC0' },
  { id: 'glass', name: 'Glass', by: 'DiceBear', license: 'CC0' },
] as const
export const AVATARS_PER_SET = 16

const file = (n: number) => String(n).padStart(2, '0') + '.png'
export const presetUrl = (set: string, n: number) => `${AVATAR_REMOTE}/${set}/${file(n)}`
/** What to draw for a saved URL: a preset's bundled copy when it is one of ours, else the URL itself (https only). */
export function displayUrl(url: string): string | null {
  if (url.startsWith(AVATAR_REMOTE + '/')) return LOCAL + url.slice(AVATAR_REMOTE.length)
  return /^https:\/\//i.test(url) ? url : null
}
/** The set a saved preset URL belongs to, or null. */
export function presetSetOf(url: string | null): string | null {
  return url?.startsWith(AVATAR_REMOTE + '/') ? url.slice(AVATAR_REMOTE.length + 1).split('/')[0] ?? null : null
}

const cacheKey = (uid: string) => `esb-banner-studio/avatar/${uid}`
const readCache = (uid: string) => { try { return localStorage.getItem(cacheKey(uid)) } catch { return null } }
const writeCache = (uid: string, url: string | null) => {
  try { if (url) localStorage.setItem(cacheKey(uid), url); else localStorage.removeItem(cacheKey(uid)) } catch { /* not kept */ }
}

interface AvatarState {
  userId: string | null
  url: string | null
  saving: string | null
  load: (session: StaffSession | null) => Promise<void>
  choose: (url: string | null) => Promise<boolean>
}

async function profileRequest(method: 'GET' | 'PATCH', body?: unknown): Promise<Response | null> {
  const s = await ensureFreshSession(useEditorialStore.getState().staffSession)
  if (!s?.token || !s.userId) return null
  return fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${encodeURIComponent(s.userId)}${method === 'GET' ? '&select=avatar_url' : ''}`, {
    method,
    headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${s.token}`, Accept: 'application/json', 'Content-Type': 'application/json', Prefer: 'return=representation' },
    body: body ? JSON.stringify(body) : undefined,
  })
}

export const useAvatar = create<AvatarState>((set, get) => ({
  userId: null,
  url: null,
  saving: null,
  load: async (session) => {
    const uid = session?.userId ?? null
    if (!uid) { set({ userId: null, url: null }); return }
    if (get().userId !== uid) set({ userId: uid, url: readCache(uid) })
    try {
      const res = await profileRequest('GET')
      if (!res?.ok) return
      const row = ((await res.json()) as { avatar_url: string | null }[])[0]
      if (!row || get().userId !== uid) return // signed out or switched account meanwhile
      set({ url: row.avatar_url })
      writeCache(uid, row.avatar_url)
    } catch { /* offline: keep the cached picture */ }
  },
  // Saved only when the site writes it back: the row the site returns must carry the new URL, else the old one returns.
  choose: async (url) => {
    const uid = get().userId
    if (!uid || get().saving) return false
    if (url !== null && (typeof url !== 'string' || !/^https:\/\/[a-z0-9.-]+\//i.test(url.trim()))) {
      return false
    }
    const before = get().url
    set({ url, saving: url ?? 'none' })
    try {
      const res = await profileRequest('PATCH', { avatar_url: url, updated_at: new Date().toISOString() })
      const rows = res?.ok ? ((await res.json()) as { avatar_url: string | null }[]) : []
      if (rows.length !== 1 || rows[0]!.avatar_url !== url) throw new Error('not saved')
      writeCache(uid, url)
      return true
    } catch {
      if (get().userId === uid) set({ url: before })
      return false
    } finally {
      set({ saving: null })
    }
  },
}))

/** Keeps the picture in step with whoever is signed in (call once, high in the tree). */
export function useAvatarSync() {
  const session = useEditorialStore((s) => s.staffSession)
  const load = useAvatar((s) => s.load)
  useEffect(() => { void load(session) }, [session?.userId]) // eslint-disable-line react-hooks/exhaustive-deps
}

/** The signed-in editor's picture, or their initials when they have none (or it fails to load). */
export function UserAvatar({ name, className = '' }: { name: string; className?: string }) {
  const url = useAvatar((s) => s.url)
  const [broken, setBroken] = useState<string | null>(null)
  const src = url ? displayUrl(url) : null
  if (src && broken !== src) return <img className={'u-avatar ' + className} src={src} alt="" draggable={false} onError={() => setBroken(src)} />
  const initials = (name || '?').split(/[\s@.]+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join('')
  return <span className={'u-avatar is-initial ' + className}>{initials || '?'}</span>
}

/** The picker, shown inside the account sheet: set tabs, a 8 × 2 grid, the credit, Remove picture. */
export function AvatarPicker({ onToast, onDone }: { onToast: (m: string) => void; onDone: () => void }) {
  const url = useAvatar((s) => s.url)
  const saving = useAvatar((s) => s.saving)
  const choose = useAvatar((s) => s.choose)
  const [setId, setSetId] = useState<string>(presetSetOf(url) ?? AVATAR_SETS[0].id)
  const meta = AVATAR_SETS.find((s) => s.id === setId) ?? AVATAR_SETS[0]
  const pick = async (next: string | null) => {
    if (saving) return
    const ok = await choose(next)
    onToast(ok ? (next ? 'Profile picture updated on esbpowerline.com' : 'Profile picture removed') : 'Could not save the picture. Check the connection and try again.')
  }
  return (
    <section className="acct-sec av" aria-label="Profile picture">
      <div className="acct-sec-head"><h3>Profile picture</h3><span className="av-note">Saved to your esbpowerline.com profile · shows on the site and the phone</span>
        <button type="button" className="btn sm av-close" onClick={onDone}><Icon name="check" size={13} /><span>Done</span></button></div>
      <div className="av-sets" role="tablist" aria-label="Avatar sets">
        {AVATAR_SETS.map((s) => (
          <button key={s.id} type="button" role="tab" aria-selected={s.id === setId} className={'av-set' + (s.id === setId ? ' on' : '')} onClick={() => setSetId(s.id)}>{s.name}</button>
        ))}
      </div>
      <div className="av-grid" role="tabpanel" aria-label={meta.name}>
        {Array.from({ length: AVATARS_PER_SET }, (_, i) => {
          const u = presetUrl(setId, i + 1)
          const on = url === u
          return (
            <button key={u} type="button" className={'av-cell' + (on ? ' on' : '') + (saving === u ? ' saving' : '')} aria-pressed={on} aria-label={`${meta.name} ${i + 1}`} data-tip={`${meta.name} ${i + 1}`} disabled={!!saving} onClick={() => void pick(u)}>
              <img src={displayUrl(u) ?? ''} alt="" loading="lazy" draggable={false} />
              {on && <span className="av-tick" aria-hidden><Icon name="check" size={11} /></span>}
            </button>
          )
        })}
      </div>
      <div className="av-foot">
        <span className="av-credit">{meta.name} by {meta.by} · {meta.license} · via DiceBear</span>
        {url && <button type="button" className="btn sm" disabled={!!saving} onClick={() => void pick(null)}><Icon name="trash" size={13} /><span>Remove picture</span></button>}
      </div>
    </section>
  )
}
