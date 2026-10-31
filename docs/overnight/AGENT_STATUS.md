# Agent status

Updated by the orchestrator whenever an agent is started, reports, or is stopped. Times are Asia/Dhaka.

| Agent | Role | Worktree / branch | Started | State | Last report |
|---|---|---|---|---|---|
| orchestrator (Fable 5.1) | plan, W7, P0, T0, integration, report | `esb-banner-studio` / `overnight/2026-11-01` | 01:40 | W7 + P0 in progress | — |
| builder W1 (Opus) | Quote & Stat Library | `esb-overnight/w1` / `overnight/w1-quote-library` (offset 100) | 02:15 | accepted 04:55, merging | 5 commits through 5a7bd4a |
| builder W2 (Opus) | Insights desk + W6 AI efficiency | `esb-overnight/w2` / `overnight/w2-insights` (offset 200) | 02:15 | accepted + merged incl. polish (4e09a7d) | a64143f, f5f08ff, 75a5915, 803cb1e |
| builder W3 (Opus) | Distribution scheduler | `esb-overnight/w3` / `overnight/w3-scheduler` (offset 300) | 02:40 | cut off 02:50, HELD (D15) | engine/guard/jobs/schedule/events/main/preload edited, distribution.test.ts, uncommitted |
| builder W5 (Opus) | Wire desk (spike gate first) | `esb-overnight/w5` / `overnight/w5-wire` (offset 500) | 02:40 | accepted 06:35, merging; polish cycle sent | 1fe0e71, 92063fc, 36dd81f |
| QA-W1 (Opus) | adversarial review of W1 | reads `esb-overnight/w1`; writes `docs/overnight/qa/W1.md` | 03:36 | done 04:55: PASS WITH NON-BLOCKING FINDINGS | qa/W1.md |
| QA-W2 (Opus) | adversarial review of W2/W6 | reads `esb-overnight/w2`; writes `docs/overnight/qa/W2.md` | 03:52 | cycle 0 PASS w/ findings 05:10; cycle 1 (803cb1e) PASS w/ findings 06:25 | qa/W2.md |
| builder W4 (Opus) | Newsletter digest | `esb-overnight/w4` / `overnight/w4-digest` (offset 400, from eee9a5c) | 05:27 | running | — |
| QA-W5 (Opus) | adversarial review of W5 | reads `esb-overnight/w5`; writes `docs/overnight/qa/W5.md` | 05:52 | done 06:35: PASS WITH NON-BLOCKING FINDINGS | qa/W5.md |
