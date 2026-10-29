# Outreach Autopilot — Implementation Progress

> **Branch:** `outreach-autopilot`  
> **Started:** 2026-10-30  
> **Status:** All Phases (0–7) Complete — Production Ready

---

## Final Verification Metrics (Phase 7 Complete)

| Check | Baseline Result (Phase 0) | Final Handover Result (Phase 7) | Status | Command / Source |
|---|---|---|---|---|
| TypeScript Typecheck | 0 errors | **0 errors** | PASS | `npx tsc -b` |
| Production Build | PASS (Main chunk: 737 kB) | **PASS (built in 352ms, Main chunk: 737.5 kB)** | PASS | `npm run build` |
| Unit Test Files | 39 test files passed | **61 test files passed (+22 new files)** | PASS | `npm test` |
| Unit Tests Total | 333 tests passed | **557 tests passed (0 failed, +224 new tests)** | PASS | `npm test` |
| Oxlint | 0 errors | **0 errors** (147 warnings, 0 errors) | PASS | `npm run lint` |
| Electron E2E Tests | 31 PASS, 0 FAIL | **31 PASS, 0 FAIL** | PASS | `npm run test:electron` |
| Soak Test (5k msgs) | — | **5,000/5,000 processed, 0 duplicates, 5.72 MB RAM growth, 0.81 ms pause** | PASS | `node tools/e2e/outreach-soak.mjs` |
| Crash Recovery Test | — | **Mid-run kill auto-resume: PASS (0 dups); Clean Quit pause preserve: PASS (reason 'quit')** | PASS | `node tools/e2e/outreach-crash.mjs` |
| Text-Fit Audit | 0 text-fit problems | **0 text-fit problems, 6 truncations, 5 field-cut** | PASS | `npm run audit:text-fit` |
| CSS Census | Duplicates: 0 | **Duplicates: 0** (0 new undefined tokens) | PASS | `npm run census` |
| Desktop Screenshots | 54 baseline PNGs | **150+ screenshots across Phases 0–6 on Desktop** | PASS | `Desktop/outreach-autopilot/` |

---

## Baseline Verification Metrics (Phase 0)

| Check | Baseline Result | Command / Source |
|---|---|---|
| TypeScript Typecheck | 0 errors | `npx tsc -b` |
| Production Build | PASS (Main CSS: 316.80 kB, Outreach chunk: 133.07 kB) | `npm run build` |
| Unit Tests | 39 test files passed, 333 tests passed (0 failed) | `npm test` |
| Oxlint | 0 errors | `npm run lint` |
| Electron E2E Tests | 31 PASS, 0 FAIL | `npm run test:electron` |
| Text-Fit Audit | 0 text-fit problems, 6 ellipsis truncations, 5 field-cut | `npm run audit:text-fit` |
| Center Alignment Audit | 0 problems | `npm run audit:center` |
| Contrast Audit | 3 low contrast (Light: Home Ai/Studio/Heart), 2 low contrast (Dark: Home Ai/Studio) | `npm run audit:contrast` |
| Accessibility Audit | All PASS (names, no horizontal overflow, tab navigation) | `npm run audit:a11y` |
| CSS Census | Duplicates: 0, Undefined: 6 (pre-existing in App.css) | `npm run census` |
| Baseline Screenshots | 54 PNGs captured (9 states × 3 widths × 2 themes) | `docs/outreach-autopilot/baseline/` & `Desktop/outreach-autopilot/baseline/` |

---

## Step-by-Step Checklist

### Phase 0 — Safety net and baseline
- [x] **0.1 Clean start:** Branch `outreach-autopilot` created from `main`.
- [x] **0.2 Stop auto-sync:** Background auto-sync verified stopped; `ESB_NO_SYNC=1` enforced.
- [x] **0.3 Baseline metrics:** All §2.4 verification commands recorded above.
- [x] **0.4 Synthetic fixture & baseline screenshots:** `tools/fixtures/outreach-synthetic.mjs` created and 54 baseline screenshots captured.
- [x] **0.5 Progress file created:** Committed with step 0.4.

