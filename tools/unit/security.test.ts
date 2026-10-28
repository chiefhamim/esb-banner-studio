import { describe, it, expect } from 'vitest'
import { createRequire } from 'node:module'
import http from 'node:http'

const require = createRequire(import.meta.url)
const {
  isPrivateIPv4,
  isPrivateIPv6,
  isPrivateIp,
  validateImageMagicBytes,
  fetchArticleHtml,
  fetchImageData,
} = require('../../electron/net-guard.cjs')
const { FsScope } = require('../../electron/fs-scope.cjs')

describe('Security Hardening — S1 SSRF & Network Guard', () => {
  describe('IPv4 Address Validation', () => {
    it('rejects loopback addresses (127.0.0.0/8)', () => {
      expect(isPrivateIPv4('127.0.0.1')).toBe(true)
      expect(isPrivateIPv4('127.0.0.2')).toBe(true)
      expect(isPrivateIPv4('127.255.255.254')).toBe(true)
      expect(isPrivateIp('127.0.0.1')).toBe(true)
    })

    it('rejects private addresses (10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16)', () => {
      expect(isPrivateIPv4('10.0.0.1')).toBe(true)
      expect(isPrivateIPv4('10.254.254.254')).toBe(true)
      expect(isPrivateIPv4('172.16.0.1')).toBe(true)
      expect(isPrivateIPv4('172.24.1.1')).toBe(true)
      expect(isPrivateIPv4('172.31.255.254')).toBe(true)
      expect(isPrivateIPv4('192.168.0.1')).toBe(true)
      expect(isPrivateIPv4('192.168.100.50')).toBe(true)
    })

    it('rejects link-local / cloud metadata (169.254.0.0/16)', () => {
      expect(isPrivateIPv4('169.254.169.254')).toBe(true)
      expect(isPrivateIPv4('169.254.1.1')).toBe(true)
    })

    it('rejects CGNAT addresses (100.64.0.0/10)', () => {
      expect(isPrivateIPv4('100.64.0.1')).toBe(true)
      expect(isPrivateIPv4('100.100.50.1')).toBe(true)
      expect(isPrivateIPv4('100.127.255.254')).toBe(true)
    })

    it('rejects multicast and reserved ranges (224.0.0.0/4)', () => {
      expect(isPrivateIPv4('224.0.0.1')).toBe(true)
      expect(isPrivateIPv4('239.255.255.255')).toBe(true)
      expect(isPrivateIPv4('240.0.0.1')).toBe(true)
      expect(isPrivateIPv4('255.255.255.255')).toBe(true)
    })

    it('permits legitimate public routable IPv4 addresses', () => {
      expect(isPrivateIPv4('8.8.8.8')).toBe(false)
      expect(isPrivateIPv4('1.1.1.1')).toBe(false)
      expect(isPrivateIPv4('100.128.0.1')).toBe(false)
      expect(isPrivateIPv4('172.32.0.1')).toBe(false)
      expect(isPrivateIPv4('151.101.65.140')).toBe(false)
      expect(isPrivateIp('8.8.8.8')).toBe(false)
    })
  })

  describe('IPv6 Address Validation', () => {
    it('rejects loopback and unspecified IPv6', () => {
      expect(isPrivateIPv6('::1')).toBe(true)
      expect(isPrivateIPv6('::')).toBe(true)
      expect(isPrivateIPv6('0:0:0:0:0:0:0:1')).toBe(true)
      expect(isPrivateIPv6('0:0:0:0:0:0:0:0')).toBe(true)
      expect(isPrivateIp('::1')).toBe(true)
    })

    it('judges IPv6 forms that carry an IPv4 address by that address', () => {
      for (const a of ['::127.0.0.1', '::7f00:1', '64:ff9b::10.0.0.1', '64:ff9b::a00:1', '2002:c0a8:101::1', '::ffff:192.168.1.1']) expect(isPrivateIPv6(a)).toBe(true)
      for (const a of ['64:ff9b::8.8.8.8', '2002:808:808::1', '2606:4700::1111']) expect(isPrivateIPv6(a)).toBe(false)
    })

    it('rejects link-local IPv6 (fe80::/10)', () => {
      expect(isPrivateIPv6('fe80::1')).toBe(true)
      expect(isPrivateIPv6('fe90::1234')).toBe(true)
      expect(isPrivateIPv6('fea0::1')).toBe(true)
      expect(isPrivateIPv6('feb0::1')).toBe(true)
    })

    it('rejects unique local addresses fc00::/7 (ULA)', () => {
      expect(isPrivateIPv6('fc00::1')).toBe(true)
      expect(isPrivateIPv6('fd12:3456:789a::1')).toBe(true)
    })

    it('rejects multicast IPv6 (ff00::/8)', () => {
      expect(isPrivateIPv6('ff02::1')).toBe(true)
      expect(isPrivateIPv6('ff05::2')).toBe(true)
    })

    it('rejects IPv4-mapped IPv6 pointing to private addresses', () => {
      expect(isPrivateIPv6('::ffff:127.0.0.1')).toBe(true)
      expect(isPrivateIPv6('::ffff:10.0.0.1')).toBe(true)
      expect(isPrivateIPv6('::ffff:169.254.169.254')).toBe(true)
      expect(isPrivateIPv6('::ffff:192.168.1.1')).toBe(true)
    })

    it('permits public routable IPv6 and IPv4-mapped public addresses', () => {
      expect(isPrivateIPv6('2607:f8b0:4005:805::200e')).toBe(false)
      expect(isPrivateIPv6('::ffff:8.8.8.8')).toBe(false)
      expect(isPrivateIp('2607:f8b0:4005:805::200e')).toBe(false)
    })
  })

  describe('Image Magic Bytes Validation', () => {
    it('recognises valid PNG magic bytes', () => {
      const pngBuf = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x00])
      const res = validateImageMagicBytes(pngBuf)
      expect(res.valid).toBe(true)
      expect(res.format).toBe('png')
      expect(res.mime).toBe('image/png')
    })

    it('recognises valid JPEG magic bytes', () => {
      const jpegBuf = Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10])
      const res = validateImageMagicBytes(jpegBuf)
      expect(res.valid).toBe(true)
      expect(res.format).toBe('jpeg')
      expect(res.mime).toBe('image/jpeg')
    })

    it('recognises valid WebP magic bytes', () => {
      const webpBuf = Buffer.from([
        0x52, 0x49, 0x46, 0x46, // RIFF
        0x20, 0x00, 0x00, 0x00, // length
        0x57, 0x45, 0x42, 0x50, // WEBP
      ])
      const res = validateImageMagicBytes(webpBuf)
      expect(res.valid).toBe(true)
      expect(res.format).toBe('webp')
      expect(res.mime).toBe('image/webp')
    })

    it('rejects arbitrary non-image buffers', () => {
      const textBuf = Buffer.from('<html><body>Hello</body></html>')
      const res = validateImageMagicBytes(textBuf)
      expect(res.valid).toBe(false)
    })
  })

  describe('SSRF and Fetch Guard', () => {
    it('blocks loopback IP without making a connection', async () => {
      const res = await fetchArticleHtml('http://127.0.0.1:8080/secret')
      expect(res.ok).toBe(false)
      expect(res.code).toBe('private_address')
    })

    it('blocks private 10.x.x.x addresses', async () => {
      const res = await fetchArticleHtml('http://10.0.0.1/admin')
      expect(res.ok).toBe(false)
      expect(res.code).toBe('private_address')
    })

    it('blocks link-local cloud metadata (169.254.169.254)', async () => {
      const res = await fetchArticleHtml('http://169.254.169.254/latest/meta-data/')
      expect(res.ok).toBe(false)
      expect(res.code).toBe('private_address')
    })

    it('blocks non-http/https protocols (file:, ftp:, javascript:)', async () => {
      const fRes = await fetchArticleHtml('file:///etc/passwd')
      expect(fRes.ok).toBe(false)
      expect(fRes.code).toBe('invalid_protocol')

      const ftpRes = await fetchArticleHtml('ftp://example.com/file')
      expect(ftpRes.ok).toBe(false)
      expect(ftpRes.code).toBe('invalid_protocol')
    })

    it('blocks simulated DNS rebinding where custom resolver returns a private IP', async () => {
      const fakeResolver = {
        lookup: async () => [{ address: '127.0.0.1', family: 4 }],
      }
      const res = await fetchArticleHtml('http://public-looking-domain.com/article', { dnsResolver: fakeResolver })
      expect(res.ok).toBe(false)
      expect(res.code).toBe('private_address')
    })

    it('blocks redirects that target a private or loopback address', async () => {
      const server = http.createServer((_req: any, res: any) => {
        res.writeHead(302, { Location: 'http://169.254.169.254/latest/meta-data/' })
        res.end()
      })
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()))
      const port = (server.address() as any).port

      try {
        const res = await fetchArticleHtml(`http://127.0.0.1:${port}/redirect`, {
          allowLoopbackForTesting: true,
        })
        expect(res.ok).toBe(false)
        expect(res.code).toBe('private_address')
      } finally {
        server.close()
      }
    })

    it('rejects image fetch when magic bytes are invalid/corrupt', async () => {
      const server = http.createServer((_req: any, res: any) => {
        res.writeHead(200, { 'Content-Type': 'image/png' })
        res.end(Buffer.from('not really a png file'))
      })
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()))
      const port = (server.address() as any).port

      try {
        const res = await fetchImageData(`http://127.0.0.1:${port}/test.png`, {
          allowLoopbackForTesting: true,
        })
        expect(res.ok).toBe(false)
        expect(res.code).toBe('invalid_image')
      } finally {
        server.close()
      }
    })
  })
})

