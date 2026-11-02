// Every finished post is written to Activity (the clock button) with its link, or, if it failed, the platform's own words.
// Runs once the Video desk has been opened: it catches up on posts that finished while the desk was closed, then follows
// live updates. A post is logged once (its id is remembered on this PC).
import { useJobLog } from '../../editorial/jobLog'

interface Dest { kind: string; state: string; error: string | null; result: { url?: string } | null; steps?: { name: string; status: string; error: string | null }[] }
interface Job { id: string; status: string; title: string; destinations: Dest[]; dryRun?: boolean }
type Api = { vpubJobs?: () => Promise<{ jobs?: Job[] }>; onVpubUpdate?: (cb: (j: Job) => void) => () => void }
const esb = () => (window as unknown as { esb?: Api }).esb
const KEY = 'esb-banner-studio/video/publish-logged/v1'
const NAME: Record<string, string> = { youtube: 'YouTube', facebook_reel: 'Facebook Reel', facebook_video: 'Facebook video' }
const TERMINAL = new Set(['done', 'failed', 'cancelled'])

const logged = (): Set<string> => { try { return new Set(JSON.parse(localStorage.getItem(KEY) ?? '[]')) } catch { return new Set() } }
const remember = (s: Set<string>) => { try { localStorage.setItem(KEY, JSON.stringify([...s].slice(-300))) } catch { /* not remembered: it may be logged twice */ } }

export function logPublishJob(j: Job): boolean {
  if (!TERMINAL.has(j.status)) return false
  const seen = logged()
  // once per outcome: a retry that ends differently is a new line in Activity
  const key = j.id + ":" + j.status + ":" + j.destinations.map((d) => d.state).join(",")
  if (seen.has(key)) return false
  seen.add(key)
  remember(seen)
  const where = j.destinations.map((d) => NAME[d.kind] ?? d.kind).join(' + ')
  const log = useJobLog.getState()
  const id = log.begin('publish', `Video: ${j.title}${j.dryRun ? ' (test run)' : ''}`, `Posting to ${where}`)
  for (const d of j.destinations) {
    const failed = d.state === 'failed' || d.state === 'cancelled'
    const why = d.error || d.steps?.find((s) => s.error)?.error
    log.step(id, `${NAME[d.kind] ?? d.kind}: ${d.state === 'done' ? (d.result?.url ?? 'posted') : failed ? (why ?? d.state) : d.state}`)
  }
  const bad = j.destinations.filter((d) => d.state !== 'done')
  log.finish(id, bad.length ? { error: bad.map((d) => `${NAME[d.kind] ?? d.kind}: ${d.error || d.steps?.find((s) => s.error)?.error || d.state}`).join(' · ') } : {})
  return true
}

let started = false
/** Catch up, then follow. Safe to call more than once. */
export function startPublishActivity() {
  if (started) return
  started = true
  const api = esb()
  if (!api?.vpubJobs) return
  void api.vpubJobs().then((r) => { for (const j of r?.jobs ?? []) logPublishJob(j) }).catch(() => {})
  api.onVpubUpdate?.((j) => { logPublishJob(j) })
}
