// The story editor: the CMS's formatting tools (headings, bold/italic/underline, highlight, lists, quote, link, table, rule)
// working on exactly the HTML the site keeps. Every change is sanitised on the way out, so what is stored is what is published.

import { useEffect, useRef, useState } from 'react'
import { EditorContent, useEditor } from '@tiptap/react'
import type { Editor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
import { Mark, mergeAttributes } from '@tiptap/core'
import { TableKit } from '@tiptap/extension-table'
import Image from '@tiptap/extension-image'
import { Icon } from '../ui/Icon'
import type { IconName } from '../ui/Icon'
import { htmlToPlain, plainToHtml, sanitizeBodyHtml } from './richBody'
import { ChartDialog } from './ChartDialog'
import { chartAlt, chartToBlob } from './chart'
import type { ChartSpec } from './chart'
import { altFromName, prepareImage } from './imageTools'

export type ImageUploader = (image: Blob) => Promise<{ ok: true; url: string } | { ok: false; error: string }>

/** Highlight exactly as the CMS writes it: a span with a background colour (the site has no <mark>). */
const Highlight = Mark.create({
  name: 'highlightColor',
  addAttributes() {
    return { color: { default: '#fde68a', parseHTML: (el) => (el as HTMLElement).style.backgroundColor || null, renderHTML: (a) => (a.color ? { style: `background-color: ${a.color}` } : {}) } }
  },
  parseHTML() { return [{ tag: 'span[style*="background-color"]' }] },
  renderHTML({ HTMLAttributes }) { return ['span', mergeAttributes(HTMLAttributes), 0] },
})

/** A picture in the story, the way the CMS writes it: a bare <img>, or a <figure> when it has a caption or credit; alignment is one of four fixed classes. */
const ALIGN = { default: '', full: 'article-img--full', left: 'article-img--left', center: 'article-img--center', right: 'article-img--right' } as const
type Align = keyof typeof ALIGN
const alignOf = (el: HTMLElement): Align => {
  const img = el.tagName === 'IMG' ? el : el.querySelector('img')
  for (const [k, v] of Object.entries(ALIGN)) if (v && img?.classList.contains(v)) return k as Align
  return 'default'
}
const FigureImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      caption: { default: '', renderHTML: () => ({}), parseHTML: () => '' },
      credit: { default: '', renderHTML: () => ({}), parseHTML: () => '' },
      align: { default: 'default', parseHTML: (el) => alignOf(el as HTMLElement), renderHTML: (a) => (ALIGN[a.align as Align] ? { class: ALIGN[a.align as Align] } : {}) },
    }
  },
  parseHTML() {
    return [
      {
        tag: 'figure.article-figure',
        getAttrs: (el) => {
          const e = el as HTMLElement
          const img = e.querySelector('img')
          if (!img) return false
          const cap = e.querySelector('figcaption')
          const clone = cap?.cloneNode(true) as HTMLElement | undefined
          clone?.querySelector('.article-figure__credit')?.remove()
          return { src: img.getAttribute('src'), alt: img.getAttribute('alt'), title: img.getAttribute('title'), caption: clone?.textContent?.trim() ?? '', credit: e.querySelector('.article-figure__credit')?.textContent?.replace(/^Photo:\s*/i, '').trim() ?? '' }
        },
      },
      { tag: 'img[src]' },
    ]
  },
  renderHTML({ HTMLAttributes, node }) {
    const caption = String(node.attrs.caption ?? '').trim()
    const credit = String(node.attrs.credit ?? '').trim()
    const { caption: _c, credit: _r, ...img } = HTMLAttributes as Record<string, unknown>
    if (!caption && !credit) return ['img', mergeAttributes(img)]
    const fc: unknown[] = ['figcaption', { class: 'article-figure__caption' }]
    if (caption) fc.push(caption)
    if (credit) fc.push(['span', { class: 'article-figure__credit' }, `Photo: ${credit}`])
    return ['figure', { class: 'article-figure' }, ['img', mergeAttributes(img)], fc]
  },
})

