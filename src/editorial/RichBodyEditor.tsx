// The story editor: the CMS's formatting tools (headings, bold/italic/underline, highlight, lists, quote, link, table, rule)
// working on exactly the HTML the site keeps. Every change is sanitised on the way out, so what is stored is what is published.

import { useEffect, useRef, useState } from 'react'
import { EditorContent, useEditor } from '@tiptap/react'
import type { Editor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
import { Mark, mergeAttributes } from '@tiptap/core'
import { TableKit } from '@tiptap/extension-table'
import { Icon } from '../ui/Icon'
import type { IconName } from '../ui/Icon'
import { htmlToPlain, plainToHtml, sanitizeBodyHtml } from './richBody'

/** Highlight exactly as the CMS writes it: a span with a background colour (the site has no <mark>). */
const Highlight = Mark.create({
  name: 'highlightColor',
  addAttributes() {
    return { color: { default: '#fde68a', parseHTML: (el) => (el as HTMLElement).style.backgroundColor || null, renderHTML: (a) => (a.color ? { style: `background-color: ${a.color}` } : {}) } }
  },
  parseHTML() { return [{ tag: 'span[style*="background-color"]' }] },
  renderHTML({ HTMLAttributes }) { return ['span', mergeAttributes(HTMLAttributes), 0] },
})

function Btn({ icon, label, on, disabled, onClick, text }: { icon?: IconName; label: string; on?: boolean; disabled?: boolean; onClick: () => void; text?: string }) {
  return (
    <button type="button" className={'rb-btn' + (on ? ' on' : '')} title={label} aria-label={label} aria-pressed={on} disabled={disabled} onMouseDown={(e) => e.preventDefault()} onClick={onClick}>
      {icon ? <Icon name={icon} size={15} /> : <span className="rb-txt">{text}</span>}
    </button>
  )
}

function Toolbar({ editor }: { editor: Editor }) {
  const [linkOpen, setLinkOpen] = useState(false)
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

export function RichBodyEditor({ body, bodyHtml, onChange }: { body: string; bodyHtml: string | null; onChange: (html: string, plain: string) => void }) {
  const initial = bodyHtml ?? plainToHtml(body)
  const emitted = useRef<string | null>(null)
  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: { levels: [1, 2, 3] }, codeBlock: false, code: false, link: { openOnClick: false, autolink: true, HTMLAttributes: { rel: 'noopener noreferrer' } } }),
      TableKit.configure({ table: { resizable: false } }),
      Highlight,
      Placeholder.configure({ placeholder: 'The full English story. Use the tools above for headings, bullet points, quotations, tables and highlights.' }),
    ],
    shouldRerenderOnTransaction: true,
    content: initial,
    editorProps: { attributes: { class: 'rb-doc article-body', spellcheck: 'true', id: 'draft-body' } },
    onUpdate: ({ editor: ed }) => {
      const html = sanitizeBodyHtml(ed.getHTML())
      emitted.current = html
      onChange(html, htmlToPlain(html))
    },
  })

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
      <Toolbar editor={editor} />
      <EditorContent editor={editor} className="rb-scroll" />
    </div>
  )
}
