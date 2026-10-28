// Files that go with every email of the batch. Three sources:
//   - any PDF / Office / image / text file from this computer (the same list the main process accepts);
//   - the Graphics banner, rendered from the banner document — the first version looked for the Graphics canvas on
//     screen, which is never there while Outreach is open, so it always failed;
//   - the Editorial story as a short text block with its link — only once the story is live on esbpowerline.com
//     (/articles/{slug}; the first version linked /news/{slug}, which does not exist).

import { useRef, useState } from 'react'
import { useOutreachStore } from './outreachStore'
import { Icon } from '../ui/Icon'
import { FileTypeIcon } from '../editorial/FileTypeIcon'
import { AttachmentViewer } from './AttachmentViewer'
import type { AttachmentItem } from './types'
import { useStore } from '../store'
import { useStoryQueue } from '../editorial/storyQueue'
import { useEditorialStore } from '../editorial/editorialStore'
import { renderBanner } from '../export'
import { loadBaseAssets } from '../core/assets'

const ACCEPT = '.pdf,.png,.jpg,.jpeg,.webp,.gif,.docx,.xlsx,.pptx,.doc,.xls,.ppt,.txt,.csv'
const MAX_BYTES = 18 * 1024 * 1024
const fmt = (b: number) => (b >= 1024 * 1024 ? `${(b / 1024 / 1024).toFixed(1)} MB` : b ? `${Math.max(1, Math.round(b / 1024))} KB` : "0 MB")
const asDataUrl = (blob: Blob) => new Promise<string>((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.onerror = () => rej(r.error); r.readAsDataURL(blob) })

export function AttachmentTray() {
  const s = useOutreachStore()
  const input = useRef<HTMLInputElement>(null)
  const [rendering, setRendering] = useState(false)
  const [viewing, setViewing] = useState<AttachmentItem | null>(null)
  const total = s.attachments.reduce((n, a) => n + a.size, 0)
  const story = useStoryQueue((q) => q.stories.find((x) => x.id === q.activeId))
  const draft = useEditorialStore((e) => e.draft)
  const liveSlug = story?.publishedSlug || story?.publishedUrl?.match(/\/articles\/([^/?#]+)/)?.[1]

  const add = async (files: FileList | null) => {
    for (const f of Array.from(files ?? [])) {
      const ext = f.name.split('.').pop()?.toLowerCase() ?? ''
      if (!ACCEPT.split(',').includes('.' + ext)) { s.addLog('warn', `${f.name}: only PDF, Office, image, text and CSV files can be attached`); continue }
      if (total + f.size > MAX_BYTES) { s.addLog('warn', `${f.name}: the attachments would pass 18 MB, which Gmail refuses`); continue }
      s.addAttachment({ id: `${Date.now()}-${f.name}`, name: f.name, size: f.size, mimeType: f.type, dataUrl: await asDataUrl(f) })
    }
  }

  const attachBanner = async () => {
    setRendering(true)
    try {
      const doc = useStore.getState().doc
      const blob = await renderBanner(doc, 'fb45', await loadBaseAssets(), 1, 'jpeg', 0.9)
      const name = `ESB-PowerLine-banner-${new Date().toISOString().slice(0, 10)}.jpg`
      s.addAttachment({ id: `banner-${Date.now()}`, name, size: blob.size, mimeType: 'image/jpeg', dataUrl: await asDataUrl(blob) })
      s.addLog('ok', `Attached the Graphics banner (${fmt(blob.size)})`)
    } catch (e) {
      s.addLog('error', `Could not render the banner: ${(e as Error).message}`)
    } finally {
      setRendering(false)
    }
  }

  const insertStory = () => {
    const c = s.campaign()
    if (!c || !liveSlug || !draft.headline.trim()) return
    const block = [`**${draft.headline.trim()}**`, draft.deck.trim(), `[Read the story](https://esbpowerline.com/articles/${liveSlug})`].filter(Boolean).join('\n')
    s.patch({ body: `${c.body.trimEnd()}\n\n${block}\n` })
    s.addLog('ok', 'Inserted the Editorial story and its link')
  }

  return (
    <div className="or-files">
      <div className="or-files-head">
        <Icon name="paperclip" size={14} />
        <b>Attachments</b>
        <span className={'or-count' + (total > MAX_BYTES ? ' over' : '')}>{fmt(total)} of 18 MB</span>
        <div className="spacer" />
        <button type="button" className="btn sm" onClick={() => void attachBanner()} disabled={rendering || !s.campaign()} data-tip="Render the banner on the Graphics desk (Facebook 4:5, JPEG) and attach it">
          <Icon name="layers" size={13} /><span>{rendering ? 'Rendering' : 'Banner'}</span>
        </button>
        <button type="button" className="btn sm" onClick={insertStory} disabled={!liveSlug || !draft.headline.trim()}
          data-tip={liveSlug ? 'Add the Editorial story’s headline, deck and link to the end of the letter' : 'Publish the Editorial story first — its link must exist before it goes in an email'}>
          <Icon name="newspaper" size={13} /><span>Story link</span>
        </button>
        <button type="button" className="btn sm" onClick={() => input.current?.click()} disabled={!s.campaign()} data-tip="PDF, Word, Excel, PowerPoint, images, text or CSV — up to 18 MB together">
          <Icon name="plus" size={13} /><span>Add files</span>
        </button>
        <input ref={input} type="file" multiple accept={ACCEPT} hidden onChange={(e) => { void add(e.target.files); e.target.value = '' }} />
      </div>
      {s.attachments.length > 0 && (
        <div className="or-file-chips">
          {s.attachments.map((a) => (
            <span key={a.id} className="or-file-chip">
              <button type="button" className="or-file-open" onClick={() => setViewing(a)} data-tip={`Open ${a.name}`}>
                {/\.(pdf|docx)$/i.test(a.name) ? <FileTypeIcon kind={a.name.toLowerCase().endsWith('.pdf') ? 'pdf' : 'docx'} size={20} /> : <Icon name={a.mimeType.startsWith('image/') ? 'image' : 'filePlus'} size={14} />}
                <span className="or-file-name">{a.name}</span>
                <span className="or-file-size">{fmt(a.size)}</span>
                <span className="or-file-ok" aria-label="Attached" data-tip="Attached — saved with this campaign and sent with every email"><Icon name="check" size={12} strokeWidth={2.6} /></span>
              </button>
              <button type="button" className="or-file-x" aria-label={`Remove ${a.name}`} data-tip="Remove" onClick={() => s.removeAttachment(a.id)}><Icon name="x" size={12} /></button>
            </span>
          ))}
        </div>
      )}
      {viewing && <AttachmentViewer file={viewing} onClose={() => setViewing(null)} />}
    </div>
  )
}
