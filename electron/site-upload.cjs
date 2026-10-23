// Upload one rendered banner to esbpowerline.com's media library, as the signed-in editor.
//
// The site's upload route (esbpowerline app/api/upload/route.ts) authenticates by its session cookie — the same
// `sb-<ref>-auth-token` cookie the CMS window is signed in with — checks `media.upload` for the role, and stores the
// file in Supabase Storage through `uploadMediaBuffer`, which re-encodes rasters as WebP capped at 2,560 px. A
// renderer cannot send a Cookie header to another origin, so the main process makes this one request.
//
// The limits here are the plans', not the route's. The route accepts 10 MB, but it runs as a Vercel function and
// Vercel refuses a request body over 4.5 MB before the route ever sees it, so the cap is 4 MB with room for the
// multipart envelope. One banner per publish, ~200–600 KB as JPEG/WebP, against Supabase Pro's 100 GB of storage
// and the route's own 20-per-minute limit: nothing here can approach either.
const SITE_ORIGIN = 'https://esbpowerline.com'
const UPLOAD_URL = SITE_ORIGIN + '/api/upload'
const MAX_UPLOAD_BYTES = 4 * 1024 * 1024
const TIMEOUT_MS = 45000

const SITE_COOKIE_NAME = /^sb-[a-z0-9]{8,40}-auth-token(\.[0-5])?$/
const SITE_COOKIE_VALUE = /^[A-Za-z0-9_-]{1,3200}$|^base64-[A-Za-z0-9_-]{1,3200}$/

// what each accepted type must start with — a canvas that failed to encode yields an empty or foreign blob
const SIGNATURES = {
  'image/jpeg': (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  'image/png': (b) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47,
  'image/webp': (b) => b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50,
}
const EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }

function checkCookies(cookies) {
  if (!Array.isArray(cookies) || cookies.length < 1 || cookies.length > 6) return false
  return cookies.every((c) => c && typeof c.name === 'string' && typeof c.value === 'string' && SITE_COOKIE_NAME.test(c.name) && SITE_COOKIE_VALUE.test(c.value))
}

/** Check everything the renderer sends before any byte leaves the machine. Returns an error string, or null. */
function validateUpload(cookies, bytes, mime, name) {
  if (!checkCookies(cookies)) return 'Not signed in to esbpowerline.com.'
  if (!(bytes instanceof Uint8Array) || bytes.length < 16) return 'The banner image is empty.'
  if (bytes.length > MAX_UPLOAD_BYTES) return `The banner is ${(bytes.length / 1048576).toFixed(1)} MB; the site accepts up to 4 MB from the Studio.`
  if (!SIGNATURES[mime]) return 'Only JPEG, PNG or WebP banners are uploaded.'
  if (!SIGNATURES[mime](bytes)) return 'The banner file is not the image type it claims to be.'
  if (typeof name !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(name)) return 'Bad file name.'
  return null
}

/** The stored file's URL must be the site's own storage, never something a response could point anywhere. */
function isTrustedMediaUrl(url) {
  try {
    const u = new URL(url)
    return u.protocol === 'https:' && (/^[a-z0-9]+\.supabase\.co$/.test(u.hostname) || u.hostname === 'esbpowerline.com')
  } catch {
    return false
  }
}

function cookieHeader(cookies) {
  return cookies.map((c) => `${c.name}=${c.value}`).join('; ')
}

async function post(form, cookies, fetchImpl) {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS)
  try {
    // `manual`: an unauthenticated request is redirected to /login, and following it would read the login page
    // as if it were the answer
    return await fetchImpl(UPLOAD_URL, { method: 'POST', body: form, headers: { Cookie: cookieHeader(cookies), Origin: SITE_ORIGIN }, redirect: 'manual', signal: ctrl.signal })
  } finally {
    clearTimeout(timer)
  }
}

async function readError(res) {
  try {
    const j = await res.json()
    if (j && typeof j.error === 'string') return j.error.slice(0, 200)
  } catch { /* not JSON */ }
  return `HTTP ${res.status}`
}

/** Upload the banner. Resolves { ok, url } or { ok: false, status, error } — it never throws. */
async function uploadBanner({ cookies, bytes, mime, name }, fetchImpl = fetch) {
  const bad = validateUpload(cookies, bytes, mime, name)
  if (bad) return { ok: false, status: 0, error: bad }
  const form = new FormData()
  const fileName = name.replace(/\.[a-z0-9]+$/i, '') + '.' + EXT[mime]
  form.append('file', new Blob([bytes], { type: mime }), fileName)
  form.append('folder', 'library')
  let res
  try {
    res = await post(form, cookies, fetchImpl)
  } catch (err) {
    return { ok: false, status: 0, error: err && err.name === 'AbortError' ? 'The upload timed out.' : 'Could not reach esbpowerline.com.' }
  }
  if (res.status >= 300 && res.status < 400) return { ok: false, status: res.status, error: 'The site did not accept this session — sign in again.' }
  if (res.status === 401 || res.status === 403) return { ok: false, status: res.status, error: 'This account cannot upload media on esbpowerline.com.' }
  if (res.status === 413) return { ok: false, status: 413, error: 'The banner is larger than the site accepts.' }
  if (res.status === 429) return { ok: false, status: 429, error: 'Too many uploads in a minute — try again shortly.' }
  if (!res.ok) return { ok: false, status: res.status, error: await readError(res) }
  let body
  try { body = await res.json() } catch { return { ok: false, status: res.status, error: 'The site answered with something other than JSON.' } }
  if (!body || typeof body.url !== 'string' || !isTrustedMediaUrl(body.url)) return { ok: false, status: res.status, error: 'The site did not return a media URL.' }
  return { ok: true, url: body.url, storage: typeof body.storage === 'string' ? body.storage : undefined }
}

/**
 * Ask whether this session may upload, without storing anything: the route checks the session and role first and
 * answers an empty form with 400 "No file provided." — so 400 means allowed, 401 means not.
 */
async function probeUpload(cookies, fetchImpl = fetch) {
  if (!checkCookies(cookies)) return { ok: false, status: 0, detail: 'Not signed in.' }
  let res
  try {
    res = await post(new FormData(), cookies, fetchImpl)
  } catch {
    return { ok: false, status: 0, detail: 'Could not reach esbpowerline.com.' }
  }
  if (res.status === 400) return { ok: true, status: 400, detail: 'Upload allowed for this account.' }
  if (res.status === 401 || res.status === 403) return { ok: false, status: res.status, detail: 'This account cannot upload media.' }
  if (res.status >= 300 && res.status < 400) return { ok: false, status: res.status, detail: 'The site redirected to sign-in — the session was not accepted.' }
  return { ok: false, status: res.status, detail: `Unexpected answer: HTTP ${res.status}` }
}

module.exports = { uploadBanner, probeUpload, validateUpload, isTrustedMediaUrl, checkCookies, MAX_UPLOAD_BYTES, SITE_COOKIE_NAME, SITE_COOKIE_VALUE }
