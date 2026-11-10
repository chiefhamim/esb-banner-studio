// The banner as the desk's centrepiece on the right: the image that goes out with the story, drawn live from Graphics, in the
// shape a channel needs (Website 16:9 or Facebook 4:5), with the three things done to it — edit, save, copy — one click away.

import { useState } from 'react'
import type { CSSProperties } from 'react'
import { create } from 'zustand'
import { Icon } from '../ui/Icon'
import { Seg } from '../ui/controls'
import { useStore } from '../store'
import { useBannerImage } from './useBannerImage'
import { useShellStore } from '../shell/shellStore'
import { FORMATS, getFormat } from '../core/tokens'
import { DEFAULT_SETTINGS, copyToClipboard, humanBytes, runExport } from '../export'
import type { Assets } from '../core/render'
import type { FormatId } from '../core/types'

export type Channel = 'web' | 'fb45'
const KEY = 'esb-banner-studio/editorial/channel'
const read = (): Channel => { try { return localStorage.getItem(KEY) === 'fb45' ? 'fb45' : 'web' } catch { return 'web' } }

/** Which channel the sidebar shows; shared by the banner hero and the banner settings below it. */
export const useBannerChannel = create<{ channel: Channel; set: (c: Channel) => void }>((set) => ({
  channel: read(),
  set: (channel) => { try { localStorage.setItem(KEY, channel) } catch { /* ignore */ } set({ channel }) },
}))

export function BannerHero({ base, onToast }: { base: Assets | null; onToast: (m: string) => void }) {
  const channel = useBannerChannel((s) => s.channel)
  const setChannel = useBannerChannel((s) => s.set)
  const slot0 = useStore((s) => s.doc.photos.slots[s.format][0])
  const fmtId: FormatId = channel
  const fmt = getFormat(fmtId)
  const url = useBannerImage(base, fmtId, 0.4)
  const [busy, setBusy] = useState<null | 'save' | 'copy'>(null)
  const hasPhoto = !!slot0?.src

  const save = async () => {
    if (!base) return
    setBusy('save')
    try {
      const res = await runExport(useStore.getState().doc, base, { ...DEFAULT_SETTINGS, formats: [fmtId], scales: [1], type: 'png', zip: false, saveProject: false, dir: null, openAfter: false }, () => {})
      onToast(res.saved.length ? `Saved the ${fmt.short} banner · ${humanBytes(res.bytes)}` : 'Export finished')
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Export failed'
      if (!/cancel/i.test(msg)) onToast(msg)
    } finally { setBusy(null) }
  }
  const copy = async () => {
    if (!base) return
    setBusy('copy')
    try { await copyToClipboard(useStore.getState().doc, fmtId, base); onToast('Banner copied — paste it anywhere') }
    catch { onToast('Copying the image was blocked. Use Save instead.') }
    finally { setBusy(null) }
  }

  return (
    <section className="bh" aria-label="Banner">
      <div className="bh-top">
        <Seg<Channel> className="bh-seg" value={channel} onChange={setChannel} options={[{ value: 'web', label: 'Website' }, { value: 'fb45', label: 'Facebook' }]} />
        <span className={'bh-flag ' + (hasPhoto ? 'ok' : 'warn')}><i />{hasPhoto ? 'Photo set' : 'No photo yet'}</span>
      </div>
      <div className="bh-frame" style={{ ['--r' as string]: FORMATS[fmtId].w / FORMATS[fmtId].h } as CSSProperties}>
        {url ? <img src={url} alt={`The ${fmt.name} banner`} /> : <span className="hint">Drawing the banner</span>}
      </div>
      <div className="bh-foot">
        <span className="bh-meta"><b>{fmt.name}</b>{FORMATS[fmtId].w} × {FORMATS[fmtId].h}</span>
        <div className="bh-acts">
          <button type="button" className="ibtn" data-tip="Edit in Graphics" aria-label="Edit in Graphics" onClick={() => useShellStore.getState().openGraphicsFrom('editorial', null)}><Icon name="edit" size={15} /></button>
          <button type="button" className="ibtn" data-tip="Save as PNG" aria-label="Save the banner" onClick={() => void save()} disabled={!base || busy === 'save'}><Icon name={busy === 'save' ? 'refresh' : 'download'} size={15} className={busy === 'save' ? 'spin' : ''} /></button>
          <button type="button" className="ibtn" data-tip="Copy the image" aria-label="Copy the banner" onClick={() => void copy()} disabled={!base || busy === 'copy'}><Icon name="copy" size={15} /></button>
        </div>
      </div>
    </section>
  )
}
