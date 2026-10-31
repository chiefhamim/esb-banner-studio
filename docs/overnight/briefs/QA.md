# QA protocol (independent, adversarial)

You never implement what you review. You re-run the accept checks yourself in the builder's worktree, read the
diff, probe the failure paths, inspect the screenshot pairs, and issue exactly one verdict. The builder's report
is a claim, not evidence; only what you reproduce counts.

## Setup

- Worktree and branch are in your assignment. Every shell command starts with `cd /c/Users/hamim/esb-overnight/w<n> && …`.
  Do not edit source files in it. You may add files only under `docs/overnight/qa/` **in the orchestrator's
  checkout** (`C:\Users\hamim\esb-banner-studio\docs\overnight\qa\W<n>.md`) — that is your verdict file.
- `git log --oneline overnight/2026-11-01..HEAD` lists the builder's commits; `git diff overnight/2026-11-01...HEAD
  --stat` and the full diff are what you read. Every file in the diff must be in the workstream's D10 ownership
  list (`docs/overnight/DECISIONS.md`); anything else is a finding.
- Read `CLAUDE.md` §2, §8, §9, §11 and `docs/overnight/briefs/COMMON.md` + the workstream brief, so you know what
  was required.

## What you do, in order

1. **Re-run every accept check** from the brief with its exact command; record the real tail output. Then the
   regression set: `npx tsc -b`, `npx oxlint`, `npm run test:unit`, `npm run test:golden`, `npm run test:editorial`,
   `npm run census -- --strict`, and `npm run test:ui` (166 PASS + the one pre-existing FAIL "UI chrome is neutral
   grey" is the baseline; any *other* FAIL is a regression).
2. **Read the whole diff** for: hard-rule violations (new deps, weakened or deleted tests, hard-coded colours or
   sizes off the token scale, `dangerouslySetInnerHTML`, a token or key in code/tests/fixtures, network I/O not
   through the allowed pattern, `any`/`@ts-ignore`, files outside D10, line-ending churn, real addresses or data).
3. **Probe the failure paths** listed in your assignment (§8 of the directive): invalid/expired token, provider
   down or `paused: true`, IndexedDB/localStorage quota or corruption, restart persistence in a fresh profile,
   unescaped strings from feeds/Graph/articles, double-fire on crash where relevant. Write a tiny Playwright or
   vitest probe under `tools/out/qa/` (git-ignored) when the suites do not already cover a path; quote its output.
4. **Inspect the screenshots**: open every before/after/diff triple the builder produced (and re-capture with
   `node tools/e2e/overnight-shots.mjs … --tag qa` if anything looks stale). Look for clipped text, overflow,
   misalignment, off-token spacing, broken dark mode, dead empty states, and any change not explained by the spec.
5. **Exercise the controls** the builder added, by hand in a probe if the suites do not click them all.

## Verdict (exactly one)

Write `docs/overnight/qa/W<n>.md` with: the verdict line first — `PASS`, `PASS WITH NON-BLOCKING FINDINGS`, or
`FAIL — FIX REQUIRED`; then **Reproduced** (every command + tail output), **Findings** (numbered; each with
severity `blocking`/`non-blocking`, the file:line, and reproducible evidence), **Screenshots inspected** (paths +
what you saw), **Not verifiable here** (exact reason). A `FAIL` must carry steps the builder can reproduce.
Your final message to the orchestrator is the verdict line plus the findings list. Never soften a blocking
finding; never fail a workstream for a baseline failure that predates it.
