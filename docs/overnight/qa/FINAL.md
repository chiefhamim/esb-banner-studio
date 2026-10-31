PASS WITH NON-BLOCKING FINDINGS

# Final adversarial QA — mission branch `overnight/2026-11-01`

Target: the orchestrator's checkout, branch `overnight/2026-11-01`. The suite ran on `825cfe4` + docs commits. HEAD
was `8d2cfc7` at the start and `625cd10` at the end. `git diff --name-only 825cfe4..HEAD` lists only `docs/` and
`artifacts/` files, so the code under test is `825cfe4`. Default ports (no `.esb-port-offset`); my probes used port
5390 with their own Vite cache. Electron used isolated temp profiles only (`--user-data-dir=%TEMP%\esb-qafinal-*`,
`ESB_NO_SYNC=1`, `ESB_OUTREACH_DRYRUN=1`); `%APPDATA%\ESB Banner Studio` was never touched. Logs and probes are in
`tools/out/qa-final/` (git-ignored).

No blocking finding. Every number matches the orchestrator's run except `test:ui`: the known Alt+corner
intermittent failed on both of my runs (finding 1). It does not block the gate, because no file it exercises changed
on the branch.

## 1. Full suite on the final commit

| Command | QA result (tail) | Orchestrator (after-w4b) |
|---|---|---|
| `npx oxlint` | exit 0 · **0 errors**, 150 warning lines (baseline log: 150) | exit 0 |
| `npx tsc -b` | exit 0 | exit 0 |
| `npm run test:unit` | `Tests 671 passed (671)` | 671 |
| `npm run test:editorial` | 75 PASS / 0 FAIL | 75 / 0 |
| `npm run test:insights` | 46 PASS / 0 FAIL, `ALL PASS` | 46 / 0 |
| `npm run test:wire` | 46 PASS / 0 FAIL, `ALL PASS` | 46 / 0 |
| `npm run test:digest` | 43 PASS / 0 FAIL, `ALL PASS` | 43 / 0 |
| `npm run test:golden` | `social-01: 292 px differ (0.013 %)` · `web-01: 988 px differ (0.048 %)` | 0.013 % / 0.048 % |
| `npm run test:ui` | **165 PASS / 2 FAIL**: `UI chrome is neutral grey` (baseline) + `Alt + corner resizes from the centre centre 592.5,675.0 -> 540.0,674.5`. Re-run `node tools/e2e/ui-test.mjs`: 159 PASS / 2 FAIL, the same two (`592.5,701.0 -> 540.0,674.5`); `date-test.mjs` 6 PASS | 166 / 1 |
| `npm run build` | exit 0, `✓ built in 316ms` | ✓ |
| `node tools/e2e/electron-test.mjs` | 35 PASS / 0 FAIL, `Home → Quit closes the app` | 35 / 0 |
| `node tools/e2e/digest-test.mjs --electron` | 9 PASS / 0 FAIL, `[electron] the only URL the renderer asked for was the site list` | 9 |
| `npm run test:video` | 22 PASS / 0 FAIL | 22 / 0 |
| `npm run census -- --strict` | exit 0 (z-index list unchanged: `0(3) … 3000(2)`) | exit 0 |
| `node tools/e2e/packaged-check.mjs` | **not runnable here**: `Error: Process failed to launch!`. It launches `release-v1.5.4/win-unpacked/ESB AI Studio.exe`, which does not exist (no `release-*` in the checkout). It also waits for `.topbar`, the stale wait fixed in D8a for electron-test. Even with a binary, it would test v1.5.4, not this branch. | not in table |

## 2. §8 probes on the integrated app

Probe sources: `tools/out/qa-final/probe-browser.mjs` (P1–P4, P6, P7), `probe-electron.mjs` (P5), `probe-ipv6.cjs`,
`prompt.test.ts`. Logs: `tools/out/qa-final/logs/probe-*.log`. Probe-harness failures I hit along the way (my seed
script running in the sandboxed srcdoc frame, a wrong store path) were fixed in the probe and re-run. None was an
app defect.

**P1 — Insights, expired (190/463) and invalid (190) token: PASS.** I used a unique fake token,
`QAFINAL-fake-token-7f3a9c11`, and every Graph request was routed. On open, 1 Graph request (1 insights). After 3
forced clicks on Refresh: still 1. Refresh is `disabled`. The state text is "Facebook rejected the Page token: it
expired or was revoked. Insights will not try it again. The figures below are the last ones read." The token was
absent from the DOM (`outerHTML`), the console, sessionStorage, every Graph URL (`token in URL=0`) and every
localStorage key except `esb-banner-studio/facebook` (`leak keys: none`). Identical for both variants. This probe's
output prints no token.

