# Phase 0 baseline — 2026-11-01

Measured on the mission branch `overnight/2026-11-01` at `79b9c01` (the day's session work committed, no
overnight edit yet). Windows 11, Node 26.3.1, Electron 45, Playwright on Edge. Every Electron run used an
isolated `--user-data-dir`; the live profile was not touched. Logs: `artifacts/overnight/baseline/*.log`.

| Command | Expected (docs/PROGRESS.md) | Actual | Status |
|---|---|---|---|
| `npx oxlint` | 0 errors; note warnings | 0 errors (warning summary: see `oxlint.log`) | OK |
| `npx tsc -b` | exit 0 | exit 0 | OK |
| `npm run test:unit` | ~557 pass | 61 files, **557/557** | OK |
| `npm run test:editorial` | all pass | **aborted at check 16 of 60**: 15 PASS, 1 FAIL "Opening a section closes the other one" — the suite throws after it, so 44 checks never ran | pre-existing; cause fixed (D8b) → re-run **60/60** |
| `npm run test:golden` | social-01 ≈ 0.005–0.013 %, web-01 ≈ 0.030–0.048 % | social-01 **0.013 %** (292 px), web-01 **0.048 %** (988 px) | OK |
| `npm run test:ui` | all pass | **166 PASS, 1 FAIL** "UI chrome is neutral grey (no coloured fills or text)" (Graphics panels, `rgba(15,23,42,.08)`); verified earlier today to fail identically on untouched `main` | pre-existing; blocks nothing; left recorded |
| `node tools/e2e/electron-test.mjs` | all pass | **0 of 35** — `waitForSelector('.topbar')` timed out: Home's header is hidden since the Home redesign | pre-existing; cause fixed (D8a) → re-run **35/35** |
| `npm run test:video` | all pass | **22/22** | OK |
| `npx vite build --outDir <scratch> --emptyOutDir` | succeeds | OK — main chunk `index-*.js` 765.12 kB (gzip 247.82 kB), `index-*.css` 361.45 kB (gzip 63.05 kB); desks are lazy chunks | OK |

## Pre-existing failures (never attributed to overnight work)

1. **Editorial accordion check** — the Details panel's "<category> · N tags" summary sat in the header's
   `actions` slot, which stops click propagation (so action buttons do not toggle panels). The summary is wide,
   so the centre of the header did nothing when clicked, and it squeezed the title to "De" (see
   `editorial-desk__1366x768__light--baseline.png`). Fixed by moving the summary to the panel `sub` (D8b);
   the test's expectation is unchanged.
2. **Electron suite** — stale launch wait; fixed with `.home-shell, .topbar` (D8a); assertions unchanged.
3. **UI suite "neutral grey" check** — Graphics panel fill is `rgba(15,23,42,.08)`, which the check reads as a
   coloured fill. Not fixed tonight (blocks no workstream); listed in the final report as a known defect.

## Baseline screenshots

`artifacts/overnight/screenshots/baseline/` — 32 PNGs: `{home, editorial-launcher, editorial-desk, graphics,
graphics-quote, video, outreach, outreach-activity} × {1366×768, 1920×1080} × {light, dark}`, taken with
`tools/e2e/overnight-shots.mjs --tag baseline` (synthetic state: two stories on the desk, one campaign).
The Outreach Activity desk is captured in its honest "Desktop app required" state (D5). Copied to the
Desktop at the end of the run.

## Environment notes

- The auto-sync daemon (`tools/git-sync.mjs`) was running and was stopped for the night (D2).
- Network-dependent checks ran with the machine online; the site/Supabase/Graph are never called by the
  suites (fixtures and mocks only).