function Btn({ icon, label, on, disabled, onClick, text }: { icon?: IconName; label: string; on?: boolean; disabled?: boolean; onClick: () => void; text?: string }) {
  return (
    <button type="button" className={'rb-btn' + (on ? ' on' : '')} title={label} aria-label={label} aria-pressed={on} disabled={disabled} onMouseDown={(e) => e.preventDefault()} onClick={onClick}>
      {icon ? <Icon name={icon} size={15} /> : <span className="rb-txt">{text}</span>}
    </button>
  )
}

function Toolbar({ editor, onFile, onChart, msg }: { editor: Editor; onFile: (f: File) => void; onChart: () => void; msg: string | null }) {
  const [linkOpen, setLinkOpen] = useState(false)
  const [imgUrl, setImgUrl] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const onImage = editor.isActive('image')
  const img = editor.getAttributes('image') as { alt?: string; caption?: string; credit?: string; align?: Align }
  const setImg = (a: Record<string, unknown>) => editor.commands.updateAttributes('image', a)
  const addByUrl = () => { editor.chain().focus().insertContent({ type: 'image', attrs: { src: (imgUrl ?? '').trim(), alt: '', caption: '', credit: '', align: 'default' } }).run(); setImgUrl(null) }
  const [url, setUrl] = useState('')
  const inTable = editor.isActive('table')
  const c = () => editor.chain().focus()
  const openLink = () => { setUrl((editor.getAttributes('link').href as string) ?? 'https://'); setLinkOpen(true) }
  const applyLink = () => {
    const href = url.trim()
    if (!href || href === 'https://') c().unsetLink().run()
    else if (/^(https?:|mailto:)/i.test(href)) c().extendMarkRange('link').setLink({ href }).run()
    setLinkOpen(false)
  }
  return (
    <div className="rb-toolbar" role="toolbar" aria-label="Story formatting">
      <div className="rb-group">
        <Btn icon="undo" label="Undo" disabled={!editor.can().undo()} onClick={() => c().undo().run()} />
        <Btn icon="redo" label="Redo" disabled={!editor.can().redo()} onClick={() => c().redo().run()} />
      </div>
      <div className="rb-group">
        <Btn text="¶" label="Paragraph" on={editor.isActive('paragraph') && !editor.isActive('blockquote')} onClick={() => c().setParagraph().run()} />
        <Btn text="H2" label="Heading" on={editor.isActive('heading', { level: 2 })} onClick={() => c().toggleHeading({ level: 2 }).run()} />
        <Btn text="H3" label="Subheading" on={editor.isActive('heading', { level: 3 })} onClick={() => c().toggleHeading({ level: 3 }).run()} />
      </div>
      <div className="rb-group">
        <Btn icon="bold" label="Bold" on={editor.isActive('bold')} onClick={() => c().toggleBold().run()} />
        <Btn icon="italic" label="Italic" on={editor.isActive('italic')} onClick={() => c().toggleItalic().run()} />
        <Btn icon="underline" label="Underline" on={editor.isActive('underline')} onClick={() => c().toggleUnderline().run()} />
        <Btn icon="strike" label="Strikethrough" on={editor.isActive('strike')} onClick={() => c().toggleStrike().run()} />
        <Btn icon="highlight" label="Highlight" on={editor.isActive('highlightColor')} onClick={() => (editor.isActive('highlightColor') ? c().unsetMark('highlightColor').run() : c().setMark('highlightColor').run())} />
      </div>
      <div className="rb-group">
        <Btn icon="listBullet" label="Bullet points" on={editor.isActive('bulletList')} onClick={() => c().toggleBulletList().run()} />
        <Btn icon="listOrdered" label="Numbered list" on={editor.isActive('orderedList')} onClick={() => c().toggleOrderedList().run()} />
        <Btn icon="quote" label="Quotation" on={editor.isActive('blockquote')} onClick={() => c().toggleBlockquote().run()} />
      </div>
      <div className="rb-group">
        <Btn icon="link" label="Link" on={editor.isActive('link')} onClick={openLink} />
        <Btn icon="image" label="Add a picture" on={imgUrl !== null} onClick={() => setImgUrl(imgUrl === null ? '' : null)} />
        <Btn icon="chart" label="Add a chart" onClick={onChart} />
        <Btn icon="table" label="Insert table" onClick={() => c().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()} />
        <Btn icon="rule" label="Divider line" onClick={() => c().setHorizontalRule().run()} />
        <Btn icon="eraser" label="Clear formatting" onClick={() => c().unsetAllMarks().clearNodes().run()} />
      </div>
      {inTable && (
        <div className="rb-group rb-table">
          <Btn text="+ Row" label="Add row below" onClick={() => c().addRowAfter().run()} />
          <Btn text="+ Col" label="Add column right" onClick={() => c().addColumnAfter().run()} />
          <Btn text="− Row" label="Delete row" onClick={() => c().deleteRow().run()} />
          <Btn text="− Col" label="Delete column" onClick={() => c().deleteColumn().run()} />
          <Btn text="Header" label="Toggle header row" onClick={() => c().toggleHeaderRow().run()} />
          <Btn icon="trash" label="Delete table" onClick={() => c().deleteTable().run()} />
        </div>
      )}
      {imgUrl !== null && (
        <div className="rb-link rb-add-img">
          <button type="button" className="btn sm" onClick={() => fileRef.current?.click()}><Icon name="upload" size={13} /><span>Choose a file…</span></button>
          <span className="hint">or</span>
          <input className="input" type="url" placeholder="Paste a picture link (https://…)" value={imgUrl} onChange={(e) => setImgUrl(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && /^https?:\/\//i.test(imgUrl)) { e.preventDefault(); addByUrl() } }} />
          <button type="button" className="btn primary sm" disabled={!/^https?:\/\//i.test(imgUrl)} onClick={addByUrl}>Add</button>
          <button type="button" className="btn sm" onClick={() => setImgUrl(null)}>Close</button>
        </div>
      )}
      <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) { setImgUrl(null); onFile(f) } }} />
      {onImage && (
        <div className="rb-image">
          <div className="rb-group">
            {(['default', 'full', 'left', 'center', 'right'] as Align[]).map((a) => (
              <button key={a} type="button" className={'rb-btn' + ((img.align ?? 'default') === a ? ' on' : '')} title={{ default: 'Standard size', full: 'Full width', left: 'Float left', center: 'Centre', right: 'Float right' }[a]} onMouseDown={(e) => e.preventDefault()} onClick={() => setImg({ align: a })}><span className="rb-txt">{{ default: 'Std', full: 'Full', left: 'Left', center: 'Mid', right: 'Right' }[a]}</span></button>
            ))}
          </div>
          <input className="input" placeholder="Alt text — what the picture shows" value={img.alt ?? ''} onChange={(e) => setImg({ alt: e.target.value })} />
          <input className="input" placeholder="Caption" value={img.caption ?? ''} onChange={(e) => setImg({ caption: e.target.value })} />
          <input className="input rb-credit" placeholder="Photo credit" value={img.credit ?? ''} onChange={(e) => setImg({ credit: e.target.value })} />
          <Btn icon="trash" label="Remove picture" onClick={() => editor.chain().focus().deleteSelection().run()} />
        </div>
      )}
      {msg && <p className="rb-msg" role="status">{msg}</p>}
      {linkOpen && (
        <form className="rb-link" onSubmit={(e) => { e.preventDefault(); applyLink() }}>
          <input className="input" autoFocus type="url" placeholder="https://…" value={url} onChange={(e) => setUrl(e.target.value)} onKeyDown={(e) => e.key === 'Escape' && setLinkOpen(false)} />
          <button type="submit" className="btn primary sm">Apply</button>
          <button type="button" className="btn sm" onClick={() => setLinkOpen(false)}>Cancel</button>
        </form>
      )}
    </div>
  )
}

