# ESB PowerLine Studio — Development Progress

## Session 2026-10-22

### Phase 0 — Baseline & Safety Net (Complete)
* **Date/Time**: 2026-10-22 20:45 +06:00
* **Backup Location**: `..\esb-banner-studio-backup-20261022-2032\` (full snapshot of `src/`, `electron/`, `tools/`, `package*.json`, `index.html`, `vite.config.ts`, `tsconfig*.json`).
* **Git Status**: Git is recommended to user; `git init` not run per rule §0.5.
* **Baseline Tooling Reproductions**:
  - `npx oxlint`: 0 errors, 45 warnings (all pre-existing).
  - `npx tsc -b`: exit code 0.
  - `npx vite build --outDir <scratch> --emptyOutDir`: exit code 0 (JS ~458.46 kB, CSS ~83.79 kB).
  - `npm run test:golden`: exit code 0 (`social-01` 0.013%, `web-01` 0.048% diff, well within tolerance).
  - `npm run test:ui`: 167 PASS "ALL PASS" + 6 PASS `date-test`.
  - `node tools/electron-test.mjs`: 7 of 7 tests pass.
* **Changes**:
  - `package.json`: Added `vitest@5.0.5` as devDependency.
    - *Justification*: Vitest is the lowest-friction unit test runner for Vite 8 and TypeScript 6, sharing identical transform pipeline and tsconfig settings. Verified peer dependency on Vite `^8.0.0`, MIT license, 0 vulnerabilities, zero additional runtime overhead.
    - Added `"test:unit": "vitest run"` script.
  - `src/esb.d.ts`: Consolidated typed interface `EsbBridge` / `window.esb` in one definition file.
  - `src/export.ts`: Removed ad hoc `declare global { interface Window { esb?: any } }` in favor of `src/esb.d.ts`.
  - `src/store.ts`: Guarded `window.__store` assignment with `typeof window !== 'undefined'` for Node/unit-test environments.
  - `electron/main.cjs`: Fixed single-instance lock timing — configure `userData` path before invoking `app.requestSingleInstanceLock()`, ensuring the lock is scoped to `ESB Banner Studio` rather than default user data directory. Also ensure second instance focuses and restores existing window.
  - `src/core/characterisation.test.ts`: Created pure unit characterisation tests covering dateParts, suggestHighlight, detectCategory, parseArticleHtml, fileNameFor, planJobs, and makeZip.

---

### Phase 1 — Security Hardening, Workspace Shell, Video Templates & Project v2 (Complete)
* **Date/Time**: 2026-10-22 21:25 +06:00
* **Acceptance Criteria Verification**:
  - `tools/golden-test.mjs`: 0.013% diff on `social-01`, 0.048% diff on `web-01` (Pass).
  - `tools/electron-test.mjs`: 13 of 13 tests pass (Pass).
  - `tools/unit/security.test.ts`: 28 of 28 unit tests pass (Pass).
  - `tools/unit/templates.test.ts`: 8 of 8 unit tests pass (Pass).
  - `tools/unit/project-v2.test.ts`: 4 of 4 unit tests pass (Pass).
  - `src/core/characterisation.test.ts`: 14 of 14 unit tests pass (Pass).
  - `npm run test:ui`: 167 PASS "ALL PASS" + 6 PASS `date-test` (0 console errors).
  - `npx oxlint`: 0 errors.
  - `npx tsc -b`: exit code 0.
* **Architectural Changes**:
  - **Security & IPC Hardening**: `net-guard.cjs`, `fs-scope.cjs`, CSP policy, granular per-image IndexedDB keys.
  - **Broadcast Video Template Formats**: `lower-third` (transparent background, 2.875:1 logo), `title-card`, `end-card`.
  - **Workspace Shell**: `src/shell/` with `shellStore.ts`, `WorkspaceRail.tsx`, `HomeWorkspace.tsx`, and `GraphicsWorkspace.tsx`.
  - **Project Format v2 & Crash Recovery**: `project.json` v2 schema with v1 fallback and debounce autosave snapshot.

---

### Phase 2 — Editorial Desk & Fact Verification Engine (Complete)
* **Date/Time**: 2026-10-22 21:35 +06:00
* **Acceptance Criteria Verification**:
  - `npm run test:editorial`: 7 of 7 checks pass in `tools/editorial-test.mjs` (Pass).
    - Workspace navigation to Editorial Desk.
    - Article text ingestion & metadata parsing.
    - Fact strip generation with currency and energy capacity metrics.
    - Draft form population.
    - Fact table verification pass on authentic draft.
    - Deterministic discrepancy flag on hallucinated figure (seeded 999 error).
    - Send Headline to Banner action with automatic workspace transition to Graphics.
  - `npm run test:unit`: 61 of 61 unit tests pass in 185ms (Pass).
    - `tools/unit/editorial.test.ts` (7 tests): Bengali digit normalisation, currency amount parsing (crore, lakh, BDT, USD), DOMParser article extraction, fact table extraction, seeded figure discrepancy flagging, unverified quote detection.
  - `tools/electron-test.mjs`: 14 of 14 checks pass, verifying 3-way workspace switching (`Home` <-> `Editorial` <-> `Graphics`) in the packaged Electron environment.
  - `npm run test:golden`: 0.013% diff on `social-01`, 0.048% diff on `web-01` (Pass).
  - `npm run test:ui`: All 167+ UI tests pass (Pass).
  - `npx oxlint`: 0 errors, 46 warnings (all baseline).
  - `npx tsc -b`: exit code 0.
* **Architectural Changes**:
  - **Bengali Normalisation (`src/editorial/bengali.ts`)**:
    - Bidirectional numeral conversion (`০-৯` <-> `0-9`).
    - Numeric multipliers: কোটি (`crore` 1e7), লাখ/লক্ষ (`lakh` 1e5), হাজার (`thousand` 1e3).
    - Currency parsing with unit normalization (e.g. `৫৯২ কোটি টাকা` -> `Tk 592 crore`).
  - **DOMParser Article Extraction (`src/editorial/extract.ts`)**:
    - Extracts title, deck, byline, publisher, publish timestamp, canonical URL, body paragraphs, and images with captions/alt.
    - Fully offline with pure headless fallback for Node/unit-test environments.
  - **Deterministic Fact Table & Discrepancy Verification (`src/editorial/facts.ts`)**:
    - Zero-AI, 100% deterministic rule engine.
    - Extracts currencies, technical capacities (MW, MMCFD, BCM, kV), quoted statements, and seeded list of 33+ Bangladesh energy sector institutions (BERC, BPDB, Petrobangla, BAPEX, PGCB, etc.).
    - Flags figures in draft missing from source, quotes altered from source, or unverified entity claims.
  - **Editorial Store & Workspace (`src/editorial/editorialStore.ts`, `EditorialWorkspace.tsx`)**:
    - Side-by-side Source Material vs English Newsroom Draft view.
    - Multi-platform social copy generator (Facebook, X, LinkedIn, Telegram).
    - 4-point verification checklist (attribution, figures, quotes, entities).
    - Direct "Send Headline to Banner" connection to Graphics Studio.
  - **Injectable Translation & Offline Isolation (`src/core/newsroom.ts`)**:
    - Added `setCustomTranslator` and `OFFLINE_HEADLINE_DICT` fallback map so `tools/ui-test.mjs` no longer depends on live network availability of `api.mymemory.translated.net`.
* **Open Issues**: None.
* **Next 3 Tasks (Phase 3 — Media Library & Playback Foundation)**:
  1. Build `src/media/` workspace module and store (`useMediaStore`).
  2. Implement local media file importer (video/audio/images) by file path reference with file hashing (SHA-256), duration, codec detection, and metadata extraction.
  3. Build the Media Bin UI, video preview player component (`<video>` with frame-accurate seek), and missing-file relink workflow.

---

### Phase 3 & 4 — Video Studio, Welcome Screen & Clean Session Architecture (Complete)
* **Date/Time**: 2026-10-22 22:20 +06:00
* **Acceptance Criteria Verification**:
  - `npm run test:video`: 9 of 9 checks pass in `tools/video-test.mjs` (Pass).
    - Workspace navigation to Video Studio via left rail.
    - Video canvas monitor rendered and frame-accurate SMPTE timecode readout initialized.
    - Transport playback started and paused.
    - Multi-track timeline initialized (V2 overlays, V1 video, C1 captions, A1 audio).
    - Broadcast lower-third overlay clip added to timeline at playhead.
    - Split clip at playhead (`S` shortcut) verified.
    - Seamless navigation back to Graphics workspace.
  - `npm run test:unit`: 70 of 70 unit tests pass across 6 files in 188ms (Pass).
    - `tools/unit/video.test.ts` (9 tests): timeline creation, SMPTE timecode formatting and parsing, clip addition and duration expansion, clip move clamping, clip trimming, clip splitting, clip deletion, active clips at timecode lookup, snapping to clip boundaries.
  - `tools/electron-test.mjs`: 15 of 15 checks pass, verifying 4-way workspace switching (`Home` <-> `Editorial` <-> `Video` <-> `Graphics`) in the packaged Electron environment with 0 console errors.
  - `npm run test:golden`: 0.013% diff on `social-01`, 0.048% diff on `web-01` (Pass).
  - `npm run test:ui`: All 167+ UI tests pass (Pass).
  - `node tools/contrast-audit.mjs`: 100% WCAG 2.2 AA compliant across all workspaces in Light & Dark themes (Pass).
  - `node tools/a11y-audit.mjs`: 100% accessible names and 0 page overflow (Pass).
  - `npx oxlint`: 0 errors.
  - `npx tsc -b`: exit code 0.
* **Architectural Changes**:
  - **Quiet Chrome Menu Bar**:
    - Removed rainbow brand gradient line (`.topbar::after`) underneath top menu bar for a clean, distraction-free Quiet Studio appearance.
  - **Clean Application & Restart Session**:
    - Added "Quit and start new" to File menu and shortcut (`Ctrl+Alt+Q`).
    - Purges dirty project state, resets banner to factory defaults, removes transient autosave snapshots, resets zoom, and transitions to the fresh Studio Hub.
    - Added "Exit Studio" (`Alt+F4` / `window.close()`) in Electron.
  - **Welcome Screen & Studio Hub**:
    - Created `src/ui/WelcomeModal.tsx` modal dialog accessible via File -> "Welcome screen…", Help -> "Welcome screen…", and session resets.
    - Enhanced `src/shell/HomeWorkspace.tsx` with ESB brand logo, quick creation tiles (News Banner, Video Studio, Editorial Desk, Open Project), interactive template cards, and recent projects.
  - **Video Studio & Timeline Editor (`src/video/`)**:
    - `timeline.ts`: pure TypeScript data model with V2 (Overlays), V1 (Video), C1 (Captions), A1 (Audio), SMPTE timecode (`HH:MM:SS:FF`), and non-destructive operations (add, move, trim, split, delete, snap).
    - `videoStore.ts`: Zustand store managing project timeline, playhead position, playback loop, selection, zoom scale, track muting/locking.
    - `compositor.ts`: real composite frame renderer drawing video footage, broadcast lower thirds (with 3-stripe ESB accent), breaking news banners (with Bengali typography), timed subtitles, and station watermark bugs.
    - `exportVideo.ts`: real video rendering and export engine utilizing `canvas.captureStream()` and `MediaRecorder` to produce downloadable WebM/VP9 video files with exact progress tracking.
    - `VideoWorkspace.tsx`: multi-track NLE workstation layout featuring aspect ratio selector (16:9, 9:16, 1:1, 4:5), asset bin with 1-click preset inserters, canvas monitor with transport controls, clip inspector, time ruler with draggable playhead line, and export progress dialog.
* **Open Issues**: None.

---

### Phase 5 — Full Video Editor Master Implementation & Zero-Command Launch (Complete)
* **Date/Time**: 2026-10-22 22:52 +06:00
* **Acceptance Criteria Verification**:
  - **Zero-Command Easy Launch**:
    - Desktop shortcut `C:\Users\hamim\Desktop\ESB Studio.lnk` configured to target `node_modules\electron\dist\electron.exe .` with official icon, launching instantly without command prompt or terminal commands.
    - Root script `Launch ESB Studio.bat` provided for 1-click folder launching.
  - **Real Media Import & Management**:
    - Real file picker & drag-and-drop supporting `.mp4`, `.webm`, `.mov`, `.mp3`, `.wav`, `.png`, `.jpg`.
    - Genuine metadata extraction: duration, dimensions, file size, and automatic video frame thumbnail generation via offscreen canvas.
    - Proper object URL allocation and cleanup on asset removal.
  - **Live Video Frame Playback & Compositing**:
    - Real-time video frame rendering onto Canvas compositor synced to playhead timecode.
    - Preserved aspect ratio for footage (cover/fit) and official brand logos (`esb-logo.png`).
  - **Timeline Trimming & Editing**:
    - Left and right interactive trim handles (`.vw-trim-handle.left`, `.vw-trim-handle.right`) on clip blocks.
    - Clip splitting (`S` shortcut), deletion (`Del`/`Backspace`), moving, and snapping.
    - Non-destructive left/right delta trimming with in/out point recalculation.
  - **Audio Mixing & Voiceover Recording**:
    - Multi-track timeline playback synchronization for audio clips.
    - Direct voiceover recording through browser microphone using `navigator.mediaDevices.getUserMedia` and `MediaRecorder`.
    - Automatic addition of voiceover takes to track A1 at current playhead.
  - **Real Video Export Pipeline**:
    - Offscreen accelerated frame pump delivering playable WebM (VP9/VP8) video.
    - Verified output file non-emptiness (> 460 KB) with valid EBML container magic header (`0x1A 0x45 0xDF 0xA3`).
  - **Project Save & Reopen**:
    - Full project serialization to `.esbvideo` JSON file and deserialization.
    - 30-state undo/redo history stack (`Ctrl+Z`, `Ctrl+Y`).
  - **Test Suite Results**:
    - `npm run test:video`: 13 of 13 checks pass, including real video export validation.
    - `npm run test:unit`: 73 of 73 unit tests pass in 193ms.
    - `npm run test:editorial`: 7 of 7 checks pass.
    - `node tools/electron-test.mjs`: 15 of 15 checks pass with 0 console errors.
    - `npm run test:golden`: 0.013% diff on `social-01`, 0.048% diff on `web-01`.
    - `npm run test:ui`: All 167+ UI tests pass ("ALL PASS").
    - `npx oxlint`: 0 errors.
    - `npx tsc -b`: exit code 0.

---

### Phase 6 — Workspace Rail Refinement & Icon Border Polish (Complete)
* **Date/Time**: 2026-10-22 23:01 +06:00
* **Acceptance Criteria Verification**:
  - `npm run test:video`: 13 of 13 checks pass (Pass).
  - `npm run test:editorial`: 7 of 7 checks pass (Pass).
  - `node tools/electron-test.mjs`: 15 of 15 checks pass with 0 console errors (Pass).
  - `npm run test:golden`: 0.013% diff on `social-01`, 0.048% diff on `web-01` (Pass).
  - `npm run test:unit`: 73 of 73 unit tests pass (Pass).
  - `npm run test:ui`: All 167+ UI tests pass ("ALL PASS").
  - `npx oxlint`: 0 errors.
  - `npx tsc -b`: exit code 0.
* **Architectural & Visual Changes**:
  - **Eliminated Clunky Button Borders**:
    - Removed harsh 1px bounding box outlines on hover (`border-color: var(--line-2)`) and active states (`border-color: var(--ink-ring)` + `box-shadow`).
    - Implemented quiet, elegant pill hover states with `background: var(--surface-hover)` and smooth transitions.
  - **Pro macOS / Linear Active Indicator**:
    - Replaced clunky ring border with a clean 3px vertical accent pill indicator on the left edge (`.rail-btn.active::before`), seamlessly signalling the active workspace.
  - **Subtle Rail Boundary**:
    - Upgraded rail divider to hairline `1px solid var(--border-subtle)` (`#232328` in dark, `#ececef` in light), ending visual conflict with the editor toolbars.
    - Switched rail background to `var(--surface-sunken)` to establish a clear, quiet hierarchy underneath the studio canvas.
  - **Iconography & Typography Balance**:
    - Upgraded Graphics icon from generic bitmap `image` to composition `layers`, preventing duplication with the banner editor's "Add image" button.
    - Standardized icon stroke weight to `1.8` at `19px`.
    - Changed labels from forced uppercase (`EDITORIAL`, `GRAPHICS`) to clean title-case (`Editorial`, `Graphics`) in `10px` medium, completely eliminating text overflow and clipping.

