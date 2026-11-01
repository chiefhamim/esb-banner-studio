// The media bin's rows and their Phase 1 metadata: two fixed fact lines (length · codec · fps / picture size · sound ·
// file size), one proxy line with a real button for its action (Cancel, Retry, Make proxy), and missing files with
// Relink — or, for a file found again by hash, where it was found and Use it. Kept apart from VideoWorkspace (classes prefixed `vw-bin-`, styles in styles/video-bin.css) so the
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
import type { MediaEntry } from './media'
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

/** The facts under a bin entry's name as two fixed lines (never wrapped mid-list, so no line starts or ends with a
 * separator): what it is (length · codec · fps) and how big (picture size · "silent" when it has no sound · file size). A line with nothing
 * on it is dropped (a picture has no length or codec). */
export function factsLines(a: MediaAsset, m: AssetMeta | undefined): string[] {
  const what = [
    a.duration > 0 ? formatShortTime(a.duration) : '',
    a.type !== 'image' ? codecLabel(m?.codec) : '',
    a.type === 'video' ? fpsLabel(m?.fps) : '',
  ].filter(Boolean).join(' · ')
  const size = [
    (a.type === 'video' || a.type === 'image') && a.width && a.height ? `${a.width}×${a.height}` : '',
    // only the exception is named (most footage has sound), so the line fits the 312 px bin without being cut
    a.type === 'video' && a.hasAudio === false ? 'silent' : '',
    mb(a.size),
  ].filter(Boolean).join(' · ')
  return [what, size].filter(Boolean)
}

/** The facts as one string (tooltips, tests). */
export const factsLine = (a: MediaAsset, m: AssetMeta | undefined) => factsLines(a, m).join(' · ')

const clean = (e?: string) => (e ?? '').replace(/^Error invoking remote method '[^']+': (Error: )?/, '').replace(/[.\s]+$/, '')

/** One line for a footage entry's proxy: what it is doing, and a real button for what can be done about it. Nothing
 * when it needs no proxy and has none. Classes stay stable for the tests: .vw-bin-proxy (+ ready / pending / failed /
 * make), .vw-bin-proxy-cancel, .vw-bin-proxy-retry, .vw-bin-proxy-make. */
function ProxyLine({ id, m }: { id: string; m: AssetMeta | undefined }) {
  const state = m?.proxy ?? 'none'
  if (state === 'ready') {
    return (
      <div className="vw-bin-proxy ready" data-proxy="ready" data-tip="Playback uses a 540p proxy made from this file, for smooth editing. Exports always read the original.">
        <Icon name="check" size={12} /><span className="vw-bin-proxy-label">Plays from proxy</span>
      </div>
    )
  }
  if (state === 'pending') {
    const pct = Math.round((m?.proxyProgress ?? 0) * 100)
    return (
      <div className="vw-bin-proxy pending" data-proxy="pending" data-tip="Making a 540p proxy in the background (it pauses while you play or export)">
        <span className="vw-bin-proxy-label">Proxy {pct} %</span>
        <span className="vw-bin-bar" role="progressbar" aria-label="Proxy progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}><span style={{ width: `${pct}%` }} /></span>
        <button type="button" className="btn xs vw-bin-proxy-btn vw-bin-proxy-cancel vw-bin-proxy-x" onClick={() => cancelProxy(id)} data-tip="Stop making the proxy">Cancel</button>
      </div>
    )
  }
  if (state === 'failed') {
    const why = clean(m?.proxyError) || 'it could not be made'
    return (
      <div className="vw-bin-proxy failed" data-proxy="failed">
        <Icon name="alert" size={12} />
        <span className="vw-bin-proxy-label vw-bin-proxy-why" data-tip={`Proxy failed: ${why}`}>Proxy failed: {why}</span>
        <button type="button" className="btn xs vw-bin-proxy-btn vw-bin-proxy-retry" onClick={() => retryProxy(id)} data-tip="Try making the proxy again">Retry</button>
      </div>
    )
  }
  if (m?.proxyNeeded) {
    return (
      <div className="vw-bin-proxy make" data-proxy="none">
        <span className="vw-bin-proxy-label" data-tip="Heavy footage (over 1080p, or few key frames): a 540p proxy makes scrubbing smooth">No proxy</span>
        <button type="button" className="btn xs vw-bin-proxy-btn vw-bin-proxy-make" onClick={() => retryProxy(id)} data-tip="Make a 540p proxy for smooth editing">Make proxy</button>
      </div>
    )
  }
  return null
}

/** The last two folders of a path ("…\\Footage\\Day 2"), so a found file says where it is without a 300-character path. */
export function shortFolder(p: string): string {
  const parts = p.split(/[\\/]+/).filter(Boolean)
  parts.pop() // the file itself
  if (parts.length <= 2) return parts.join('\\')
  return '…\\' + parts.slice(-2).join('\\')
}

