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
import { Tooltips } from './ui/controls'
import { CATEGORIES } from './core/tokens'
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

  // The story's category colour on the page root, so menus, popovers and dialogs (drawn outside the workspaces) mark
  // a selection in the same colour as the open panel and the chosen tile
  const categoryId = useStore((s) => s.doc.content.categoryId)
  useEffect(() => {
    const c = CATEGORIES.find((x) => x.id === categoryId)
    const root = document.documentElement.style
    if (c) { root.setProperty('--cat', c.accent); root.setProperty('--cat-ink', c.chipText) } else { root.removeProperty('--cat'); root.removeProperty('--cat-ink') }
  }, [categoryId])

  // Ctrl+Q quits the desktop app from any workspace, as the Home → Quit button does
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'q' && window.esb?.quit) { e.preventDefault(); void window.esb.quit() }
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [])

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
      {/* one tooltip layer for every workspace (it lived inside Graphics, so Editorial, Video and Home had none) */}
      <Tooltips />
    </div>
  )
}