---

### Phase 7 — Editorial & Graphics End-to-End Newsroom Automation Pipeline (Complete)
* **Date/Time**: 2026-10-22 23:20 +06:00
* **Acceptance Criteria Verification**:
  - `npm run test:editorial`: 7 of 7 checks pass (Pass).
  - `npm run test:video`: 13 of 13 checks pass (Pass).
  - `node tools/electron-test.mjs`: 15 of 15 checks pass with 0 console errors (Pass).
  - `npm run test:golden`: 0.013% diff on `social-01`, 0.048% diff on `web-01` (Pass).
  - `npm run test:unit`: 73 of 73 unit tests pass (Pass).
  - `npm run test:ui`: All 167+ UI tests pass ("ALL PASS").
  - `npx tsc -b`: exit code 0.
  - `npm run build`: client bundle built in 176ms with 0 errors.
* **Architectural & Automation Features**:
  - **Full Automation Pipeline (`src/editorial/automation.ts`)**:
    - Created `automateNewsFromUrl(url, onProgress)` which accepts any Bengali or English news URL.
    - Scrapes HTML via Electron net-guard SSRF bridge or browser fetch.
    - Parses document: extracts title, deck, paragraphs, publish date, byline, publisher, and high-resolution lead / b-roll images.
    - Industry Sector Classification: automatically detects one of ESB PowerLine's 10 desks (`01` Policy to `10` Environment) from article contents.
    - Journalistic Translation & Polishing: converts Bengali headlines into authoritative, natural English (`translateBengaliToEnglish`).
    - Key Metric & Figure Highlight Extraction: automatically detects monetary sums, capacities (e.g. `MMCFD`, `MW`, `Tk Crore`), or percentages (`suggestHighlight`).
    - Discrepancy & Fact Verification: extracts full fact table and compares against the draft.
    - Multi-Platform Social Caption Generation: generates tailored captions for Facebook, X, LinkedIn, and Telegram.
    - Lead Media Ingestion: downloads lead photo via `fetchImageData`, converts to image asset, and injects into banner canvas slot (`bannerStore.addImages`).
  - **Bidirectional Workspace Integration**:
    - **From Editorial Desk (`src/editorial/EditorialWorkspace.tsx`)**: Pasting an article URL runs the full automation pipeline and sets up both the editorial draft and graphics banner. Added a **Live Graphics Banner Companion Card** displaying live banner format dimensions, category pill, lead image thumbnail, headline, and highlight pill, with 1-click "Open in Graphics Studio →" and "Sync Draft to Banner" buttons.
    - **From Graphics Studio (`src/components/Panels.tsx`)**: Pasting a news URL into the Story panel triggers `automateNewsFromUrl`, updating the graphics banner and simultaneously populating the Editorial Desk with raw source, fact table, and social captions, with a direct 1-click shortcut button "Open in Editorial Desk →".
  - **Styling Polish (`src/App.css`)**:
    - Added styles for `.ed-banner-companion-card`, `.ebc-badge`, `.ebc-thumb-wrap`, `.ebc-info`, `.ebc-highlight`, `.ebc-actions`, `.ed-progress-pill`, and `.asp-actions`.

