// Small single-colour marks for the four places a caption goes (they take the text colour), and the network picker
// on Story → Social: one tile per network with its mark, its length against that network's limit, and whether its
// checks pass — so the editor sees all four captions' state without opening each.

import type { SocialCheck } from './socialChecks'

export type SocialNet = 'facebook' | 'x' | 'linkedin' | 'telegram'

export function SocialMark({ net, size = 16 }: { net: SocialNet; size?: number }) {
  const common = { width: size, height: size, viewBox: '0 0 24 24', 'aria-hidden': true, focusable: false, fill: 'currentColor' } as const
  if (net === 'facebook') return <svg {...common}><path d="M12 2a10 10 0 0 0-1.6 19.9v-7H7.9V12h2.5V9.8c0-2.5 1.5-3.9 3.8-3.9 1.1 0 2.2.2 2.2.2v2.5h-1.2c-1.2 0-1.6.8-1.6 1.6V12h2.8l-.4 2.9h-2.3v7A10 10 0 0 0 12 2z" /></svg>
  if (net === 'x') return <svg {...common}><path d="M17.8 3h3.1l-6.8 7.8L22 21h-6.2l-4.9-6.4L5.3 21H2.2l7.3-8.3L2 3h6.3l4.4 5.8L17.8 3zm-1.1 16.2h1.7L7.4 4.7H5.6l11.1 14.5z" /></svg>
  if (net === 'linkedin') return <svg {...common}><path fillRule="evenodd" d="M4.5 3h15A1.5 1.5 0 0 1 21 4.5v15a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 19.5v-15A1.5 1.5 0 0 1 4.5 3zm2.8 7.2V18h2.4v-7.8H7.3zm1.2-3.9a1.4 1.4 0 1 0 0 2.8 1.4 1.4 0 0 0 0-2.8zm2.7 3.9V18h2.4v-4.2c0-1.1.3-2 1.5-2s1.3 1 1.3 2.1V18h2.4v-4.7c0-2.3-1.2-3.3-2.9-3.3-1.4 0-2 .7-2.4 1.3v-1.1h-2.3z" /></svg>
  return <svg {...common}><path d="M21.4 4.1 2.9 11.2c-1.1.4-1.1 1.5 0 1.8l4.6 1.4 1.7 5.4c.2.6.9.8 1.4.4l2.6-2.1 4.8 3.5c.6.5 1.5.1 1.7-.7l3.3-15.6c.2-.9-.7-1.6-1.6-1.2zM9.9 14.2l8-7.3-6.4 8.2-.3 2.7-1.3-3.6z" /></svg>
}

const LIMIT: Record<SocialNet, number> = { facebook: 125, x: 280, linkedin: 3000, telegram: 4096 }
const NAME: Record<SocialNet, string> = { facebook: 'Facebook', x: 'X', linkedin: 'LinkedIn', telegram: 'Telegram' }

export function SocialPicker({ value, onChange, captions, checks, lengthOf }: {
  value: SocialNet
  onChange: (n: SocialNet) => void
  captions: Record<SocialNet, string>
  checks: SocialCheck[]
  /** how a network counts length (X counts every link as 23) */
  lengthOf: (n: SocialNet, text: string) => number
}) {
  return (
    <div className="soc-pick" role="tablist" aria-label="Where the caption goes">
      {(Object.keys(NAME) as SocialNet[]).map((n) => {
        const text = captions[n] || ''
        const len = lengthOf(n, text)
        const mine = checks.filter((c) => c.platform === n)
        const pass = mine.filter((c) => c.status === 'good').length
        const over = len > LIMIT[n]
        return (
          <button key={n} type="button" role="tab" aria-selected={value === n} className={'soc-tile' + (value === n ? ' on' : '')} onClick={() => onChange(n)}
            data-tip={`${NAME[n]}: ${len} of ${LIMIT[n].toLocaleString()} characters${n === 'facebook' ? ' before "See more"' : ''} · ${pass} of ${mine.length} checks pass`}>
            <span className="soc-tile-mark"><SocialMark net={n} size={17} /></span>
            <span className="soc-tile-text">
              <b>{NAME[n]}</b>
              <small className={over ? 'over' : ''}>{text.trim() ? `${len} / ${LIMIT[n].toLocaleString()}` : 'Empty'}</small>
            </span>
            {mine.length > 0 && <i className={'soc-tile-state' + (pass === mine.length ? ' ok' : '')} aria-label={pass === mine.length ? 'All checks pass' : `${mine.length - pass} to fix`}>{pass === mine.length ? '' : mine.length - pass}</i>}
          </button>
        )
      })}
    </div>
  )
}
