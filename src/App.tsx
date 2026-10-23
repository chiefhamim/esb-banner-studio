import { useEffect, useState } from 'react'
import './App.css'
import { loadBaseAssets } from './core/assets'
import type { Assets } from './core/render'
import { HomeWorkspace } from './shell/HomeWorkspace'
import { GraphicsWorkspace } from './shell/GraphicsWorkspace'
import { EditorialWorkspace } from './editorial/EditorialWorkspace'
import { VideoWorkspace } from './video/VideoWorkspace'
import { ComponentGallery } from './ui/ComponentGallery'
import { useShellStore } from './shell/shellStore'
import { useStore } from './store'
import { installBannerLink } from './editorial/bannerLink'
// the design layer loads after every other stylesheet so it is the last word on shared chrome
import './styles/studio.css'

installBannerLink()

export default function App() {
  const [base, setBase] = useState<Assets | null>(null)
  const workspace = useShellStore((s) => s.workspace)
  const theme = useStore((s) => s.theme)
  const isGallery = typeof window !== 'undefined' && window.location.search.includes('gallery')

  useEffect(() => {
    loadBaseAssets().then((b) => setBase(b))
  }, [])

  useEffect(() => {
    document.documentElement.dataset.theme = theme
  }, [theme])

  if (isGallery) {
    return <ComponentGallery />
  }

  return (
    <div className="studio-shell">
      <div className="workspace-main">
        {workspace === 'home' && <HomeWorkspace />}
        {workspace === 'editorial' && <EditorialWorkspace />}
        {workspace === 'video' && <VideoWorkspace />}
        {workspace === 'graphics' && (
          base ? <GraphicsWorkspace base={base} /> : (
            <div className="loading"><div className="spinner" />Loading fonts and artwork…</div>
          )
        )}
      </div>
    </div>
  )
}
