// The media bin's rows and their Phase 1 metadata: codec · fps · picture size · length · file size, the proxy state
// (badge, live progress, cancel, make again), and missing files with Relink and one-click Relink all for files found
// again by hash. Kept apart from VideoWorkspace (classes prefixed `vw-bin-`, styles in styles/video-bin.css) so the
// bin can be restyled without touching the desk. The older `vw-media-*` classes stay on the row for the tests.
import { memo } from 'react'
import { Icon } from '../ui/Icon'
import { IconButton, Seg } from '../ui/controls'
import type { MediaAsset } from './timeline'
import { formatShortTime } from './timeline'
import type { AssetMeta } from './media'
import { useMediaMeta } from './media'
import { cancelProxy, retryProxy } from './proxies'
import { relinkAllFound, setProjectSettings } from './projectIO'
import '../styles/video-bin.css'

/** A codec string as people say it: avc1.64002a → H.264, hvc1 → HEVC, vp09 → VP9, mp4a → AAC. */
export function codecLabel(codec?: string): string {
  if (!codec) return ''
  const c = codec.toLowerCase()
  if (c.startsWith('avc')) return 'H.264'
  if (c.startsWith('hev') || c.startsWith('hvc')) return 'HEVC'
  if (c.startsWith('vp09') || c === 'vp9') return 'VP9'
  if (c.startsWith('vp8')) return 'VP8'
  if (c.startsWith('av01') || c === 'av1') return 'AV1'
  if (c.startsWith('mp4a') || c === 'aac') return 'AAC'
  if (c === 'opus') return 'Opus'
  if (c === 'mp3') return 'MP3'
  if (c === 'flac') return 'FLAC'
  if (c.startsWith('pcm')) return 'PCM'
  return codec.slice(0, 10)
}

const mb = (bytes: number) => (bytes >= 1024 ** 3 ? `${(bytes / 1024 ** 3).toFixed(1)} GB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`)
const fpsLabel = (fps?: number) => (fps ? `${Math.round(fps * 100) / 100} fps` : '')

/** The facts line under a bin entry's name. */
export function factsLine(a: MediaAsset, m: AssetMeta | undefined): string {
  return [
    a.duration > 0 ? formatShortTime(a.duration) : '',
    a.type !== 'image' ? codecLabel(m?.codec) : '',
    a.type === 'video' ? fpsLabel(m?.fps) : '',
    (a.type === 'video' || a.type === 'image') && a.width && a.height ? `${a.width}×${a.height}` : '',
    a.type === 'video' && a.hasAudio !== undefined ? (a.hasAudio ? 'sound' : 'no sound') : '',
    mb(a.size),
  ].filter(Boolean).join(' · ')
}

/** The proxy badge of a footage entry (nothing when it needs no proxy and has none). */
function ProxyBadge({ id, m }: { id: string; m: AssetMeta | undefined }) {
  const state = m?.proxy ?? 'none'
  if (state === 'ready') return <span className="vw-bin-proxy ready" data-proxy="ready" data-tip="Previews from a 540p proxy; exports read the original"><Icon name="check" size={11} />Proxy</span>
  if (state === 'pending') {
    const pct = Math.round((m?.proxyProgress ?? 0) * 100)
    return (
      <span className="vw-bin-proxy pending" data-proxy="pending" data-tip="Making a 540p proxy in the background">
        <span className="vw-bin-proxy-label">Proxy {pct}%</span>
        <span className="vw-bin-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}><span style={{ width: `${pct}%` }} /></span>
        <button type="button" className="vw-bin-proxy-x" onClick={() => cancelProxy(id)} aria-label="Stop making the proxy" data-tip="Stop"><Icon name="x" size={11} /></button>
      </span>
    )
  }
  if (state === 'failed') return <button type="button" className="vw-bin-proxy failed" data-proxy="failed" onClick={() => retryProxy(id)} data-tip={`${m?.proxyError ?? 'The proxy could not be made'} · Try again`}><Icon name="alert" size={11} />Proxy failed</button>
  if (m?.proxyNeeded) return <button type="button" className="vw-bin-proxy make" data-proxy="none" onClick={() => retryProxy(id)} data-tip="Heavy footage: make a 540p proxy for smooth editing"><Icon name="refresh" size={11} />Make proxy</button>
  return null
}

