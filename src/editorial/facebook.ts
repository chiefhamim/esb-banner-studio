// The Facebook Page connection. The editor pastes the Page ID and a Page access token (from their Meta developer
// app); both stay in this machine's localStorage — never in the repo, never in a log — and every call goes straight
// from the app to graph.facebook.com with the token in an Authorization header (not in the URL).
// Publishing posts the 4:5 banner as a photo with the Facebook caption, which already ends with the article link.

const KEY = 'esb-banner-studio/facebook'
const GRAPH = 'https://graph.facebook.com/v26.0'

export interface FacebookConfig { pageId: string; token: string; pageName?: string }

export function getFacebook(): FacebookConfig | null {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? 'null') as FacebookConfig | null
    return v && /^\d{5,}$/.test(v.pageId) && v.token ? v : null
  } catch {
    return null
  }
}
export function saveFacebook(c: FacebookConfig) { try { localStorage.setItem(KEY, JSON.stringify(c)) } catch { /* ignore */ } }
export function clearFacebook() { try { localStorage.removeItem(KEY) } catch { /* ignore */ } }

/** Graph API errors in words an editor can act on. */
export function facebookError(status: number, body: { error?: { message?: string; code?: number } } | null): string {
  const code = body?.error?.code
  if (code === 190 || status === 401) return 'Facebook rejected the token — it expired or was revoked. Create a new Page access token and paste it again.'
  if (code === 200 || code === 10 || status === 403) return 'The token does not allow this. Posting needs pages_manage_posts and pages_read_engagement; commenting the article link needs pages_manage_engagement. Generate a new Page token with all three and paste it again.'
  if (code === 100) return 'Facebook could not find that Page ID, or the token is not for this Page.'
  if (code === 4 || code === 17 || code === 32) return 'Facebook is limiting requests right now. Wait a few minutes and try again.'
  return body?.error?.message ? `Facebook said: ${body.error.message}` : `Facebook answered HTTP ${status}.`
}

const auth = (token: string) => ({ Authorization: `Bearer ${token}` })

/** Read the Page the token belongs to — proves the ID and token pair works before anything is posted. */
export async function verifyFacebook(pageId: string, token: string): Promise<{ ok: true; name: string } | { ok: false; error: string }> {
  try {
    const res = await fetch(`${GRAPH}/${encodeURIComponent(pageId)}?fields=name`, { headers: auth(token) })
    const body = await res.json().catch(() => null)
    if (!res.ok || !body?.name) return { ok: false, error: facebookError(res.status, body) }
    return { ok: true, name: String(body.name) }
  } catch {
    return { ok: false, error: 'Could not reach Facebook. Check the connection and try again.' }
  }
}

/** Post the banner as a photo with a caption to the Page. */
export async function postBannerToFacebook(cfg: FacebookConfig, photo: Blob, caption: string): Promise<{ ok: true; postId: string; url: string } | { ok: false; error: string }> {
  try {
    const form = new FormData()
    form.append('source', photo, photo.type === 'image/png' ? 'banner.png' : 'banner.jpg')
    form.append('caption', caption)
    form.append('published', 'true')
    const res = await fetch(`${GRAPH}/${encodeURIComponent(cfg.pageId)}/photos`, { method: 'POST', headers: auth(cfg.token), body: form })
    const body = await res.json().catch(() => null)
    if (!res.ok || !(body?.post_id || body?.id)) return { ok: false, error: facebookError(res.status, body) }
    const postId = String(body.post_id || body.id)
    return { ok: true, postId, url: `https://www.facebook.com/${postId}` }
  } catch {
    return { ok: false, error: 'Could not reach Facebook. Check the connection and try again.' }
  }
}

/** Add a comment, as the Page, to one of the Page's posts - the article link goes here, not in the caption. */
export async function commentOnPost(cfg: FacebookConfig, postId: string, message: string): Promise<{ ok: true; commentId: string } | { ok: false; error: string }> {
  try {
    const form = new FormData()
    form.append('message', message)
    const res = await fetch(`${GRAPH}/${encodeURIComponent(postId)}/comments`, { method: 'POST', headers: auth(cfg.token), body: form })
    const body = await res.json().catch(() => null)
    if (!res.ok || !body?.id) return { ok: false, error: facebookError(res.status, body) }
    return { ok: true, commentId: String(body.id) }
  } catch {
    return { ok: false, error: 'Could not reach Facebook. Check the connection and try again.' }
  }
}

/**
 * Share a picture to the Page's Story (Meta's Page Stories API): upload it unpublished, then publish it as a photo
 * story. Meta may require the app to be approved for Stories; its refusal is reported in words.
 */
export async function postPhotoStory(cfg: FacebookConfig, photo: Blob): Promise<{ ok: true; storyId: string } | { ok: false; error: string }> {
  try {
    const up = new FormData()
    up.append('source', photo, photo.type === 'image/png' ? 'story.png' : 'story.jpg')
    up.append('published', 'false')
    const r1 = await fetch(`${GRAPH}/${encodeURIComponent(cfg.pageId)}/photos`, { method: 'POST', headers: auth(cfg.token), body: up })
    const b1 = await r1.json().catch(() => null)
    if (!r1.ok || !b1?.id) return { ok: false, error: facebookError(r1.status, b1) }
    const form = new FormData()
    form.append('photo_id', String(b1.id))
    const r2 = await fetch(`${GRAPH}/${encodeURIComponent(cfg.pageId)}/photo_stories`, { method: 'POST', headers: auth(cfg.token), body: form })
    const b2 = await r2.json().catch(() => null)
    if (!r2.ok || !(b2?.success || b2?.post_id)) {
      const base = facebookError(r2.status, b2)
      return { ok: false, error: `${base} Page Stories may need Meta's approval for your app.` }
    }
    return { ok: true, storyId: String(b2.post_id ?? b1.id) }
  } catch {
    return { ok: false, error: 'Could not reach Facebook. Check the connection and try again.' }
  }
}

const STORY_KEY = 'esb-banner-studio/fb-story'
export const getStoryOn = () => { try { return localStorage.getItem(STORY_KEY) === '1' } catch { return false } }
export const setStoryOn = (v: boolean) => { try { localStorage.setItem(STORY_KEY, v ? '1' : '0') } catch { /* ignore */ } }