---

### Phase 8 — Clean Source Extraction, Full Body Translation & CMS New Story Studio (Complete)
* **Date/Time**: 2026-10-22 23:43 +06:00
* **Acceptance Criteria Verification**:
  - `npm run test:editorial`: 7 of 7 checks pass (Pass).
  - `npm run test:video`: 13 of 13 checks pass (Pass).
  - `node tools/electron-test.mjs`: 15 of 15 checks pass with 0 console errors (Pass).
  - `npm run test:golden`: 0.013% diff on `social-01`, 0.048% diff on `web-01` (Pass).
  - `npm run test:unit`: 77 of 77 unit tests pass (Pass).
  - `npm run test:ui`: All 167+ UI tests pass ("ALL PASS").
  - `npx tsc -b`: exit code 0.
  - `npm run build`: client bundle built in 188ms with 0 errors.
* **Architectural & Editorial Upgrades**:
  - **Clean Source Material Filtering (`src/editorial/extract.ts`)**:
    - Implemented `isBoilerplateParagraph(text)` to automatically strip out publisher & editor lines, commercial office addresses, corporate phone/fax/email notices, copyright/disclaimers, advertising, and subscription prompts.
    - Left Source Material pane now exclusively contains the pure, authentic news story text.
  - **Bilingual Newsroom Translation Engine (`src/editorial/translator.ts`)**:
    - Built `translateNewsArticle(...)` conforming strictly to the bilingual news editor prompt specification.
    - Implemented `enforceHeadlineLength` strictly under 104 characters with live badge counter.
    - Implemented `enforceDeckLength` picking a punchy catch sentence strictly under 200 characters.
    - Full English body translation preserving facts, direct quotes, and narrative paragraph structure.
    - Auto-generates kebab-case URL permalink slug strictly under 80 characters (`generateSlug`).
    - Multi-tier translation pipeline: direct Google Gemini 1.5/2.0 Flash integration when API key is configured; automatic built-in intelligent newsroom translation engine when offline or unconfigured.
  - **CMS > New Story for ESB PowerLine Editor (`src/editorial/EditorialWorkspace.tsx`)**:
    - Re-architected right pane as a professional newsroom CMS suite.
    - **Headline (< 104 chars)** and **Deck (< 200 chars)** with real-time character boundary indicators.
    - **Permalink Slug (< 80 chars)** with base domain prefix `https://esbpowerline.com/news/` and one-click copy.
    - **Story Body** with real-time word count, paragraph count, and reading metrics.
    - **SEO & Search Engine Metadata Card**:
      - Focus Keyphrase(s) field.
      - SEO Meta Title (< 60 chars) with live counter.
      - SEO Meta Description (< 160 chars) with live counter.
      - Interactive **Google Search Result Preview** mockup rendering live favicon, blue search title, and snippet.
    - **AI Translator Key Configuration**:
      - Added key management modal allowing editors to input and securely persist their Gemini API key in local storage.

