# Outreach settings audit (2026-11-01, branch `outreach-pacing-fix`; re-run 2026-11-02, branch `outreach-simplify`)

## 2026-11-02 — what changed (branch `outreach-simplify`)

The editor's complaints: "100 a day spread out was meant to keep it running — now I wait ~4 hours for the next batch";
"lots of options that don't talk to each other"; "clicking Log in Activity freezes the app".

1. **Daily limit = calendar day** in the sending time zone (Asia/Dhaka: resets at 00:00 Dhaka), for the account limit
   AND the per-organisation limit. One rule in one place, `outreach-schedule.cjs capState` (+ `dayStartAt`,
   `nextDayStartAt`, `dayKey`, `nextOpenAt`), used by the engine (`capNow`), the mailer's ledger (`ledgerCheck`,
   `status().sentToday`) and the live plan (`livePlan`). Before, it was a rolling 24 h window: on 2 Nov at 11:06 the
   last 100 sends began at 15:26 the day before, so nothing could go until 15:26 — four hours into the sending
   hours. Under the new rule 19 of those 100 were sent today (00:00–00:43, while the hours were still off), so
   **81 can go at once** when the engine restarts.
2. **Safety ceiling**: never more than `gmailCeiling24h` (default **400**, under Gmail's 500 for a consumer account;
   50–2000, settings file only — no screen) in any rolling 24 h, so a full day at 23:00 followed by a full day at
   00:00 cannot burst past Gmail. Enforced by the engine and the mailer.
3. **Full day → resumes at the right time**: the wait ends at local midnight, then the sending hours decide
   (`job.until = nextOpenAt(freesAt)`); the footer says "daily limit reached — 100 of 100 sent today · resumes
   9:00 AM (sending hours)" or "· resumes 12:00 AM (new day)"; the ceiling says "safety limit: 400 emails in 24 h
   (max 400) · resumes …". `job.wait` carries `kind` ('day' | 'ceiling'), `resetAt`, `resumeAt`, `hours`, `tz`.
4. **One pacing model**: a random gap between the two numbers. "Spread over the hours" (`pace: 'auto'`) is gone —
   with a calendar-day limit it only delayed emails the editor wanted out. `pace` is still accepted ('auto' from an
   older file or another PC) and stored/read as 'manual'; `autoGap` is no longer used by the engine.