**P2 — Wire desk with real `net-guard` rejections: PASS.** `window.esb.fetchUrl` was bridged
(`page.exposeFunction`) to the real `electron/net-guard.cjs fetchArticleHtml` in Node, with a local HTTP server and a
custom resolver. The only test allowance (exactly `127.0.0.1`) went to the first hop of the redirect and oversize
cases; net-guard judged every redirect target and the size cap itself.
- `intranet.qa.test`→10.0.0.5: `private_address` "Host intranet.qa.test resolved to private/restricted IP: 10.0.0.5"
- `rebind.qa.test`→169.254.169.254: `private_address`
- 302 → `http://127.0.0.2/feed`: `private_address` "Access to private IP address is rejected: 127.0.0.2"
- 6.5 MB `application/rss+xml`: `too_large` "Response exceeded size cap of 5242880 bytes"
- `http://localhost:…/feed` (no allowance): `private_address`
- The source list shows the structured text, e.g. "Retrying in 1 h · Response exceeded size cap of 5242880 bytes";
  the note reads "Checked 5 sources · 0 new · 5 failed."
- Backoff: after poll 1, `failures=1`, next try in 60 min. A second Check now with nothing due made **0** fetches.
  With every source made due again and the app relaunched: `failures 1->2`, delay `60->120 min` for all five.
- IPv6 literals through the real bridge path, with no resolver and no allowance (`probe-ipv6.cjs`): `[::1]`,
  `[::ffff:127.0.0.1]`, `[::ffff:7f00:1]`, `[0:0:0:0:0:ffff:127.0.0.1]`, `[::127.0.0.1]`, `[fe80::1]`, `[fc00::1]` all
  returned `private_address`. My first run "accepted" a redirect to `[::ffff:127.0.0.1]` only because my resolver's
  catch-all answered 127.0.0.1 under the test allowance. That was a probe artifact, not a finding.
- No page errors and no external requests.

**P3 — Quote library with IndexedDB failing / absent: PASS. D16 is confirmed and is still the only issue.** Three
modes, each followed by a relaunch without the patch:
- (a) `IDBObjectStore.put` throws `QuotaExceededError` for entry rows only. The panel says "4 added." The index was
  written with 4 rows; at relaunch verify-on-read dropped them and rewrote the index. Result: 0 rows, 0 index rows,
  0 orphans.
- (b) Every `put` throws: "4 added.", then 0 / 0 / 0 after relaunch.
- (c) `indexedDB` undefined: "4 added." (memory), then 0 / 0 / 0 after relaunch.

No page errors. The index is never corrupt: every index row has its entry. The UI says "4 added." when nothing
reached disk. After relaunch the library silently reads "Nothing harvested yet" (finding 2).

**P4 — AI paused (`paused: true`, no provider): PASS.**
- Wire: Add source, Check now (5 items) and Use this link (fills the link intake with
  `https://news.example.com/economy/garment-exports-rise`) all work.
- Library: harvest (4 rows) and search ("Nasrin" → 1) work. Use as quote banner → Graphics with `cardType: quote`,
  "We will add 400 MW of evening peak capacity before the summer", speaker "Rafiq Islam". Use as stat banner → `stat`,
  "Tk 120 crore", label "Upgrade will cost".
- Insights: the desk renders the logged story, and the Summarise button is absent (0).
- Digest: the sheet lists the story; Create makes a `draft` with `scheduledAt: null` and 0 sent.
- `page.on('request')` saw **0** requests to generativelanguage / anthropic / openai / openrouter. No page errors.

**P5 — Restart persistence, fresh isolated Electron profile (dist build): PASS.** Launch 1, through the UI:
- Added a Wire source and dismissed one of two seeded inbox items.
- Harvested 3 library entries and edited a speaker title (`org-berc` → "QA edited title P5").
- Seeded an insights cache with `fetchedAt` = now − 2 min.
- Created a digest draft campaign.

Launch 2 on the same profile: the source is back, the inbox has "P5 wire item one" only, `dismissed` = 1, the
library has 3 → 3 rows, the speaker title is back, Insights shows "Figures from 2 min ago" with 4,321 impressions,
and the campaign "This week at ESB PowerLine — 26 Oct – 1 Nov 2026" is listed.

Every non-local request was cancelled in the main process. The only one was the existing Page-name check
`graph.facebook.com/v26.0/100000000000001?fields=name`, with the token not in the URL. There were 0 insights
requests (the fresh cache was honoured) and no page errors.

