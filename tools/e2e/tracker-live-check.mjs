// End to end against the LIVE ESB Mail Tracker, without sending any email: build a letter the way the mailer does
// (trackHtml, Worker mode, this PC's config), load its pixel and follow its link as a reader's mail app would, then let
// the app's poller bring the hits back into a throwaway event log. Cleans its rows off the tracker afterwards.
// Usage: node tools/e2e/tracker-live-check.mjs
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const T = require('../../electron/outreach-tracking.cjs')
const { createTrackerPull } = require('../../electron/outreach-tracker-pull.cjs')

const tracker = T.loadTrackerConfig()
if (!tracker) { console.error('No tracker config on this PC (~/.config/esb-mail-tracker/secrets.env).'); process.exit(2) }
let failed = 0
const ok = (c, m) => { console.log(`${c ? '✔' : '✘'} ${m}`); if (!c) failed++ }
const UA_OUTLOOK = 'Mozilla/4.0 (compatible; ms-office; MSOffice 16)'
const UA_CHROME = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'

const gate = T.createTrackingGate({ env: {}, tracker })
ok(await gate.enabled(), `gate says the tracker is live (${gate.status().host})`)

const key = T.newMessageKey()
const sentAt = Date.now() - 5 * 60_000 // five minutes ago: past the tracker's "too soon to be a person" window
const dest = 'https://esbpowerline.com/?tracker-live-check=1'
const html = T.trackHtml(`<html><body><p>Hello</p><p><a href="${dest}">Read the story</a></p></body></html>`, { key, tracker, sentAt })
const pixel = html.match(/<img src="([^"]+)"/)?.[1]
const link = html.match(/<a href="([^"]+)"/)?.[1]?.replace(/&amp;/g, '&')
ok(!!pixel && pixel.startsWith(tracker.base + '/o/'), 'letter carries one tracker pixel')
ok(!!link && link.startsWith(tracker.base + '/c/'), 'letter link goes through the tracker')

const p = await fetch(pixel, { headers: { 'user-agent': UA_OUTLOOK } })
ok(p.status === 200 && p.headers.get('content-type') === 'image/gif', `pixel loads as a GIF (${p.status})`)
const c = await fetch(link, { redirect: 'manual', headers: { 'user-agent': UA_CHROME } })
ok(c.status === 302 && c.headers.get('location') === dest, `link lands on the story (${c.status} → ${c.headers.get('location')})`)

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'trk-live-'))
const ledger = [{ t: sentAt, to: 'reader@example.com', kind: 'campaign', key, c: 'live-check' }]
const appended = []
// start from the newest rows: read the current cursor end first so the poll only walks recent pages
const pull = createTrackerPull({ tracker, dir, ledger: () => ledger, append: (e) => appended.push(e) })
let got = 0
for (let i = 0; i < 10 && got < 2; i++) { got += await pull.poll({ force: true }); if (got < 2) await new Promise((r) => setTimeout(r, 1000)) }
const open = appended.find((e) => e.type === 'track.open')
const click = appended.find((e) => e.type === 'track.click')
ok(!!open && open.email === 'reader@example.com' && open.campaignId === 'live-check', 'open came back into the event log, matched to the reader')
ok(open?.cls === 'human' && open?.client === 'Outlook', `open judged a person in Outlook (${open?.cls}, ${open?.client}, ${[open?.city, open?.country].filter(Boolean).join(', ')})`)
ok(!!click && click.link === dest && click.cls === 'human', `click came back with its link (${click?.cls})`)
await pull.poll({ force: true })
ok(appended.length === 2, `polling again adds nothing (${appended.length} events)`)

const del = await fetch(`${tracker.base}/api/events?keys=${key}`, { method: 'DELETE', headers: { authorization: `Bearer ${tracker.token}` } })
ok((await del.json()).deleted === 2, 'test rows removed from the tracker')
fs.rmSync(dir, { recursive: true, force: true })
console.log(failed ? `\n${failed} FAILED` : '\nAll passed')
process.exit(failed ? 1 : 0)
