import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { createRenderRegistry } = require('../../electron/video-renders.cjs')
const { registerVideoPublishIpc, approvalText } = require('../../electron/video-publish/ipc.cjs')

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'esb-vpub-ipc-'))
const file = path.join(tmp, 'clip.mp4')
fs.writeFileSync(file, Buffer.alloc(5000, 7))

describe('render registry', () => {
  it('names files by opaque id, lists name and size but never a path, and loses a deleted file', () => {
    const reg = createRenderRegistry({ file: path.join(tmp, 'renders.json') })
    expect(reg.register(path.join(tmp, 'missing.mp4'))).toBeNull()
    expect(reg.register('relative/path.mp4')).toBeNull()
    const id = reg.register(file)
    expect(typeof id).toBe('string')
    expect(reg.pathOf(id)).toBe(file)
    expect(reg.pathOf('../../etc/passwd')).toBeNull()
    expect(JSON.stringify(reg.list())).not.toContain(tmp)
    expect(reg.list()[0]).toMatchObject({ name: 'clip.mp4', size: 5000, exists: true })
    const copy = path.join(tmp, 'gone.mp4'); fs.writeFileSync(copy, 'x'); const id2 = reg.register(copy); fs.rmSync(copy)
    expect(reg.pathOf(id2)).toBeNull()
    // remembered across a restart
    expect(createRenderRegistry({ file: path.join(tmp, 'renders.json') }).pathOf(id)).toBe(file)
  })
})

function harness() {
  const handlers = new Map<string, (...a: unknown[]) => unknown>()
  const ipcMain = { handle: (c: string, fn: (...a: unknown[]) => unknown) => handlers.set(c, fn) }
  const reg = createRenderRegistry({ file: path.join(tmp, 'renders2.json') })
  const id = reg.register(file)
  const dialogCalls: Record<string, unknown>[] = []
  const dialog = { showMessageBox: async (_w: unknown, o: Record<string, unknown>) => { dialogCalls.push(o); return { response: 0 } } }
  registerVideoPublishIpc({
    ipcMain, dialog, shell: { openExternal: async () => {}, showItemInFolder: () => {} }, app: { getPath: () => tmp }, safeStorage: {}, getWindow: () => null,
    renders: reg, createPublishing: async () => { throw new Error('not needed here') }, onUpdate: () => {},
  })
  const call = (c: string, ...a: unknown[]) => handlers.get(c)!({}, ...a)
  return { call, id, dialogCalls }
}

describe('hostile reads of a render', () => {
  const { call, id } = harness()
  it('reads a bounded piece of a registered render', async () => {
    const r = (await call('esb:vpub-render-read', id, 10, 20)) as Uint8Array
    expect(r).toBeInstanceOf(Uint8Array)
    expect(r.length).toBe(10)
    const tail = (await call('esb:vpub-render-read', id, 4990, 6000)) as Uint8Array
    expect(tail.length).toBe(10)
  })
  it('refuses unknown ids, negative, reversed, huge, fractional and past-the-end ranges', async () => {
    for (const args of [['nope', 0, 10], [id, -1, 10], [id, 10, 10], [id, 20, 10], [id, 0, 9 * 1024 * 1024], [id, 0.5, 10], [id, 5000, 5100], ['../../x', 0, 5]]) {
      const r = (await call('esb:vpub-render-read', ...args)) as { ok?: boolean }
      expect(r && (r as { ok?: boolean }).ok === false, JSON.stringify(args)).toBe(true)
    }
  })
  it('never lets the renderer name a path to show in a folder', async () => {
    const r = (await call('esb:vpub-render-show', 'C:/Windows/System32/notepad.exe')) as { ok?: boolean; error?: string }
    expect(r.ok).toBe(false)
  })
})

describe('the Approve dialog text', () => {
  it('says exactly what will be posted, where and when, and mentions AI voice and test runs', () => {
    const t = approvalText({ title: 'Two wells', renderPath: file, destinations: [{ kind: 'youtube', privacyStatus: 'private' }, { kind: 'facebook_reel', postState: 'DRAFT' }], schedule: { at: null }, aiVoice: true, dryRun: true })
    expect(t.message).toContain('Two wells')
    expect(t.detail).toContain('YouTube (private)')
    expect(t.detail).toContain('Facebook Reel (DRAFT)')
    expect(t.detail).toContain('AI voice')
    expect(t.detail).toContain('TEST RUN')
    expect(t.detail).toContain('clip.mp4')
  })
})
