# Outreach Autopilot — Implementation Progress

> **Branch:** `outreach-autopilot`  
> **Started:** 2026-10-30  
> **Status:** Phase 2 Complete (In Progress: Phase 3)

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
- [ ] **3.1 Stats aggregation (`outreach-stats.cjs`):** Hourly, daily, duration, and median metrics.
- [ ] **3.2 Activity state & formatters (`activityStore.ts`, `activityFormat.ts`):** Paged event list & time formatters.
- [ ] **3.3 SVG Charts (`charts.tsx`):** Token-styled bar, line, and stacked charts.
- [ ] **3.4 Activity Overview (`ActivityOverview.tsx`):** Full-screen KPI strip, hourly distribution, running jobs.
- [ ] **3.5 Activity Log (`ActivityLog.tsx`):** Filterable, searchable, expandable transaction log.
- [ ] **3.6 Activity Reports (`ActivityReports.tsx`):** Aggregated day/run summaries & CSV exports.
- [ ] **3.7 Desk switch integration (`ActivityDesk.tsx`):** Compose vs. Activity header switch.
- [ ] **3.8 Styling (`outreach-activity.css`):** Scoped CSS tokens and responsive layout.
- [ ] **3.9 Phase 3 Gate:** Full Activity desk visual screenshots & verification.

### Phase 4 — Data, validation and exceptions
- [ ] **4.1 Dynamic fields & fallbacks:** Support all spreadsheet columns (`{field|fallback}`) without dropping rows.
- [ ] **4.2 In-app address verification:** DNS MX/A validation, role-mailbox, and disposable domain tagging.
- [ ] **4.3 Bulk approval:** Single-click approval for deliverable contacts.
- [ ] **4.4 Per-message verification & "Needs you":** Granular error detection & human exception queue.
- [ ] **4.5 Phase 4 Gate:** Verified address import & exceptions workflow.

### Phase 5 — Personalisation
- [ ] **5.1 Segment & version data model:** Audience sector/purpose variants.
- [ ] **5.2 Versions by sector UI (`SegmentsDialog.tsx`):** Sector-tailored AI drafts with approval gates.
- [ ] **5.3 Subject variants:** Rotating subject lines.
- [ ] **5.4 VIP openers:** Guarded 1–2 sentence personal introductions.
- [ ] **5.5 AI second reading:** Review & send pre-flight checks.
- [ ] **5.6 Phase 5 Gate:** Segmented draft & opener verification.

### Phase 6 — AI Assistant
- [ ] **6.1 Command registry (`commands.ts`):** Structured typed command surface.
- [ ] **6.2 AI Operator (`operator.ts`):** Natural language intent mapping with autonomy levels (`suggest`, `confirm`, `auto-safe`).
- [ ] **6.3 Assistant dialog (`AssistantDialog.tsx`):** Chat/action command panel.
- [ ] **6.4 Opt-in reply classification (`replyAi.ts`):** Privacy-conscious reply sorting.
- [ ] **6.5 Phase 6 Gate:** Assistant autonomy & security audit.

### Phase 7 — Hardening and handover
- [ ] **7.1 Soak testing:** 5,000-message dry run.
- [ ] **7.2 Crash & recovery testing:** Process kill and auto-resume validation.
- [ ] **7.3 Final audit sweep:** Zero regression on 20-point contract.
- [ ] **7.4 Documentation:** CLAUDE.md and architecture guide updates.
- [ ] **7.5 Final Handover:** Verification report.

---

## Deviations & Notes
- `capture-baseline-shots.mjs` was created to automate capturing the 54 baseline screenshot matrix directly across 3 viewports (900×700, 1366×768, 1920×1080) in both light and dark themes, copying them directly to `Desktop/outreach-autopilot/baseline/` for visual verification.
- Pre-existing CSS census warning on App.css (6 undefined var names) noted in baseline metrics; our new code will introduce 0 undefined tokens.
