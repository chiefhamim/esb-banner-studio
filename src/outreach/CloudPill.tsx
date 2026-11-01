// The status bar's Cloud pill: whether this desk's campaigns, lists and send results are shared with the other PCs,
// and when they last were. Its own subscription and its own 5-second clock, so "Synced 12 s ago" never re-renders
// the desk around it. Click = sync now.

import { useEffect, useState } from 'react'
import { cloudText, useCloud } from './cloudStore'
import { syncNow } from './cloudSync'

const TIPS: Record<string, string> = {
  'signed-out': 'Campaigns stay on this PC only. Sign in with your esbpowerline.com staff account (Editorial desk, top right) to share them with the other PCs.',
  'test-run': 'This is a test run (ESB_OUTREACH_DRYRUN): nothing is really sent, so nothing is shared with the other PCs.',
  'not-setup': 'The shared Outreach tables are not on the site yet (website migration 0024). Sending works from this PC; sharing starts once they are.',
  'no-access': 'This account is not allowed to use the shared Outreach data. Sending still works from this PC.',
  offline: 'The shared copy could not be reached. Everything is kept here and goes up when the connection is back. Click to try now.',
  error: 'The last sync did not finish. It is tried again every minute. Click to try now.',
  syncing: 'Sending and fetching changes',
  ok: 'Campaigns, lists, designed letters and every send result are shared with the other PCs. Click to sync now.',
}

export function CloudPill() {
  const state = useCloud((x) => x.state)
  const lastSync = useCloud((x) => x.lastSync)
  const pending = useCloud((x) => x.pending)
  const error = useCloud((x) => x.error)
  const [, tick] = useState(0)
  useEffect(() => { const t = setInterval(() => tick((n) => n + 1), 5000); return () => clearInterval(t) }, [])
  const tone = state === 'ok' || state === 'syncing' ? 'on' : state === 'signed-out' || state === 'not-setup' || state === 'test-run' ? 'quiet' : 'off'
  const tip = `${TIPS[state]}${error && state !== 'ok' && state !== 'signed-out' ? ` (${error})` : ''}${pending && state !== 'ok' ? ` · ${pending} change${pending === 1 ? '' : 's'} waiting` : ''}`
  return (
    <button type="button" className={'sb-cms or-sb-cloud ' + tone} onClick={() => void syncNow()} data-tip={tip}>
      <span className="sb-k">Cloud</span>
      <span className="sb-pill"><i className="sb-dot" aria-hidden /><span className="sb-text">{cloudText({ state, lastSync, pending })}</span></span>
    </button>
  )
}
