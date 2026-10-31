# QA assignments (one review per workstream; protocol in QA.md)

Each review: worktree + branch, the brief, the builder's report (pasted by the orchestrator), and the specific
failure-mode probes below in addition to the protocol's generic ones. Verdict file: `docs/overnight/qa/W<n>.md`
in the orchestrator's checkout.

## W1 — Quote & Stat Library (`esb-overnight/w1`, `overnight/w1-quote-library`)
Probes: (1) IndexedDB unavailable → memory fallback, no crash, library still usable in-session; (2) simulate
quota: make `idbSet` throw on the entry write → index unchanged, no half-entry, UI shows the failure honestly;
(3) 505 harvested entries → 500 kept, oldest gone, index and entries agree; (4) a quote containing `<script>`
and `&amp;` renders as text in the list and lands verbatim in `quoteText`; (5) AI paused / no provider → every
library action still works; (6) restart persistence: harvest, reload in the same browser context, entries and
speaker edits are back; (7) "Use as quote banner" then switch format in Graphics → card still shows the
quote (document state is per-doc, not per-format); (8) the `esb:story-published` listener harvests only the
active story and records the event's `slug`/`url`.

## W2 — Insights desk + W6 (`esb-overnight/w2`, `overnight/w2-insights`)
Probes: (1) expired token (Graph error code 190): honest state, no retry on the next refresh, nothing in
console/localStorage/DOM/test output containing the fake token string; (2) rate limit (code 4): back-off state,
Refresh disabled with the reason, no request storm (count requests over 3 clicks = 0 new); (3) malformed JSON /
HTTP 500 / offline → typed error, charts show empty state, no sample numbers; (4) no publish log → "Nothing
published from this app yet"; (5) CSV: open the exported file, count rows = stories in range, commas/quotes in
headlines escaped; (6) AI summary prompt: capture the `aiJson` request (mock) and assert it carries only the
aggregate table, inside delimiters, no article text, no token; button absent when AI is paused; (7) W6:
`decideEscalation` with a clean verification → no second call (mock counts 1); with a number mismatch → second
call to the stronger model and a job-log line; (8) the Anthropic request body still carries the `cache_control`
breakpoints; (9) restart persistence of the insights cache with its `fetchedAt`; (10) both desk views at
1366×768 light/dark — toolbar fits, no overflow.

## W3 — Distribution scheduler (`esb-overnight/w3`, `overnight/w3-scheduler`)
Probes — try hard to double-fire: (1) submit the same (story, action) twice → second refused with
`distribute.skip`; (2) approve, let it fire, then relaunch → not fired again; (3) force-kill between the
`distribute.fire` ledger line and the renderer's result → on relaunch `failed: interrupted`, zero extra mock
calls; (4) renderer sends a forged `esb:outreach-distribute-result` for a key it never received → rejected by the
guard, job state unchanged; (5) unapproved job past `fireAt` → never fires, UI says so; (6) `fireAt` in the past
at submit → rejected; day-boundary times; (7) window closed with an approved job pending → hidden to tray,
fires; Clean Quit → state resumable; (8) app not running at `fireAt`, relaunch inside / outside the 2-hour grace;
(9) existing autopilot suites unchanged (`outreach-autopilot-test.mjs`, `outreach-crash.mjs`); (10) no new IPC
argument accepted without validation (read `outreach-guard.cjs` diff).

## W5 — Wire desk (`esb-overnight/w5`, `overnight/w5-wire`)
Probes: (1) net-guard rejections surfaced as structured text — private IP, redirect to loopback, oversize body —
and the source backs off (`nextAt` grows, `failures` increments); (2) a feed item whose title contains
`<img onerror>` renders as text; a `javascript:` link is never rendered as an href; (3) dedupe: the same story
from two sources with Bengali vs ASCII digits → one inbox item; (4) 300-item cap and dismissed persistence
across reload; (5) interval respected: Check now twice within the interval → one fetch; (6) no live network:
`page.on('request')` sees only localhost; (7) "Use this link" fills the Link field and does not fetch by itself;
(8) the gate: confirm by reading `net-guard.cjs`/`main.cjs` that no change was needed and none was made.
