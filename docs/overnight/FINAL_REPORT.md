# Overnight build — final report (2026-11-01)

> DRAFT — sections marked ⏳ are completed once W4's QA verdict, the W5 micro-fix and the final adversarial pass
> are in. Format follows CLAUDE.md §12. Nothing below is checked off without a command and its output.

Directive: `C:\Users\hamim\Desktop\overnight.txt`. Mission branch `overnight/2026-11-01` from `main` @ `e15753e`.
Orchestrator: Fable 5.1. Builders and QA: Claude Opus 5.5 subagents, one worktree per workstream.

## What changed

**Implemented, QA-verified and merged on the mission branch**

| WS | What the editor gets | Branch / commits | QA verdict |
|---|---|---|---|
| W7 | `SECURITY.md` (anon key decoded as `role: anon`; RLS **NOT VERIFIED**), `.gitignore` policy, full-history secret scan (245 commits: only the by-design anon key) | `bb997f3`, `e9edcc4` | orchestrator (no subagent, per directive) |
| P0 | Baseline table + 32 baseline screenshots; two stale e2e checks fixed at the cause (Electron suite 0 → 35/35, Editorial 16 → 60/60); per-worktree ports and Vite cache; `overnight-shots.mjs` + `shot-diff.mjs` | `3607d47`, `b58545f` | — |
| W1 | **Library** tab in the Editorial source column: harvested quotes (speaker when the text names one) and figures with units, provenance per row, search/filters, speaker registry, **Use as quote / stats banner**, harvest on publish | `overnight/w1-quote-library` → merge `c01342b` | FAIL → fixed (own quote scanner) → **PASS WITH NON-BLOCKING FINDINGS** (`qa/W1.md`) |
| W2 | **Desk · Insights** in the Editorial header: Graph post/page insights joined to a local publish log, KPI tiles, SVG chart, weekly tables, CSV export, honest unconfigured / expired-token / rate-limited states, opt-in AI weekly summary | `overnight/w2-insights` → merges `19433a7`+`eee9a5c`, polish `4e09a7d` | **PASS WITH NON-BLOCKING FINDINGS** ×2 (`qa/W2.md`) |
| W6 | Opt-in escalation to the stronger model when figures mismatch the source (logged to Activity); per-story AI cost rows in the Engine panel; usage recorded for every provider | in W2's branch (`f5f08ff`) | with W2 |
| W5 | **Wire** option in the Editorial intake: RSS/Atom/sitemap sources polled through the existing net-guard bridge, inbox with dedupe, backoff, dismiss, **Use this link** into the URL intake | `overnight/w5-wire` → merges `3dba21a`, polish `145bb8f` | **PASS WITH NON-BLOCKING FINDINGS** ×2 (`qa/W5.md`) |
| W4 | ⏳ "Campaign from this week's stories": digest of published stories as an ordinary **draft** Outreach campaign | `overnight/w4-digest` | ⏳ QA running |

**Not merged**

| WS | State |
|---|---|
| W3 | Cut for time (D20). Engine edits + first unit test preserved as a WIP commit `65631b8` on `overnight/w3-scheduler`, marked NOT verified. |

## Why

The directive asked for the shipping app to be extended with these workstreams under adversarial QA, with the
existing suites kept green. Evidence for every claim: `docs/overnight/REQUIREMENTS_LEDGER.md` (one row per task),
`docs/overnight/qa/W*.md` (verdicts with reproduced commands), `artifacts/overnight/regress/*/SUMMARY.md`
(regression table after every merge), `docs/overnight/DECISIONS.md` (D1–D21).

## Verification

### Baseline vs. after each merge (full table, same commands)

