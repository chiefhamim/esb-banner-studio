// @vitest-environment jsdom
// Phase 1 fix round, Part A — the renderer's media state: a relinked entry never previews (or caches a filmstrip
// from) the old file's proxy (C3), a failed re-hash keeps the hash it had and saving a Phase 0 single file keeps the
// facts (C6), and background proxies can be held during playback and export (P5a: holdProxies).
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useVideoStore } from '../../src/video/videoStore'
import { clipsForAsset, createDefaultTimeline } from '../../src/video/timeline'
import type { MediaAsset } from '../../src/video/timeline'
import { holdProxies, mediaInfo, metaFor, patchMeta, previewUrlFor, proxiesHeld, proxiesUnheld, proxyHolds, useMediaMeta } from '../../src/video/media'
import { startMediaPipeline } from '../../src/video/proxies'
import { saveProject } from '../../src/video/projectIO'
import { parseProjectText } from '../../src/video/projectFolder'

const A = 'esb-media://m/' + 'a'.repeat(32)
const B = 'esb-media://m/' + 'b'.repeat(32)
const H = '1'.repeat(32)
const PROXY = 'esb-media://p/u/proxies/' + H + '.mp4'
const footage: MediaAsset = { id: 'a-foot', name: 'interview.mp4', type: 'video', url: A, path: 'C:\\media\\interview.mp4', duration: 6, size: 1000, width: 1920, height: 1080, hasAudio: true }
const S = () => useVideoStore.getState()

function load() {
  const p = createDefaultTimeline('16:9')
  S().loadProject({ ...p, clips: clipsForAsset(p, footage, 0, 'auto', 'x') }, { assets: [footage], path: 'C:\\Pictures\\old.esbvideo' })
  useMediaMeta.setState({ folder: null, byId: {}, found: {} })
  patchMeta(footage.id, { analyzedUrl: A, hashUrl: A, hash: H, codec: 'avc1.640028', fps: 29.97, keyframeInterval: 1, proxy: 'ready', proxyUrl: PROXY, proxyHash: H, proxyNeeded: true })
}

const statusCalls: string[][] = []
beforeEach(() => {
  // nothing behind esb-media:// here: the container read fails at once (mediabunny retries network errors, not a 404)
  vi.stubGlobal('fetch', async () => new Response(null, { status: 404 }))
  statusCalls.length = 0
  ;(window as unknown as { esb?: unknown }).esb = {
    // the new file's hash cannot be read (unplugged drive, say)
    videoMediaFacts: async () => { throw new Error('unreadable') },
    videoProxyStatus: async (_f: string | null, hashes: string[]) => { statusCalls.push(hashes); return { [H]: PROXY } },
  }
  load()
})

describe('C3: a relink drops the old file’s proxy at once', () => {
  it('previews the new original (never the old proxy), and mediaInfo says no proxy', async () => {
    expect(previewUrlFor(footage.id)).toBe(PROXY)
    expect(mediaInfo(footage.id)?.proxy).toBe('ready')
    startMediaPipeline()
    S().relinkAsset(footage.id, { url: B, path: 'C:\\other\\take2.mp4', size: 2000 })
    // synchronously after the relink: the guard alone already refuses the old proxy
    expect(previewUrlFor(footage.id)).toBe(B)
    expect(mediaInfo(footage.id)?.proxy).toBe('none')
    // the pipeline resets the proxy state and reads the new file
    await vi.waitFor(() => expect(metaFor(footage.id)?.analyzedUrl).toBe(B), { timeout: 5000 })
    const m = metaFor(footage.id)!
    expect(m.proxy).toBe('none')
    expect(m.proxyUrl).toBeUndefined()
    expect(previewUrlFor(footage.id)).toBe(B)
    // C6: the failed re-hash kept the previous hash (relink-by-hash and project.json still need it) …
    expect(m.hash).toBe(H)
    // … but it is not trusted as the new file's: no proxy was looked up or made with it
    expect(m.hashUrl).toBe(A)
    expect(statusCalls).toEqual([])
  })

  it('relinking back to a file with the same hash finds its proxy again', async () => {
    ;(window as unknown as { esb: Record<string, unknown> }).esb.videoMediaFacts = async (urls: string[]) => urls.map((url) => ({ url, hash: H, size: 1000 }))
    startMediaPipeline()
    S().relinkAsset(footage.id, { url: B })
    expect(previewUrlFor(footage.id)).toBe(B)
    await vi.waitFor(() => expect(previewUrlFor(footage.id)).toBe(PROXY), { timeout: 5000 })
    expect(metaFor(footage.id)?.hashUrl).toBe(B)
    expect(statusCalls).toEqual([[H]])
  })
})

describe('C6: saving a Phase 0 single-file project keeps the media facts', () => {
  it('hash, codec, fps and key-frame interval go into the single file and come back on open', async () => {
    let saved = ''
    ;(window as unknown as { esb: Record<string, unknown> }).esb = {
      videoFolderCreate: async () => null,
      videoFolderSave: async () => '',
      videoSaveProject: async (_n: string, text: string, existing: string | null) => { saved = text; return existing },
    }
    expect(await saveProject()).toBe('C:\\Pictures\\old.esbvideo')
    const rec = JSON.parse(saved).mediaAssets[0]
    expect(rec).toMatchObject({ id: footage.id, hash: H, codec: 'avc1.640028', fps: 29.97, keyframeInterval: 1 })
    // still a Phase 0 file (older builds open it), and the facts are read back through the v1 → v2 migration
    expect(JSON.parse(saved).tracks).toBeTruthy()
    const back = parseProjectText(saved)!
    expect(back.version).toBe(1)
    expect(back.facts[footage.id]).toMatchObject({ hash: H, codec: 'avc1.640028', fps: 29.97, keyframeInterval: 1 })
  })
})

describe('P5a: holdProxies', () => {
  it('holds nest, release is idempotent, and waiters resume only when the last hold is released', async () => {
    expect(proxiesHeld()).toBe(false)
    const play = holdProxies('playback')
    const exp = holdProxies('export')
    expect(proxyHolds().sort()).toEqual(['export', 'playback'])
    let resumed = false
    void proxiesUnheld().then(() => { resumed = true })
    play()
    play()
    await Promise.resolve()
    expect(resumed).toBe(false)
    expect(proxyHolds()).toEqual(['export'])
    exp()
    await Promise.resolve()
    await Promise.resolve()
    expect(resumed).toBe(true)
    expect(proxiesHeld()).toBe(false)
    await expect(proxiesUnheld()).resolves.toBeUndefined()
  })
})
