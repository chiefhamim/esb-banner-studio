# Overnight build — final report (2026-11-01)

Directive: `C:\Users\hamim\Desktop\overnight.txt`. Mission branch `overnight/2026-11-01` from `main` @ `e15753e`;
final product commit `825cfe4` (docs commits follow it). Orchestrator: Fable 5.1. Builders and QA: Claude Opus 5.5
subagents, one git worktree per workstream, one independent QA review per workstream, one final adversarial pass.
Format: CLAUDE.md §12. Nothing is checked off without a command and its output; "NOT VERIFIED" is said where it is so.

**Final gate verdict: ⏳ (filled in from `docs/overnight/qa/FINAL.md` when the pass completes).**

## 1. What changed

### Implemented, QA-verified and merged

| WS | What the editor gets | Branch → merge | QA |
|---|---|---|---|
| W7 | `SECURITY.md` (anon key decoded as `role: anon`, RLS **NOT VERIFIED — check or rotate**), `.gitignore` policy, full-history secret scan: 245 commits, only the by-design anon key | `bb997f3`, `e9edcc4` | orchestrator (no subagent, per directive) |
| P0 | Baseline table + 32 baseline screenshots; two stale e2e checks fixed at the cause (Electron suite 0 → 35/35, Editorial 16-of-60 abort → 60/60, D8); per-worktree ports + Vite cache (D3); `tools/e2e/overnight-shots.mjs`, `tools/e2e/shot-diff.mjs`, `tools/port-offset.mjs` | `3607d47`, `b58545f` | — |
| W1 | **Library** tab in the Editorial source column: quotes (speaker only when the text names one) and figures with units harvested from the story, provenance on every row, search / kind / speaker-org filters, speaker registry seeded from the newsroom orgs, **Use as quote banner** / **Use as stats banner**, harvest on publish (D9) | `overnight/w1-quote-library` → `c01342b` | FAIL (narration saved as a quote) → fixed with an own paragraph-scoped scanner → **PASS WITH NON-BLOCKING FINDINGS** |
| W2 | **Desk · Insights** in the Editorial header: Graph post + page insights joined to a local publish log; KPI tiles, SVG chart, weekly tables, CSV export; honest states for no token / empty log / expired token (never retried) / rate limit (15-min back-off); opt-in AI weekly summary from the aggregate table only | `overnight/w2-insights` → `19433a7` + `eee9a5c`, polish `4e09a7d` | **PASS WITH NON-BLOCKING FINDINGS** (cycles 0 and 1) |
| W6 | Opt-in escalation to the stronger model when figures mismatch the source (decision logged to Activity); per-story cost rows in the Engine panel; token usage recorded for every provider; cache breakpoint unit-tested | in W2's branch (`f5f08ff`) | with W2 |
| W5 | **Wire** option in the Editorial intake: RSS / Atom / sitemap sources polled through the existing `net-guard` bridge (gate: no bridge change needed), inbox with dedupe, backoff, dismiss, **Use this link** into the URL intake | `overnight/w5-wire` → `3dba21a`, polish `145bb8f`, micro-fix `dc4d9d6` | **PASS WITH NON-BLOCKING FINDINGS** (cycles 0, 1, 2) |
| W4 | Campaigns → New → **Campaign from this week's stories**: digest of the stories this app published (range, ticks, reorder, intro, live letter preview) created as an ordinary **draft** Outreach campaign; the send path is untouched | `overnight/w4-digest` → `9d20cc2`, polish `825cfe4` | **PASS WITH NON-BLOCKING FINDINGS** (cycles 0 and 1) |

### Not merged

| WS | State |
|---|---|
| W3 Distribution scheduler | Cut for time (D20) after its builder was stopped by the account rate limit before any accept check ran. Engine edits + a first unit test preserved as WIP commit `65631b8` on `overnight/w3-scheduler` (pushed), marked NOT merged / NOT verified. Design and the Telegram / X / LinkedIn boundary: `docs/overnight/briefs/W3.md`. |

### Decisions of note
`docs/overnight/DECISIONS.md` D1–D20. Highlights: the day's uncommitted work committed first (D1); auto-sync daemon
stopped for the night (D2); per-worktree ports so builders never tested each other's server (D3); `main` is touched
only after a passing final gate (D6); two baseline failures fixed at the cause because they blocked workstreams (D8);
the publish-event contract between W2 and W1 (D9); a conflict-marker slip caught and fixed (D18); the D9 chain proving
itself end to end in the integrated Editorial suite (D19).