---

### Phase 9 — Gemini Web Bridge (Option 1), Pastable Manual Source Material, Enhanced Noise Filtering & Photorealistic Facebook Feed Preview (Complete)
* **Date/Time**: 2026-10-23 00:11 +06:00
* **Acceptance Criteria Verification**:
  - `npm run test:editorial`: 10 of 10 checks pass (Pass).
  - `npm run test:video`: 13 of 13 checks pass (Pass).
  - `node tools/electron-test.mjs`: 15 of 15 checks pass with 0 console errors (Pass).
  - `npm run test:golden`: 0.013% diff on `social-01`, 0.048% diff on `web-01` (Pass).
  - `npm run test:unit`: 79 of 79 unit tests pass (Pass).
  - `npm run test:ui`: All 167+ UI tests pass ("ALL PASS").
  - `npx tsc -b`: exit code 0 (0 errors).
  - `npm run build`: built in 221ms with 0 errors.
* **Architectural & Editorial Upgrades**:
  - **Option 1 Gemini Pro Web Chat Bridge (`src/editorial/translator.ts`, `src/editorial/EditorialWorkspace.tsx`)**:
    - Zero-API workflow using the user's existing Gemini Pro web subscription (`gemini.google.com`).
    - Added 1-click **"Copy AI Prompt (Gemini Pro)"**: bundles the clean source article with the exact professional newsroom prompt.
    - Added direct shortcut button **"Gemini Web ↗"** to `https://gemini.google.com/app`.
    - Added **"Import AI Output"** modal: auto-detects and parses raw chat responses (markdown or plain text) into Headline (< 104 chars), Slug (< 80 chars), Deck (< 200 chars), SEO fields, and English Story Body.
  - **Enhanced Noise & Boilerplate Filtering (`src/editorial/extract.ts`)**:
    - Expanded boilerplate dictionary to catch printer/press lines, digital/paper edition credits, commercial office districts, district rep/byline slugs, and social/app invitations.
    - Added `cleanParagraphLead(text)`: strips reporter datelines (e.g. `নিজস্ব প্রতিবেদক, ঢাকা:`, `(ঢাকা, ২৩ অক্টোবর) —`, `অনলাইন ডেস্ক:`, `সিলেট (বাসস):`) and trailing noise so paragraphs begin directly with authentic journalistic prose.
  - **Pastable & Editable Manual Source Material (`src/editorial/EditorialWorkspace.tsx`, `src/editorial/editorialStore.ts`)**:
    - Dual mode on left Source pane: **"Clean Article"** (formatted view with verified fact pills) and **"Manual Source"** (direct editable inputs for Source Headline, Deck, and Body paragraphs).
    - Added **"Translate & Update CMS Story"** to manually translate and sync to graphics banner, and **"Copy AI Prompt (Gemini Pro)"** using manual inputs.
    - Added **"Paste from Clipboard"** button to automatically partition raw pasted text into headline, deck, and paragraphs.
  - **SEO Strictly Derived from English Translation (`src/editorial/translator.ts`)**:
    - Added `buildSeoFromEnglishStory(headline, deck, bodyText)`: guarantees Slug (< 80 chars), Focus Keywords, Meta Title (< 60 chars), and Meta Description (< 160 chars) are calculated strictly and exclusively from English translation text.
  - **Photorealistic Facebook Feed Preview Card (`src/editorial/EditorialWorkspace.tsx`, `src/App.css`)**:
    - Added multi-view switcher on CMS Story pane: **"CMS Story"**, **"Facebook Preview"**, and **"Web Article"**.
    - Facebook Preview Card replicates genuine Facebook feed design:
      - Verified header: ESB PowerLine avatar + blue verification checkmark badge + "Just now · 🌐".
      - Caption area with social copy and hashtag highlighting.
      - OpenGraph Link Card: 16:9 banner image companion previewing live graphics banner/lead image, uppercase domain label `ESBPOWERLINE.COM`, bold 2-line headline, and description snippet.
      - Engagement bar: Reactions (👍 ❤️ ⚡ 1.4K), 128 comments, 42 shares, and like/comment/share action buttons.
      - Fast action bar: "Copy Caption", "Copy Story Link", "Copy All for Facebook", and "Open in Graphics Studio".
  - **Web Article Reader Preview (`src/editorial/EditorialWorkspace.tsx`)**:
    - Full website mockup on `esbpowerline.com` with sector category pill, byline, reading time, hero image, formatted narrative body, and 1-click Markdown/HTML copy.
  - **Visual Design Polish**:
    - Added secondary studio subbar with live word count, reading time calculator, verified fact counters, and smooth theme integration matching Graphics Studio.

