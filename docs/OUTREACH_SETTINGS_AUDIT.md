# Outreach settings audit (2026-11-01, branch `outreach-pacing-fix`)

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
| How fast: Fixed gap / Spread over the hours (`pace`) | engine `chooseGapSec` | yes (gapKey) | engine (4), (23); pacing A, B |
| Wait at least / at most (`minDelaySec`/`maxDelaySec`) | engine `chooseGapSec` (both paces); mailer only for display (`pacing()` overlay) | yes | pacing A (manual 60–120 s honoured for rnd 0/0.5/1), B (auto never outside). **FIXED**: was edited only in the Sender dialog and saved to `outreach-smtp.json`, which the engine never read; the Autopilot dialog had no fields. Now both dialogs edit the engine copy; 'auto' was ignoring them entirely (60 s floor, up to 30 min) — now clamped inside them |
| Emails a day (`dailyLimit`) | engine `rampCap` (room); mailer ledger cap via `pacing()` | yes | engine (3); pacing A (mailer enforces the engine number). **FIXED**: same two-copy bug as the gaps (Sender dialog → smtp file only) |
| Start slowly (warm-up, `ramp`) | engine `rampCap(cap, sendDays)` | yes | engine (3). Note: send days are counted by UTC date, not Dhaka date (a 00:00–06:00 Dhaka send counts on the previous UTC day) — harmless, documented |
| At most N a day to one organisation (`domainMaxPerDay`) | `pickNext` with `domainStats` | yes. **FIXED**: counts lived only in memory and reset on every restart (desco.gov.bd got 7 on 2026-11-01 with a limit of 3; ~32 engine starts that day). Rebuilt from the event log at start (`rebuildFromLog`, the send.ok of the last 24 h incl. other PCs', reset 24 h after the first send to that organisation — the same rule as before) | pacing C (restart keeps 3/3 and the reset time). **FIXED**: a changed limit now wakes a batch waiting on it (pacing C "wakes") |
| … minutes apart (`domainMinGapSec`) | `pickNext` | yes | pacing C (spacing after restart). **FIXED**: typing 0 saved 20 (`Number(x) \|\| 20`) |
| Contact cooldown (days) | engine `isUnderCooldown` (first letters; ≥ 7) | yes | engine (13) |
| Keep sending from the tray | `main.cjs` window `close` handler reads it at close time | yes | manual (main process; no unit seam) |
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
| Emails a day, Wait at least / at most | **FIXED**: the engine's autopilot settings (`engineClient.saveSettings`; typed gaps = Fixed gap). The smtp file keeps a copy only because its validator needs one; the mailer reports and enforces the engine numbers (`createMailer({ pacing })`) | engine; mailer status/cap | pacing A |

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
`gap 1–2 min` · `spread over the sending hours, 3–8 min apart` · `outside sending hours (09:00–17:00)` ·
`100 sent in 24 h — daily limit 100` (the wait now ends when the oldest send turns 24 h, not a blind hour).
Tests: pacing D, pacing-shots e2e.

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