## 2. Why

The directive asked for the shipping app to be extended with these workstreams under adversarial QA, the existing
suites kept green, screenshots inspected, and an honest report. Evidence: `docs/overnight/REQUIREMENTS_LEDGER.md`
(one row per task with status, reviewer and evidence), `docs/overnight/qa/W1.md … W5.md`, `FINAL.md` (verdicts with
reproduced commands), `artifacts/overnight/regress/*/SUMMARY.md` and the per-command logs (regression table after
every merge), `artifacts/overnight/baseline/*.log`, `artifacts/overnight/secret-scan.log`.

## 3. Verification

### Baseline vs. after every merge — same commands, same machine

| Check | Baseline `79b9c01` | +W1 `c01342b` | +W2 `ef17c94` | +W5 `880f444` | +W4 `9d20cc2` | **final `825cfe4`** |
|---|---|---|---|---|---|---|
| `npx oxlint` | 0 errors | 0 | 0 | 0 | 0 | **0** |
| `npx tsc -b` | exit 0 | 0 | 0 | 0 | 0 | **0** |
| `npm run test:unit` | 557 | 582 | 621 | 649 | 668 | **671** |
| `npm run test:editorial` | 15 PASS, aborted at check 16/60 (pre-existing) → 60/60 after D8 | 74/74 | 75/75 | 75/75 | 75/75 | **75/75** |
| `npm run test:insights` | — | — | 46 | 46 | 46 | **46** |
| `npm run test:wire` | — | — | — | 46 | 46 | **46** |
| `npm run test:digest` | — | — | — | — | 41 | **43** |
| `npm run test:golden` | 0.013 % / 0.048 % | same | same | same | same | **same** |
| `npm run test:ui` | 166 PASS + 1 FAIL (pre-existing "neutral grey") | same | same | same | same | **same** |
| `node tools/e2e/electron-test.mjs` | 0/35 (stale wait, pre-existing) → 35/35 after D8 | 35 | 35 | 35 | 35 | **35** |
| `npm run test:video` | 22 | 22 | 22 | 22 | 22 | **22** |
| `npm run census -- --strict` | clean | clean | clean | clean | clean | **clean** |
| `vite build` | OK | OK | OK | OK | OK | **OK** |

Logs: `artifacts/overnight/baseline/`, `artifacts/overnight/regress/{post-p0,after-w1,after-w2,after-w2b,after-w5,after-w5b,after-w4,after-w4b}/`.
Electron dry-run proof for the digest (`node tools/e2e/digest-test.mjs --electron`, isolated profile,
`ESB_OUTREACH_DRYRUN=1`): 9/9 by the builder and by QA.

### Screenshots (inspected, not just saved)