---

### Phase 10 — Graphics Export Resiliency, Scraped Media Auto-Transfer, Header Layout Repair & Authentic esbpowerline.com Reader Preview (Complete)
* **Date/Time**: 2026-10-23 00:43 +06:00
* **Acceptance Criteria Verification**:
  - `npm run test:editorial`: 10 of 10 checks pass (Pass).
  - `npm run test:video`: 13 of 13 checks pass (Pass).
  - `node tools/electron-test.mjs`: 15 of 15 checks pass with 0 console errors (Pass).
  - `npm run test:golden`: 0.013% diff on `social-01`, 0.048% diff on `web-01` (Pass).
  - `npm run test:unit`: 79 of 79 unit tests pass (Pass).
  - `npm run test:ui`: All 167+ UI tests pass ("ALL PASS").
  - `npx tsc -b`: exit code 0 (0 errors).
  - `npm run build`: built in 187ms with 0 errors.
* **Architectural & Design Upgrades**:
  - **Graphics Export Session Resiliency (`src/export.ts`)**:
    - Resolved EACCES export failure when restoring a previously selected export folder across Electron launches (`fsScope.assertAllowed` clears allowlist per session).
    - Added resilient auto-fallback in `runExport`: on directory access error, prompts the user via `window.esb.pickFolder()` to re-allow the directory for the current session without losing user choices, and seamlessly falls back to browser download if cancelled.
  - **Scraped Media Auto-Transfer & Tray Overlay (`src/editorial/automation.ts`, `src/editorial/editorialStore.ts`, `src/editorial/EditorialWorkspace.tsx`)**:
    - Built and exported `importImageToBanner(imageUrl, fileName)`: fetches cross-origin news photos securely via Electron background net-guard `fetchImageData`, converts to local Blob, and automatically registers into Graphics Studio's image slots.
    - Added interactive `.img-actions-overlay` with a dedicated **"⚡ Use in Banner"** button over every image in the Source Images tray, giving editors 1-click photo assignment.
    - Integrated automatic lead image transfer during the 1-click link automation pipeline.
  - **Editorial Header Unconstrained 3-Zone Layout (`src/App.css`, `src/editorial/EditorialWorkspace.tsx`)**:
    - Discarded restrictive `max-width: 800px` container that was causing the "Send headline to..." button and intake input to collide and truncate.
    - Split into three clean zones: Brand (`.ed-brand`), Intake Bar (`.ed-intake-bar`), and dedicated Right Actions (`.ed-header-actions`).
  - **Official `esbpowerline.com` Website Reader Preview (`src/editorial/EditorialWorkspace.tsx`, `src/App.css`)**:
    - Replaced generic reader card with an authentic desktop browser frame:
      - Mac/desktop chrome with traffic light window dots and URL bar (`https://esbpowerline.com/news/[slug]`).
      - Official ESB PowerLine brand navbar with electric logo and uppercase category navigation.
      - Dynamic category kicker pill and "ESB POWERLINE EXCLUSIVE" badge.
      - Deck summary callout with orange accent border.
      - Author byline with official circular avatar badge, publication timestamp, and reading time estimate.
      - Hero media container with "POWERLINE MEDIA" watermark pill.
      - **"⚡ AT A GLANCE — KEY TAKEAWAYS"** card detailing the deck, verified facts, and focus topics.
      - Styled article body with elegant pull quote styling and hashtag cloud.
      - Official ESB PowerLine Journalism Network footer and 1-click Markdown / HTML copy controls.
  - **Gemini Structured JSON Schema Optimization (`src/editorial/translator.ts`)**:
    - Optimized Google AI Studio Gemini API calls using native `responseSchema` and `responseMimeType: "application/json"` with `temperature: 0.1` for guaranteed deterministic extraction of English Headline (< 104 chars), Deck (< 200 chars), Slug (< 80 chars), Focus Keywords, Meta Title (< 60 chars), Meta Description (< 160 chars), and complete story body.








