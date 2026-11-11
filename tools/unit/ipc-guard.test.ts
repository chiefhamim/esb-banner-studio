import { describe, it, expect } from 'vitest'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const g = require('../../electron/ipc-guard.cjs')

describe('imageFileName', () => {
  it('keeps an image name and strips directories', () => {
    expect(g.imageFileName('C:\\x\\..\\banner.PNG')).toBe('banner.png')
    expect(g.imageFileName('../../etc/photo.jpeg')).toBe('photo.jpeg')
  })
  it('turns any other extension into .png', () => {
    expect(g.imageFileName('evil.exe')).toBe('evil.png')
    expect(g.imageFileName('run.bat')).toBe('run.png')
    expect(g.imageFileName('')).toBe('ESB-Banner.png')
    expect(g.imageFileName('a.png.vbs')).toBe('a.png.png')
  })
  it('allows video names only for drag-out', () => {
    expect(g.dragFileName('clip.mp4')).toBe('clip.mp4')
    expect(g.imageFileName('clip.mp4')).toBe('clip.png')
  })
})

describe('isImageBytes', () => {
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0, 0, 0, 0, 0, 0])
  it('accepts real image headers and refuses anything else', () => {
    expect(g.isImageBytes(png)).toBe(true)
    expect(g.isImageBytes(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]))).toBe(true)
    expect(g.isImageBytes(new Uint8Array([0x4d, 0x5a, 0x90, 0, 3, 0, 0, 0, 4, 0, 0, 0, 0xff, 0xff, 0, 0, 0]))).toBe(false) // MZ
    expect(g.isImageBytes(new Uint8Array(4))).toBe(false)
    expect(g.isImageBytes('not bytes' as unknown as Uint8Array)).toBe(false)
  })
})

describe('safeImageFetchOptions', () => {
  it('drops everything but a clamped timeout and size', () => {
    expect(g.safeImageFetchOptions({ allowLoopbackForTesting: true, dnsResolver: {}, allowedTypes: ['text/html'], timeoutMs: 99999, maxBytes: 1e12 })).toEqual({ timeoutMs: 15000, maxBytes: g.MAX_IMAGE_FETCH_BYTES })
    expect(g.safeImageFetchOptions(null)).toEqual({})
    expect(g.safeImageFetchOptions({ timeoutMs: 10 })).toEqual({ timeoutMs: 1000 })
  })
})

describe('isProjectPath', () => {
  it('accepts only .esb files', () => {
    expect(g.isProjectPath('C:\\Users\\x\\Pictures\\ESB Banners\\story.esb')).toBe(true)
    expect(g.isProjectPath('C:\\Users\\x\\AppData\\Local\\Temp\\run.cmd')).toBe(false)
    expect(g.isProjectPath('a.esb\u0000.cmd')).toBe(false)
    expect(g.isProjectPath(42)).toBe(false)
  })
})

describe('isAppUrl', () => {
  const allowed = ['file:///C:/app/dist/index.html', undefined]
  it('matches the app page with any hash or query, and nothing else', () => {
    expect(g.isAppUrl('file:///C:/app/dist/index.html#home', allowed)).toBe(true)
    expect(g.isAppUrl('file:///C:/app/dist/index.html?x=1', allowed)).toBe(true)
    expect(g.isAppUrl('file:///C:/Windows/win.ini', allowed)).toBe(false)
    expect(g.isAppUrl('https://evil.example/', allowed)).toBe(false)
  })
})

describe('isAppFrame', () => {
  const file = 'file:///C:/app/dist/index.html'
  it('accepts the built page, with a hash or query', () => {
    expect(g.isAppFrame(file + '#home', [undefined, file])).toBe(true)
  })
  it('accepts any page of the dev server origin, and only that origin', () => {
    expect(g.isAppFrame('http://localhost:5173/', ['http://localhost:5173', file])).toBe(true)
    expect(g.isAppFrame('http://localhost:5174/', ['http://localhost:5173', file])).toBe(false)
    expect(g.isAppFrame('https://evil.example/', [undefined, file])).toBe(false)
  })
  it('rejects other files, blank and data pages', () => {
    for (const u of ['file:///C:/app/dist/other.html', 'about:blank', 'about:srcdoc', 'data:text/html,x', '', null]) expect(g.isAppFrame(u as string, [undefined, file])).toBe(false)
  })
})