export function RichBodyEditor({ body, bodyHtml, onChange, uploadImage, accent }: { body: string; bodyHtml: string | null; onChange: (html: string, plain: string) => void; uploadImage: ImageUploader; accent: string }) {
  const [msg, setMsg] = useState<string | null>(null)
  const [chartOpen, setChartOpen] = useState(false)
  const [chartBusy, setChartBusy] = useState(false)
  const [chartErr, setChartErr] = useState<string | null>(null)
  const upRef = useRef(uploadImage)
  upRef.current = uploadImage
  const edRef = useRef<Editor | null>(null)
  const addRef = useRef<(f: File) => Promise<void>>(async () => {})
  const initial = bodyHtml ?? plainToHtml(body)
  const emitted = useRef<string | null>(null)
  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: { levels: [1, 2, 3] }, codeBlock: false, code: false, link: { openOnClick: false, autolink: true, HTMLAttributes: { rel: 'noopener noreferrer' } } }),
      TableKit.configure({ table: { resizable: false } }),
      FigureImage,
      Highlight,
      Placeholder.configure({ placeholder: 'The full English story. Use the tools above for headings, bullet points, quotations, tables and highlights.' }),
    ],
    shouldRerenderOnTransaction: true,
    content: initial,
    editorProps: {
      attributes: { class: 'rb-doc article-body', spellcheck: 'true', id: 'draft-body' },
      // a picture pasted or dropped in goes the same way as one chosen from the toolbar
      handlePaste: (_v, e) => { const f = Array.from(e.clipboardData?.files ?? []).find((x) => x.type.startsWith('image/')); if (!f) return false; void addRef.current(f); return true },
      handleDrop: (_v, e) => { const f = Array.from((e as DragEvent).dataTransfer?.files ?? []).find((x) => x.type.startsWith('image/')); if (!f) return false; e.preventDefault(); void addRef.current(f); return true },
    },
    onUpdate: ({ editor: ed }) => {
      const html = sanitizeBodyHtml(ed.getHTML())
      emitted.current = html
      onChange(html, htmlToPlain(html))
    },
  })

  edRef.current = editor
  addRef.current = async (file: File) => {
    const ed = edRef.current
    if (!ed) return
    setMsg('Preparing the picture…')
    try {
      const blob = await prepareImage(file)
      setMsg('Uploading to the site…')
      const up = await upRef.current(blob)
      if (!up.ok) { setMsg(up.error); return }
      ed.chain().focus().insertContent({ type: 'image', attrs: { src: up.url, alt: altFromName(file.name), caption: '', credit: '', align: 'default' } }).run()
      setMsg(null)
    } catch (err) {
      setMsg(err instanceof Error ? err.message : 'The picture could not be added.')
    }
  }
  const insertChart = async (spec: ChartSpec) => {
    const ed = edRef.current
    if (!ed) return
    setChartBusy(true); setChartErr(null)
    try {
      await document.fonts.load('800 40px "ESB Sans"')
      const up = await upRef.current(await chartToBlob(spec, accent))
      if (!up.ok) { setChartErr(up.error); return }
      ed.chain().focus().insertContent({ type: 'image', attrs: { src: up.url, alt: chartAlt(spec), caption: spec.title, credit: '', align: 'full' } }).run()
      setChartOpen(false)
    } catch (err) {
      setChartErr(err instanceof Error ? err.message : 'The chart could not be added.')
    } finally {
      setChartBusy(false)
    }
  }

  // the story changed from outside (a new translation, another story): load it, unless it is our own last edit coming back
  useEffect(() => {
    if (!editor || editor.isDestroyed) return
    const mine = emitted.current !== null && htmlToPlain(emitted.current) === body.trim()
    if (mine) return
    editor.commands.setContent(bodyHtml ?? plainToHtml(body), { emitUpdate: false })
  }, [editor, body, bodyHtml])

  if (!editor) return null
  return (
    <div className="rb">
      <Toolbar editor={editor} onFile={(f) => void addRef.current(f)} onChart={() => { setChartErr(null); setChartOpen(true) }} msg={msg} />
      <EditorContent editor={editor} className="rb-scroll" />
      {chartOpen && <ChartDialog accent={accent} busy={chartBusy} error={chartErr} onInsert={(s) => void insertChart(s)} onClose={() => setChartOpen(false)} />}
    </div>
  )
}