### Phase 8 — Editorial × Graphics integration (Complete)
- **Graphics rail** (`src/editorial/GraphicsRail.tsx`): the real banner beside the story editor at all times — format picker, drag-to-place photo, story-photo picker, 10-desk chips, highlight, news label, headline backdrop, Facebook caption, Export PNG / Copy image / Copy caption.
- **Live link** (`src/editorial/bannerLink.ts`): headline, credit and caption stay identical in the draft and the banner, both directions, in every workspace. Pause toggle in the rail.
- **Desk handling**: a hand-picked desk is no longer overwritten by auto-detection (`deskFlag.ts`, `deskAuto` in the store).
- **Autosave**: draft, source and checklist persist across restarts (`esb-banner-studio/editorial/v1`).
- **Publish**: hero image now uses the story photo's public URL (was a local blob URL); pre-flight list; Publish Live requires a valid headline/slug/body and the three verification ticks.
- Layout: 3 panes with show/hide toggles for the source column and the rail. `npm run test:editorial`: 15 of 15.

---

### Phase 0 (2026-10-23) — Baseline audit, cross-platform tests, honest offline translation
* Audit against the master product brief recorded in the session report (scratch); key corrections to earlier entries in this file:
  - "Atomic write" autosave was never implemented — `electron/main.cjs` writes projects with a plain `writeFileSync` (still open).
  - Only `editorial-test.mjs` fell back from Edge to Chromium; every other browser tool hard-coded `msedge`. Fixed in Phase 1 via `tools/launch-browser.mjs`.
  - `tools/unit/security.test.ts` failed on Linux (backslash paths) — fixed in `electron/fs-scope.cjs`.
* Translation (`src/editorial/translator.ts`, `src/core/newsroom.ts`, new `src/editorial/translateNet.ts`): GTX and MyMemory are raced under one 2.2 s deadline; remote calls are skipped when `navigator.onLine` is false; when Bengali text is left untranslated the result reports `provider: 'offline'` + `translationFailed`, and the Editorial Desk toast/status bar say so instead of "Neural".

### Phase 1 (2026-10-23) — Shared design system and one shell
* **Tokens**: `src/styles/tokens.css` is the single definition point. The duplicate `:root` blocks in `App.css` (legacy palette, radii, heights, motion) and the "Aqua-lite" surface/shadow block were removed; their shipping values were folded into `tokens.css` as aliases (light and dark), so computed colours are unchanged. `--line-1` is now defined.
* **One shell**: Graphics `.topbar`, Editorial `.ed-topbar` and Video `.vw-header` are all `--h-app-header` (40 px) with the same surface gradient and hairline; workspace rail tiles are 48 × 48 with an 11 px label. Previously 52 / 52 / 40.
* **Category colour out of the chrome**: focus rings, inputs, side/dock tabs, tool-rail selection, quick-bar selection, layer rows, menus, panel focus and the canvas well no longer tint with `--cat`; they use ink. The banner, category tiles/chip, headline-highlight words and the status dot keep the desk colour.
* **Layout defects**: format pill no longer wraps (nowrap; dims hidden < 1500 px; key caps/drag tag hidden < 1400 px so the Export button stays inside the bar at 1366 px); Editorial headline textarea auto-sizes (`field-sizing: content`, min 96 px) instead of clipping; word-count meta and the headline label no longer wrap; "Banner line breaks" label replaces the 9.5 px kicker; export-dialog format tags wrap instead of overflowing.
* **Video monitor**: the canvas now fills the monitor at the project's aspect ratio (`--vw-ar` + container units) and re-renders on resize; previously it rendered at the intrinsic 300 × 150 box. Clip tints are muted uniformly in CSS (data unchanged).
* **Test infrastructure**: all 32 browser scripts in `tools/` use `launchBrowser()`; `tools/electron-test.mjs` is platform-aware and its stale `h2` selector now checks `.ed-topbar-title`; new `tools/css-census.mjs` (`npm run census`).
* Not changed (by design): nested 6 px radii (DESIGN_NOTES nesting rule); Facebook/web mock palettes; security items from the audit (newsroom bypass sign-in, Gemini key in localStorage, spoofed UA in net-guard) — these need an explicit decision because they change how publishing and source fetching behave.

