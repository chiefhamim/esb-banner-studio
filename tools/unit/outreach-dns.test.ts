import { describe, expect, it } from 'vitest'
import { createDnsChecker } from '../../electron/outreach-dns.cjs'
import { validateDomains } from '../../electron/outreach-guard.cjs'

describe('Step 4.2: DNS address checking & guard', () => {
  it('guard refuses non-hostnames, IP literals, and > 2,000 domains', () => {
    // Valid domains
    expect(validateDomains(['example.com', 'mail.esbpowerline.com']).ok).toBe(true)

    // IP literals refused
    expect(validateDomains(['192.168.1.1']).ok).toBe(false)
    expect(validateDomains(['[::1]']).ok).toBe(false)

    // Hostnames with invalid characters / protocols / paths
    expect(validateDomains(['http://example.com']).ok).toBe(false)
    expect(validateDomains(['example.com/test']).ok).toBe(false)
    expect(validateDomains(['invalid_domain!.com']).ok).toBe(false)

    // Max 2,000 limit
    const huge = Array.from({ length: 2001 }, (_, i) => `dom${i}.com`)
    expect(validateDomains(huge).ok).toBe(false)
  })

  it('resolves MX ok when mail server present', async () => {
    const fakeDns = {
      resolveMx: async (domain: string) => [{ exchange: `mail.${domain}`, priority: 10 }],
      lookup: async () => { throw new Error('should not call lookup if MX ok') },
    }
    const checker = createDnsChecker({ dns: fakeDns })
    const res = await checker.checkOne('esbpowerline.com')
    expect(res).toEqual({ mx: true, a: false })
  })

  it('falls back to A record when no MX present', async () => {
    const fakeDns = {
      resolveMx: async () => [],
      lookup: async (domain: string) => ({ address: '198.51.100.1', family: 4 }),
    }
    const checker = createDnsChecker({ dns: fakeDns })
    const res = await checker.checkOne('a-fallback.example.com')
    expect(res).toEqual({ mx: false, a: true })
  })

  it('marks NXDOMAIN as no mail server (no MX and no A)', async () => {
    const fakeDns = {
      resolveMx: async () => { const err = new Error('queryMx ENOTFOUND'); (err as any).code = 'ENOTFOUND'; throw err },
      lookup: async () => { const err = new Error('getaddrinfo ENOTFOUND'); (err as any).code = 'ENOTFOUND'; throw err },
    }
    const checker = createDnsChecker({ dns: fakeDns })
    const res = await checker.checkOne('dead-domain.example.com')
    expect(res).toEqual({ mx: false, a: false })
  })

  it('records timeout cleanly when resolver stalls', async () => {
    const fakeDns = {
      resolveMx: () => new Promise((resolve) => setTimeout(resolve, 500)),
      lookup: () => new Promise((resolve) => setTimeout(resolve, 500)),
    }
    const checker = createDnsChecker({ dns: fakeDns, timeoutMs: 50 })
    const res = await checker.checkOne('slow.example.com')
    expect(res.mx).toBe(false)
    expect(res.a).toBe(false)
    expect(res.error).toBe('timeout')
  })

  it('caches results for 24h and reuses memory / disk cache', async () => {
    let callCount = 0
    let now = 1000000
    const disk: Record<string, string> = {}
    const fakeFs = {
      existsSync: (p: string) => p in disk,
      readFileSync: (p: string) => disk[p],
      writeFileSync: (p: string, data: string) => { disk[p] = data },
      renameSync: (from: string, to: string) => { disk[to] = disk[from]; delete disk[from] },
    }

    const fakeDns = {
      resolveMx: async () => { callCount++; return [{ exchange: 'mx.test', priority: 10 }] },
      lookup: async () => ({ address: '1.2.3.4', family: 4 }),
    }

    const checker1 = createDnsChecker({
      cacheFile: '/cache/dns.json',
      dns: fakeDns,
      clock: () => now,
      fs: fakeFs as any,
    })

    const res1 = await checker1.checkOne('cached.example.com')
    expect(res1.mx).toBe(true)
    expect(callCount).toBe(1)

    // Second call within 24h hits memory cache, no new DNS query
    now += 3600 * 1000 // 1 hour later
    const res2 = await checker1.checkOne('cached.example.com')
    expect(res2.mx).toBe(true)
    expect(callCount).toBe(1)

    // Batch checks flush cache to disk; a new checker reconstructs from disk
    await checker1.checkDomains(['cached.example.com'])
    const checker2 = createDnsChecker({
      cacheFile: '/cache/dns.json',
      dns: fakeDns,
      clock: () => now,
      fs: fakeFs as any,
    })
    const res3 = await checker2.checkOne('cached.example.com')
    expect(res3.mx).toBe(true)
    expect(callCount).toBe(1)

    // After 25 hours, cache expires and triggers fresh DNS lookup
    now += 25 * 3600 * 1000
    const res4 = await checker2.checkOne('cached.example.com')
    expect(res4.mx).toBe(true)
    expect(callCount).toBe(2)
  })
})
