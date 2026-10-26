// A document sheet with a folded corner and a colour label across its lower edge: red for PDF, blue for Word.
// Drawn here (not an icon font) so it stays crisp at any size and takes the app's own typeface for the label.
import { useId } from 'react'

export type FileKind = 'pdf' | 'docx'

const TONES: Record<FileKind, { top: string; bottom: string; label: string }> = {
  pdf: { top: '#f4675f', bottom: '#cf372f', label: 'PDF' },
  docx: { top: '#5a98f5', bottom: '#2a5fd0', label: 'DOC' },
}

export function FileTypeIcon({ kind, size = 36, className = '' }: { kind: FileKind; size?: number; className?: string }) {
  const id = useId().replace(/:/g, '')
  const t = TONES[kind]
  return (
    <svg className={'file-icon ' + className} width={(size * 40) / 48} height={size} viewBox="0 0 40 48" aria-hidden focusable="false">
      <defs>
        <linearGradient id={`g${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={t.top} />
          <stop offset="1" stopColor={t.bottom} />
        </linearGradient>
        <linearGradient id={`p${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="var(--file-page-top, #ffffff)" />
          <stop offset="1" stopColor="var(--file-page-bottom, #eceef2)" />
        </linearGradient>
      </defs>
      {/* the sheet */}
      <path d="M8 1.5h16.2a3 3 0 0 1 2.1.9l8.3 8.3a3 3 0 0 1 .9 2.1V41a5.5 5.5 0 0 1-5.5 5.5H8A5.5 5.5 0 0 1 2.5 41V7A5.5 5.5 0 0 1 8 1.5Z" fill={`url(#p${id})`} stroke="var(--file-edge, rgba(20,22,30,.14))" />
      {/* the folded corner */}
      <path d="M24.5 1.8v6.7a3.2 3.2 0 0 0 3.2 3.2h6.8" fill="var(--file-fold, #e1e4ea)" stroke="var(--file-edge, rgba(20,22,30,.14))" strokeLinejoin="round" />
      {/* a few lines of text on the page */}
      <rect x="9" y="15" width="13" height="2" rx="1" fill={t.bottom} opacity=".22" />
      <rect x="9" y="20" width="19" height="2" rx="1" fill={t.bottom} opacity=".14" />
      <rect x="9" y="25" width="16" height="2" rx="1" fill={t.bottom} opacity=".14" />
      {/* the label, overhanging the left edge */}
      <rect x="0" y="29.5" width="27" height="12.5" rx="3.2" fill={`url(#g${id})`} />
      <rect x="0.5" y="30" width="26" height="11.5" rx="2.8" fill="none" stroke="#fff" strokeOpacity=".28" />
      <text x="13.5" y="38.6" textAnchor="middle" fill="#fff" fontFamily="inherit" fontSize="8.2" fontWeight="800" letterSpacing=".6">{t.label}</text>
    </svg>
  )
}

/** PDF and Word side by side: what the Paste tab accepts. */
export function FileTypePair({ size = 36 }: { size?: number }) {
  return (
    <span className="file-pair" aria-hidden>
      <FileTypeIcon kind="pdf" size={size} />
      <FileTypeIcon kind="docx" size={size} />
    </span>
  )
}