5. **One Sending panel** (`AutopilotDialog.tsx`, "Sending settings" in the Campaign menu, the Autopilot card and the
   Sender dialog's link): Emails per day · Gap between emails (min–max) · Sending hours (on/off, from/to, days, zone)
   on top; a **live plan line** computed by the engine from the unsaved values (`esb:outreach-plan` with `draft` +
   the open campaign's remaining `domains` → `engine.plan` → `livePlan`, an email-by-email simulation with the
   engine's own rules) — "Today: 19 of 100 sent · next email now · at 1–2 min gaps, 100 emails take about 2.5 h ·
   the remaining 182 in this campaign finish ~Wed 4 Nov 9:00 AM" — and warnings when settings contradict (only N
   fit in the hours; the 24 h ceiling is below the daily number; warm-up lowers today; hours off; "96 of the 120
   remaining contacts are in 4 organisations — at 3 a day each, 20 min apart, only 36 can go today"). **Advanced**
   (folded, with a one-line summary): per organisation limit + spacing, contact cooldown, warm-up, tray sending,
   assistant — each with one line on what it does to the pace. The **Sender dialog** keeps only the account and
   servers and shows the pace in one line with "Change in Sending settings".
6. **Freeze**: the 2026-11-01 migration logged `settings.migrated` with `to: { minDelaySec, … }`. The Log prints
   `ev.to` as the recipient; React threw #31 ("objects are not valid as a React child") and, with no error
   boundary, unmounted the whole app — a blank grey window. Reproduced with a copy of the editor's own event log.
   Fixed three ways: every event is made printable before it is shown (`activityFormat.displaySafe`), the event now
   uses `before`/`after`, and the Activity desk has an error boundary (`DeskBoundary.tsx`) so one bad row can never
   blank the window. Also: the event log's "All time" query re-read and re-parsed every month file synchronously
   in the main process on each call (and the Log re-asks on every live push) — now parsed once and kept while the
   files are unchanged (50k events: 38 ms → 0.1 ms a query); `ensureDir` called itself until the stack overflowed;
   log rows are memoised with their day headings computed once; a contact-list rule turned log rows into a broken
   grid under 1180 px.

Measured (`node tools/e2e/outreach-simplify-shots.mjs`, built app): the editor's log — before: never opens (blank
window); after: 65–86 ms. 50,000 events — Log opens in 82–97 ms (All time), no long tasks, worst frame round trip
9–12 ms.

Every setting the editor can change, followed from the screen to the code that obeys it. A setting that was stored
twice, ignored, overridden or only applied after a restart was treated as a bug and fixed on this branch (marked
**FIXED**). Files: `userData` = `%APPDATA%\ESB Banner Studio`; "engine" = `electron/outreach-engine.cjs`.

"Live" means a change applies to a batch that is already waiting, without a restart: `esb:outreach-settings-save`
→ `engine.settingsChanged()` wakes waits for the window, the daily cap, the gap and an organisation's limit/spacing,
and the next tick reads the new values.

## Autopilot settings (Campaign → Autopilot settings, `AutopilotDialog.tsx`)

Stored in `userData/outreach-autopilot.json` (`electron/outreach-settings.cjs`, validated, atomic write). Account-wide
keys (`SHARED_KEYS`) also go to `outreach_settings` row `autopilot` once proposal 0025 is applied.

| Setting | Read by | Live? | Test |
|---|---|---|---|
| Only send in a time window (on/off) | engine `getEffectiveWindow` → `windowState` (schedule.cjs) | yes | engine (2), (2b); pacing-shots e2e. **FIXED**: OFF now shows "Sending at any hour — set hours in Autopilot settings" on the Autopilot card and Send footer, and a warning in the dialog |
| Days, From, To | `windowState` / `secondsLeftInWindow` / `planSchedule` | yes | engine (2), (2b); schedule tests |
| Time zone | same (Intl zone math) | yes | schedule tests (Asia/Dhaka) |
| ~~How fast: Fixed gap / Spread over the hours (`pace`)~~ | **REMOVED 2026-11-02**: one model (random gap between the two numbers); 'auto' accepted and stored as 'manual' | — | pacing B; daily-limit D |
| Gap between emails min–max (`minDelaySec`/`maxDelaySec`) — Sending panel | engine `chooseGapSec` (random between them); live plan (`avgGap`) | yes (gapKey) | pacing A, B. (2026-11-01 **FIXED**: the two-copy bug — the Sender dialog saved to `outreach-smtp.json`, which the engine never read.) 2026-11-02: edited ONLY in the Sending panel; the Sender dialog shows them in words |
| Emails per day (`dailyLimit`) — Sending panel | engine `capNow` → `capState` (**calendar day** in `window.tz`); mailer `ledgerCheck` → the same `capState` (tz + ceiling passed by `pacing()`); live plan | yes | daily-limit A (Dhaka midnight reset; the editor's 2 Nov case: 81 can go; a full day waits for 09:00 tomorrow, or 00:00 with hours off), mailer (next slot = next Dhaka midnight; yesterday's sends do not count) |
| (no UI) 24 h safety ceiling (`gmailCeiling24h`, default 400, 50–2000) | engine `capNow`, mailer `ledgerCheck` (`capState` ceiling) | yes | daily-limit B, mailer ("ceiling holds across midnight"), settings (bounds) |
| Start slowly (warm-up, `ramp`) — Advanced | engine `rampCap(cap, sendDays)`; live plan | yes | engine (3). **FIXED 2026-11-02**: sending days are counted by the Dhaka date (were UTC dates), and today counts before its first send (the second morning is day 2, not day 1 again) |
| At most N a day to one organisation (`domainMaxPerDay`) — Advanced | `pickNext` with `domainStats` | yes. 2026-11-01 **FIXED**: counts rebuilt from the event log at start (`rebuildFromLog`). **2026-11-02**: the count is per **calendar day** too (resets at Dhaka midnight, `resetAt = nextDayStartAt`); the last-send time survives midnight so the spacing still holds | pacing C (restart keeps 3/3; freed at Dhaka midnight), daily-limit A (3 late in the evening → a 4th at 00:00; spacing across midnight) |
| … minutes apart (`domainMinGapSec`) — Advanced | `pickNext`; live plan | yes | pacing C (spacing after restart). **FIXED**: typing 0 saved 20 (`Number(x) \|\| 20`) |
| Contact cooldown (days) — Advanced | engine `isUnderCooldown` (first letters; ≥ 7) | yes | engine (13) |
| Keep sending from the tray — Advanced | `main.cjs` window `close` handler reads it at close time | yes | manual (main process; no unit seam) |
| Assistant: Suggest / Ask me first / Do safe things | `operator.ts`, `AssistantDialog.tsx` | yes | `outreach-operator.test.ts` |
| Let the assistant read replies | `main.cjs` `isAiReadsReply` → `inbox.cjs`, `saveReplyText` | yes | `outreach-reply-ai.test.ts` |
| (no UI) `autoResume` | engine `start()` for a job left running by a crash | n/a | engine (17) |
| Restore defaults | dialog state only until Save | — | — |

Also **FIXED** in the dialog: it initialised its fields from the engine settings at mount; when they had not loaded
yet it showed the defaults, and pressing Save wrote those defaults over the editor's settings. It now waits for the
saved settings before showing the form.

## Sender (header avatar → Sender, `SenderDialog.tsx`)

| Setting | Stored | Read by | Test |
|---|---|---|---|
| Name, address, app password, SMTP host/port, IMAP host | `userData/outreach-smtp.json` (password DPAPI-encrypted) | `mailer.cjs` transport, `inbox.cjs` | `mailer.test.ts`, electron-test |
| ~~Emails a day, Wait at least / at most~~ | **REMOVED 2026-11-02** from this dialog: shown in one line ("Sending pace: 100 a day · 1–2 min apart · 9:00 AM–9:00 PM") with "Change in Sending settings". The smtp file keeps a copy only because its validator needs one (the engine's numbers are passed through unchanged); the mailer reports and enforces the engine numbers (`createMailer({ pacing })`) | engine; mailer status/cap | pacing A, pacing-shots e2e |

One-time migration (`migratePacingFromMailer`, at engine start, logged as `settings.migrated`): if the smtp copy's
gaps / daily limit differ from the engine's and either the smtp file is newer or the engine values are still the
untouched defaults (180–480 s / 100 — no screen could edit them before this fix), the smtp values are adopted with
pace = Fixed gap. Runs once (`pacingMigrated`), never writes the smtp file. **On the editor's PC**: smtp 60–120 s,
autopilot 180–480 s manual (autopilot file newer, but default values) → after restart the engine uses **60–120 s,
Fixed gap, 100 a day**; window stays OFF (now warned), per-organisation 3/day and 20 min stay.

The mailer's own floor between two sends is 30 s (`MIN_GAP_SEC`), below the smallest allowed gap: it never adds a wait.

## Campaign-level options

| Option | Set in | Stored | Obeyed by | Test |
|---|---|---|---|---|
| Start at a time | Review & send → Start at a time | `campaign.scheduledAt`; `JobSpec.startAt` | engine (`why: 'schedule'`) | engine (18) |
| Follow-up after N days | Letter → Follow-up letter | `campaign.followUp.afterDays` | `campaign.ts followUpCode`; main enforces ≥ 2 days and once per 30 days | `outreach.test.ts`, `mailer.test.ts` |
| Approved by hand | Review / Contacts | `outreachStore.approved` (per address) | `compose.ts skipReason` → JobSpec | `outreach.test.ts`. Sync **FIXED** (see below) |
| Opted out | Contacts, unsubscribe reply | `outreachStore.optOut`; engine `optout` events | engine suppression; skipReason | engine (14). Sync **FIXED** |
| Test send | Send tab → Send test | mailer ledger `kind: 'test'` | mailer 10/hour, 30/day; not counted in the cap | `mailer.test.ts` |
| Signature / letterhead / templates / house prompt | Letter menu | `outreachStore` | renderer when building the job | composer tests. Sync **FIXED** |

## Why the batch waits (shown on screen)

The engine now sets `job.wait` beside `job.why` and pushes it with every progress message; `activityFormat.waitReason`
words it; the Send footer shows "Next in m:ss" + the reason, the Autopilot card "Next in m:ss — reason":
`desco.gov.bd: 20-min spacing per organisation` · `desco.gov.bd had 3 today (limit 3 per organisation)` ·
`gap 1–2 min` · `outside sending hours (09:00–17:00)` · (2026-11-02) `daily limit reached — 100 of 100 sent today ·
resumes 9:00 AM (sending hours)` / `… · resumes 12:00 AM (new day)` · `safety limit: 400 emails in 24 h (max 400) ·
resumes …`. A job snapshot from the previous build (no `wait.kind`) keeps the old "N sent in 24 h" wording. The
Send footer's top line is "Next in m:ss", or "Next email Tue 3 Nov 9:00 AM" for a wait over 6 h, with the reason
under it. Tests: pacing D, daily-limit A/B, `outreach-simplify-shots.mjs`.

## Cross-PC sync (`cloudSync.ts`, `cloudMerge.ts`)

| Fact / setting | Before | Now |
|---|---|---|
| sent, failed, skipped, replied, bounced, followed, tracking keys, sent-from-PC | campaign maps (union) + `outreach_sends` rows | unchanged |
| Opens / clicks | `outreach_events` per open campaign | unchanged (+ Realtime poke) |
| Opt-out of an address no campaign wrote to | **lost** (only a status on a sent row) | own row `addr:optout:{email}` (no campaign/kind; older builds ignore it) |
| Approvals | **local only** | union in `outreach_settings` row `desk` (needs 0025) |
| Signatures, templates, house prompt, letterhead look | **local only** | row `desk`, newest wins (needs 0025) |
| Autopilot settings (account-wide part) | **local only** — two PCs on one Gmail account had two daily limits | row `autopilot`, newest `sharedUpdatedAt` wins, applied through the engine's validated save (needs 0025) |
| Tray / assistant / reads-replies | local | local (per PC by design) |
| Lists, designed letters, campaigns | synced | unchanged; a campaign's data is now downloaded only when another PC changed it |
| Dry run | sync off | **FIXED**: saving settings in a dry run dropped the `dryRun` flag from the renderer's copy and turned sync back on |

Without migration 0025 everything above "needs 0025" stays per PC, silently (the table is re-probed every 30 min);
nothing else changes. Proposal: `docs/proposals/website-0025_outreach_settings_realtime.sql`.
