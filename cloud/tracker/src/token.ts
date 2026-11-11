// Signed tracking tokens. The app (electron/outreach-tracking.cjs) makes them with the same secret; the Worker only
// records hits whose token verifies, and only redirects to a link whose signature verifies, so nobody can forge opens
// or turn the click route into an open redirect.
//
// token = base64url( 0x01 | key (16 bytes) | sent (uint32, seconds since 1970) | mac (12 bytes) )  → 44 characters
//   mac  = HMAC-SHA256(secret, "esb-trk-v1|" + bytes 0..20)[0..12]
// link signature  = base64url(HMAC-SHA256(secret, "esb-lnk-v1|" + key + "|" + url)[0..9])   → 12 characters
// file signature  = base64url(HMAC-SHA256(secret, "esb-file-v1|" + key + "|" + fileId)[0..9])

const enc = new TextEncoder()

export function b64url(bytes: Uint8Array): string {
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function unb64url(s: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]*$/.test(s)) return null
  try {
    const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4))
    return Uint8Array.from(bin, (c) => c.charCodeAt(0))
  } catch {
    return null
  }
}

const keys = new Map<string, Promise<CryptoKey>>()
function hmacKey(secret: string) {
  let k = keys.get(secret)
  if (!k) {
    k = crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
    keys.set(secret, k)
  }
  return k
}

async function mac(secret: string, label: string, data: Uint8Array | string, len: number): Promise<Uint8Array> {
  const body = typeof data === 'string' ? enc.encode(label + data) : concat(enc.encode(label), data)
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', await hmacKey(secret), body))
  return sig.slice(0, len)
}

function concat(a: Uint8Array, b: Uint8Array) {
  const o = new Uint8Array(a.length + b.length)
  o.set(a); o.set(b, a.length)
  return o
}

/** Compare without stopping at the first difference. */
export function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  let d = 0
  for (let i = 0; i < a.length; i++) d |= a[i] ^ b[i]
  return d === 0
}

export function sameText(a: string, b: string): boolean {
  return sameBytes(enc.encode(a), enc.encode(b))
}

export interface Token { key: string; sentAt: number }

export async function makeToken(secret: string, key: string, sentAtMs: number): Promise<string> {
  const k = unb64url(key)
  if (!k || k.length !== 16) throw new Error('bad key')
  const head = new Uint8Array(21)
  head[0] = 1
  head.set(k, 1)
  new DataView(head.buffer).setUint32(17, Math.floor(sentAtMs / 1000))
  return b64url(concat(head, await mac(secret, 'esb-trk-v1|', head, 12)))
}

export async function readToken(secret: string, token: string): Promise<Token | null> {
  if (token.length !== 44) return null
  const raw = unb64url(token)
  if (!raw || raw.length !== 33 || raw[0] !== 1) return null
  const head = raw.slice(0, 21)
  if (!sameBytes(raw.slice(21), await mac(secret, 'esb-trk-v1|', head, 12))) return null
  return { key: b64url(head.slice(1, 17)), sentAt: new DataView(head.buffer).getUint32(17) * 1000 }
}

export async function linkSig(secret: string, key: string, url: string) {
  return b64url(await mac(secret, 'esb-lnk-v1|', `${key}|${url}`, 9))
}

export async function fileSig(secret: string, key: string, fileId: string) {
  return b64url(await mac(secret, 'esb-file-v1|', `${key}|${fileId}`, 9))
}
