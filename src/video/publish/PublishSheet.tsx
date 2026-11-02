// Publish: renders (the queue), the post itself (checks and Approve), and the connections. One sheet, three tabs.
import { useState } from 'react'
import { Dialog, Tabs } from '../../ui/controls'
import { PublishRenders } from './PublishRenders'
import { PublishPost } from './PublishPost'
import { PublishConnections } from './PublishConnections'

type Tab = 'renders' | 'post' | 'connections'

export function PublishSheet({ onClose, start = 'renders' }: { onClose: () => void; start?: Tab }) {
  const [tab, setTab] = useState<Tab>(start)
  const [renderId, setRenderId] = useState<string | undefined>()
  return (
    <Dialog title="Publish" kicker="YOUTUBE · FACEBOOK" onClose={onClose} width={640}>
      <div className="vw-pub">
        <Tabs<Tab> value={tab} onChange={setTab} options={[{ value: 'renders', label: 'Renders' }, { value: 'post', label: 'Post' }, { value: 'connections', label: 'Connections' }]} />
        <div className="vw-pub-body">
          {tab === 'renders' && <PublishRenders onPublish={(id) => { setRenderId(id); setTab('post') }} />}
          {tab === 'post' && <PublishPost initialRenderId={renderId} />}
          {tab === 'connections' && <PublishConnections />}
        </div>
      </div>
    </Dialog>
  )
}
