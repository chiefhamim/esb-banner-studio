// Live link between the Editorial draft and the Graphics banner.
// Change-driven (never state-driven): only a field that actually changed is copied across, and only when the
// other side differs, so the two subscriptions can never ping-pong.
import { useStore } from '../store'
import { useEditorialStore } from './editorialStore'
import { suggestHighlight } from '../core/newsroom'
import { isAutoDeskWrite } from './deskFlag'

let installed = false

/** Call once at startup. Works in every workspace, so editing in Graphics Studio flows back to the Editorial draft. */
export function installBannerLink() {
  if (installed) return
  installed = true

  // Editorial draft -> banner
  useEditorialStore.subscribe((s, prev) => {
    if (!s.bannerLink) return
    const banner = useStore.getState()
    const c = banner.doc.content
    const patch: Partial<typeof c> = {}

    if (s.draft.headline !== prev.draft.headline && s.draft.headline !== c.headline) {
      patch.headline = s.draft.headline
      // keep the highlighted phrase only while it is still part of the headline
      if (!c.highlight || !s.draft.headline.includes(c.highlight)) patch.highlight = suggestHighlight(s.draft.headline) || ''
    }
    if (s.draft.credit !== prev.draft.credit && s.draft.credit && s.draft.credit !== c.credit) patch.credit = s.draft.credit
    if (s.draft.social.facebook !== prev.draft.social.facebook && s.draft.social.facebook && s.draft.social.facebook !== c.caption) {
      patch.caption = s.draft.social.facebook
    }
    if (Object.keys(patch).length) banner.setContent(patch)
  })

  // Graphics banner -> Editorial draft
  useStore.subscribe((s, prev) => {
    const ed = useEditorialStore.getState()
    if (!ed.bannerLink) return
    const c = s.doc.content
    const p = prev.doc.content
    if (c === p) return

    if (c.headline !== p.headline && c.headline !== ed.draft.headline) ed.setDraftField('headline', c.headline)
    if (c.credit !== p.credit && c.credit !== ed.draft.credit) ed.setDraftField('credit', c.credit)
    if (c.caption !== p.caption && c.caption && c.caption !== ed.draft.social.facebook) ed.setSocialCaption('facebook', c.caption)
    // a desk picked in Graphics Studio is a deliberate choice
    if (c.categoryId !== p.categoryId && ed.deskAuto && !isAutoDeskWrite()) ed.setDeskAuto(false)
  })
}