/** One bin row: picture or icon, name, facts, proxy and missing state, and its actions in one aligned group. */
export const BinCard = memo(function BinCard({ asset, onAdd, onRelink, onRemove }: { asset: MediaAsset; onAdd: (a: MediaAsset, as?: 'auto' | 'overlay') => void; onRelink: (a: MediaAsset) => void; onRemove: (id: string) => void }) {
  const m = useMediaMeta((s) => s.byId[asset.id])
  const found = useMediaMeta((s) => s.found[asset.id])
  const thumb = asset.thumbnailUrl && !asset.missing
    ? <img src={asset.thumbnailUrl} alt="" className="vw-media-thumb" crossOrigin={/^(blob:|data:)/.test(asset.thumbnailUrl) ? undefined : 'anonymous'} />
    : <div className={`vw-media-thumb vw-thumb-icon${asset.missing ? ' missing' : ''}`}><Icon name={asset.missing ? 'alert' : asset.type === 'audio' ? 'volume' : asset.type === 'image' ? 'image' : 'video'} size={18} /></div>
  const copy = m?.storage === 'copy'
  return (
    <div className={`vw-media-card vw-bin-card${asset.missing ? ' missing' : ''}`} data-asset={asset.type} data-proxy={asset.type === 'video' ? m?.proxy ?? 'none' : undefined}>
      {thumb}
      <div className="vw-media-info">
        <div className="vw-media-title" data-tip={`${asset.path ?? asset.name}${copy ? ' · copied into the project' : ''}`}>{asset.name}</div>
        {asset.missing ? (
          <div className="vw-media-meta vw-bin-meta">
            <span className="vw-miss-word">Not found{asset.removed ? ' · used by clips' : ''}</span>
            {found && <span className="vw-bin-found" data-tip={found.path}> · found again</span>}
          </div>
        ) : (
          <div className="vw-media-meta vw-bin-meta" data-tip={factsLine(asset, m)}>{factsLine(asset, m)}</div>
        )}
        {!asset.missing && asset.type === 'video' && <div className="vw-bin-tags"><ProxyBadge id={asset.id} m={m} />{copy && <span className="vw-bin-tag">In project</span>}</div>}
      </div>
      <div className="vw-media-actions">
        {asset.missing ? (
          <button type="button" className="btn xs vw-relink" onClick={() => onRelink(asset)} data-tip="Find the file on this PC"><Icon name="search" size={12} />Relink</button>
        ) : (
          <>
            {asset.type === 'image' && <IconButton icon="layers" size={14} className="vw-act vw-add-overlay" tip="Add as an overlay on V2 (over the footage)" onClick={() => onAdd(asset, 'overlay')} />}
            <IconButton icon="plus" size={14} className="vw-act vw-add" tip={asset.type === 'image' ? 'Add to V1 as a full-frame still' : asset.type === 'video' ? (asset.hasAudio ? 'Add to V1, with its sound on A1' : 'Add to V1') : 'Add to A1'} onClick={() => onAdd(asset)} />
          </>
        )}
        {!asset.removed && <IconButton icon="trash" size={14} className="vw-act vw-remove" tip="Remove from the bin (Ctrl+Z brings it back)" onClick={() => onRemove(asset.id)} />}
      </div>
    </div>
  )
})

/** The missing-files note above the bin, with Relink all when some were found again by size and hash. */
export function BinMissingBar({ missing, onRelinked }: { missing: number; onRelinked?: (n: number) => void }) {
  const found = useMediaMeta((s) => Object.keys(s.found).length)
  if (!missing) return null
  return (
    <div className="vw-missing vw-bin-missing" role="status">
      <Icon name="alert" size={14} />
      <span className="vw-bin-missing-text">{missing} file{missing === 1 ? ' is' : 's are'} missing. {found ? `${found === missing ? (found === 1 ? 'It was' : 'All were') : `${found} of ${missing} were`} found again.` : `Relink ${missing === 1 ? 'it' : 'them'} to play and export.`}</span>
      {found > 0 && <button type="button" className="btn xs vw-bin-relink-all" onClick={() => void relinkAllFound().then((n) => onRelinked?.(n))}>Relink all</button>}
    </div>
  )
}

/** Link or copy on import — shown when the project has a folder to copy into. */
export function BinImportMode() {
  const folder = useMediaMeta((s) => s.folder)
  const mode = useMediaMeta((s) => s.settings.importMode)
  if (!folder) return null
  return (
    <div className="vw-bin-import-mode">
      <span className="vw-bin-import-label">On import</span>
      <Seg
        value={mode}
        label="On import"
        onChange={(v) => setProjectSettings({ importMode: v })}
        options={[
          { value: 'reference', label: 'Link', tip: 'Play each file where it is (default)' },
          { value: 'copy', label: 'Copy', tip: 'Copy each file into the project folder' },
        ]}
      />
    </div>
  )
}