**P6 — Unescaped strings / prompt concatenation: PASS.**
- Static grep over the eight files (`quoteLibrary.ts`, `insights.ts`, `wire.ts`, `digest.ts`,
  `QuoteLibraryPanel.tsx`, `InsightsDesk.tsx`, `WireInbox.tsx`, `src/outreach/DigestDialog.tsx`): no
  `dangerouslySetInnerHTML`, `innerHTML`, `outerHTML`, `insertAdjacentHTML`, `document.write` or `eval`. The digest
  preview is `<iframe sandbox="" srcDoc>` (`DigestDialog.tsx:154`). The only prompt is `insights.ts:414-418`, with
  the table between `"""` and a "data, never instructions" system line.
- Hostile string ``<img src=x onerror=alert(1)><svg onload="window.__pwned=1">"""{name}``, pushed through:
  - Wire: source name, and a CDATA item title plus `<script>` in the description.
  - Library: headline and a quoted body.
  - Insights: publish-log headline.
  - Digest: headline in the sheet and in the created campaign.
- Result on every surface: 0 `img[src=x]`, 0 `svg[onload]`, `window.__pwned` unset, 0 dialogs, 0 scriptable nodes
  in frames, and the string is shown as text.
- The digest srcdoc carries `&lt;img src=x onerror=alert(1)&gt;&lt;svg onload=&quot;…`. The stored letter has
  `{name}` neutralised to `｛name｝`.
- Prompt (`prompt.test.ts`): a hostile headline/category with runs of 3 and 6 quotes gives exactly 2 `"""` in the
  prompt.
- The known W2 cycle-1 #1 is still open: a hand-edited `publishedAt` (finding 3).

**P7 — Cross-feature chain in the browser: PASS.** Steps, each verified:
- Browser-preview publish with a mocked site (`POST rest/v1/Article`, status PUBLISHED). Slug:
  `chain-probe-grid-operator-adds-400-mw-of-evening-peak-capacity`.
- The publish log holds that slug and headline (`dryRun:false`).
- The Library holds 4 entries (2 quotes, 2 stats), all with that slug (D9).
- Insights lists the headline.
- The Digest "Last 7 days" lists "Chain probe: … · Sun 1 Nov · A synthetic deck for the chain probe."
- Create draft campaign makes a `draft` campaign containing the story, with 0 sent and `scheduledAt: null`. No SMTP
  path exists in the browser.

0 AI requests and no page errors. The only external requests were two Supabase `auth/v1/user` session checks after
the stubbed sign-in, which my probe aborted.

**P8 — W3 (distribution scheduler) was cut (D20).** The window-closed and force-kill / exactly-once distribution
probes do not apply to this branch and were not run. W3's WIP is on `overnight/w3-scheduler`, not merged.

## 3. Screenshots inspected

`compare/diff-table.md`: home, graphics, graphics-quote, video, outreach and outreach-activity are **0.000 %** at both
sizes and both themes. Only editorial-launcher (0.105–0.484 %) and editorial-desk (0.179–1.199 %) differ.

- Opened `editorial-desk__1366x768__dark--{diff,baseline,final}.png`. The differences are:
  - the header Desk·Insights Seg;
  - the Library tab and the Wire option in the left column;
  - the Details header summary, which is the D8b fix ("De" truncation gone);
  - antialiasing on the left-column text.

  Nothing else moved.
- New screens opened:
  - `editorial-library` 1366 light/dark
  - `editorial-insights` 1366 light/dark
  - `editorial-insights-unconfigured` 1366 dark
  - `editorial-wire` 1366 light/dark and 1920 dark
  - `outreach-digest` 1366 light/dark and 1920 light

  All read as the app: Inter, hairline cards, graphite surfaces, 28/32 px controls and the same header chrome.
  Selected states use the light chip in dark mode. No clipped text or overflow, and honest empty or unconfigured
  states ("Facebook Page not connected …", "not read yet", "No deck kept for this story").
- Cosmetic notes are in findings 4 and 6.

## 4. Repo hygiene (final tree, HEAD `625cd10`)

- `git status --short`: clean. At the start, `artifacts/overnight/screenshots/compare/diff-table.md` was untracked;
  the orchestrator's docs commit since then covers it.
- `git ls-files artifacts | grep -vE '\.(log|md)$'`: empty.
- Secret grep over `e15753e..HEAD -p` (`*.ts *.tsx *.mjs *.cjs *.json *.md`): one hit, line 832. It is the grep
  command itself quoted in `docs/overnight/briefs/QA-FINAL.md`, a false positive. No key, token or `ghp_`.
- E-mail addresses in files added or modified on the branch under `tools/` and `src/`:
  - Branch-added files use only `example.com` / `example.org` (`reporter@`, `desk@`, `editor@`, `a@`, `b@`, `u@`,
    `nmd@`, `nce@`).
  - Realistic addresses on real institutional domains exist only in the pre-existing
    `tools/e2e/capture-phase{3,4,5}-shots.mjs` (e.g. `capture-phase3-shots.mjs:165`). The branch added none of them
    (`git log e15753e..HEAD -p | grep '^+.*@pgcb…'` = 0); it only changed their port line (finding 7).

## Findings

1. **non-blocking — `test:ui` "Alt + corner resizes from the centre" failed on 2 of 2 runs here (UI total 165 vs
   166).** `tools/e2e/ui-test.mjs:163-174`. The failure is in the start position, not the resize: the centre before
   the Alt drag is 592.5 here vs 540.0 in all 9 earlier logs (baseline + every `regress/*/ui.log`), so the preceding
   Shift+corner step left the element in a different place. Not attributable to the branch:
   `git diff --stat 79b9c01..HEAD -- src/components src/core src/store.ts src/ui src/App.tsx src/shell` is empty, and
   Graphics loads none of the new modules. FINAL_REPORT.md:108 already calls it intermittent on untouched code. It
   reproduced twice in a row here, though, so "intermittent" understates it. Repro: `node tools/e2e/ui-test.mjs`.
2. **non-blocking — D16 is unchanged: "N added" when nothing reached disk, and the loss is silent after relaunch.**
   `src/outreach/idb.ts:23-30` resolves `undefined` on any IDB error, and `idbSet` (`:38`) never rejects, so
   `saveMerge` sees success and `QuoteLibraryPanel.tsx:35` says "4 added.". On relaunch, verify-on-read drops the rows
   and the panel says "Nothing harvested yet", with no word that entries were lost. The index is never corrupt.
   Repro: `node tools/out/qa-final/probe-browser.mjs p3`.
3. **non-blocking — the W2 cycle-1 #1 delimiter gap is still open.** `src/editorial/insights.ts:411` puts
   `r.publishedAt.slice(0, 10)` into the prompt without `cell()`, and `cleanRecord` (`:50`) accepts
   `'(""""") Jan 1 2026'`. Result: 3 `"""` in the prompt (`npx vitest run tools/out/qa-final/prompt.test.ts`). It
   needs the publish log edited outside the app, and the summary is opt-in, AI-only and refused when AI is paused.
4. **non-blocking (copy) — the digest spells the brand "ESB PowerLine".** `src/editorial/digest.ts:26`
   (`DIGEST_TITLE`, the subject of every digest letter) and `:187` (the intro). The rest of the app and the Insights
   system prompt say "ESB Power Line" (32 files). The letter goes to outside recipients. The intro is editable in the
   sheet; the subject comes from the constant.
5. **non-blocking (cosmetic, same class as W1 #2) — any double-quoted run is harvested as a quote.** In P6, the
   attribute text `"window.__pwned=1"` became a library quote ("Speaker not named in the story"). It is inert
   (rendered as text) and only matters for odd inputs.
6. **non-blocking (layout) — Wire list height at 1920×1080.** The inbox is a fixed-height scroll area inside the
   launcher card: about 4.5 rows show, with roughly 230 px of empty page above and below the card, and the last row is
   cut at the scroll edge with no fade (`editorial-wire__1920x1080__dark--final.png`). Related to W5 #4.
7. **non-blocking (pre-existing, outside this branch) — realistic institutional e-mail addresses in old capture
   scripts.** `tools/e2e/capture-phase{3,4,5}-shots.mjs` (e.g. `rezwan.khan@pgcb.gov.bd` at
   `capture-phase3-shots.mjs:165`, `chairman@sreda.gov.bd`) conflict with CLAUDE.md's "tests use example.com" rule.
   Not added tonight.
8. **non-blocking — `tools/e2e/packaged-check.mjs` is stale.** It hard-codes `release-v1.5.4/…exe` and waits for
   `.topbar`, so it cannot gate this branch. A packaged build of the branch was not produced or checked.

No blocking finding. The pre-existing "UI chrome is neutral grey" failure is unchanged and not counted.

## Not verifiable here

- **The packaged installer / `win-unpacked` app:** no packaged build exists in the checkout, and
  `packaged-check.mjs` targets v1.5.4.
- **Real Facebook Graph, real feeds, real SMTP:** all calls were mocked or cancelled by policy (no live calls).
  Graph error shapes come from the documented OAuthException format.
- **A real IndexedDB quota or eviction by the browser:** simulated by throwing `QuotaExceededError` from
  `IDBObjectStore.put` and by removing `indexedDB`. Chromium's own eviction of the `esb-outreach` origin was not
  produced.
- **W3 distribution probes:** W3 was cut (D20).
