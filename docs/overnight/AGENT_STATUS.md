# Agent status

Updated by the orchestrator whenever an agent is started, reports, or is stopped. Times are Asia/Dhaka.

| Agent | Role | Worktree / branch | Started | State | Last report |
|---|---|---|---|---|---|
| orchestrator (Fable 5.1) | plan, W7, P0, T0, integration, report | `esb-banner-studio` / `overnight/2026-11-01` | 01:40 | W7 + P0 in progress | — |
| builder W1 (Opus) | Quote & Stat Library | `esb-overnight/w1` / `overnight/w1-quote-library` (offset 100) | 02:15 | accepted 04:55, merging | 5 commits through 5a7bd4a |
| builder W2 (Opus) | Insights desk + W6 AI efficiency | `esb-overnight/w2` / `overnight/w2-insights` (offset 200) | 02:15 | reported 03:50 | a64143f W2, f5f08ff W6, 75a5915 logs: unit 595, insights e2e 46, editorial 60/60, golden unchanged |
| builder W3 (Opus) | Distribution scheduler | `esb-overnight/w3` / `overnight/w3-scheduler` (offset 300) | 02:40 | cut off 02:50, HELD (D15) | engine/guard/jobs/schedule/events/main/preload edited, distribution.test.ts, uncommitted |
| builder W5 (Opus) | Wire desk (spike gate first) | `esb-overnight/w5` / `overnight/w5-wire` (offset 500) | 02:40 | cut off 02:50, HELD (D15) | spike passed + committed 1fe0e71; WireInbox.tsx, wire-test.mjs uncommitted |
| QA-W1 (Opus) | adversarial review of W1 | reads `esb-overnight/w1`; writes `docs/overnight/qa/W1.md` | 03:36 | done 04:55: PASS WITH NON-BLOCKING FINDINGS | qa/W1.md |
| QA-W2 (Opus) | adversarial review of W2/W6 | reads `esb-overnight/w2`; writes `docs/overnight/qa/W2.md` | 03:52 | running | — |
