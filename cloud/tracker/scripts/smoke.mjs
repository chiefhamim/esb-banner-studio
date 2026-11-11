// Smoke test against a running tracker: one of everything, checked end to end, then cleaned up.
//   npm run smoke                                  (wrangler dev on :8787)
//   npm run smoke -- https://t.esbpowerline.com    (live; TRACK_SECRET and API_TOKEN in the environment)
import { links, newKey } from './lib/token.mjs'
import { target, UA_CHROME } from './lib/target.mjs'

const T = target()
const results = []
const check = async (name, fn) => {
  const t0 = performance.now()
  try {
    await fn()
    results.push([name, 'ok', Math.round(performance.now() - t0)])
  } catch (e) {
    results.push([name, 'FAIL: ' + e.message, Math.round(performance.now() - t0)])
  }
}
const must = (cond, msg) => { if (!cond) throw new Error(msg) }

const key = newKey()
const L = links(T.base, T.secret, key, Date.now() - 3_600_000)
const dest = 'https://esbpowerline.com/?smoke=' + key
const fileId = 'smoke-' + key.slice(0, 12).replace(/[^A-Za-z0-9]/g, 'x')
const H = { 'user-agent': UA_CHROME }

let filesOn = false
await check('health', async () => {
  const r = await fetch(T.base + '/health')
  const j = await r.json()
  filesOn = j.files === 'on'
  must(r.status === 200 && j.ok, JSON.stringify(j))
})
await check('pixel answers a GIF', async () => {
  const r = await fetch(L.pixel, { headers: H })
  must(r.status === 200 && r.headers.get('content-type') === 'image/gif', `${r.status} ${r.headers.get('content-type')}`)
  must((await r.arrayBuffer()).byteLength === 43, 'not 43 bytes')
  must(/no-store/.test(r.headers.get('cache-control') ?? ''), 'cacheable')
})
await check('forged pixel still a GIF', async () => {
  const r = await fetch(`${T.base}/o/${'A'.repeat(44)}.gif`, { headers: H })
  must(r.status === 200 && r.headers.get('content-type') === 'image/gif', String(r.status))
})
await check('click redirects to the signed link', async () => {
  const r = await fetch(L.click(dest), { headers: H, redirect: 'manual' })
  must(r.status === 302 && r.headers.get('location') === dest, `${r.status} -> ${r.headers.get('location')}`)
})
await check('tampered click goes home', async () => {
  const r = await fetch(L.click(dest).replace(encodeURIComponent(dest), encodeURIComponent('https://evil.example/')), { headers: H, redirect: 'manual' })
  must(r.status === 302 && !/evil/.test(r.headers.get('location') ?? ''), r.headers.get('location'))
})
if (filesOn) await check('file upload + tracked download', async () => {
  const body = new TextEncoder().encode('ESB tracker smoke file ' + key)
  const up = await T.api(`/api/files/${fileId}`, { method: 'PUT', body, headers: { 'content-type': 'text/plain', 'x-file-name': 'smoke.txt' } })
  must(up.ok, 'upload ' + up.status)
  const r = await fetch(L.file(fileId), { headers: H })
  must(r.ok && (await r.text()).includes(key), 'download ' + r.status)
})
await check('every hit came back through the API', async () => {
  let s
  for (let i = 0; i < 20; i++) {
    s = (await (await T.api(`/api/summary?keys=${key}`)).json()).summaries[0]
    if (s.opens >= 1 && s.clicks >= 1 && (!filesOn || s.files.length)) break
    await new Promise((r) => setTimeout(r, 500))
  }
  must(s.opens === 1 && s.clicks === 1 && (!filesOn || s.files[0]?.downloads === 1), JSON.stringify({ opens: s.opens, clicks: s.clicks, files: s.files }))
})
await check('clean up', async () => {
  if (filesOn) await T.api(`/api/files/${fileId}`, { method: 'DELETE' })
  const d = await (await T.api(`/api/events?keys=${key}`, { method: 'DELETE' })).json()
  must(d.deleted === (filesOn ? 3 : 2), 'deleted ' + d.deleted)
})

const w = Math.max(...results.map((r) => r[0].length))
for (const [n, s, ms] of results) console.log(`${s === 'ok' ? '✔' : '✘'} ${n.padEnd(w)}  ${String(ms).padStart(5)} ms  ${s === 'ok' ? '' : s}`)
const failed = results.filter((r) => r[1] !== 'ok').length
console.log(failed ? `\n${failed} FAILED against ${T.base}` : `\nAll ${results.length} passed against ${T.base}`)
process.exit(failed ? 1 : 0)
