// ESB Studio — Hardened Network Guard (SSRF / URL / Body protection)
const http = require('node:http')
const https = require('node:https')
const dns = require('node:dns')
const net = require('node:net')
const { URL } = require('node:url')

const pkg = require('../package.json')
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'

const MAX_HTML_BYTES = 5 * 1024 * 1024 // 5 MB
const MAX_IMAGE_BYTES = 25 * 1024 * 1024 // 25 MB
const DEFAULT_TIMEOUT_MS = 8000 // 8 seconds default
const ARTICLE_TIMEOUT_MS = 20000 // a news page on a slow host can take longer than a plain request
const DEFAULT_IMAGE_TIMEOUT_MS = 4000 // 4 seconds for images
const MAX_REDIRECTS = 5

const ALLOWED_HTML_TYPES = [
  'text/html',
  'application/xhtml+xml',
  'text/plain',
  // text-only feed formats (still size-capped, SSRF-checked, never executed)
  'application/xml',
  'text/xml',
  'application/rss+xml',
  'application/atom+xml',
]
const ALLOWED_IMAGE_TYPES = [
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/pjpeg',
  'image/webp',
  'image/gif',
  'image/avif',
  'application/octet-stream',
  'binary/octet-stream',
]

/**
 * Validates whether an IPv4 address belongs to a private, loopback, link-local,
 * CGNAT, multicast, broadcast or reserved range.
 */
function isPrivateIPv4(ip) {
  const parts = ip.split('.').map(Number)
  if (parts.length !== 4 || parts.some((p) => isNaN(p) || p < 0 || p > 255)) return true
  if (parts[0] === 0) return true // 0.0.0.0/8 (unspecified / current network)
  if (parts[0] === 10) return true // 10.0.0.0/8 (private)
  if (parts[0] === 127) return true // 127.0.0.0/8 (loopback)
  if (parts[0] === 169 && parts[1] === 254) return true // 169.254.0.0/16 (link-local, cloud metadata)
  if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true // 172.16.0.0/12 (private)
  if (parts[0] === 192 && parts[1] === 168) return true // 192.168.0.0/16 (private)
  if (parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127) return true // 100.64.0.0/10 (CGNAT)
  if (parts[0] === 192 && parts[1] === 0 && parts[2] === 0) return true // 192.0.0.0/24
  if (parts[0] === 192 && parts[1] === 0 && parts[2] === 2) return true // 192.0.2.0/24 (TEST-NET-1)
  if (parts[0] === 192 && parts[1] === 88 && parts[2] === 99) return true // 192.88.99.0/24 (6to4)
  if (parts[0] === 198 && (parts[1] === 18 || parts[1] === 19)) return true // 198.18.0.0/15 (benchmark)
  if (parts[0] === 198 && parts[1] === 51 && parts[2] === 100) return true // 198.51.100.0/24 (TEST-NET-2)
  if (parts[0] === 203 && parts[1] === 0 && parts[2] === 113) return true // 203.0.113.0/24 (TEST-NET-3)
  if (parts[0] >= 224) return true // 224.0.0.0/4 (multicast 224-239 & reserved 240-255)
  return false
}

/**
 * Validates whether an IPv6 address belongs to a loopback, unspecified,
 * link-local, unique local, IPv4-mapped private, or multicast range.
 */
/** '::7f00:1' → [0,0,0,0,0,0,0x7f00,1]; a dotted IPv4 tail becomes its two groups. null when it is not IPv6 text. */
function ipv6Groups(ip) {
  let s = ip.toLowerCase().trim().replace(/%.*$/, '')
  const v4 = s.match(/(\d+\.\d+\.\d+\.\d+)$/)
  if (v4) {
    const o = v4[1].split('.').map(Number)
    if (o.some((n) => n > 255)) return null
    s = s.slice(0, -v4[1].length) + ((o[0] << 8) | o[1]).toString(16) + ':' + ((o[2] << 8) | o[3]).toString(16)
  }
  const halves = s.split('::')
  if (halves.length > 2) return null
  const head = halves[0] ? halves[0].split(':') : []
  const tail = halves.length === 2 && halves[1] ? halves[1].split(':') : []
  const fill = halves.length === 2 ? 8 - head.length - tail.length : 0
  const all = [...head, ...Array(Math.max(0, fill)).fill('0'), ...tail]
  if (all.length !== 8 || all.some((g) => !/^[0-9a-f]{1,4}$/.test(g))) return null
  return all.map((g) => parseInt(g, 16))
}
const v4Of = (hi, lo) => `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`

