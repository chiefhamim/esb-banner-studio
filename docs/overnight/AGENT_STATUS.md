# Agent status

Updated by the orchestrator whenever an agent is started, reports, or is stopped. Times are Asia/Dhaka.

| Agent | Role | Worktree / branch | Started | State | Last report |
|---|---|---|---|---|---|
| orchestrator (Fable 5.1) | plan, W7, P0, T0, integration, report | `esb-banner-studio` / `overnight/2026-11-01` | 01:40 | W7 + P0 in progress | — |
| builder W1 (Opus) | Quote & Stat Library | `esb-overnight/w1` / `overnight/w1-quote-library` (offset 100) | 02:15 | accepted 04:55, merging | 5 commits through 5a7bd4a |
| builder W2 (Opus) | Insights desk + W6 AI efficiency | `esb-overnight/w2` / `overnight/w2-insights` (offset 200) | 02:15 | accepted 05:10, merged; polish cycle (D17) running | a64143f, f5f08ff, 75a5915 |
| builder W3 (Opus) | Distribution scheduler | `esb-overnight/w3` / `overnight/w3-scheduler` (offset 300) | 02:40 | cut off 02:50, HELD (D15) | engine/guard/jobs/schedule/events/main/preload edited, distribution.test.ts, uncommitted |
| builder W5 (Opus) | Wire desk (spike gate first) | `esb-overnight/w5` / `overnight/w5-wire` (offset 500) | 02:40 | resumed 05:25 | spike 1fe0e71; finishing UI + wire-test |
| QA-W1 (Opus) | adversarial review of W1 | reads `esb-overnight/w1`; writes `docs/overnight/qa/W1.md` | 03:36 | done 04:55: PASS WITH NON-BLOCKING FINDINGS | qa/W1.md |
| QA-W2 (Opus) | adversarial review of W2/W6 | reads `esb-overnight/w2`; writes `docs/overnight/qa/W2.md` | 03:52 | done 05:10: PASS WITH NON-BLOCKING FINDINGS | qa/W2.md |
| builder W4 (Opus) | Newsletter digest | `esb-overnight/w4` / `overnight/w4-digest` (offset 400, from eee9a5c) | 05:27 | running | — |