describe('Security Hardening — S2 File System Path Scoping', () => {
  it('allows access to files within explicitly granted directory roots', () => {
    const scope = new FsScope()
    scope.allow('C:/Users/test/Pictures/ESB Banners')

    expect(scope.isAllowed('C:/Users/test/Pictures/ESB Banners/banner-01.png')).toBe(true)
    expect(scope.isAllowed('C:\\Users\\test\\Pictures\\ESB Banners\\nested\\banner.png')).toBe(true)
  })

  it('rejects access to paths outside approved roots', () => {
    const scope = new FsScope()
    scope.allow('C:/Users/test/Pictures/ESB Banners')

    expect(scope.isAllowed('C:/Windows/System32/calc.exe')).toBe(false)
    expect(scope.isAllowed('C:/Users/test/Documents/secret.txt')).toBe(false)
  })

  it('rejects path traversal attempts attempting to break out of approved roots', () => {
    const scope = new FsScope()
    scope.allow('C:/Users/test/Pictures/ESB Banners')

    const sneaky = 'C:/Users/test/Pictures/ESB Banners/../../Documents/escape.txt'
    expect(scope.isAllowed(sneaky)).toBe(false)
  })

  it('allows access to specifically granted files via allowFile()', () => {
    const scope = new FsScope()
    scope.allowFile('C:/Users/test/Documents/my-project.esb')

    expect(scope.isAllowed('C:/Users/test/Documents/my-project.esb')).toBe(true)
    // the file only — not its folder, which would open every sibling and subfolder
    expect(scope.isAllowed('C:/Users/test/Documents/other.esb')).toBe(false)
    expect(scope.isAllowed('C:/Users/test/Documents/sub/x.png')).toBe(false)
  })

  it('throws an EACCES error when assertAllowed is called on a disallowed path', () => {
    const scope = new FsScope()
    scope.allow('C:/Users/test/Pictures/ESB Banners')

    expect(() => {
      scope.assertAllowed('C:/Windows/System32/cmd.exe', 'write')
    }).toThrow(/FS Scope: write denied/)
  })
})
