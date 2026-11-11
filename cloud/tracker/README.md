# ESB Mail Tracker (Cloudflare Worker)

Opens, link clicks and attachment downloads for Outreach letters. Free plan: Workers + D1 + R2.

| Route | What |
|---|---|
| `GET /o/{token}.gif` | open pixel; always 200 + 43-byte GIF, even with a bad token or the database down |
| `GET /c/{token}?u=&s=` | click; redirects only to a link the secret signed, anything else goes to `HOME_URL` |
| `GET /f/{token}/{fileId}?s=` | tracked attachment from R2 (ranges; one download counted per file fetch) |
| `GET /health` | database, file store, dead-letter backlog, secret present |
| `GET /api/events?after=&limit=` | raw hits after an id (the app's cursor) — Bearer `API_TOKEN` |
| `GET /api/summary?keys=` | per-letter summary (opens, clicks, files, clients, places, forwarded) |
| `DELETE /api/events?keys=` | remove test letters' rows |
| `PUT/DELETE /api/files/{id}` | attachment upload (≤25 MB, `x-file-name`) |

**Tokens:** `src/token.ts` (Worker) and `scripts/lib/token.mjs` (Node, for the app) are held byte-identical by `test/token.test.ts`.
**Never loses a hit silently:** insert → 2 retries → dead letter in R2 `dlq/` → cron replays every 5 min (`hit_id` makes replays idempotent) → last resort, the Worker log.
**Classes:** `human`, `proxy` (Gmail/Yahoo/Microsoft fetch: an open, location hidden), `prefetch` (Apple Mail Privacy Protection, < 30 s after sending), `scanner` (security gateways, cloud hosts, HEAD, link previews), `bot`. Only human + proxy count as opens. "Forwarded" is an estimate (likely / possible / no / unknown) from where people opened it.

## Test like a madman

```
npm test                      # 68 tests in the real Workers runtime: unit, routes, chaos, load, fuzz
npm run retest -- 10          # the suite 10× in shuffled order
npm run dev                   # local tracker on :8787 (secrets from .dev.vars, not in git)
npm run smoke                 # one of everything against :8787, checked and cleaned up
npm run flood -- --letters=1000 --opens=5 --clicks=2 --conc=100
npm run madman                # typecheck + 5 shuffled runs + smoke + 7,000-hit flood (needs `npm run dev`)
```
Live: `TRACK_SECRET` and `API_TOKEN` in the environment, then `npm run smoke -- https://t.esbpowerline.com`
(flood is capped at 20,000 hits live; free plan = 100,000 requests a day).

## Deploy (once)
```
npx wrangler login
npx wrangler d1 create esb-mail-tracker        # put the id in wrangler.jsonc
npx wrangler r2 bucket create esb-mail-tracker-files
npx wrangler d1 migrations apply DB --remote
npx wrangler secret put TRACK_SECRET           # 48+ random characters; the app gets the same value
npx wrangler secret put API_TOKEN
npx wrangler deploy                            # then add the custom domain t.esbpowerline.com
```