### Phase 1 — The engine (main process)
- [x] **1.1 Event log (`outreach-events.cjs`):** Append-only monthly JSONL log & suppression fold. (`a6b2669`)
- [x] **1.2 Error classification (`outreach-errors.cjs`):** SMTP error taxonomy & 45-day/60,000 ledger update. (`6f393ac`)
- [x] **1.3 Scheduling maths (`outreach-schedule.cjs`):** Pure window, cap, autoGap, domain throttle, plan schedule. (`9445995`)
- [x] **1.4 Job store (`outreach-jobs.cjs`):** Immutable message files & atomic state files. (`c32473a`)
- [x] **1.5 Engine (`outreach-engine.cjs`):** Headless single-timer queue, retries, circuit breaker, inbox loop. (`d5b30f9`)
- [x] **1.6 Settings (`outreach-settings.cjs`):** Autopilot configuration schema & validation. (`d71ae05`)
- [x] **1.7 IPC guard (`outreach-guard.cjs`):** Strict argument sanitization for all outreach bridge calls. (`2863dfa`)
- [x] **1.8 Wiring (main, preload, types, tray):** System tray, close-to-tray, IPC handlers, push channel. (`c320c9d`)
- [x] **1.9 Phase 1 Gate:** Unit & E2E verification; zero UI regression. Ready to commit.

### Phase 2 — Make the desk drive the engine
- [x] **2.1 Projection (`reconcile.ts`, `engineClient.ts`, `engineStore.ts`):** Event cursor & state reconciliation; extracted `applyInboxResult`. (`876ae81`)
- [x] **2.2 Replace in-window loop (`jobSpec.ts`, `campaign.ts`):** Headless job submission.
- [x] **2.3 Scheduler & inbox move to main:** App-level scheduler offload; engineClient init.
- [x] **2.4 Controls & Autopilot card:** Send tab card, Pause/Resume/Stop, human status sentences. (`activityFormat.ts`, `AutopilotCard.tsx`)
- [x] **2.5 Header, banner row, status-bar pill:** Dynamic Autopilot status indicators.
- [x] **2.6 Review & send sheet:** Plan metrics, pre-flight checks, spot checks.
- [x] **2.7 Autopilot settings sheet (`AutopilotDialog.tsx`):** UI configuration modal.
- [x] **2.8 Interrupted card:** Resumption from unexpected close.
- [x] **2.9 Quit & close integration:** Tray-aware confirmation dialog.
- [x] **2.10 Phase 2 Gate:** UI dry-run E2E tests, visual diff review, 30 desktop screenshots verified.

### Phase 3 — The Activity desk
- [x] **3.1 Stats aggregation (`outreach-stats.cjs`):** Hourly, daily, duration, and median metrics. (`tools/unit/outreach-stats.test.ts`)
- [x] **3.2 Activity state & formatters (`activityStore.ts`, `activityFormat.ts`):** Paged event list & time formatters.
- [x] **3.3 SVG Charts (`charts.tsx`):** Token-styled bar, line, and stacked charts.
- [x] **3.4 Activity Overview (`ActivityOverview.tsx`):** Full-screen KPI strip, hourly distribution, running jobs.
- [x] **3.5 Activity Log (`ActivityLog.tsx`):** Filterable, searchable, expandable transaction log.
- [x] **3.6 Activity Reports (`ActivityReports.tsx`):** Aggregated day/run summaries & CSV exports.
- [x] **3.7 Desk switch integration (`ActivityDesk.tsx`):** Compose vs. Activity header switch.
- [x] **3.8 Styling (`outreach-activity.css`):** Scoped CSS tokens and responsive layout.
- [x] **3.9 Phase 3 Gate:** Full Activity desk visual screenshots & verification, 30 desktop screenshots verified.

### Phase 4 — Data, validation and exceptions
- [x] **4.1 Dynamic fields & fallbacks:** Support all spreadsheet columns (`{field|fallback}`) without dropping rows.
- [x] **4.2 In-app address verification:** DNS MX/A validation, role-mailbox, and disposable domain tagging.
- [x] **4.3 Bulk approval:** Single-click approval for deliverable contacts.
- [x] **4.4 Per-message verification & "Needs you":** Granular error detection & human exception queue.
- [x] **4.5 Phase 4 Gate:** Verified address import & exceptions workflow, 30 desktop screenshots verified.

