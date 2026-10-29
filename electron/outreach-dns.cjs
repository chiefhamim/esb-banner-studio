// electron/outreach-dns.cjs
// DNS MX and A/AAAA resolver with concurrency pool, per-query timeout, and 24h disk caching.

const fs = require('fs')
const path = require('path')

const CACHE_TTL_MS = 24 * 60 * 60 * 1000
const MAX_CACHE_ENTRIES = 20000
const DEFAULT_TIMEOUT_MS = 4000
const DEFAULT_CONCURRENCY = 8

function createDnsChecker(options = {}) {
  const {
    cacheFile,
    dns = require('dns').promises,
    clock = Date.now,
    fs: fileSystem = fs,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    concurrency = DEFAULT_CONCURRENCY,
  } = options

  const cache = new Map()

  // Load cache from disk if available
  if (cacheFile && fileSystem.existsSync(cacheFile)) {
    try {
      const raw = fileSystem.readFileSync(cacheFile, 'utf8')
      const json = JSON.parse(raw)
      if (json && typeof json === 'object') {
        const now = clock()
        for (const [dom, entry] of Object.entries(json)) {
          if (entry && typeof entry.ts === 'number' && now - entry.ts < CACHE_TTL_MS) {
            cache.set(dom.toLowerCase(), entry)
          }
        }
      }
    } catch {
      // Corrupt cache ignored
    }
  }

  function saveCache() {
    if (!cacheFile) return
    try {
      if (cache.size > MAX_CACHE_ENTRIES) {
        const sorted = [...cache.entries()].sort((a, b) => a[1].ts - b[1].ts)
        const toDelete = sorted.slice(0, cache.size - MAX_CACHE_ENTRIES)
        for (const [k] of toDelete) cache.delete(k)
      }
      const obj = Object.fromEntries(cache.entries())
      const tmp = `${cacheFile}.tmp`
      fileSystem.writeFileSync(tmp, JSON.stringify(obj), 'utf8')
      fileSystem.renameSync(tmp, cacheFile)
    } catch {
      // Disk errors non-fatal
    }
  }

  async function checkOne(rawDomain) {
    const domain = (rawDomain || '').toLowerCase().trim()
    if (!domain) return { mx: false, a: false, error: 'Empty domain' }

    const now = clock()
    const cached = cache.get(domain)
    if (cached && now - cached.ts < CACHE_TTL_MS) {
      return { mx: cached.mx, a: cached.a, ...(cached.error ? { error: cached.error } : {}) }
    }

    const withTimeout = (promise, ms) =>
      Promise.race([
        promise,
        new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ms)),
      ])

    let mx = false
    let a = false
    let error

    // 1. Resolve MX
    try {
      const mxRecords = await withTimeout(dns.resolveMx(domain), timeoutMs)
      if (mxRecords && mxRecords.length > 0) {
        mx = true
      }
    } catch (err) {
      const msg = err?.message || String(err)
      if (msg.includes('timeout')) {
        error = 'timeout'
      }
    }

    // 2. If no MX (and didn't timeout), try A / AAAA
    if (!mx && error !== 'timeout') {
      try {
        const lookup = await withTimeout(dns.lookup(domain), timeoutMs)
        if (lookup && (lookup.address || lookup.length > 0)) {
          a = true
        }
      } catch (err) {
        const msg = err?.message || String(err)
        if (msg.includes('timeout')) {
          error = 'timeout'
        }
      }
    }

    const entry = { mx, a, ts: now, ...(error ? { error } : {}) }
    cache.set(domain, entry)
    return { mx, a, ...(error ? { error } : {}) }
  }

  async function checkDomains(domains, onProgress) {
    const results = {}
    const queue = [...domains]
    let completed = 0

    const workers = Array.from({ length: Math.min(concurrency, queue.length || 1) }, async () => {
      while (queue.length > 0) {
        const domain = queue.shift()
        if (!domain) break
        const res = await checkOne(domain)
        results[domain] = res
        completed++
        if (onProgress) onProgress(completed, domains.length)
      }
    })

    await Promise.all(workers)
    saveCache()
    return results
  }

  return {
    checkOne,
    checkDomains,
    getCacheSize: () => cache.size,
    clearCache: () => cache.clear(),
  }
}

module.exports = { createDnsChecker }
