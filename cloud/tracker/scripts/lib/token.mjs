// Node copy of src/token.ts (node:crypto). The app's main process signs links with this exact algorithm;
// test/token.test.ts holds the two copies equal byte for byte.
import { createHmac, randomBytes } from 'node:crypto'

const b64url = (buf) => Buffer.from(buf).toString('base64url')
const mac = (secret, label, data, len) => createHmac('sha256', secret).update(Buffer.concat([Buffer.from(label), Buffer.from(data)])).digest().subarray(0, len)

export function newKey() {
  return b64url(randomBytes(16))
}

export function makeToken(secret, key, sentAtMs) {
  const k = Buffer.from(key, 'base64url')
  if (k.length !== 16) throw new Error('bad key')
  const head = Buffer.alloc(21)
  head[0] = 1
  k.copy(head, 1)
  head.writeUInt32BE(Math.floor(sentAtMs / 1000), 17)
  return b64url(Buffer.concat([head, mac(secret, 'esb-trk-v1|', head, 12)]))
}

export const linkSig = (secret, key, url) => b64url(mac(secret, 'esb-lnk-v1|', `${key}|${url}`, 9))
export const fileSig = (secret, key, fileId) => b64url(mac(secret, 'esb-file-v1|', `${key}|${fileId}`, 9))

/** The three addresses a letter carries. `url` must already be normalised (new URL(u).href). */
export function links(base, secret, key, sentAtMs) {
  const t = makeToken(secret, key, sentAtMs)
  return {
    token: t,
    pixel: `${base}/o/${t}.gif`,
    click: (url) => `${base}/c/${t}?u=${encodeURIComponent(url)}&s=${linkSig(secret, key, url)}`,
    file: (id) => `${base}/f/${t}/${id}?s=${fileSig(secret, key, id)}`,
  }
}