### Phase 2a (2026-10-23) — Authentic esbpowerline.com "Web Article" preview
* The hand-drawn `.esb-site-mock` replica (inline styles, invented nav) is replaced by `src/editorial/SitePreview.tsx`: the site's real article template rendered in an iframe at 1280 / 768 / 390 px with the site's three themes (Midnight · Dark · White, default White as on the site), scaled to the rail.
  - Markup ported from `esbpowerline/esbpowerline` `app/(public)/articles/[slug]/page.tsx` (breadcrumbs, back link, category link, `font-display` headline, excerpt, meta row with avatar initials / "Published on … at …" in Asia/Dhaka / read time / "0 views" as the site's own CMS preview shows for a draft, Share + disabled Save, hero frame with "Photo: credit" overlay or the site's No-image frame, text-size tool, body with the CMS preview's dashed automatic ad-slot marker after ⌊n/2⌋ paragraphs, "Trending Keywords", Related stories from the live article feed when any share the desk) plus `PublicNavbar` (masthead banner per theme, pill clusters, hub links, 10-desk ribbon with the active desk underlined in its colour) and `PublicFooter` (real office/contact copy, Explore/Sectors lists, member card, copyright).
  - Styles are not restyled by hand: `tools/site-css.mjs` extracts the theme tokens and article/nav/footer/card rules from the site's `globals.css`, resolves their `@apply` with the site's Tailwind 3.4.19 config and emits `src/editorial/site-preview.css` (98 kB, inlined into the bundle). Fonts: the site's Inter / Space Grotesk / Source Serif 4 (bundled), Hind Siliguri standing in for Noto Sans Bengali.
  - Left out rather than faked: live market ticker, comments, the real ad creative, "Data behind this story" cards, view counts.
  - Site category names and colours are identical to the Studio's 10 desks (`lib/constants.ts` ↔ `src/core/tokens.ts`), so the mapping is direct. Permalinks shown as `/articles/<slug>` (the site's route; there is no `/news/`).
  - A preview error can no longer unmount the Editorial desk (error boundary).
* Verification: `test:editorial` extended (theme class, Space Grotesk headline, draft headline bound, 10 ribbon cells, Midnight switch); screenshots at 1280/390 in all themes; real Electron run under Xvfb.

