// The Facebook Page connection. The editor pastes the Page ID and a Page access token (from their Meta developer
// app); both stay in this machine's localStorage — never in the repo, never in a log — and every call goes straight
// from the app to graph.facebook.com with the token in an Authorization header (not in the URL).
// Publishing posts the 4:5 banner as a photo with the Facebook caption, which already ends with the article link.

import { create } from 'zustand'

const KEY = 'esb-banner-studio/facebook'
const GRAPH = 'https://graph.facebook.com/v26.0'

export interface FacebookConfig {
  pageId: string
  token: string
  pageName?: string
  /** True when the token was made from a long-lived user token: Meta documents that such a Page token never expires. */
  permanent?: boolean
}

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
  if (code === 200 || code === 10 || status === 403) return 'The token does not allow this. Posting needs pages_manage_posts and pages_read_engagement; commenting the article link needs pages_manage_engagement. Generate a new Page token with all three and paste it again.' + (body?.error?.message ? ` Facebook's own words: ${body.error.message}` : '')
  if (code === 100) return 'Facebook could not find that Page ID, or the token is not for this Page.'
  if (code === 4 || code === 17 || code === 32) return 'Facebook is limiting requests right now. Wait a few minutes and try again.'
  return body?.error?.message ? `Facebook said: ${body.error.message}` : `Facebook answered HTTP ${status}.`
}

const auth = (token: string) => ({ Authorization: `Bearer ${token}` })

/** Read the Page the token belongs to — proves the ID and token pair works before anything is posted. */
const verified = new Map<string, { at: number; name: string }>()
const VERIFY_TTL = 5 * 60_000
/** Read the Page the token belongs to. A good answer is remembered for five minutes per ID + token; `fresh` forces a new call. */
export async function verifyFacebook(pageId: string, token: string, fresh = false): Promise<{ ok: true; name: string } | { ok: false; error: string }> {
  const key = `${pageId}|${token.slice(-12)}`
  const hit = verified.get(key)
  if (!fresh && hit && Date.now() - hit.at < VERIFY_TTL) return { ok: true, name: hit.name }
  try {
    const res = await fetch(`${GRAPH}/${encodeURIComponent(pageId)}?fields=name`, { headers: auth(token) })
    const body = await res.json().catch(() => null)
    if (!res.ok || !body?.name) return { ok: false, error: facebookError(res.status, body) }
    verified.set(key, { at: Date.now(), name: String(body.name) })
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
 * Why a pasted token "disappears": it does not - Facebook ends it. A token copied from the Graph API Explorer is a
 * short-lived USER token (about an hour), and a Page token made from it dies with it. A Page token made from a LONG-LIVED
 * user token does not expire. This does that exchange: the short-lived user token + the app's ID and secret give a
 * 60-day user token, which gives the Page's own token; `debug_token` then confirms it never expires. The app secret is
 * used for these calls only and is not stored anywhere.
 */
export async function makeTokenPermanent(input: { pageId: string; userToken: string; appId: string; appSecret: string }): Promise<{ ok: true; token: string; pageName: string; permanent: boolean } | { ok: false; error: string }> {
  const { pageId, userToken, appId, appSecret } = input
  try {
    const form = new FormData()
    form.append('grant_type', 'fb_exchange_token')
    form.append('client_id', appId)
    form.append('client_secret', appSecret)
    form.append('fb_exchange_token', userToken)
    const r1 = await fetch(`${GRAPH}/oauth/access_token`, { method: 'POST', body: form })
    const b1 = await r1.json().catch(() => null)
    if (!r1.ok || !b1?.access_token) return { ok: false, error: `Facebook would not extend the token. ${facebookError(r1.status, b1)} Check the App ID and App Secret, and that the token is a user token from the Graph API Explorer.` }
    const longUser = String(b1.access_token)
    const r2 = await fetch(`${GRAPH}/${encodeURIComponent(pageId)}?fields=access_token,name`, { headers: auth(longUser) })
    const b2 = await r2.json().catch(() => null)
    if (!r2.ok || !b2?.access_token) return { ok: false, error: `The extended token could not read this Page's own token. ${facebookError(r2.status, b2)} The Facebook account must be an admin of the Page, with pages_show_list granted.` }
    const pageToken = String(b2.access_token)
    // does it expire? (expires_at 0 = never)
    let permanent = false
    try {
      const r3 = await fetch(`${GRAPH}/debug_token?input_token=${encodeURIComponent(pageToken)}`, { headers: auth(`${appId}|${appSecret}`) })
      const b3 = await r3.json().catch(() => null)
      permanent = r3.ok && b3?.data?.expires_at === 0
    } catch { /* unknown: reported as not confirmed */ }
    return { ok: true, token: pageToken, pageName: String(b2.name ?? ''), permanent }
  } catch {
    return { ok: false, error: 'Could not reach Facebook. Check the connection and try again.' }
  }
}

const PREFS_KEY = 'esb-banner-studio/facebook-prefs'
const readPrefs = (): { linkComment: boolean } => { try { return { linkComment: (JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}') as { linkComment?: boolean }).linkComment !== false } } catch { return { linkComment: true } } }

/** How a Facebook post is made, as the editor set it: whether the article link is added as the post's first comment (on unless turned off). */
export const useFacebookPrefs = create<{ linkComment: boolean; setLinkComment: (v: boolean) => void }>((set) => ({
  ...readPrefs(),
  setLinkComment: (linkComment) => { try { localStorage.setItem(PREFS_KEY, JSON.stringify({ linkComment })) } catch { /* ignore */ } set({ linkComment }) },
}))