### Phase 5 — Personalisation
- [x] **5.1 Segment & version data model:** Audience sector/purpose variants.
- [x] **5.2 Versions by sector UI (`SegmentsDialog.tsx`):** Sector-tailored AI drafts with approval gates.
- [x] **5.3 Subject variants:** Rotating subject lines.
- [x] **5.4 VIP openers:** Guarded 1–2 sentence personal introductions.
- [x] **5.5 AI second reading:** Review & send pre-flight checks.
- [x] **5.6 Phase 5 Gate:** Segmented draft & opener verification, 30 desktop screenshots verified.

### Phase 6 — AI Assistant
- [x] **6.1 Command registry (`commands.ts`):** Structured typed command surface.
- [x] **6.2 AI Operator (`operator.ts`):** Natural language intent mapping with autonomy levels (`suggest`, `confirm`, `auto-safe`).
- [x] **6.3 Assistant dialog (`AssistantDialog.tsx`):** Chat/action command panel.
- [x] **6.4 Opt-in reply classification (`replyAi.ts`):** Privacy-conscious reply sorting.
- [x] **6.5 Phase 6 Gate:** Assistant autonomy & security audit, 30 desktop screenshots verified.

### Phase 7 — Hardening and handover
- [x] **7.1 Soak testing:** 5,000-message dry run across 100+ simulated days: 0 duplicate sends, all 5,000 accounted for (4,751 ok + 249 fail), heap growth 5.72 MB (< 100 MB), pause latency 0.81 ms (< 500 ms).
- [x] **7.2 Crash & recovery testing:** Mid-run forceful process kill (200-msg job) auto-resumes on relaunch with zero duplicate sends; Clean Quit preserves paused state with reason `'quit'` and resumes cleanly to 50/50 completion.
- [x] **7.3 Final audit sweep:** 0 type errors (`tsc -b`), production build 352ms (main chunk 737 kB), 61 test files & 557 unit tests PASS (`vitest`), 0 lint errors (`oxlint`), Electron E2E suite 31/31 PASS (`test:electron`), 0 text-fit problems, 0 duplicate CSS tokens.
- [x] **7.4 Documentation:** `CLAUDE.md` Workspace 4 updated with Autopilot engine, event log, activity desk, segments, AI assistant, and switches. `tools/README.md` updated with soak and crash test commands.
- [x] **7.5 Final Handover:** Verification complete, all gates passed, zero regressions.

---

## How Hamim Should First Try It

1. **Launch the Studio:**
   Double-click `Launch ESB Studio.bat` on your desktop or run `npm run app`.
2. **Open the Outreach Desk:**
   Click the **Outreach** tab in the top workspace switcher.
3. **Explore the Autopilot Card:**
   On the right column (Send tab), notice the new **Autopilot** card. It displays human-readable sentences detailing daily pace, warm-up ramp status, and estimated send days.
4. **Open Autopilot Settings:**
   Click **Autopilot settings** on the card (or Campaign → Autopilot settings…). Configure daily sending limits, send windows (Sun–Thu 09:00–17:00 Asia/Dhaka), and safety gaps.
5. **Inspect the Activity Desk:**
   Click the **Activity** pill in the top header (next to the workspace switcher) to view the full-screen Activity Desk. Review live SVG charts (hourly send distribution, 30-day delivery volume), filterable transaction log, and run reports with CSV export.
6. **Ask the AI Assistant:**
   Click **Ask the assistant…** on the Autopilot card or menu. Type natural-language requests like `"How many emails can we send today?"` or `"Show me deliverable contacts"`. Notice the safe, typed command execution and clear autonomy matrix.
7. **Try Background Sending & Tray:**
   Start a campaign run in dry-run or real mode. Close the main window — notice ESB Studio minimizes to the system tray and continues sending on schedule without interruption. Double-click the tray icon to restore.

---

## Deviations & Notes
- `capture-baseline-shots.mjs` was created to automate capturing the 54 baseline screenshot matrix directly across 3 viewports (900×700, 1366×768, 1920×1080) in both light and dark themes, copying them directly to `Desktop/outreach-autopilot/baseline/` for visual verification.
- Pre-existing CSS census warning on App.css (6 undefined var names) noted in baseline metrics; our new code introduced 0 undefined tokens.
- All visual screenshot verification sets (Phases 0, 2, 3, 4, 5, 6) are preserved in `docs/outreach-autopilot/` and copied to `C:\Users\hamim\Desktop\outreach-autopilot/`.