`artifacts/overnight/screenshots/` — PNGs are git-ignored; the whole tree (202+ images) is copied to
`C:\Users\hamim\Desktop\overnight-screenshots\`:
- `baseline/` — 32 shots of every workspace at `79b9c01`.
- `final/` — 48 shots at `825cfe4` (12 screens × 1366×768 / 1920×1080 × light / dark).
- `compare/` — baseline-vs-final pairs with `*--diff.png` and `diff-table.md`: Home, Graphics, Graphics quote card,
  Video, Outreach, Outreach Activity are **0.000 %** different; Editorial desk 0.18–1.20 % and launcher 0.11–0.48 %,
  which the diff images show to be the new Library tab, the Desk · Insights switch, the Wire option and the D8
  subtitle move (plus antialiasing) — nothing else.
- `w1/`, `w2/`, `w4/`, `w5/` — each builder's before/after/diff pairs and the shots of its new screen, with
  `diff-table.md`; QA re-captured each (`--tag qa`) and inspected them.

## 4. Implemented but not fully verifiable here

- **Live Facebook Graph answers** (W2): a real Page token is needed; Meta may answer error 100 for some metrics on
  newer Pages — the desk shows its honest error state, never numbers.
- **A real signed-in publish writing the publish log** (W2): the PUBLISHED-only guard in
  `EditorialWorkspace.handleLivePublishToCms` is verified by reading; the Editorial suite's browser-preview publish
  proves publish → event → Library (D19) with a mocked site.
- **Live feeds through the Electron bridge** (W5): feed content types confirmed by reading `net-guard.cjs`; no live
  fetch was allowed.
- **A real SMTP socket never opening** (W4): proven by the ledger (`sent24h === 0`, no account, dry-run env) in an
  isolated Electron profile, not by packet capture.
- **Real IndexedDB quota failure** (W1): simulated by patching writes.
- **Escalation against a live AI provider** (W6): hook unit-tested with the translator mocked.
- **Supabase RLS** (W7): cannot be checked without project credentials — **NOT VERIFIED**; the maintainer must check
  every table and bucket the CMS touches, or rotate the anon key.

## 5. Not done / cut

- **W3 Distribution scheduler** — cut (D20); WIP on its branch.
- Escalation on the paste / re-translate paths — only link intake escalates (D17).
- `src/outreach/idb.ts` swallowing real IndexedDB write failures (the Library can say "N added" when nothing reached
  disk; the next launch's verify-on-read drops the lost rows) — shared helper, deferred (D16).
- Pictures in the digest letter — the composer has no image mark (W4).

## 6. Known defects (open; all rated non-blocking by QA)

- Pre-existing: UI suite "UI chrome is neutral grey" (Graphics panel fill `rgba(15,23,42,.08)`); "Alt + corner resizes
  from the centre" is intermittent on untouched code.
- W1: a plural possessive inside a *single*-quoted statement cuts the quote short; scare quotes become unattributed
  entries; the Library lives in the `esb-outreach` IndexedDB database (clearing Outreach data clears it).
- W2: a hand-edited `publishedAt` in localStorage could break the summary-prompt delimiter; the disabled Refresh
  button's reason is tooltip-only; no source-block cache breakpoint (never existed); `BarChart` labels two
  same-day stories "1 Nov" / "1 Nov (2)".
- W4: composer marks inside headlines are interpreted (`**bold**`, `[x](url)`); an intro typed with `{name}` is
  neutralised too; a reachable-but-empty site feed reads as "could not be read"; the dialog scrolls at small windows.
- W5: `<script>` *text* inside a CDATA title shows as plain text; the seen-link cap is global (2000); the filter row
  scrolls with the inbox.
- ⏳ Findings from the final pass.

## 7. Per-agent summary (cumulative tokens as reported by the harness)

| Agent | Work | Cycles | Tokens | Outcome |
|---|---|---|---|---|
| builder W1 | Quote & Stat Library | build + 1 fix | ~316k | accepted |
| builder W2 | Insights desk + W6 | build + 1 polish | ~468k | accepted |
| builder W3 | Distribution scheduler | stopped by rate limit, then cut | n/a | not merged |
| builder W4 | Newsletter digest | build + 1 polish | ~308k | accepted |
| builder W5 | Wire desk | spike + build + polish + micro-fix | ~302k | accepted |
| QA-W1 | adversarial review | 2 verdicts | ~265k | FAIL → PASS w/ findings |
| QA-W2 | adversarial review | 2 verdicts | ~344k | PASS w/ findings ×2 |
| QA-W4 | adversarial review | 2 verdicts | ~245k | PASS w/ findings ×2 |
| QA-W5 | adversarial review | 3 verdicts | ~288k | PASS w/ findings ×3 |
| QA-FINAL | final gate | 1 | ⏳ | ⏳ |

All four builders were terminated once by the account's 5-hour Opus limit (~02:50, reset 03:10) and resumed from their
saved worktrees (D15); W3 alone was not resumed.

## 8. Branches and commits

Pushed to `origin`: `overnight/2026-11-01` (mission), `overnight/w1-quote-library`, `overnight/w2-insights`,
`overnight/w3-scheduler` (WIP), `overnight/w4-digest`, `overnight/w5-wire`. `main`: ⏳ (D6 — fast-forwarded only on a
passing final gate). Worktrees remain under `C:\Users\hamim\esb-overnight\w{1,2,3,4,5}` (`git worktree remove` when
done). The auto-sync daemon restarts from the Startup shortcut at next login and pulls `main`.

## 9. Next recommended step

⏳