function isPrivateIPv6(ip) {
  const s = ip.toLowerCase().trim()
  // forms that carry an IPv4 address inside them are judged by that address: IPv4-compatible (::a.b.c.d, ::7f00:1),
  // IPv4-mapped (::ffff:…), NAT64 (64:ff9b::/96) and 6to4 (2002::/16). They were read as public, so ::127.0.0.1
  // passed the loopback check on any host that routes it.
  const g = ipv6Groups(s)
  if (g) {
    const zero = (from, to) => g.slice(from, to).every((x) => x === 0)
    if (zero(0, 6) && (g[6] || g[7] > 1)) return isPrivateIPv4(v4Of(g[6], g[7]))
    if (zero(0, 5) && g[5] === 0xffff) return isPrivateIPv4(v4Of(g[6], g[7]))
    if (g[0] === 0x64 && g[1] === 0xff9b && zero(2, 6)) return isPrivateIPv4(v4Of(g[6], g[7]))
    if (g[0] === 0x2002) return isPrivateIPv4(v4Of(g[1], g[2]))
  }
  if (s === '::' || s === '0:0:0:0:0:0:0:0') return true
  if (s === '::1' || s === '0:0:0:0:0:0:0:1') return true
  if (s.startsWith('::ffff:')) {
    const rest = s.slice(7)
    if (rest.includes('.')) return isPrivateIPv4(rest)
    const hexParts = rest.split(':')
    if (hexParts.length === 2) {
      const p1 = parseInt(hexParts[0], 16)
      const p2 = parseInt(hexParts[1], 16)
      return isPrivateIPv4(`${(p1 >> 8) & 255}.${p1 & 255}.${(p2 >> 8) & 255}.${p2 & 255}`)
    }
  }
  if (s.startsWith('fc') || s.startsWith('fd')) return true // fc00::/7 (ULA)
  if (/^fe[89ab]/i.test(s)) return true // fe80::/10 (link-local)
  if (s.startsWith('ff')) return true // ff00::/8 (multicast)
  if (s.startsWith('100::')) return true // 100::/64 (discard)
  if (s.startsWith('2001:db8:')) return true // 2001:db8::/32 (doc)
  return false
}

function isPrivateIp(ip) {
  const family = net.isIP(ip)
  if (family === 4) return isPrivateIPv4(ip)
  if (family === 6) return isPrivateIPv6(ip)
  return true // invalid IP format treated as unsafe
}

/**
 * Validates magic bytes for common image formats.
 */
function validateImageMagicBytes(buf) {
  if (!buf || buf.length < 4) return { valid: false, format: null }
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (buf.length >= 8 &&
      buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47 &&
      buf[4] === 0x0D && buf[5] === 0x0A && buf[6] === 0x1A && buf[7] === 0x0A) {
    return { valid: true, format: 'png', mime: 'image/png' }
  }
  // JPEG: FF D8 FF
  if (buf[0] === 0xFF && buf[1] === 0xD8 && buf[2] === 0xFF) {
    return { valid: true, format: 'jpeg', mime: 'image/jpeg' }
  }
  // GIF: GIF87a or GIF89a
  if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x38 &&
      (buf[4] === 0x37 || buf[4] === 0x39) && buf[5] === 0x61) {
    return { valid: true, format: 'gif', mime: 'image/gif' }
  }
  // WebP: RIFF .... WEBP
  if (buf.length >= 12 &&
      buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 &&
      buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50) {
    return { valid: true, format: 'webp', mime: 'image/webp' }
  }
  // AVIF / HEIF: .... ftyp (avif | avis | mif1)
  if (buf.length >= 12 &&
      buf[4] === 0x66 && buf[5] === 0x74 && buf[6] === 0x79 && buf[7] === 0x70) {
    const brand = buf.subarray(8, 12).toString('ascii')
    if (brand === 'avif' || brand === 'avis' || brand === 'mif1') {
      return { valid: true, format: 'avif', mime: 'image/avif' }
    }
  }
  return { valid: false, format: null }
}

