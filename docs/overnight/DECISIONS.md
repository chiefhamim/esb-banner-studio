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
- **D9 — Publish event contract (W1 consumes, W2 emits).** After a publish completes, the publish flow
  (`src/editorial/PublishDialog.tsx`, owned by W2 tonight) dispatches
  `window.dispatchEvent(new CustomEvent('esb:story-published', { detail }))` with
  `detail = { storyId, slug, url, headline, categoryId, format: 'web'|'fb45', publishedAt: ISO string,
  facebookPostId?: string, dryRun: boolean }`. W2 also appends the same record to its local publish log.
  W1 listens for the event to harvest the active story's quotes and stats. Each side tests its half by
  dispatching the event itself, so neither depends on the other's merge.
- **D10 — File ownership tonight.** W1: `src/editorial/quoteLibrary.ts`, `src/editorial/QuoteLibrary*.tsx`,
  `tools/unit/quote-library.test.ts`, the left-column tabs region of `src/editorial/EditorialWorkspace.tsx`
  (one tab entry + one render branch + imports), `src/editorial/editorial.css` additions under a `/* W1 */`
  banner, new checks appended to `tools/e2e/editorial-test.mjs`. W2: `src/editorial/insights.ts`,
  `src/editorial/Insights*.tsx`, `src/editorial/PublishDialog.tsx` (event + log line only),
  `src/editorial/EngineStatus.tsx` (cost rows), `src/editorial/aiProviders.ts` (escalation + usage only — the
  one pre-approved shared file), the header desk switch region of `EditorialWorkspace.tsx` (one `Seg` + one
  body branch + imports), `tools/unit/insights.test.ts`, `tools/unit/ai-escalation.test.ts`,
  `tools/e2e/insights-test.mjs`, one `test:insights` script line in `package.json`. Both may append one
  screen id to `tools/e2e/overnight-shots.mjs`. Anything else shared (`store.ts`, `shellStore.ts`, `src/ui/*`,
  `esb.d.ts`, `electron/*`) is off limits without a new entry here.
- **D11 / D12 / D13 — File ownership for W4, W3, W5** is the "Ownership" section at the end of each brief
  (`docs/overnight/briefs/W4.md`, `W3.md`, `W5.md`). W3 is the only one with pre-approved `electron/*` and
  `esb.d.ts` edits (the engine is being extended, per the directive); W5's gate is precisely that it needs none.
- **D14 — W3 and W5 start in parallel with W1/W2, not after W4.** The ladder orders them later, but their only
  stated dependency rule is "start as their dependencies integrate" and neither depends on W1/W2/W4 (W4 does
  depend on W2's publish log). W3 is the longest workstream; giving it the night is the only way it can reach
  its crash-recovery e2e. If budget runs short the cut order is unchanged: W5, then W3, then W4. Four builders
  share one machine; each worktree has its own ports and cache (D3).
- **D7 — W6 is woven into W2's builder** (directive §5): same agent, same worktree, separate commits (`W6:`).
