// Flood a running tracker and prove nothing was lost: every hit sent must come back, exactly.
//   npm run flood -- --letters=200 --opens=5 --clicks=2 --conc=50
//   npm run flood -- https://t.esbpowerline.com --letters=100   (live; secrets in the environment)
// Free-plan budget: one hit = one Worker request + one D1 row write. 200×7 = 1,400 of the 100,000 requests a day.
import { links, newKey } from './lib/token.mjs'
import { pct, pool, target, UA_CHROME } from './lib/target.mjs'

const T = target()
const letters = T.opt('letters', 200), opens = T.opt('opens', 5), clicks = T.opt('clicks', 2), conc = T.opt('conc', 50)
const keep = process.argv.includes('--keep')
const total = letters * (opens + clicks)
if (!T.local && total > 20_000) { console.error(`${total} hits is too many for a live run (cap 20,000).`); process.exit(2) }

const sentAt = Date.now() - 3_600_000
const L = Array.from({ length: letters }, () => { const key = newKey(); return { key, ...links(T.base, T.secret, key, sentAt) } })
const jobs = []
for (const l of L) {
  for (let i = 0; i < opens; i++) jobs.push({ kind: 'open', url: l.pixel })
  for (let i = 0; i < clicks; i++) jobs.push({ kind: 'click', url: l.click(`https://esbpowerline.com/?flood=${i}`) })
}
jobs.sort(() => Math.random() - 0.5)

console.log(`Flooding ${T.base}: ${letters} letters × (${opens} opens + ${clicks} clicks) = ${total} hits, ${conc} at a time`)
const lat = [], bad = []
const t0 = performance.now()
await pool(jobs.map((j) => async () => {
  const s = performance.now()
  try {
    // each request looks like a different reader so the dedupe window never folds them
    const r = await fetch(j.url, { redirect: 'manual', headers: { 'user-agent': `${UA_CHROME} flood/${Math.random().toString(36).slice(2)}` } })
    await r.arrayBuffer()
    const ok = j.kind === 'open' ? r.status === 200 && r.headers.get('content-type') === 'image/gif' : r.status === 302 && r.headers.get('location')?.startsWith('https://esbpowerline.com/?flood=')
    if (!ok) bad.push(`${j.kind} ${r.status} ${r.headers.get('location') ?? ''}`)
  } catch (e) {
    bad.push(`${j.kind} network ${e.message}`)
  }
  lat.push(performance.now() - s)
}), conc)
const secs = (performance.now() - t0) / 1000
lat.sort((a, b) => a - b)
console.log(`Sent in ${secs.toFixed(1)} s (${Math.round(total / secs)}/s). Latency p50 ${pct(lat, 50).toFixed(0)} ms · p95 ${pct(lat, 95).toFixed(0)} ms · p99 ${pct(lat, 99).toFixed(0)} ms · max ${lat.at(-1).toFixed(0)} ms`)
if (bad.length) console.log(`Wrong answers: ${bad.length}\n  ` + bad.slice(0, 10).join('\n  '))

// Read back: recording runs after the answer (waitUntil), so allow a moment.
let missing = [], extra = []
for (let attempt = 0; attempt < 30; attempt++) {
  missing = []; extra = []
  for (let i = 0; i < L.length; i += 100) {
    const keys = L.slice(i, i + 100).map((l) => l.key)
    const { summaries } = await (await T.api(`/api/summary?keys=${keys.join(',')}`)).json()
    for (const s of summaries) {
      const got = s.humanOpens + s.machineOpens + s.proxyOpens, gotC = s.clicks + s.machineClicks
      if (got < opens || gotC < clicks) missing.push(`${s.key}: opens ${got}/${opens}, clicks ${gotC}/${clicks}`)
      if (got > opens || gotC > clicks) extra.push(`${s.key}: opens ${got}/${opens}, clicks ${gotC}/${clicks}`)
    }
  }
  if (!missing.length) break
  await new Promise((r) => setTimeout(r, 1000))
}
const health = await (await fetch(T.base + '/health')).json()
console.log(`Stored: ${missing.length ? `${missing.length} letters short` : 'every hit'}${extra.length ? `, ${extra.length} letters with EXTRA rows` : ''}. Dead letters waiting: ${health.deadLetters}`)
for (const m of [...missing, ...extra].slice(0, 10)) console.log('  ' + m)

if (!keep) {
  let deleted = 0
  for (let i = 0; i < L.length; i += 100) deleted += (await (await T.api(`/api/events?keys=${L.slice(i, i + 100).map((l) => l.key).join(',')}`, { method: 'DELETE' })).json()).deleted
  console.log(`Cleaned up ${deleted} rows.`)
}
const pass = !bad.length && !missing.length && !extra.length
console.log(pass ? 'PASS' : 'FAIL')
process.exit(pass ? 0 : 1)
