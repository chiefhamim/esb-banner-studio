// Open an article that is already on esbpowerline.com for editing: the desk gets its real headline, deck, body, SEO
// and tags (read with the editor's token, so drafts open too), and the story is linked to that article, so Publish
// updates it instead of trying to create a second one with the same slug.

import { useEditorialStore } from './editorialStore'
import { useStoryQueue } from './storyQueue'
import { ensureFreshSession, findArticle, htmlToBody, SITE_BASE_URL } from './siteApi'
import type { LiveArticleSummary } from './siteApi'

export async function openArticleForEdit(art: LiveArticleSummary): Promise<{ exact: boolean }> {
  useStoryQueue.getState().newStory()
  const ed = useEditorialStore.getState()
  await ed.loadLiveArticleForEdit(art)
  const session = await ensureFreshSession(useEditorialStore.getState().staffSession)
  const row = await findArticle({ slug: art.slug }, session)
  const set = useEditorialStore.getState().setDraftField
  if (row) {
    set('headline', row.title)
    set('deck', row.excerpt ?? '')
    if (row.content?.trim()) set('body', htmlToBody(row.content))
    const tags = Array.isArray(row.tags) ? row.tags : []
    set('focusKeywords', tags.join(', '))
    set('focusKeyphrase', row.seo?.focusKeyword ?? tags[0] ?? '')
    set('metaTitle', row.seo?.metaTitle ?? row.title)
    set('metaDescription', row.seo?.metaDescription ?? row.excerpt ?? '')
    set('imageAlt', row.seo?.heroImage?.alt ?? '')
    set('imageCaption', row.seo?.heroImage?.caption ?? '')
    set('credit', row.imageCredit ?? 'ESB PowerLine')
    set('postAsNewsDesk', !!row.postAsNewsDesk)
  }
  const q = useStoryQueue.getState()
  q.saveActive()
  q.linkArticle({ id: row?.id, slug: art.slug, url: `${SITE_BASE_URL}/articles/${art.slug}` })
  return { exact: !!row }
}
