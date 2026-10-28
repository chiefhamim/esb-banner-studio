import { useRef } from 'react'
import { useOutreachStore } from './outreachStore'
import { Icon } from '../ui/Icon'
import { useStore } from '../store'
import { useEditorialStore } from '../editorial/editorialStore'
import type { AttachmentItem } from './types'

export function AttachmentTray() {
  const attachments = useOutreachStore((s) => s.attachments)
  const addAttachment = useOutreachStore((s) => s.addAttachment)
  const removeAttachment = useOutreachStore((s) => s.removeAttachment)
  const setBodyHtml = useOutreachStore((s) => s.setBodyHtml)
  const addLog = useOutreachStore((s) => s.addLog)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const totalBytes = attachments.reduce((acc, a) => acc + a.size, 0)
  const totalMB = (totalBytes / (1024 * 1024)).toFixed(1)
  const isOverLimit = totalBytes > 25 * 1024 * 1024
  const isWarning = totalBytes > 20 * 1024 * 1024

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (!files || files.length === 0) return

    for (let i = 0; i < files.length; i++) {
      const f = files[i]
      const reader = new FileReader()
      reader.onload = (ev) => {
        const dataUrl = ev.target?.result as string
        const item: AttachmentItem = {
          id: 'att_' + Date.now() + '_' + i,
          name: f.name,
          size: f.size,
          mimeType: f.type || 'application/octet-stream',
          dataUrl,
        }
        addAttachment(item)
      }
      reader.readAsDataURL(f)
    }
    e.target.value = ''
  }

  // Cross-Desk Bridge 1: Attach Current Graphics Banner
  const handleAttachBanner = async () => {
    try {
      // Find the active artboard canvas from Graphics Desk
      const canvas = document.querySelector<HTMLCanvasElement>('.stage canvas, canvas#artboard')
      if (!canvas) {
        // Fallback: check doc headline from graphics store
        const headline = useStore.getState().doc.content.headline || 'ESB PowerLine Banner'
        addLog('warning', `Canvas not currently rendered. Using banner document: ${headline}`)
        return
      }

      const dataUrl = canvas.toDataURL('image/png')
      // calculate approximate size from base64
      const approxBytes = Math.round((dataUrl.length * 3) / 4)
      const bannerItem: AttachmentItem = {
        id: 'banner_' + Date.now(),
        name: `ESB_PowerLine_Banner_${Date.now()}.png`,
        size: approxBytes,
        mimeType: 'image/png',
        dataUrl,
        isInline: true,
        cid: 'esb_banner_art',
      }
      addAttachment(bannerItem)
      addLog('success', 'Attached current Graphics Desk composition (PNG).')
    } catch (err) {
      addLog('error', `Could not capture banner: ${String(err)}`)
    }
  }

  // Cross-Desk Bridge 2: Insert Active Editorial Story Card
  const handleInsertEditorialStory = () => {
    try {
      const draft = useEditorialStore.getState().draft
      if (!draft || !draft.headline) {
        addLog('warning', 'No active story on Editorial Desk to insert.')
        return
      }

      const currentHtml = useOutreachStore.getState().bodyHtml
      const articleUrl = draft.slug ? `https://esbpowerline.com/news/${draft.slug}` : 'https://esbpowerline.com'
      const storyCard = `
<div style="margin: 16px 0; padding: 14px 18px; border-left: 3px solid #0aa37a; background: #131b26; border-radius: 6px; font-family: sans-serif;">
  <span style="font-size: 11px; text-transform: uppercase; color: #1fd3a8; font-weight: 700; letter-spacing: 0.5px;">ESB PowerLine Intelligence Feature</span>
  <h3 style="margin: 6px 0 4px 0; font-size: 15px; color: #ffffff; font-weight: 700; line-height: 1.3;">${draft.headline}</h3>
  <p style="margin: 0 0 10px 0; font-size: 13px; color: #94a3b8; line-height: 1.4;">${draft.deck || ''}</p>
  <a href="${articleUrl}" style="display: inline-block; font-size: 12px; color: #38bdf8; text-decoration: none; font-weight: 600;">Read Full Analysis on ESB PowerLine &rarr;</a>
</div>
`
      setBodyHtml(currentHtml + '\n' + storyCard)
      addLog('success', `Inserted story card: "${draft.headline.substring(0, 40)}..."`)
    } catch (err) {
      addLog('error', `Failed inserting editorial story: ${String(err)}`)
    }
  }

  return (
    <div className="outreach-attachment-tray">
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
        <div className="row" style={{ gap: 6, alignItems: 'center' }}>
          <Icon name="paperclip" size={13} />
          <strong style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.4px', opacity: 0.8 }}>
            Attachments & Assets
          </strong>
          <span className={'payload-pill' + (isOverLimit ? ' danger' : isWarning ? ' warning' : '')}>
            {totalMB} MB / 25 MB
          </span>
        </div>

        {/* 1-Click Bridge Buttons */}
        <div className="row" style={{ gap: 5 }}>
          <button
            type="button"
            className="btn xs subtle"
            data-tip="Render and attach active banner from Graphics Desk"
            onClick={handleAttachBanner}
          >
            <Icon name="layers" size={12} />
            <span>+ Attach Studio Banner</span>
          </button>

          <button
            type="button"
            className="btn xs subtle"
            data-tip="Insert active newsroom story from Editorial Desk"
            onClick={handleInsertEditorialStory}
          >
            <Icon name="newspaper" size={12} />
            <span>+ Insert Editorial Story</span>
          </button>

          <button
            type="button"
            className="btn xs"
            data-tip="Attach any file from PC (PDF, DOCX, XLSX, Photos)"
            onClick={() => fileInputRef.current?.click()}
          >
            <Icon name="plus" size={12} />
            <span>Add Files</span>
          </button>

          <input
            ref={fileInputRef}
            type="file"
            multiple
            style={{ display: 'none' }}
            onChange={handleFileSelect}
          />
        </div>
      </div>

      {/* Attachment chips */}
      {attachments.length > 0 && (
        <div className="row att-chips-wrap" style={{ gap: 6, flexWrap: 'wrap' }}>
          {attachments.map((a) => (
            <div key={a.id} className="att-chip">
              <Icon name={a.mimeType.startsWith('image/') ? 'image' : 'filePlus'} size={12} />
              <span className="att-name" title={a.name}>{a.name}</span>
              <span className="att-size">({Math.round(a.size / 1024)} KB)</span>
              <button
                type="button"
                className="att-del"
                data-tip="Remove attachment"
                onClick={() => removeAttachment(a.id)}
              >
                &times;
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