/**
 * Extracts charset encoding from Content-Type or HTML meta tags.
 */
function extractHtmlCharset(contentType, buffer) {
  if (contentType) {
    const match = contentType.match(/charset=([a-zA-Z0-9_-]+)/i)
    if (match && match[1]) return match[1].trim()
  }
  if (buffer && buffer.length > 0) {
    const head = buffer.subarray(0, Math.min(buffer.length, 1024)).toString('ascii')
    const metaMatch = head.match(/<meta[^>]+charset=["']?([a-zA-Z0-9_-]+)/i) ||
                      head.match(/<meta[^>]+content=["'][^"']*charset=([a-zA-Z0-9_-]+)/i)
    if (metaMatch && metaMatch[1]) return metaMatch[1].trim()
  }
  return 'utf-8'
}

/**
 * Decode HTML buffer according to detected or fallback charset.
 */
function decodeHtmlBuffer(buffer, contentType) {
  const charset = extractHtmlCharset(contentType, buffer)
  try {
    const decoder = new TextDecoder(charset)
    return decoder.decode(buffer)
  } catch {
    const fallback = new TextDecoder('utf-8')
    return fallback.decode(buffer)
  }
}

/**
 * Resolves hostname and validates all returned IP addresses.
 */
async function resolveAndValidateHost(hostname, resolver = null, allowLoopback = false) {
  if (net.isIP(hostname)) {
    if (allowLoopback && (hostname === '127.0.0.1' || hostname === '::1')) {
      return { ok: true, ip: hostname, family: net.isIP(hostname) }
    }
    if (isPrivateIp(hostname)) {
      return { ok: false, code: 'private_address', error: `Access to private IP address is rejected: ${hostname}` }
    }
    return { ok: true, ip: hostname, family: net.isIP(hostname) }
  }

  try {
    let addresses
    if (resolver && typeof resolver.lookup === 'function') {
      addresses = await resolver.lookup(hostname)
    } else {
      addresses = await dns.promises.lookup(hostname, { all: true })
    }

    if (!addresses || addresses.length === 0) {
      return { ok: false, code: 'dns_error', error: `Failed to resolve host: ${hostname}` }
    }

    for (const addr of addresses) {
      if (allowLoopback && (addr.address === '127.0.0.1' || addr.address === '::1')) {
        continue
      }
      if (isPrivateIp(addr.address)) {
        return { ok: false, code: 'private_address', error: `Host ${hostname} resolved to private/restricted IP: ${addr.address}` }
      }
    }

    const picked = addresses.find((a) => a.family === 4) || addresses[0]
    return { ok: true, ip: picked.address, family: picked.family }
  } catch (err) {
    return { ok: false, code: 'dns_error', error: `DNS lookup failed for ${hostname}: ${err.message}` }
  }
}

/**
 * Safe fetch execution with DNS rebind protection, manual redirects, and body cap.
 */
async function safeFetch(targetUrl, options = {}) {
  const maxBytes = options.maxBytes || MAX_HTML_BYTES
  const allowedTypes = options.allowedTypes || ALLOWED_HTML_TYPES
  const totalTimeout = options.timeoutMs || DEFAULT_TIMEOUT_MS
  const startTime = Date.now()
  const customResolver = options.dnsResolver || null
  const allowLoopback = options.allowLoopbackForTesting === true

  let currentUrl = targetUrl
  let redirects = 0

  while (redirects <= MAX_REDIRECTS) {
    const elapsed = Date.now() - startTime
    const remainingTime = totalTimeout - elapsed
    if (remainingTime <= 0) {
      return { ok: false, code: 'timeout', error: `Request timed out after ${totalTimeout}ms` }
    }

    let parsed
    try {
      parsed = new URL(currentUrl)
    } catch {
      return { ok: false, code: 'invalid_url', error: `Invalid URL: ${currentUrl}` }
    }

    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return { ok: false, code: 'invalid_protocol', error: `Disallowed protocol: ${parsed.protocol} (only http/https allowed)` }
    }

    // The DNS lookup counts against the same deadline: a dead domain's lookup can hang for minutes, and it ran before the
    // request timer started, so one dead government site held a whole News pass at "226 of 227".
    let dnsTimer
    const hostCheck = await Promise.race([
      resolveAndValidateHost(parsed.hostname, customResolver, allowLoopback),
      new Promise((r) => { dnsTimer = setTimeout(() => r({ ok: false, code: 'timeout', error: `DNS lookup for ${parsed.hostname} timed out` }), Math.min(remainingTime, 10000)) }),
    ]).finally(() => clearTimeout(dnsTimer))
    if (!hostCheck.ok) {
      return hostCheck
    }

    const isHttps = parsed.protocol === 'https:'
    const client = isHttps ? https : http
    const port = parsed.port ? parseInt(parsed.port, 10) : (isHttps ? 443 : 80)

    const result = await new Promise((settle) => {
      let aborted = false
      let wall = null
      const resolve = (v) => { clearTimeout(wall); settle(v) }
      const req = client.request({
        protocol: parsed.protocol,
        host: hostCheck.ip,
        port,
        path: parsed.pathname + parsed.search,
        method: 'GET',
        headers: {
          'Host': parsed.host,
          'User-Agent': USER_AGENT,
          'Accept': options.acceptHeader || '*/*',
          // what a real browser sends with a page request; sites that screen out bare clients look for these
          'Accept-Language': 'bn-BD,bn;q=0.9,en-US;q=0.8,en;q=0.7',
          'Upgrade-Insecure-Requests': '1',
          'Sec-Fetch-Dest': 'document',
          'Sec-Fetch-Mode': 'navigate',
          'Sec-Fetch-Site': 'none',
          'Referer': `${parsed.protocol}//${parsed.host}/`,
          'Connection': 'close',
        },
        servername: isHttps ? parsed.hostname : undefined,
        timeout: remainingTime,
      })

      // Detach the handlers that would resolve again, but never leave the request without an 'error' listener: a
      // destroyed or half-closed socket emits 'error' ("socket hang up") a tick later, and with no listener that is an
      // uncaught exception — in Electron, the "A JavaScript error occurred in the main process" dialog. A slow image
      // host hitting the 4 s timeout was enough to raise it.
      const cleanup = () => {
        req.removeAllListeners()
        req.on('error', () => {})
      }

      // `timeout` above is an idle timeout: a server that drips a byte every few seconds never trips it. This is the
      // whole request's budget, headers and body together.
      wall = setTimeout(() => {
        aborted = true
        req.destroy()
        cleanup()
        resolve({ ok: false, code: 'timeout', error: `Gave up after ${remainingTime}ms` })
      }, remainingTime)

      req.on('timeout', () => {
        aborted = true
        req.destroy()
        cleanup()
        resolve({ ok: false, code: 'timeout', error: `Socket timed out after ${remainingTime}ms` })
      })

      req.on('error', (err) => {
        if (aborted) return
        cleanup()
        // If a portal's certificate only covers the bare domain (e.g. dailynayadiganta.com) while the feed linked to www.,
        // step to the bare domain under the redirect budget.
        if (isHttps && /^www\./i.test(parsed.hostname) && err && /does not match certificate's altnames/i.test(err.message)) {
          const bare = parsed.hostname.replace(/^www\./i, '')
          if (err.message.toLowerCase().includes(`dns:${bare.toLowerCase()}`)) {
            const next = new URL(currentUrl)
            next.hostname = bare
            resolve({ redirect: true, nextUrl: next.href })
            return
          }
        }
        resolve({ ok: false, code: 'network_error', error: err.message })
      })

      req.on('response', (res) => {
        const statusCode = res.statusCode || 0

        // Handle redirects manually
        if ([301, 302, 303, 307, 308].includes(statusCode)) {
          res.resume() // consume stream
          cleanup()
          const loc = res.headers.location
          if (!loc) {
            resolve({ ok: false, code: 'bad_redirect', error: `Redirect status ${statusCode} with no Location header` })
            return
          }
          try {
            const next = new URL(loc, currentUrl).href
            resolve({ redirect: true, nextUrl: next })
          } catch {
            resolve({ ok: false, code: 'bad_redirect', error: `Invalid redirect location: ${loc}` })
          }
          return
        }

        // Status code filtering
        if (statusCode === 401 || statusCode === 403 || statusCode === 429) {
          res.resume()
          cleanup()
          resolve({ ok: false, code: statusCode === 429 ? 'rate_limited' : 'blocked', error: `Site returned HTTP ${statusCode} (access blocked or rate limited)` })
          return
        }

        if (statusCode < 200 || statusCode >= 300) {
          res.resume()
          cleanup()
          resolve({ ok: false, code: 'http_error', error: `HTTP ${statusCode} ${res.statusMessage || ''}`.trim() })
          return
        }

        const rawContentType = res.headers['content-type'] || ''
        const mimeType = rawContentType.split(';')[0].trim().toLowerCase()

        if (allowedTypes && allowedTypes.length > 0) {
          const typeMatch = allowedTypes.some((t) => mimeType === t || (t.endsWith('/*') && mimeType.startsWith(t.slice(0, -1))))
          if (!typeMatch) {
            res.resume()
            cleanup()
            resolve({ ok: false, code: 'bad_type', error: `Content-type '${rawContentType}' is not in allowed types: ${allowedTypes.join(', ')}` })
            return
          }
        }

        const chunks = []
        let totalReceived = 0

        res.on('data', (chunk) => {
          totalReceived += chunk.length
          if (totalReceived > maxBytes) {
            aborted = true
            res.destroy()
            req.destroy()
            cleanup()
            resolve({ ok: false, code: 'too_large', error: `Response exceeded size cap of ${maxBytes} bytes` })
            return
          }
          chunks.push(chunk)
        })

        res.on('end', () => {
          if (aborted) return
          cleanup()
          const buffer = Buffer.concat(chunks)
          resolve({
            ok: true,
            buffer,
            contentType: rawContentType,
            mimeType,
            url: currentUrl,
            statusCode,
          })
        })

        res.on('error', (err) => {
          if (aborted) return
          cleanup()
          resolve({ ok: false, code: 'stream_error', error: err.message })
        })
      })

      req.end()
    })

    if (result.redirect) {
      redirects++
      if (redirects > MAX_REDIRECTS) {
        return { ok: false, code: 'too_many_redirects', error: `Exceeded maximum redirects (${MAX_REDIRECTS})` }
      }
      currentUrl = result.nextUrl
      continue
    }

    return result
  }

  return { ok: false, code: 'too_many_redirects', error: `Exceeded maximum redirects (${MAX_REDIRECTS})` }
}

/**
 * Unwraps Bing News click-through URLs (?url=https://...) when handed directly to fetchArticleHtml.
 */
function unwrapFeedRedirectUrl(rawUrl) {
  try {
    const u = new URL(rawUrl)
    if (/(^|\.)bing\.com$/i.test(u.hostname) && /apiclick/i.test(u.pathname)) {
      const real = u.searchParams.get('url')
      if (real && /^https?:\/\//i.test(real)) return real
    }
  } catch { /* keep as-is */ }
  return rawUrl
}

/**
 * Resolves an encoded Google News RSS article link (news.google.com/rss/articles/CBMi...) to the publisher's own URL.
 */
async function resolveGoogleNewsUrl(rawUrl, options = {}) {
  const m = String(rawUrl || '').match(/^https?:\/\/(?:www\.)?news\.google\.com\/(?:rss\/)?articles\/([A-Za-z0-9_-]+)/i)
  if (!m) return null
  const id = m[1]

  // 1. Legacy CBMi base64url payloads carry the destination URL directly in the bytes.
  try {
    const buf = Buffer.from(id.replace(/-/g, '+').replace(/_/g, '/'), 'base64')
    const str = buf.toString('latin1')
    const httpIdx = str.indexOf('http')
    if (httpIdx !== -1) {
      const sub = str.slice(httpIdx)
      const urlMatch = sub.match(/^https?:\/\/[^\x00-\x1f\x7f-\xff"'\s<>]+/)
      if (urlMatch && !/news\.google\.com/i.test(urlMatch[0])) return urlMatch[0]
    }
  } catch { /* fall through to batchexecute */ }

  // 2. Modern AU_yqL tokens: read signature (data-n-a-sg) and timestamp (data-n-a-ts) from the splash HTML, then exchange
  //    via Google News's Fbv4je batchexecute RPC.
  for (const prefix of ['https://news.google.com/rss/articles/', 'https://news.google.com/articles/']) {
    const splash = await safeFetch(`${prefix}${id}?oc=5`, {
      maxBytes: MAX_HTML_BYTES,
      allowedTypes: ALLOWED_HTML_TYPES,
      dnsResolver: options.dnsResolver,
      timeoutMs: Math.min(options.timeoutMs || ARTICLE_TIMEOUT_MS, 12000),
      allowLoopbackForTesting: options.allowLoopbackForTesting,
    })
    if (!splash.ok || !splash.buffer) continue
    const splashHtml = splash.buffer.toString('utf8')
    const sg = splashHtml.match(/data-n-a-sg="([^"]+)"/)?.[1]
    const ts = splashHtml.match(/data-n-a-ts="([^"]+)"/)?.[1]
    if (!sg || !ts) continue

    const hostCheck = await resolveAndValidateHost('news.google.com', options.dnsResolver || null, options.allowLoopbackForTesting === true)
    if (!hostCheck.ok) return null

    const inner = `["garturlreq",[["X","X",["X","X"],null,null,1,1,"US:en",null,1,null,null,null,null,null,0,1],"X","X",1,[1,1,1],1,1,null,0,0,null,0],"${id}",${ts},"${sg}"]`
    const payload = `f.req=${encodeURIComponent(JSON.stringify([[['Fbv4je', inner, null, 'generic']]]))}`

    const decoded = await new Promise((resolve) => {
      const req = https.request({
        protocol: 'https:',
        host: hostCheck.ip,
        port: 443,
        path: '/_/DotsSplashUi/data/batchexecute',
        method: 'POST',
        servername: 'news.google.com',
        timeout: 10000,
        headers: {
          'Host': 'news.google.com',
          'User-Agent': USER_AGENT,
          'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
          'Referer': 'https://news.google.com/',
          'Content-Length': Buffer.byteLength(payload),
          'Connection': 'close',
        },
      }, (res) => {
        const chunks = []
        let total = 0
        res.on('data', (c) => {
          total += c.length
          if (total <= 512 * 1024) chunks.push(c)
        })
        res.on('end', () => {
          try {
            const text = Buffer.concat(chunks).toString('utf8')
            const hit = text.match(/\\"garturlres\\",\\"(https?:[^\\"]+)\\"/)
            if (hit && hit[1]) {
              try { resolve(JSON.parse(`"${hit[1]}"`)) } catch { resolve(hit[1]) }
              return
            }
          } catch { /* ignore */ }
          resolve(null)
        })
        res.on('error', () => resolve(null))
      })
      req.on('timeout', () => { req.destroy(); resolve(null) })
      req.on('error', () => resolve(null))
      req.write(payload)
      req.end()
    })
    if (decoded && /^https?:\/\//i.test(decoded)) return decoded
  }
  return null
}

/**
 * Hardened fetch for news article HTML.
 */
async function fetchArticleHtml(rawUrl, options = {}) {
  let targetUrl = String(rawUrl || '').trim()
  if (!targetUrl) {
    return { ok: false, error: 'Please enter a valid URL', code: 'invalid_url' }
  }
  // Only add https:// if no scheme is present (e.g. prothomalo.com/...)
  if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(targetUrl)) {
    targetUrl = 'https://' + targetUrl
  }
  targetUrl = unwrapFeedRedirectUrl(targetUrl)
  if (/^https?:\/\/(?:www\.)?news\.google\.com\/(?:rss\/)?articles\//i.test(targetUrl)) {
    const resolved = await resolveGoogleNewsUrl(targetUrl, options)
    if (resolved) targetUrl = resolved
  }

  const res = await safeFetch(targetUrl, {
    maxBytes: options.maxBytes || MAX_HTML_BYTES,
    allowedTypes: options.allowedTypes || ALLOWED_HTML_TYPES,
    acceptHeader: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    dnsResolver: options.dnsResolver,
    timeoutMs: options.timeoutMs || ARTICLE_TIMEOUT_MS,
    allowLoopbackForTesting: options.allowLoopbackForTesting,
  })

  if (!res.ok) {
    return { ok: false, error: res.error, code: res.code }
  }

  if (!res.buffer || res.buffer.length === 0) {
    return { ok: false, error: 'Fetched page content was empty', code: 'empty_response' }
  }

  const html = decodeHtmlBuffer(res.buffer, res.contentType)
  if (!html.trim()) {
    return { ok: false, error: 'Fetched page content was blank', code: 'empty_response' }
  }

  // Paywall / Captcha / Short page detection
  if (html.length < 300) {
    const lower = html.toLowerCase()
    if (lower.includes('captcha') || lower.includes('security check') || lower.includes('cloudflare') || lower.includes('access denied')) {
      return { ok: false, error: 'Site presented a captcha or security check page', code: 'blocked' }
    }
  }

  return { ok: true, html, url: res.url }
}

/**
 * Hardened fetch for image data (returns data URL).
 */
async function fetchImageData(rawUrl, options = {}) {
  const res = await safeFetch(rawUrl, {
    maxBytes: options.maxBytes || MAX_IMAGE_BYTES,
    allowedTypes: options.allowedTypes || ALLOWED_IMAGE_TYPES,
    acceptHeader: 'image/png,image/jpeg,image/webp,image/gif,*/*;q=0.8',
    dnsResolver: options.dnsResolver,
    timeoutMs: options.timeoutMs || DEFAULT_IMAGE_TIMEOUT_MS,
    allowLoopbackForTesting: options.allowLoopbackForTesting,
  })

  if (!res.ok) {
    return { ok: false, error: res.error, code: res.code }
  }

  if (!res.buffer || res.buffer.length === 0) {
    return { ok: false, error: 'Image body was empty', code: 'empty_response' }
  }

  // Verify magic bytes
  const magic = validateImageMagicBytes(res.buffer)
  if (!magic.valid) {
    return { ok: false, error: 'Image magic bytes do not match a supported image format (PNG, JPEG, WebP, GIF)', code: 'invalid_image' }
  }

  const mime = magic.mime || res.mimeType || 'image/jpeg'
  const b64 = res.buffer.toString('base64')
  return { ok: true, dataUrl: `data:${mime};base64,${b64}`, format: magic.format }
}

module.exports = {
  USER_AGENT,
  MAX_HTML_BYTES,
  MAX_IMAGE_BYTES,
  isPrivateIPv4,
  isPrivateIPv6,
  isPrivateIp,
  validateImageMagicBytes,
  resolveAndValidateHost,
  safeFetch,
  unwrapFeedRedirectUrl,
  resolveGoogleNewsUrl,
  fetchArticleHtml,
  fetchImageData,
}
