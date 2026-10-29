// src/outreach/ActivityOverview.tsx
// Activity Desk Overview tab: KPI strip, hourly distribution, running jobs, days chart, durations (§3.4, §5.7).

import { useActivityStore } from './activityStore'
import { BarChart } from './charts'
import { fmtDuration, fmtDay, describeRun } from './activityFormat'
import { Icon } from '../ui/Icon'
import { useEngineStore } from './engineStore'
import { engineClient } from './engineClient'

export function ActivityOverview() {
  const store = useActivityStore()
  const engine = useEngineStore()
  const stats = store.stats
  const settings = engine.settings

  if (store.isLoading && !stats) {
    return (
      <div className="oa-loading-state">
        <div className="oa-loading-skeleton kpi-strip" />
        <div className="oa-loading-skeleton chart-row" />
      </div>
    )
  }

  if (store.isError) {
    return (
      <div className="oa-error-state">
        <Icon name="info" size={24} />
        <p>{store.errorMessage || 'Failed to load activity metrics.'}</p>
        <button className="btn sm" onClick={() => store.fetchStats()}>
          Try again
        </button>
      </div>
    )
  }

  const totals = stats?.totals
  const hasHistory = totals && (totals.sent > 0 || totals.failed > 0 || totals.bounced > 0 || totals.replied > 0)

  if (!hasHistory) {
    return (
      <div className="oa-empty-desk">
        <div className="oa-empty-card">
          <Icon name="mail" size={32} />
          <h3>No activity yet</h3>
          <p>
            Nothing has been sent from this app yet. When a campaign runs, every email, reply and problem is listed here
            with its time.
          </p>
        </div>
      </div>
    )
  }

  // Active running jobs
  const activeJobs = (stats?.jobs || []).filter((j) =>
    ['running', 'waiting', 'paused', 'queued'].includes(j.status)
  )

  // 1. KPI strip calculations
  const sentToday = stats.today.reduce((acc, h) => acc + h.sent, 0)
  const sentRange = totals.sent
  const replies = totals.replied
  const bounced = totals.bounced + totals.failed
  const stillToSend = activeJobs.reduce((acc, j) => acc + (j.remaining || 0), 0)

  let finishesAbout = '—'
  const firstActiveWithEta = activeJobs.find((j) => j.etaAt)
  if (firstActiveWithEta?.etaAt) {
    finishesAbout = fmtDay(firstActiveWithEta.etaAt, stats.window?.tz)
  }

  // 2. Today by hour chart data
  const hourData = stats.today.map((h) => ({
    label: `${String(h.t).padStart(2, '0')}:00`,
    sent: h.sent,
    failed: h.failed,
    tooltip: `${String(h.t).padStart(2, '0')}:00–${String((h.t + 1) % 24).padStart(2, '0')}:00 · ${h.sent} sent · ${h.failed} failed`,
  }))

  // 3. Days chart data
  const daysData = stats.byDay.map((d) => ({
    label: d.day.slice(5), // "MM-DD"
    sent: d.sent,
    failed: d.failed,
    bounced: d.bounced,
    replies: d.replied,
    tooltip: `${d.day} · ${d.sent} sent · ${d.failed} failed · ${d.bounced} bounced · ${d.replied} replies`,
  }))

  // Send window band for today (default 09:00 to 17:00)
  const windowBand = stats.window
    ? {
        fromIndex: parseInt(stats.window.from.split(':')[0], 10) || 9,
        toIndex: parseInt(stats.window.to.split(':')[0], 10) || 17,
        label: `Send window (${stats.window.from}–${stats.window.to})`,
      }
    : undefined

  const durations = stats.durations

  return (
    <div className="oa-overview">
      {/* KPI strip (6 tiles) */}
      <section className="oa-kpi-strip" aria-label="Key Performance Indicators">
        <div className="oa-kpi-tile">
          <div className="oa-kpi-caption">SENT TODAY</div>
          <div className="oa-kpi-figure">{sentToday.toLocaleString()}</div>
          <div className="oa-kpi-sub">of {stats.cap || 60} cap</div>
        </div>

        <div className="oa-kpi-tile">
          <div className="oa-kpi-caption">SENT (RANGE)</div>
          <div className="oa-kpi-figure">{sentRange.toLocaleString()}</div>
          <div className="oa-kpi-sub">total emails</div>
        </div>

        <div className="oa-kpi-tile">
          <div className="oa-kpi-caption">REPLIES</div>
          <div className="oa-kpi-figure">{replies.toLocaleString()}</div>
          <div className="oa-kpi-sub">
            {sentRange > 0 ? `${Math.round((replies / sentRange) * 100)}% of sent` : '0% of sent'}
          </div>
        </div>

        <div className="oa-kpi-tile">
          <div className="oa-kpi-caption">BOUNCED OR REFUSED</div>
          <div className="oa-kpi-figure">{bounced.toLocaleString()}</div>
          <div className="oa-kpi-sub">
            {totals.optedOut > 0 ? `${totals.optedOut} unsubscribed` : 'undeliverable'}
          </div>
        </div>

        <div className="oa-kpi-tile">
          <div className="oa-kpi-caption">STILL TO SEND</div>
          <div className="oa-kpi-figure">{stillToSend.toLocaleString()}</div>
          <div className="oa-kpi-sub">{activeJobs.length} active runs</div>
        </div>

        <div className="oa-kpi-tile">
          <div className="oa-kpi-caption">FINISHES ABOUT</div>
          <div className="oa-kpi-figure sm">{finishesAbout}</div>
          <div className="oa-kpi-sub">{activeJobs.length > 0 ? 'based on window & cap' : 'no active runs'}</div>
        </div>
      </section>

      {/* Row 2: Today by hour + Running now cards */}
      <section className="oa-grid-row-2">
        <div className="oa-panel">
          <BarChart
            title="Today by hour"
            summary="Distribution of sends and problems across hours in your schedule time zone."
            data={hourData}
            series={[
              { key: 'sent', label: 'Sent', colorVar: 'var(--or-sent)' },
              { key: 'failed', label: 'Failed', colorVar: 'var(--danger)' },
            ]}
            stacked={true}
            band={windowBand}
            rule={stats.cap ? { value: stats.cap / 8, label: 'Target pace' } : undefined}
          />
        </div>

        <div className="oa-panel oa-running-panel">
          <div className="oa-panel-head">
            <h3>Running now</h3>
            <span className="or-muted">{activeJobs.length} active</span>
          </div>

          <div className="oa-running-list">
            {activeJobs.length === 0 ? (
              <div className="oa-no-runs">
                <p>No sending is running.</p>
                {stats.lastSendAt && (
                  <div className="oa-last-run-note">
                    Last sent email: {fmtDay(stats.lastSendAt, stats.window?.tz)}
                  </div>
                )}
              </div>
            ) : (
              activeJobs.map((job) => {
                const desc = describeRun(job, settings)
                return (
                  <div key={job.jobId} className="oa-job-card">
                    <div className="oa-job-card-top">
                      <span className="oa-job-name">{job.name || 'Campaign'}</span>
                      <span className={`or-chip ${desc.chipClass}`}>{desc.label}</span>
                    </div>

                    <div className="oa-job-sentence or-muted">{desc.sentence}</div>

                    <div className="oa-meter">
                      <div className="oa-meter-fill" style={{ width: `${desc.percent}%` }} />
                    </div>

                    <div className="oa-job-metrics">
                      <span>{desc.countText}</span>
                      {desc.nextInText && <span className="or-muted">{desc.nextInText}</span>}
                    </div>

                    <div className="oa-job-actions">
                      {job.status === 'running' || job.status === 'waiting' ? (
                        <button
                          className="btn xs"
                          onClick={() => engineClient.control(job.jobId, 'pause')}
                        >
                          <Icon name="pause" size={13} />
                          <span>Pause</span>
                        </button>
                      ) : (
                        <button
                          className="btn xs"
                          onClick={() => engineClient.control(job.jobId, 'resume')}
                        >
                          <Icon name="play" size={13} />
                          <span>Resume</span>
                        </button>
                      )}
                      <button
                        className="btn xs danger-text"
                        onClick={() => engineClient.control(job.jobId, 'stop')}
                      >
                        <Icon name="x" size={13} />
                        <span>Stop</span>
                      </button>
                    </div>
                  </div>
                )
              })
            )}
          </div>
        </div>
      </section>

      {/* Row 3: Days chart */}
      <section className="oa-panel oa-days-panel">
        <BarChart
          title="Daily history"
          summary="Sends, failures, bounces and replies over the selected date range."
          data={daysData}
          series={[
            { key: 'sent', label: 'Sent', colorVar: 'var(--or-sent)' },
            { key: 'failed', label: 'Failed', colorVar: 'var(--danger)' },
            { key: 'bounced', label: 'Bounced', colorVar: 'var(--warning)' },
          ]}
          stacked={true}
          lineSeries={{ key: 'replies', label: 'Replies', colorVar: 'var(--or-reply)' }}
        />
      </section>

      {/* Row 4: How long it took (6 figures) */}
      <section className="oa-panel oa-durations-panel">
        <div className="oa-panel-head">
          <h3>How long it took</h3>
          <span className="or-muted">Pacing & performance metrics</span>
        </div>

        <div className="oa-durations-grid">
          <div className="oa-duration-tile" title="Average time taken by the SMTP server to accept each email.">
            <div className="oa-duration-label">
              <span>Avg time per email</span>
              <Icon name="info" size={12} />
            </div>
            <div className="oa-duration-val">
              {durations?.avgSendMs ? `${(durations.avgSendMs / 1000).toFixed(1)} s` : '—'}
            </div>
            <div className="oa-duration-sub">p95: {(durations?.p95SendMs || 0) / 1000} s</div>
          </div>

          <div className="oa-duration-tile" title="Average delay spaced out between consecutive emails.">
            <div className="oa-duration-label">
              <span>Average gap</span>
              <Icon name="info" size={12} />
            </div>
            <div className="oa-duration-val">
              {durations?.avgGapSec ? fmtDuration(durations.avgGapSec) : '—'}
            </div>
            <div className="oa-duration-sub">between sends</div>
          </div>

          <div className="oa-duration-tile" title="Total accumulated time when campaigns were actively sending.">
            <div className="oa-duration-label">
              <span>Time sending</span>
              <Icon name="info" size={12} />
            </div>
            <div className="oa-duration-val">
              {durations?.activeMs ? fmtDuration(Math.round(durations.activeMs / 1000)) : '0 s'}
            </div>
            <div className="oa-duration-sub">active send time</div>
          </div>

          <div className="oa-duration-tile" title="Total wall-clock elapsed time across the selected date range.">
            <div className="oa-duration-label">
              <span>Elapsed time</span>
              <Icon name="info" size={12} />
            </div>
            <div className="oa-duration-val">
              {durations?.elapsedMs ? fmtDuration(Math.round(durations.elapsedMs / 1000)) : '—'}
            </div>
            <div className="oa-duration-sub">wall clock</div>
          </div>

          <div className="oa-duration-tile" title="Effective delivery throughput per hour of active sending.">
            <div className="oa-duration-label">
              <span>Emails per active hour</span>
              <Icon name="info" size={12} />
            </div>
            <div className="oa-duration-val">
              {durations?.perActiveHour ? `${durations.perActiveHour}` : '—'}
            </div>
            <div className="oa-duration-sub">throughput</div>
          </div>

          <div className="oa-duration-tile" title="Median duration between sending an email and receiving a recipient reply.">
            <div className="oa-duration-label">
              <span>Median time to reply</span>
              <Icon name="info" size={12} />
            </div>
            <div className="oa-duration-val">
              {stats.replyMedianMs ? fmtDuration(Math.round(stats.replyMedianMs / 1000)) : '—'}
            </div>
            <div className="oa-duration-sub">response speed</div>
          </div>
        </div>
      </section>
    </div>
  )
}
