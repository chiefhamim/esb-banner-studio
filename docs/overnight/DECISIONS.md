# Decisions (orchestrator)

Each entry: what was decided, why, and what it binds. Shared-interface changes by builders need an entry
here **before** the change.

- **D1 — The day's uncommitted work is committed on the mission branch, not stashed.** `git status` at start
  showed 21 modified/new files from the same day's directed session (Activity desk tokens, Editorial launcher,
  card design system, photo editor, control standard). Directive §3 says to stash nothing of the user's away
  and §2.11 never to discard uncommitted user changes; a baseline on top of uncommitted edits would be
  unreproducible. Committed as `79b9c01` ("session: …"). Baseline is measured on that commit.
- **D2 — The auto-sync daemon was stopped for the night.** `tools/git-sync.mjs` (PID 18612) and its
  `auto-sync.ps1` wrapper poll every 20 s and `git pull --rebase --autostash origin main` + `npm run build`
  whenever HEAD ≠ origin/main — on a mission branch that is always. Its log shows one no-op pull and one
  rebuild after the branch was created, nothing lost. The Startup shortcut restarts it at next login.
- **D3 — Builders work in git worktrees with a `node_modules` junction and a per-worktree port offset.**
  Reason: every `tools/*.mjs` runner hard-codes its Vite port and then polls `http://localhost:<port>` until it
  answers — with two worktrees that means a runner can silently test *the other builder's* server. Fix:
  `tools/port-offset.mjs` + `.esb-port-offset` (git-ignored) per worktree; mechanical `const PORT = base +
  portOffset()` edit in each runner; `VITE_CACHE_DIR` honoured by `vite.config.ts`. Applied after the baseline
  table finished so the baseline ran on untouched runners.
- **D4 — Artifacts policy.** `artifacts/**/*.png|jpg|webp|zip|mp4` are git-ignored (bulky); the small text
  logs (secret scan, baseline logs, diff tables) are committed as evidence. Screenshots are also copied to the
  Desktop at the end for the user.
- **D5 — Activity desk screenshots in the browser capture show its "Desktop app required" state.** The desk
  needs `window.esb`; the baseline tool runs in Chromium for speed and determinism. Electron-driven captures
  (`tools/e2e/electron-test.mjs` style, isolated profile) are used where a workstream changes desktop-only UI.
- **D6 — `main` merge policy.** The user's launcher auto-pulls `main`. `main` is fast-forwarded to the mission
  branch at the end only if the final adversarial QA verdict is PASS or PASS WITH NON-BLOCKING FINDINGS and the
  full baseline table is no worse than baseline. Otherwise only the branches are pushed and the report says why.
- **D8 — Two baseline failures were fixed because they block workstreams, by fixing the cause, not the test.**
  (a) `tools/e2e/electron-test.mjs` waited for `.topbar` to be visible at launch; since the Home redesign the Home
  header is the floating corner group, so the wait timed out and the whole suite (35 checks) reported 0 — W3
  and the final packaged-app gate need it. The wait is now `.home-shell, .topbar` (the app has rendered); every
  assertion is unchanged: 35/35. (b) `tools/e2e/editorial-test.mjs` aborted at check 16 of 60 — the Details
  panel's summary ("<category> · N tags") was passed as header `actions`, which stop click propagation so action
  *buttons* don't toggle a panel; the summary is wide, so most of the header was dead to clicks (users too, not
  just the test) and it truncated the title to "De" (visible in the baseline screenshot). The summary is now the
  panel's `sub`; the test's expectation is untouched. W1 extends this suite, so it had to run past check 16.
  The one remaining baseline failure (`ui-test` "UI chrome is neutral grey") blocks nothing and stays recorded.
- **D7 — W6 is woven into W2's builder** (directive §5): same agent, same worktree, separate commits (`W6:`).
