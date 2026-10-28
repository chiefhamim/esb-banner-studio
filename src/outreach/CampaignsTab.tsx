// Every campaign on this desk, newest first — like the Editorial story queue: the open one is raised, each row's edge
// carries its state (draft, scheduled, sending, paused, done), and the figures are the campaign's own results.

import { useOutreachStore } from './outreachStore'
import { ask, useOutreachUi } from './outreachUi'
import { Icon } from '../ui/Icon'
import { MenuButton } from '../ui/controls'
import type { Campaign } from './types'

export const STATUS_TEXT: Record<Campaign['status'], string> = { draft: 'Draft', scheduled: 'Scheduled', sending: 'Sending', paused: 'Paused', done: 'Done' }

const when = (t: number) => {
  const d = new Date(t), now = new Date()
  return d.toDateString() === now.toDateString() ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : d.toLocaleDateString([], { day: 'numeric', month: 'short' })
}

export function CampaignsTab() {
  const s = useOutreachStore()
  const ui = useOutreachUi()
  const idle = s.run === 'idle'
  const sorted = [...s.campaigns].sort((a, b) => b.updatedAt - a.updatedAt)

  return (
    <div className="or-tab">
      <div className="or-left-head or-new">
        <button type="button" className="btn primary" onClick={() => void s.createCampaign()} disabled={!idle} data-tip="A campaign to a mailing list (uses the list you have open)"><Icon name="plus" size={13} /><span>Campaign</span></button>
        <button type="button" className="btn" onClick={async () => { await s.createCampaign({ kind: 'direct', name: 'New email', listId: null, sheet: '', blueprint: 'blank', subject: '', body: '' }); ui.set({ left: 'contacts', view: 'edit' }) }} disabled={!idle} data-tip="An ordinary email to addresses you type"><Icon name="mail" size={13} /><span>Email</span></button>
      </div>
      <div className="or-list" role="listbox" aria-label="Campaigns">
        {!sorted.length ? (
          <div className="or-empty"><Icon name="send" size={22} /><b>No campaigns yet</b><p>A campaign is one letter to one audience, sent at a pace you set. Start one, or import a list and one is made for you.</p></div>
        ) : sorted.map((c) => {
          const sent = Object.keys(c.sent).length, failed = Object.keys(c.failed).length + Object.keys(c.bounced).length, replied = Object.keys(c.replied).length
          const on = c.id === s.activeId
          return (
            <div key={c.id} className={'or-row or-camp cs-' + c.status + (on ? ' on' : '')} role="option" aria-selected={on}>
              <button type="button" className="or-camp-open" onClick={() => void s.openCampaign(c.id)} disabled={!idle && !on}>
                <span className="or-row-main">
                  <span className="or-camp-top"><b>{c.name}</b><span className={'or-chip cs-' + c.status}>{c.status === 'scheduled' && c.scheduledAt ? when(c.scheduledAt) : STATUS_TEXT[c.status]}</span></span>
                  <span>{c.kind === 'direct' ? `Email · ${c.recipients.length} address${c.recipients.length === 1 ? '' : 'es'}` : `${s.lists.find((l) => l.id === c.listId)?.fileName ?? 'No list'}${c.sheet ? ` · ${c.sheet.replace(/_/g, ' ')}` : ''}`}</span>
                  <span className="or-camp-n">{sent ? [`${sent} sent`, replied && `${replied} replied`, failed && `${failed} failed`].filter(Boolean).join(' · ') : `Not sent · edited ${when(c.updatedAt)}`}</span>
                </span>
              </button>
              <MenuButton icon="more" className="ibtn or-camp-menu" title="Campaign actions" align="end" items={[
                { label: 'Open', icon: 'folder', disabled: on || !idle, onClick: () => void s.openCampaign(c.id) },
                { label: 'Duplicate', icon: 'copy', disabled: !idle, onClick: () => void s.duplicateCampaign(c.id) },
                { label: 'Rename…', icon: 'edit', disabled: !on, onClick: () => ui.set({ sheet: 'rename' }) },
                ...(c.status === 'scheduled' ? [{ label: 'Cancel the schedule', icon: 'clock' as const, onClick: () => s.patchById(c.id, { status: 'draft', scheduledAt: null }) }] : []),
                { divider: true },
                { label: 'Delete', icon: 'trash', danger: true, disabled: !idle && on, onClick: async () => { if (await ask({ title: `Delete “${c.name}”?`, body: 'Its letter, sources and results go with it. Addresses it already emailed stay protected by the 7-day rule.', ok: 'Delete', danger: true })) void s.deleteCampaign(c.id) } },
              ]} />
            </div>
          )
        })}
      </div>
    </div>
  )
}