| Check | Baseline `79b9c01` | after W1 `c01342b` | after W2 `ef17c94` | after W5 `880f444` | ⏳ final |
|---|---|---|---|---|---|
| `npx oxlint` | 0 errors | 0 | 0 | 0 | ⏳ |
| `npx tsc -b` | 0 | 0 | 0 | 0 | ⏳ |
| `npm run test:unit` | 557 | 582 | 621 | 649 | ⏳ |
| `npm run test:editorial` | 15 PASS, aborted at 16 of 60 (pre-existing, D8b) → 60/60 | 74/74 | 75/75 | 75/75 | ⏳ |
| `npm run test:insights` | — | — | 46 | 46 | ⏳ |
| `npm run test:wire` | — | — | — | 46 | ⏳ |
| `npm run test:golden` | 0.013 % / 0.048 % | same | same | same | ⏳ |
| `npm run test:ui` | 166 PASS + 1 FAIL (neutral grey, pre-existing) | same | same | same | ⏳ |
| `node tools/e2e/electron-test.mjs` | 0/35 (stale wait, D8a) → 35/35 | 35/35 | 35/35 | 35/35 | ⏳ |
| `npm run test:video` | 22/22 | 22 | 22 | 22 | ⏳ |
| `npm run census -- --strict` | clean | clean | clean | clean | ⏳ |
| `vite build` | OK (765 kB JS / 361 kB CSS main) | OK | OK | OK | ⏳ |

### Screenshots

`artifacts/overnight/screenshots/` (copied to `Desktop\overnight-screenshots\`):
- `baseline/` — 32 shots: 8 screens × {1366×768, 1920×1080} × {light, dark}.
- `w1/` — `editorial-desk` before/after/diff (0.038–0.128 %, tab bar only) + `editorial-library` after.
- `w2/` — `editorial-desk` before/after/diff (0.060–0.858 %: the header Seg + anti-aliasing, verified by QA) + `editorial-insights` configured and unconfigured.
- `w5/` — `editorial-launcher` before/after/diff (0.083–0.281 %, the Seg row) + `editorial-wire`.
- `w4/` — ⏳ `outreach` before/after (0.000 %) + `outreach-digest`.
- `final/` — ⏳ every screen again on the final commit, for baseline-vs-final.

## Implemented but not fully verifiable here

- **Live Facebook Graph answers** (W2): need a real Page token; Meta may answer error 100 for some metrics on
  newer Pages — the desk shows its honest error state, never numbers.
- **A real signed-in publish writing the publish log** (W2): the `PUBLISHED`-only guard is verified by reading
  (`EditorialWorkspace.handleLivePublishToCms`), not by a test; the browser-preview publish in the Editorial
  suite proves the event → library path (D19) but not the site round trip.
- **Live feeds through the Electron bridge** (W5): content types confirmed by reading `net-guard.cjs`; no live
  fetch was allowed.
- **Real IndexedDB quota failure** (W1): simulated by patching writes.
- **Escalation against a live provider** (W6): hook unit-tested with the translator mocked.
- **Supabase RLS** (W7): cannot be checked without project credentials — **NOT VERIFIED**; the maintainer must
  check or rotate.

## Not done / cut

- **W3 Distribution scheduler** — cut (D20); WIP preserved, design in `briefs/W3.md`.
- Escalation on the paste / re-translate paths (only link intake escalates) — deferred (D17).
- `idb.ts` swallowing real IndexedDB write failures (W1 can say "N added" when nothing reached disk) — shared
  helper, deferred (D16).

## Known defects (open, all non-blocking per QA)

- UI suite "UI chrome is neutral grey" — pre-existing (Graphics panel fill `rgba(15,23,42,.08)`), untouched.
- UI suite "Alt + corner resizes from the centre" — intermittent on untouched code (seen on `main` earlier today).
- W1: a plural possessive inside a *single*-quoted statement cuts the quote short (unattributed, verbatim).
- W1: scare quotes are saved as unattributed entries (noise, not fabrication).
- W2: a hand-edited `publishedAt` in localStorage could break the summary-prompt delimiter (needs outside-app editing).
- W2: the disabled Refresh button's reason is only a tooltip; no source-block cache breakpoint (never existed).
- W5: `<script>` *text* inside a CDATA title shows as plain text; the seen-link cap is global (2000); the filter
  row scrolls with the inbox.
- ⏳ W4 findings.

## Per-agent summary

⏳ (tokens, tool uses, cycles per agent — from the task notifications.)

## Next recommended step

⏳
