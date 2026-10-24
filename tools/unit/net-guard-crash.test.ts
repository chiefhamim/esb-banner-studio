import { describe, it, expect } from 'vitest'
import { createRequire } from 'node:module'
import net from 'node:net'

const require = createRequire(import.meta.url)
const { fetchArticleHtml, fetchImageData } = require('../../electron/net-guard.cjs')

// A server that misbehaves the ways news and image hosts do: accept and never answer, answer a redirect then drop the
// socket, or close mid-headers. Each must come back as a result — never as an uncaught exception, which in Electron's
// main process is the "A JavaScript error occurred in the main process … socket hang up" dialog.
function server(behave: (s: net.Socket) => void): Promise<{ port: number; close: () => void }> {
  return new Promise((res) => {
    const sockets: net.Socket[] = []
    const srv = net.createServer((s) => { sockets.push(s); s.on('error', () => {}); behave(s) })
    srv.listen(0, '127.0.0.1', () => res({ port: (srv.address() as net.AddressInfo).port, close: () => { sockets.forEach((s) => s.destroy()); srv.close() } }))
  })
}

async function noUncaught(run: () => Promise<unknown>) {
  const seen: unknown[] = []
  const onErr = (e: unknown) => seen.push(e)
  process.on('uncaughtException', onErr)
  try {
    const r = await run()
    await new Promise((r2) => setTimeout(r2, 300)) // the late 'error' a destroyed socket emits
    return { r, seen }
  } finally {
    process.off('uncaughtException', onErr)
  }
}

const opts = { allowLoopbackForTesting: true }

describe('net guard never throws out of the main process', () => {
  it('a host that never answers times out cleanly', async () => {
    const s = await server(() => {})
    const { r, seen } = await noUncaught(() => fetchImageData(`http://127.0.0.1:${s.port}/a.jpg`, { ...opts, timeoutMs: 400 }))
    s.close()
    expect(seen).toEqual([])
    expect(r).toMatchObject({ ok: false })
  })

  it('a redirect followed by a dropped socket is a result, not a crash', async () => {
    const s = await server((sock) => {
      sock.once('data', () => { sock.write('HTTP/1.1 302 Found\r\nLocation: /next\r\nContent-Length: 100\r\n\r\npartial'); setTimeout(() => sock.destroy(), 20) })
    })
    const { r, seen } = await noUncaught(() => fetchArticleHtml(`http://127.0.0.1:${s.port}/story`, { ...opts, timeoutMs: 1500 }))
    s.close()
    expect(seen).toEqual([])
    expect(r).toMatchObject({ ok: false })
  })

  it('an error status whose body is cut off is a result, not a crash', async () => {
    const s = await server((sock) => {
      sock.once('data', () => { sock.write('HTTP/1.1 403 Forbidden\r\nContent-Length: 5000\r\n\r\nshort'); setTimeout(() => sock.destroy(), 20) })
    })
    const { r, seen } = await noUncaught(() => fetchArticleHtml(`http://127.0.0.1:${s.port}/story`, { ...opts, timeoutMs: 1500 }))
    s.close()
    expect(seen).toEqual([])
    expect(r).toMatchObject({ ok: false, code: 'blocked' })
  })
})