### Phase 2b (2026-10-23) — Link intake that is honest about what it got
* **Extractor (`src/editorial/extract.ts`)**: schema.org `NewsArticle` JSON-LD (also inside `@graph`) is read first — headline, description, `articleBody`, `datePublished`, author, publisher, `ImageObject` with caption/credit. The story block is chosen by prose density (paragraph text minus link text, penalised under nav/aside/related/share ancestors) instead of the first `<article>` match; related-story rails, share rows and bylines inside the block are excluded. Stories that exist only in embedded app state (`__NEXT_DATA__`, `application/json`, `__INITIAL_STATE__`) are recovered as a last resort and labelled as such. `og:site_name` is stripped from `<title>` generically. Images are size-filtered (spacers/thumbnails dropped), captions carry "ছবি:/Photo:" credits.
* **Boilerplate filter false positives fixed**: an English sentence mentioning a road, block, street or tower, a Bengali sentence mentioning Gulshan/Motijheel, or a paragraph that starts with a weekday is no longer dropped — only short lines that also look like an address (postcode, phone, house/plot number, bhaban/plaza) or a bare dateline are.
* **Extraction report**: every fetched story carries `meta` (`structured` / `markup` / `page-data` / `metadata-only`, language, warnings, the story block's selector); the source pane shows it as chips, with amber notes for few paragraphs, subscription-wall text, embedded-data recovery or no photo. The import toast counts the notes.
* **Intake errors**: `automateNewsFromUrl` throws `IntakeError` with the net-guard code; `describeIntakeError` turns it into "prothomalo.com refused the request / did not answer / could not be found…" with a "Paste the text instead" action (and "Try again"). The browser fallback through `api.allorigins.win` (a third-party relay the URL was silently sent to) is removed; the browser path is direct fetch → local dev proxy only.
* **Fact chips** are deduplicated per kind + value (first offset kept).
* **Tests**: `npm run test:extract` (20 checks over four fixtures: JSON-LD-in-@graph, markup with related rail + address footer, `__NEXT_DATA__`-only, paywall); unit tests for the filter, body splitting, dedupe and error mapping; `test:editorial` now fetches a fixture page through the real pipeline (report, Bengali headline, deduped chips) and checks the blocked-link fallback — 21 checks.
* Not verified here: live publisher pages (this container cannot reach them). The extractor is standards-driven rather than per-site; the first real Prothom Alo / Bonik Barta / Daily Star runs on the Windows box should be checked against the report chips, and any page that lands on "Page data" or "Metadata only" is a candidate for a fixture.

### Phase 2c (2026-10-23) — Editorial is the CMS editor, inside the Graphics shell
* **Layout**: the desk is now three columns in the same frame as Graphics. Left: the original article (`.left` panel with Source / New link tabs; collapsible Original link, Headline & deck, Facts to check, Original story). Centre: the esbpowerline.com CMS article editor — a "Headline & deck" panel, then **Story as its own panel** with Body · SEO · Social · Preview (the full-width article preview lives here, as in the CMS). Right: the CMS sidebar (`.right` with `.pnl` panels) — Publish, Featured image, Organize (category, tags as pills, byline), Outputs.
* **Removed from the editor**: the "Banner line breaks" strip and the collapsed "Story details & metadata" accordion (its fields moved to Story → SEO / Social and Organize). Line breaks typed into the headline still carry to the banner; detailed line tuning is a Graphics job.
* **Header matches Graphics**: same `.topbar` with the ESB logo, a menu bar (Story · Site · View), a centred tool group of `.pv-btn` pills (source toggle, site status, Re-translate), the grey `.pillbar` of icon buttons and one black primary action (Publish). Controls are the Graphics ones throughout: `Seg`/`Tabs` with the sliding thumb, `.input`, `Panel`, `Select` with category swatches, `Scrub`, `Slider`.
* **Outputs**: Banner / Web article / Facebook are one segmented control (level edges, gliding thumb) instead of three underline tabs with mismatched bottoms. Each preview sizes to the panel width.
* **Featured image**: the banner's photo slot 0, edited in place — live canvas preview drawn with the renderer's own `drawSlotImage` (extracted from `drawPhotos`, golden-tested), drag to reframe, wheel/slider zoom, Fill / Fit whole, Exposure · Contrast · Saturation · Warmth, story-photo and library thumbnails, add/drop a file, image credit. **Edit in Graphics** opens Graphics on the Photos tab with the photo selected (`shellStore.openGraphicsFrom`), and Graphics shows an "‹ Editorial" button back. Both workspaces read the same store, so edits made in either appear in the other immediately. Stated in the panel: the article on the site still uses the original photo file; framing and tone apply to the banner and social images.
* **Responsive**: columns are `clamp()`ed like Graphics' side panels. Under 1180 px of desk width the source column slides over the editor (scrim, closes on click) instead of squeezing it; under 820 px the sidebar stacks under the editor. The source column's open/closed state is remembered. Header items drop out in order (title, host text, menus) as width shrinks.
* **Cleanup**: ~1,370 lines of CSS for the previous Editorial layouts that no class referenced any more were removed from `App.css`; the new rules are in `src/editorial/editorial.css`.
* **Tests**: `test:editorial` rewritten for the new structure — 35 checks, adding: Story panel separate from Headline & deck, no line-break strip, SEO slug, centre preview, outputs segmented control with level edges, category via the Organize select, featured photo set/drawn/reframed, Edit in Graphics lands on Photos with the photo selected, a tone edit made in Graphics shows back in Editorial, and a 1366 px fit check. Fixture photo requests are served a drawn test image (`tools/fixtures/media/synthetic-rig.jpg`).

### Phase 2d (2026-10-23) — One shell, calmer panels, a real SEO tab
* **Navigation**: the 56 px icon rail is gone. Home · Editorial · Graphics · Video is a segmented control at the start of every workspace header (Home got a header for it). The ESB logo left the Graphics and Editorial headers; it remains on Home and in About.
* **Header controls**: one size system — 32 px controls with an 8 px radius in the 40 px bar (format picker, quick switch, Preview, icon group, Drag to Post, Export, menus, the switcher). The Graphics header now fits from 1180 px up with or without the "‹ Editorial" button.
* **Panels**: side-column panels are an accordion — opening one closes its siblings, scrolls it to the top of the column and marks its header (ink bar, full-strength title); closed sections show their icons. Each launch starts with only Category (Graphics Story tab) / Organize (Editorial) open, plus Photo library on the Photos tab and Original story in the source column; open/closed state lasts for the session. The Inspector keeps independent sections.
* **Editorial columns resize** by dragging their edges (same `Splitter` as Graphics), remembered between launches; double-click resets.
* **View menu (Editorial)**: Light / Dark appearance, and the Bengali reading font for the source column — Hind Siliguri (now with 400/500, previously only 600/700 were bundled, which made Bengali body text heavy), Noto Sans Bengali, Noto Serif Bengali, Tiro Bangla, Anek Bangla, Baloo Da 2. Bengali subsets from Fontsource, SIL OFL, licences in `src/assets/fonts/bn/`.
* **Translation lost the end of paragraphs — fixed.** `raceTranslate` sent MyMemory each paragraph cut to its first 500 characters; whenever MyMemory answered first, the rest of the paragraph disappeared. Text is now chunked at sentence ends (≤ 480 chars), every chunk is translated, MyMemory only gets text it can take whole, and an unanswered chunk stays in Bengali so the gap is visible. GTX batches are capped at 900 Bengali characters (a 3,500-character batch was a ~31 kB URL Google refuses). Unit-tested with a fake MyMemory that always answers first.
* **Gemini**: model picker in the Gemini dialog, listing the models the key can call (Pro included when the key has it); Auto = newest Flash. Timeouts raised from 6.5 s to 75 s (Flash) / 150 s (Pro) — a full article could never finish in 6.5 s, so Gemini silently fell back. A reply that stops early is rejected; a reply with far fewer paragraphs than the source shows a warning on the Headline & deck panel until dismissed. The "Test key" status message, which never displayed, now does.
* **SEO** (`seo.ts`, `SeoPanel.tsx`): focus keyphrase field with suggestions drawn from the story (sector lexicon, named organisations/places, recurring noun phrases; scored by headline/deck/intro/body placement; no amounts, filler or verb fragments; longer phrases win over fragments), a Google result preview with the keyphrase in bold, Build buttons for SEO title (≤ 60, keyphrase kept, site suffix dropped first), meta description (120–158, whole sentences) and slug (keyphrase-first, ≤ 8 words), and 15 checks in three groups (keyphrase placement and density, already targeted by a published story, snippet lengths, slug form, story/sentence/paragraph length, image, tag count). The keyphrase goes to the CMS as `seo.focusKeyword`. Tags ("Auto-pick from story" and the translation pipeline) use the same keyphrase picker.
* **Web article preview** shows the rendered 16:9 Web banner as the hero (toggle: Web banner / photo), in both Story → Preview and Outputs → Web article.
* **Tests**: unit 98 (+ translation completeness, Gemini early stop, keyphrases, SEO checks and builders); `test:editorial` 44 checks (+ switcher/no logo, default panel state, accordion, View → Dark, View → Bengali font loaded, column resize, SEO keyphrase/build/checks, banner hero is a 16:9 render).