/** A missing entry that was found again by size + hash: where it is now (the row's Use it button relinks it). */
function FoundLine({ asset, found }: { asset: MediaAsset; found: MediaEntry }) {
  const name = found.name || found.path.split(/[\\/]/).pop() || ''
  const where = shortFolder(found.path)
  return (
    <div className="vw-media-meta vw-bin-meta vw-bin-found-line">
      <span className="vw-bin-found" data-tip={found.path}>{[name && name !== asset.name ? `Found as ${name}` : 'Found', where ? `in ${where}` : ''].filter(Boolean).join(' ')}</span>
    </div>
  )
}

/** One bin row: picture or icon, name, facts, proxy and missing state, and its actions in one aligned group. */
export const BinCard = memo(function BinCard({ asset, onAdd, onRelink, onRemove }: { asset: MediaAsset; onAdd: (a: MediaAsset, as?: 'auto' | 'overlay') => void; onRelink: (a: MediaAsset) => void; onRemove: (id: string) => void }) {
  const m = useMediaMeta((s) => s.byId[asset.id])
  const found = useMediaMeta((s) => s.found[asset.id])
  const isFound = !!asset.missing && !!found
  const thumb = asset.thumbnailUrl && !asset.missing
    ? <img src={asset.thumbnailUrl} alt="" className="vw-media-thumb" crossOrigin={/^(blob:|data:)/.test(asset.thumbnailUrl) ? undefined : 'anonymous'} />
    : <div className={`vw-media-thumb vw-thumb-icon${asset.missing && !isFound ? ' missing' : ''}`}><Icon name={isFound ? 'search' : asset.missing ? 'alert' : asset.type === 'audio' ? 'volume' : asset.type === 'image' ? 'image' : 'video'} size={18} /></div>
  const copy = m?.storage === 'copy'
  const lines = factsLines(asset, m)
  return (
    <div className={`vw-media-card vw-bin-card${asset.missing ? ' missing' : ''}${isFound ? ' found' : ''}`} data-asset={asset.type} data-proxy={asset.type === 'video' ? m?.proxy ?? 'none' : undefined}>
      {thumb}
      <div className="vw-media-info">
        <div className="vw-media-title" data-tip={`${asset.path ?? asset.name}${copy ? ' · copied into the project folder (media/)' : ''}`}>{asset.name}</div>
        {isFound ? (
          <FoundLine asset={asset} found={found} />
        ) : asset.missing ? (
          <div className="vw-media-meta vw-bin-meta">
            <span className="vw-miss-word">Not found{asset.removed ? ' · used by clips' : ''}</span>
          </div>
        ) : (
          <div className="vw-bin-facts" data-tip={factsLine(asset, m)}>
            {lines.map((l, i) => <div key={i} className="vw-media-meta vw-bin-meta">{l}</div>)}
          </div>
        )}
        {!asset.missing && (asset.type === 'video' || copy) && (
          <div className="vw-bin-tags">
            {asset.type === 'video' && <ProxyLine id={asset.id} m={m} />}
            {copy && <span className="vw-bin-tag" data-tip="This file was copied into the project folder (media/), so the project keeps it if the original moves">Copied into project</span>}
          </div>
        )}
      </div>
      <div className="vw-media-actions">
        {isFound ? (
          <button type="button" className="btn xs vw-bin-use-found" onClick={() => void relinkAllFound([asset.id])} data-tip={`Use ${found.path}`}>Use it</button>
        ) : asset.missing ? (
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

/** The note above the bin: files that moved and were found again by size and hash (Use all), and files that are still
 * missing (Relink each). One clear sentence for each, never "missing" for a file that was found. */
export function BinMissingBar({ missing, onRelinked }: { missing: number; onRelinked?: (n: number) => void }) {
  const found = useMediaMeta((s) => Object.keys(s.found).length)
  if (!missing) return null
  const lost = Math.max(0, missing - found)
  const foundText = found ? `${found === 1 ? '1 file was' : `${found} files were`} found again in a new place.` : ''
  const lostText = lost ? `${lost === 1 ? '1 file is' : `${lost} files are`} missing — relink ${lost === 1 ? 'it' : 'them'} to play and export.` : ''
  return (
    <div className={`vw-missing vw-bin-missing${lost ? '' : ' all-found'}`} role="status">
      <Icon name={lost ? 'alert' : 'search'} size={14} />
      <span className="vw-bin-missing-text">{[foundText, lostText].filter(Boolean).join(' ')}</span>
      {found > 1 && <button type="button" className="btn xs vw-bin-relink-all" onClick={() => void relinkAllFound().then((n) => onRelinked?.(n))} data-tip="Use every file found again">Use all</button>}
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
