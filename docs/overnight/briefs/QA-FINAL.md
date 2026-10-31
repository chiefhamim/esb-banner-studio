# Final adversarial QA pass — assignment

Target: the mission branch `overnight/2026-11-01` in the orchestrator's checkout `C:\Users\hamim\esb-banner-studio`
(port offset 0 — the only checkout allowed to use the default ports; no builder runs suites there any more).
Read-only for source; you may write only `docs/overnight/qa/FINAL.md` and probes under `tools/out/qa-final/`.

## Scope

1. **Full suite on the final commit**, each command with its real tail output: `npx oxlint`, `npx tsc -b`,
   `npm run test:unit`, `npm run test:editorial`, `npm run test:insights`, `npm run test:wire`, `npm run test:digest`,
   `npm run test:golden`, `npm run test:ui`, `npm run build`, `node tools/e2e/electron-test.mjs`,
   `node tools/e2e/digest-test.mjs --electron`, `npm run test:video`, `npm run census -- --strict`, and the packaged-app
   style check `node tools/e2e/packaged-check.mjs` if it runs in this environment. Compare against
   `docs/overnight/BASELINE.md` and `artifacts/overnight/regress/*/SUMMARY.md`.
2. **The directive's §8 probes, on the integrated app** (isolated profiles only; never `%APPDATA%\ESB Banner Studio`):
   - Expired/invalid Facebook token in Insights: honest error state, no retry storm, nothing logged containing the
     token (console, localStorage, DOM, your probe output).
   - `net-guard` rejections for the Wire desk (private IP, redirect to loopback, oversize feed): structured error
     surfaced, source backs off.
   - IndexedDB quota / eviction for the Quote library: degrades without index corruption; what the UI says.
   - AI provider down or `paused: true`: Library, Insights, Wire and Digest all work by hand; no AI host contacted.
   - Restart persistence in a fresh isolated Electron profile: library entries + speaker edit, insights cache with
     `fetchedAt`, wire sources/inbox/dismissed, a digest draft campaign — all back after relaunch.
   - Any new string from feeds / Graph / articles rendered unescaped, or concatenated into a prompt without the
     delimiter pattern (grep the four new modules; probe one hostile string through each surface).
   - Cross-feature: publish (browser preview, mocked) → publish log → Insights row → Library harvest → digest
     lists the story — one story through the whole chain.
   - (W3 was cut: the window-closed / force-kill distribution probes do not apply; say so.)
3. **Screenshots**: `node tools/e2e/overnight-shots.mjs --out artifacts/overnight/screenshots/final --tag final`
   (all screens, both sizes, both themes), then pair them against `artifacts/overnight/screenshots/baseline/` with
   `node tools/e2e/shot-diff.mjs artifacts/overnight/screenshots/final --before baseline --after final` after
   copying the baseline files in — or compare by eye with the Read tool: every workspace must still look like itself;
   the new screens must look like the app (Quiet Studio), light and dark, 1366×768 and 1920×1080.
4. **Repo hygiene on the final tree**: `git status` clean; no file under `artifacts/` committed except `*.log`/`*.md`;
   `git log --all -p -- '*.ts' '*.tsx' '*.mjs' '*.cjs' '*.json' | grep -E "sk-ant-|AIza|EAA[A-Za-z0-9]{40}|xox[bp]-"`
   on the mission branch's new commits = nothing; no real e-mail address or real contact in any new test/fixture.

## Verdict

`docs/overnight/qa/FINAL.md`: verdict line first (`PASS`, `PASS WITH NON-BLOCKING FINDINGS`, `FAIL — FIX REQUIRED`),
then the full-suite table, the §8 probe results one by one with evidence, screenshots inspected, findings
(numbered, severity, file:line), not verifiable here. The verdict decides whether `main` is fast-forwarded (D6).
