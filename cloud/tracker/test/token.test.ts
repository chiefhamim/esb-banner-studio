import { describe, expect, it } from 'vitest'
import { b64url, fileSig, linkSig, makeToken, readToken, unb64url } from '../src/token'
import * as node from '../scripts/lib/token.mjs'

const S = 'test-secret-0123456789abcdef0123456789abcdef'
const KEY = 'AAECAwQFBgcICQoLDA0ODw' // bytes 0..15

describe('token', () => {
  it('round-trips key and send time (to the second)', async () => {
    const t = await makeToken(S, KEY, 1_762_000_000_123)
    expect(t).toHaveLength(44)
    expect(await readToken(S, t)).toEqual({ key: KEY, sentAt: 1_762_000_000_000 })
  })

  it('refuses every single-character change', async () => {
    const t = await makeToken(S, KEY, 1_762_000_000_000)
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'
    let accepted = 0
    for (let i = 0; i < t.length; i++) {
      for (const c of ['A', 'z', '_', alphabet[(alphabet.indexOf(t[i]) + 1) % 64]]) {
        if (c === t[i]) continue
        const bad = t.slice(0, i) + c + t.slice(i + 1)
        // the last character carries 2 padding bits; a change there can decode to the same bytes
        if (b64url(unb64url(bad)!) !== bad) continue
        if (await readToken(S, bad)) accepted++
      }
    }
    expect(accepted).toBe(0)
  })

  it('refuses another secret, wrong lengths, junk', async () => {
    const t = await makeToken(S, KEY, Date.now())
    expect(await readToken(S + 'x', t)).toBeNull()
    for (const bad of ['', 'x', t.slice(1), t + 'A', '!'.repeat(44), ' '.repeat(44), t.replace(/./, '+')]) {
      expect(await readToken(S, bad)).toBeNull()
    }
  })

  it('link and file signatures bind key + target', async () => {
    const a = await linkSig(S, KEY, 'https://esbpowerline.com/a')
    expect(a).toHaveLength(12)
    expect(await linkSig(S, KEY, 'https://esbpowerline.com/b')).not.toBe(a)
    expect(await linkSig(S, 'BAECAwQFBgcICQoLDA0ODw', 'https://esbpowerline.com/a')).not.toBe(a)
    expect(await fileSig(S, KEY, 'file-0001')).not.toBe(await linkSig(S, KEY, 'file-0001'))
  })

  it('the Node copy (used by the app) signs byte-for-byte the same', async () => {
    for (let i = 0; i < 200; i++) {
      const key = node.newKey()
      const at = 1_700_000_000_000 + i * 997_331
      const url = `https://esbpowerline.com/articles/story-${i}?x=${i}&y=%E0%A6%95`
      expect(node.makeToken(S, key, at)).toBe(await makeToken(S, key, at))
      expect(node.linkSig(S, key, url)).toBe(await linkSig(S, key, url))
      expect(node.fileSig(S, key, `f-${i}-abcdefgh`)).toBe(await fileSig(S, key, `f-${i}-abcdefgh`))
    }
  })
})
