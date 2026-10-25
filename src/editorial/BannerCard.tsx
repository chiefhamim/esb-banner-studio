// The right sidebar's banner card: the banner as it is right now (live from Graphics) and the three things an editor
// does with it — change it in Graphics, save it as a file, copy it to paste anywhere.

import { useState } from 'react'
import { useStore } from '../store'
import { useBannerImage } from './useBannerImage'
import { useShellStore } from '../shell/shellStore'
import { Icon } from '../ui/Icon'
import { getFormat } from '../core/tokens'
import { DEFAULT_SETTINGS, copyToClipboard, humanBytes, runExport } from '../export'
import type { Assets } from '../core/render'

export function BannerCard({ base, onToast }: { base: Assets | null; onToast: (m: string) => void }) {
  const format = useStore((s) => s.format)
  const url = useBannerImage(base, format, 0.35)
  const [busy, setBusy] = useState<null | 'save' | 'copy'>(null)
  const fmt = getFormat(format)

  const save = async () => {
    if (!base) return
    setBusy('save')
    try {
      const res = await runExport(useStore.getState().doc, base, { ...DEFAULT_SETTINGS, formats: [format], scales: [1], type: 'png', zip: false, saveProject: false, dir: null, openAfter: false }, () => {})
      onToast(res.saved.length ? `Saved the ${fmt.short} banner · ${humanBytes(res.bytes)}` : 'Export finished')
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Export failed'
      if (!/cancel/i.test(msg)) onToast(msg)
    } finally {
      setBusy(null)
    }
  }
  const copy = async () => {
    if (!base) return
    setBusy('copy')
    try { await copyToClipboard(useStore.getState().doc, format, base); onToast('Banner copied — paste it anywhere') }
    catch { onToast('Copying the image was blocked. Use Save instead.') }
    finally { setBusy(null) }
  }

  return (
    <div className="bc">
      <div className="bc-frame" style={{ aspectRatio: `${fmt.w} / ${fmt.h}` }}>
        {url ? <img src={url} alt="The banner as it is now" /> : <span className="hint">Drawing the banner…</span>}
      </div>
      <p className="bc-meta">{fmt.short} · follows Graphics live</p>
      <div className="bc-actions">
        <button type="button" className="btn sm" onClick={() => useShellStore.getState().openGraphicsFrom('editorial', null)}><Icon name="edit" size={13} /><span>Edit in Graphics</span></button>
        <button type="button" className="btn sm" onClick={() => void save()} disabled={!base || busy === 'save'}><Icon name="download" size={13} /><span>{busy === 'save' ? 'Saving…' : 'Save'}</span></button>
        <button type="button" className="btn sm" onClick={() => void copy()} disabled={!base || busy === 'copy'}><Icon name="copy" size={13} /><span>Copy</span></button>
      </div>
    </div>
  )
}
