# Overnight build — master plan (2026-11-01)

Orchestrator: Fable 5.1 (this session). Directive: `C:\Users\hamim\Desktop\overnight.txt` (not in the repo).
Mission branch: `overnight/2026-11-01`, branched from `main` @ `e15753e`. First commit `79b9c01` = the day's
uncommitted session work (committed, not stashed, per directive §3 — see DECISIONS D1).

## Sequence

| Step | What | Owner | Gate to next |
|---|---|---|---|
| W7 | Public-repo hygiene: history secret scan, `.gitignore`, `SECURITY.md` | orchestrator | artifacts + commit |
| P0 | Baseline table (§3) + screenshots of every workspace, light/dark, 1366×768 + 1920×1080 | orchestrator | `docs/overnight/BASELINE.md` |
| T0 | Tooling so builders can work in parallel without cross-talk: per-worktree e2e port offset, per-worktree Vite cache, `overnight-shots.mjs` + `shot-diff.mjs` | orchestrator | tools committed on mission branch before any worktree is cut |
| W1 ∥ W2(+W6) | Quote & Stat Library ∥ Insights desk + AI efficiency | Opus builders, own worktrees | QA PASS each → merge in dependency order → full regression |
| W4 ∥ W3 ∥ W5 | Newsletter digest ∥ Distribution scheduler ∥ Wire desk (90-min spike gate first) | Opus builders | same |
| FINAL | Adversarial QA pass on the mission branch, `FINAL_REPORT.md`, push, screenshot folder on the Desktop, shutdown | QA agent + orchestrator | — |

Cut order if time or budget runs short: W5, then W3, then W4. A workstream that cannot reach green stays on its
worktree branch and is reported as not merged.

## Team

- **Builders**: one Opus agent per workstream, in `C:\Users\hamim\esb-overnight\w<n>\` (a git worktree on
  `overnight/w<n>-<slug>`, cut from the mission branch). Each owns its files exclusively; anything in
  `src/store.ts`, `src/shell/shellStore.ts`, `src/editorial/aiProviders.ts`, `electron/net-guard.cjs`,
  `src/ui/*`, `src/esb.d.ts`, `electron/preload.cjs`, `electron/main.cjs` needs a DECISIONS entry first.
- **QA**: one independent Opus agent. Re-runs accept checks in the builder's worktree, reads the diff, probes
  the §8 failure modes, inspects the screenshot pairs, issues exactly one verdict per workstream.
- **Orchestrator**: no bulk implementation. Owns this file, the ledger, DECISIONS, AGENT_STATUS, BASELINE,
  FINAL_REPORT; approves shared-file changes; merges; arbitrates.

## Worktree mechanics (why: parallel builders must never test against each other's code)

- `node_modules` is a junction to the main checkout's (one install, 224 GB free, no `npm ci` per tree).
- Every Playwright script in `tools/` computes its port as `base + portOffset()`, where `portOffset()` reads
  `<repo root>/.esb-port-offset` (git-ignored). Worktree w<n> gets offset `100 × n`. Without the file the
  offset is 0, so the main checkout and CI behave exactly as before.
- Vite's dep cache: `vite.config.ts` honours `VITE_CACHE_DIR`; each worktree's agent runs with it set to
  `.vite-cache` (git-ignored) so concurrent dev servers do not race on `node_modules/.vite`.
- Electron tests already use isolated `--user-data-dir` profiles; `ESB_NO_SYNC=1` is set by the runners.

## Verification loop (every step, every workstream)

INSPECT → IMPLEMENT → `npx tsc -b` + `npx oxlint` → focused `vitest` → relevant e2e → SCREENSHOT pair + diff →
QA REVIEW → FIX (≤ 3 cycles) → COMMIT (`W<n>:` prefix) → LEDGER row.

Screenshots: `node tools/e2e/overnight-shots.mjs --out artifacts/overnight/screenshots/<w> --tag before|after
[--screens a,b] [--sizes 1366x768,1920x1080]`, then `node tools/e2e/shot-diff.mjs <dir>` for the pixelmatch
diffs. Pairs are inspected, not just saved.

## End of night

1. Final QA verdict on the mission branch; `docs/overnight/FINAL_REPORT.md` in CLAUDE.md §12 format.
2. Push `overnight/2026-11-01` and every `overnight/w<n>-*` branch. `main` is fast-forwarded to the mission
   branch only if the final QA verdict is PASS or PASS WITH NON-BLOCKING FINDINGS (the launcher auto-pulls
   `main`); otherwise `main` is left untouched and the report says so (DECISIONS D6).
3. Copy `artifacts/overnight/screenshots/` to `C:\Users\hamim\Desktop\overnight-screenshots\`.
4. `shutdown /s /t 60`.
