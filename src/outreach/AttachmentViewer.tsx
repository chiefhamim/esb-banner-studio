// Opens an attached file inside the desk, the file the recipients will get, byte for byte (it is read from the
// same data that is sent). Images as they are; PDFs drawn page by page with the pdf.js that reads PDFs on the
// Editorial desk; Word files as their text and headings through mammoth, cleaned by the same sanitiser the story body
// uses; text and CSV as written. Excel and PowerPoint have no viewer here — the sheet says so and offers a copy to
// open in Office, rather than showing a blank page.

import { useEffect, useRef, useState } from 'react'
import { Dialog } from '../ui/controls'
import { Icon } from '../ui/Icon'
import { loadPdfjs, fmtFileSize } from '../editorial/importDocument'
import { sanitizeBodyHtml } from '../editorial/richBody'
import type { AttachmentItem } from './types'

const ext = (n: string) => n.split('.').pop()?.toLowerCase() ?? ''
const bytesOf = (dataUrl: string) => { const b = atob(dataUrl.slice(dataUrl.indexOf(',') + 1)); const u = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return u }

export function saveCopy(a: AttachmentItem) {
  const url = URL.createObjectURL(new Blob([bytesOf(a.dataUrl)], { type: a.mimeType || 'application/octet-stream' }))
  const link = Object.assign(document.createElement('a'), { href: url, download: a.name })
  document.body.appendChild(link); link.click(); link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function PdfPages({ data }: { data: Uint8Array }) {
  const host = useRef<HTMLDivElement>(null)
  const [state, setState] = useState<string>('Drawing the pages')
  useEffect(() => {
    let dead = false
    void (async () => {
      try {
        const pdfjs = await loadPdfjs()
        const pdf = await pdfjs.getDocument({ data: data.slice() }).promise
        const pages = Math.min(pdf.numPages, 30)
        for (let i = 1; i <= pages && !dead; i++) {
          const page = await pdf.getPage(i)
          const vp = page.getViewport({ scale: 1.4 })
          const canvas = document.createElement('canvas')
          canvas.width = vp.width; canvas.height = vp.height
          await page.render({ canvasContext: canvas.getContext('2d')!, viewport: vp, canvas } as Parameters<typeof page.render>[0]).promise
          if (!dead) host.current?.appendChild(canvas)
        }
        if (!dead) setState(pdf.numPages > pages ? `First ${pages} of ${pdf.numPages} pages` : '')
      } catch (e) { if (!dead) setState(`This PDF could not be drawn: ${(e as Error).message}`) }
    })()
    return () => { dead = true }
  }, [data])
  return <>{state && <p className="hint">{state}</p>}<div ref={host} className="or-view-pdf" /></>
}

function DocxText({ data }: { data: Uint8Array }) {
  const [html, setHtml] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  useEffect(() => {
    void (async () => {
      try {
        const mammoth = (await import('mammoth/mammoth.browser')).default as { convertToHtml(o: { arrayBuffer: ArrayBuffer }): Promise<{ value: string }> }
        const r = await mammoth.convertToHtml({ arrayBuffer: data.slice().buffer })
        setHtml(sanitizeBodyHtml(r.value))
      } catch (e) { setErr((e as Error).message) }
    })()
  }, [data])
  if (err) return <p className="hint">This Word file could not be read: {err}</p>
  return html === null ? <p className="hint">Reading the document</p> : <div className="or-view-doc" dangerouslySetInnerHTML={{ __html: html }} />
}

export function AttachmentViewer({ file, onClose }: { file: AttachmentItem; onClose: () => void }) {
  const e = ext(file.name)
  const [data] = useState(() => bytesOf(file.dataUrl))
  const image = file.mimeType.startsWith('image/')
  const text = e === 'txt' || e === 'csv'
  return (
    <Dialog title={file.name} kicker={`ATTACHMENT · ${fmtFileSize(file.size)}`} width={image ? 820 : 760} onClose={onClose} footer={<>
      <span className="or-attached-note"><Icon name="check" size={14} />Attached — goes with every email of this campaign</span>
      <div className="spacer" />
      <button type="button" className="btn" onClick={() => saveCopy(file)}><Icon name="download" size={14} /><span>Save a copy</span></button>
      <button type="button" className="btn primary" onClick={onClose}>Done</button>
    </>}>
      <div className="or-view">
        {image ? <img src={file.dataUrl} alt={file.name} />
          : e === 'pdf' ? <PdfPages data={data} />
          : e === 'docx' ? <DocxText data={data} />
          : text ? <pre className="or-view-text">{new TextDecoder().decode(data).slice(0, 200_000)}</pre>
          : <div className="or-empty"><Icon name="filePlus" size={26} /><b>No preview for .{e} files here</b><p>It is attached and will be sent as it is. Save a copy to open it in Office.</p></div>}
      </div>
    </Dialog>
  )
}
