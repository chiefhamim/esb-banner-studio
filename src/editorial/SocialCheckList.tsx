// The social checklist under the caption box: what is checked on each channel, with where it comes from, and one
// button that has the AI provider rewrite whatever fails. Manual editing stays as it was.

import { Icon } from '../ui/Icon'
import type { SocialCheck } from './socialChecks'

const NAMES: Record<string, string> = { facebook: 'Facebook', x: 'X', linkedin: 'LinkedIn', telegram: 'Telegram' }

export function SocialChecks({ checks, active, onFix, busy, onUndo }: { checks: SocialCheck[]; active: string; onFix?: () => void; busy?: boolean; onUndo?: () => void }) {
  const good = checks.filter((c) => c.status === 'good').length
  const mine = checks.filter((c) => c.platform === active)
  const mineGood = mine.filter((c) => c.status === 'good').length
  return (
    <div className="seo-checks soc-checks">
      <div className="seo-checks-head">
        <b>{NAMES[active]} checks</b>
        <span className={'seo-score' + (mineGood === mine.length ? ' all' : '')}>{mineGood} of {mine.length} pass</span>
        <span className="seo-bar" aria-hidden><i style={{ width: `${(mineGood * 100) / Math.max(1, mine.length)}%` }} /></span>
      </div>
      <div className="seo-fixrow">
        <span className="hint">All channels: {good} of {checks.length} pass. These are current newsroom practice, not Google rules.</span>
        <div className="seo-fixbtns">
          {onUndo && <button type="button" className="btn sm" onClick={onUndo} disabled={busy}><Icon name="undo" size={13} /><span>Undo</span></button>}
          {onFix && <button type="button" className="btn sm ai-btn" onClick={onFix} disabled={busy || good === checks.length}><Icon name="sparkle" size={13} className={busy ? 'spin' : ''} /><span>{busy ? 'Fixing…' : good === checks.length ? 'All fixed' : 'Fix all with AI'}</span></button>}
        </div>
      </div>
      <div className="seo-group">
        {mine.map((c) => (
          <div key={c.id} className={'seo-check ' + c.status} data-tip={c.why}>
            <Icon name={c.status === 'good' ? 'check' : 'info'} size={13} />
            <span className="seo-check-label">{c.label}</span>
            <span className="seo-check-detail">{c.detail}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
