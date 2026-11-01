// ESB Studio — open and click tracking for Outreach letters, in the main process (OUTREACH_SYNC_CONTRACT §2–3).
//
// Every letter gets its own message key: 22 random base64url characters, made here at send time, never taken from
// the renderer. After the letter's HTML has been built and cut down (email-html.mjs sanitizeDesignHtml / renderEmail),
// and only then:
//   - each link to an allowlisted https host is rewritten through https://esbpowerline.com/r/{key}?u=…&c=…, which
//     records a click and 302s to the original (the site re-checks the same allowlist, so it is never an open redirect);
//     mailto:, #anchors, {unsubscribe} (already a mailto: by now) and every other host are left exactly as they were;
//   - ONE 1×1 picture, https://esbpowerline.com/api/o/{key}?c=…, is appended just before </body>. It is the only remote
//     image any letter may carry: the sanitizer still strips every non-cid: src the page itself brings.
// The endpoints live on the website (app/api/o, app/r). Until they answer, rewritten links would lead to a 404, so
// tracking is only switched on after the gate below has seen both endpoints respond the way the contract says.

const crypto = require('node:crypto')

const TRACK_HOSTS = new Set([
  'esbpowerline.com', 'www.esbpowerline.com',
  'facebook.com', 'www.facebook.com', 'm.facebook.com',
  'youtube.com', 'www.youtube.com', 'youtu.be',
  'wa.me', 'api.whatsapp.com',
])
const SITE = 'https://esbpowerline.com'
const KEY_RE = /^[A-Za-z0-9_-]{22}$/
const CAMPAIGN_RE = /^[A-Za-z0-9_-]{1,100}$/

/** 16 random bytes = exactly 22 base64url characters. */
function newMessageKey(randomBytes = crypto.randomBytes) {
  return randomBytes(16).toString('base64url').slice(0, 22)
}

const decodeAttr = (v) => String(v).replace(/&amp;/gi, '&').replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'").replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
const encodeAttr = (v) => String(v).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/**
 * May this link go through the click redirect? Only https, no user:password@ part, the default port, and a host
 * that IS one of the allowlisted names — `esbpowerline.com.evil.com` or `evil.com/esbpowerline.com` are not.
 * The browser's own URL parser decides what the host is (so `https://evil.com\@esbpowerline.com` is evil.com).
 */
function isTrackableUrl(href) {
  const raw = String(href ?? '').trim()
  if (!/^https:\/\//i.test(raw)) return false
  let u
  try { u = new URL(raw) } catch { return false }
  if (u.protocol !== 'https:' || u.username || u.password || u.port) return false
  const host = u.hostname.toLowerCase().replace(/\.$/, '')
  return TRACK_HOSTS.has(host)
}

const query = (campaignId) => (CAMPAIGN_RE.test(String(campaignId ?? '')) ? `c=${encodeURIComponent(campaignId)}` : '')

function clickUrl(key, original, campaignId) {
  const c = query(campaignId)
  return `${SITE}/r/${key}?u=${encodeURIComponent(original)}${c ? `&${c}` : ''}`
}

function pixelTag(key, campaignId) {
  const c = query(campaignId)
  return `<img src="${SITE}/api/o/${key}${c ? `?${c}` : ''}" width="1" height="1" alt="" style="display:block;width:1px;height:1px;border:0">`
}

/**
 * The letter as it is sent with tracking: allowlisted links rewritten, one pixel before </body>. `html` must already
 * be the sanitized, filled page; nothing the renderer sent is trusted to carry a key or a pixel.
 */
function trackHtml(html, { key, campaignId } = {}) {
  if (!KEY_RE.test(String(key ?? ''))) throw new Error('Bad message key')
  let out = String(html).replace(/(<a\b[^>]*?\shref\s*=\s*)("([^"]*)"|'([^']*)')/gi, (m, pre, _q, dq, sq) => {
    const href = decodeAttr(dq ?? sq ?? '')
    if (!isTrackableUrl(href)) return m
    return `${pre}"${encodeAttr(clickUrl(key, href.trim(), campaignId))}"`
  })
  const pixel = pixelTag(key, campaignId)
  const at = out.search(/<\/body\s*>(?![\s\S]*<\/body\s*>)/i)
  out = at >= 0 ? out.slice(0, at) + pixel + out.slice(at) : out + pixel
  return out
}

/**
 * Is tracking live on the site? Both endpoints are asked once (a key that is not 22 characters long, so nothing is
 * recorded): /api/o must answer a GIF and /r must redirect to esbpowerline.com. The answer is kept for 10 minutes
 * (a failure for 2), so a batch asks at most a few times an hour. ESB_OUTREACH_TRACKING=0 turns it off entirely.
 */
function createTrackingGate({ fetchFn = globalThis.fetch, clock = () => Date.now(), env = process.env } = {}) {
  let cached = null
  let inflight = null
  async function probe() {
    try {
      const ctl = new AbortController()
      const timer = setTimeout(() => ctl.abort(), 6000)
      try {
        const pix = await fetchFn(`${SITE}/api/o/probe.gif`, { redirect: 'manual', signal: ctl.signal, headers: { 'user-agent': 'ESB-Studio-tracking-check' } })
        const type = String(pix.headers?.get?.('content-type') || '')
        if (pix.status !== 200 || !/^image\/gif/i.test(type)) return { live: false, why: `pixel endpoint answered ${pix.status}` }
        const red = await fetchFn(`${SITE}/r/probe?u=${encodeURIComponent(`${SITE}/`)}`, { redirect: 'manual', signal: ctl.signal, headers: { 'user-agent': 'ESB-Studio-tracking-check' } })
        const loc = String(red.headers?.get?.('location') || '')
        if (red.status < 300 || red.status > 308 || !/^https:\/\/(www\.)?esbpowerline\.com(\/|$)/i.test(loc)) return { live: false, why: `click endpoint answered ${red.status}` }
        return { live: true }
      } finally { clearTimeout(timer) }
    } catch (e) {
      return { live: false, why: String((e && e.name === 'AbortError') ? 'no answer' : (e && e.message) || e).slice(0, 120) }
    }
  }
  async function enabled() {
    if (env.ESB_OUTREACH_TRACKING === '0') return false
    const now = clock()
    if (cached && now < cached.until) return cached.live
    inflight ??= probe().then((r) => { cached = { ...r, at: now, until: now + (r.live ? 600_000 : 120_000) }; inflight = null; return r.live })
    return inflight
  }
  const status = () => (env.ESB_OUTREACH_TRACKING === '0' ? { live: false, why: 'turned off', at: null } : cached ? { live: cached.live, why: cached.why || null, at: cached.at } : { live: null, why: 'not checked yet', at: null })
  return { enabled, status }
}

module.exports = { TRACK_HOSTS, KEY_RE, newMessageKey, isTrackableUrl, clickUrl, pixelTag, trackHtml, createTrackingGate }
