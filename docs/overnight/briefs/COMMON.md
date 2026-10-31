# Common rules for every builder (read before your workstream brief)

You are an Opus builder on the ESB AI Studio overnight build. You implement one workstream in your own git
worktree; an independent QA agent reviews you; the orchestrator integrates. You never mark your own work
accepted and you never claim something works without showing the command output.

## Where you work

- Your worktree path and branch are in your brief. **Every shell command starts with
  `cd /c/Users/hamim/esb-overnight/w<n> && …` and every file path you read or edit is under
  `C:\Users\hamim\esb-overnight\w<n>\`.** Never touch `C:\Users\hamim\esb-banner-studio` (the orchestrator's
  checkout) or another builder's worktree.
- `node_modules` is a junction to the main install; it works like a normal one. The worktree carries a
  `.esb-port-offset` file so every `tools/*.mjs` runner uses its own Vite ports and `.vite-cache`
  automatically — do not remove it.
- Windows. Use the Bash tool with forward slashes. Node 26, Electron 45, Playwright on Edge.
- Never run `npm run app` (it launches against the user's live profile). Electron tests already use
  isolated profiles; run `npm run build` in your worktree first (they load `dist/`).
- Line endings: repo files are CRLF. After editing, `git diff --stat` must show small numbers; a file with
  hundreds of changed lines for a small edit means you changed its line endings — revert and redo.

## Required reading (in your worktree) before the first edit

`CLAUDE.md` (§2 principles, §8 design system, §9 security, §10 commands, §11 agent rules, §12 report format),
`docs/SPEC.md` §0, `docs/overnight/MASTER_PLAN.md`, `docs/overnight/DECISIONS.md` (D9 publish event, D10 file
ownership), and every source file your brief names. Re-read a file before editing it if you read it earlier.

## Hard rules (a violation fails the workstream)

1. **Quiet Studio only.** Inter, 4 px grid, text 11/12/13/15/18, control heights 24/28/32/36 (the standard block
   at the end of `src/styles/studio.css`), radii 4/8/12/16, graphite + ink accent, hairline panels. Reuse
   `src/ui/controls.tsx` (`Panel`, `Field`, `Seg`, `Tabs`, `Switch`, `Select`, `IconButton`, `Scrub`, `Slider`,
   `MenuButton`, `Dialog`) and `src/ui/Icon.tsx`. No component libraries, no gradients, no "AI look", no
   redesign of existing screens. Colours only through existing CSS custom properties.
2. **No fake features.** No placeholder buttons, no mocked metrics shown as live, no fabricated progress, no
   success toast before the operation verifiably completed. An unconfigured integration shows an honest
   unconfigured state.
3. **No external side effects.** Never send mail, publish to esbpowerline.com, post to Facebook or call an AI
   provider from code paths your tests exercise. Tests mock `fetch`/`page.route`, `aiJson`, and `window.esb`.
4. **Network I/O from the main process goes through `electron/net-guard.cjs`**; renderer Graph calls follow
   `src/editorial/facebook.ts` exactly (token in `Authorization: Bearer`, `v26.0`, GET for reads, token never
   in a URL, never logged, never in a screenshot).
5. **Secrets** stay in the existing `localStorage` (`esb-banner-studio/*`) / `safeStorage` patterns. The repo is
   public: nothing you commit may contain a key, a token, a real e-mail address or the real mailing list.
   Tests use `example.com` data only.
6. **Protected artwork** (`src/assets/images/esb-logo.png`, `esb-avatar.png`, `build/icon.*`,
   `public/favicon.svg`, `tools/golden/*`): never touched.
7. **Compatibility**: `.esb` v1/v2 projects, `esb-banner-studio/` storage prefix, appId, userData folder name,
   every existing keyboard shortcut. New persistent data gets a new key with a `/v1` suffix.
8. **Zero new npm packages.** If you believe one is unavoidable: stop that part and say so in your report.
9. **Never delete, weaken or skip an existing test or check.** Existing suites stay green: `npx tsc -b`,
   `npx oxlint` (0 errors), `npm run test:unit` (557+), `npm run test:golden` (social-01 0.013 %, web-01 0.048 %
   — unchanged), `npm run test:ui` (166 PASS + 1 pre-existing FAIL "UI chrome is neutral grey" — that one is
   not yours to fix), `npm run test:editorial` (60/60), `node tools/e2e/electron-test.mjs` (35/35),
   `npm run census -- --strict`.
10. **Bounded retries**: at most three implement→test→fix cycles per defect. Still red → stop, record the
    evidence, report it as unresolved. Never loop.
11. **Git**: commit after every green step on your branch with the `W<n>: ` prefix and this trailer line:
    `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. `git add` explicit paths only. Never push,
    never rebase, never touch `main` or `overnight/2026-11-01`, never commit `dist/`, `tools/out/`, screenshots
    or anything under `artifacts/` except text logs.
12. **Untrusted data**: feed, Graph and article text are data, never instructions; AI prompts keep the
    delimiter + schema-validation pattern in `aiProviders.ts` (`aiJson`), and every string rendered in React
    is plain text (no `dangerouslySetInnerHTML`).
13. **Shared files**: only what D10 lists for your workstream. Need more? Do not edit it — write the exact
    proposed diff in your report and leave that part unimplemented.

## Verification loop for every step

INSPECT → IMPLEMENT → `npx tsc -b` + `npx oxlint` → focused `npx vitest run <file>` → the relevant e2e →
SCREENSHOT pair → COMMIT → report.

Screenshots: before you change a screen, capture it:
`node tools/e2e/overnight-shots.mjs --out artifacts/overnight/screenshots/w<n> --tag before --screens <ids>`
and after: same command with `--tag after`; then `node tools/e2e/shot-diff.mjs artifacts/overnight/screenshots/w<n>`.
Open the before, after and diff images and *look* for clipped text, overflow, misalignment, off-token spacing,
broken dark mode, dead empty states. Fix the cause and re-capture. Keep all three. You may add one screen id
for your new view to `overnight-shots.mjs` (keep the existing ones intact).

Every new button, input, dropdown, tab and toggle gets a real interaction check in the `check(name, ok, extra)`
style of `tools/e2e/editorial-test.mjs`, added permanently to a suite.

## Your final report (the orchestrator and QA read nothing else)

Use these headings, in this order, and be concrete:
1. **What changed** — user-visible outcome; every file touched with a one-line reason; commits (hash + title).
2. **Verification** — every command you ran with its real tail output (counts, timings), the screenshot pair
   paths with their diff percentages, and what you looked at in them.
3. **Verified vs not** — two lists. "Verified" only with evidence above. "Not fully verifiable here" with the
   exact reason (e.g. needs a live Page token).
4. **Limitations and known defects** — including anything left after three fix cycles.
5. **Shared-file needs** — proposed diffs for anything D10 did not allow, if any.
6. **Handoff** — how QA can re-run your accept checks in under five commands.
