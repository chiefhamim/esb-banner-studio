# ESB PowerLine Studio — Repository Audit

Audited: 2026-10-22, read-only. Repository: `C:\Users\hamim\esb-banner-studio` (package `esb-banner-studio` v1.5.4, product name "ESB Studio").
Nothing in `src/`, `electron/`, `tools/` or `package.json` was modified. The only writes were this `docs/` folder and scratch files outside the repo (a test build into the session scratchpad, an Electron probe).

Labels used throughout: **[V]** verified by reading code or running something; **[I]** inference; **[U]** unknown / not verified; **[R]** recommendation.

---

## 1. Executive summary

* **The premise of the brief does not match the repo.** ESB Studio is a **single-window Electron 45 desktop app** (Vite 8 + React 19 + TypeScript 6 + Zustand 5) that runs fully offline from `dist/` over `file://`. There is **no web server, no backend, no database, no auth, no router, no API routes, no AI provider, no deployment target** other than the packaged `release-*/win-unpacked/ESB Studio.exe`. [V] (`package.json`, `electron/main.cjs`, `vite.config.ts` `base: './'`)
* **What exists is a very good, pixel-verified fixed-template banner editor**, not a general design tool: six formats, ten categories, template builders (`src/core/templates.ts`) that turn a `Content` object into a `Scene`, a custom canvas renderer (`src/core/render.ts`), a DOM-overlay editor (`Stage.tsx`), undo/redo, layers, project files, multi-scale export. 167 UI checks, 6 date checks, golden pixel-diffs, Electron bridge checks all pass today. [V]
* **There is a small "newsroom" layer already** (`src/core/newsroom.ts`, URL importer in `Panels.tsx` `StoryPanel`): URL → regex HTML scrape → headline-only machine translation through a **third-party public endpoint (`api.mymemory.translated.net`)** → word-substitution "polish" → category guess → fixed Unsplash image suggestions. It works as a *banner-fill helper*, but it is **not an editorial pipeline** and has real security and editorial-integrity problems (§10).
* **Video, audio, timeline, media library: nothing exists.** No `<video>`/`<audio>` code, no Web Audio, no MediaRecorder, no WebCodecs usage anywhere in `src/`. [V] (grep)
* **Runtime feasibility is better than the brief assumes.** Probed inside the installed Electron 45 from a `file://` page: WebCodecs video/audio encode+decode, MediaRecorder (webm + mp4), `getUserMedia`, `OfflineAudioContext`, WASM and OffscreenCanvas are all available, with H.264, VP9, AV1, HEVC and AAC/Opus reported supported on this PC (§7). `SharedArrayBuffer` is **not** available (not cross-origin isolated), which rules out multithreaded ffmpeg.wasm without extra work.
* **No git repository.** `git status` → "not a git repository". 391 MB per `release-*` folder (nine of them), 147 MB `tools/out`. There is no version control safety net for a large refactor. [V]
* **Recommended path:** keep the app, add a workspace switcher around the existing editor, and add the new capabilities as *separate modules behind the Electron main process* (hardened fetch, secrets, file I/O) and *Web Workers in the renderer* (media). Do not introduce a server, database or framework migration.

---

## 2. Verified stack and architecture

| Layer | Fact | Evidence |
|---|---|---|
| Shell | Electron `^45.0.0` (installed 45.0.0), `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, native menu removed, single-instance lock | `electron/main.cjs` |
| Bridge | `electron/preload.cjs` exposes `window.esb`: `saveImage, pickFolder, reveal, saveProject, openProject, readProject, fetchUrl, fetchImageData, prepareDragFile, startDrag` | `electron/preload.cjs` |
| UI | React 19.3, Zustand 5, plain CSS (`src/App.css`, 104 KB, tokens in header), no component library, no router | `package.json`, `src/App.tsx` |
| Build | Vite 8, `tsc -b`, `oxlint`; `base:'./'`; `electron-builder --win dir` (unpacked folder, no installer, `asar: true`) | `vite.config.ts`, `package.json` |
| Language | TypeScript `~6.0.3`, `erasableSyntaxOnly`, `verbatimModuleSyntax`, `noUnusedLocals/Parameters` | `tsconfig.app.json` |
| Rendering | Hand-written Canvas 2D renderer, Figma-matched text metrics, bundled fonts (Inter 3.19, Space Grotesk, Source Serif 4, Oswald, Hind Siliguri for Bengali) | `src/core/*`, `src/assets/fonts` |
| State | One Zustand store (`src/store.ts`, 754 lines): `doc`, `format`, selection, history (`past/future`, limit 150), images | `src/store.ts` |
| Persistence | `localStorage` key `esb-banner-studio/doc/v1` (250 ms debounce) + IndexedDB `esb-banner-studio/idb` store `kv`, **one record `images` rewritten wholesale on every image-list change**; `.esb` JSON project files with images inlined as base64 data URLs; recents in `localStorage` | `store.ts` ~l.655-750, `project.ts` |
| Node-side | Main process: save/open dialogs, `fs.writeFileSync`, `fetch()` (Node/undici) for URL + image import, temp file for drag-out | `electron/main.cjs` |
| Tests | Playwright-core driving system Edge + Electron: `tools/e2e/ui-test.mjs`, `date-test.mjs`, `golden-test.mjs` (pixelmatch), `fuzz.mjs`, `electron-test.mjs`, `packaged-check.mjs`, `perf-ui.mjs`, `overflow-audit.mjs`, `audit-ui.mjs`. **No unit-test framework** (no vitest/jest in `node_modules`). **No CI.** | `package.json`, `tools/` |
| Auth / DB / API / AI | **None** | grep of `src/` and `electron/` |

Code size: `src/` ≈ 7,470 TS/TSX lines. Large files: `Stage.tsx` 1,177 · `Panels.tsx` 1,024 · `store.ts` 754 · `templates.ts` 594 · `App.tsx` 572 · `controls.tsx` 590.

`window.esb` is typed ad hoc in `src/export.ts` (l.~60-70), not in a shared declaration file. [V]

---

## 3. Existing functionality inventory

**Graphics (core strength)**
* Formats (`FORMAT_LIST`, `tokens.ts`): `fb45` 1080×1350 (default), `story` 1080×1920, `sq` 1080×1080, `social` 1598×1431 (classic Figma template), `web` 1920×1080, `yt` 1280×720. Two layout families: `stack` and `split`.
* 10 categories (`CATEGORIES`), per-category colours/icons; card types `standard | quote | stat`; label pills (`LABEL_PRESETS`: breaking, exclusive, special, analysis, opinion, trending, featured, developing, factcheck + custom); photo credit; link pill; headline highlight; headline watermark icon.
* Eleven collage presets (`collage.ts`), photo zoom/pan/backdrop/brightness/contrast/saturation/warmth/vignette (`PhotoSlot`).
* Editor: move/resize/rotate-less box editing, snapping, guides, rulers, multi-select, align/distribute, copy/paste, custom text/rect/image layers, layer order, per-element override reset, inline text editing, Elements panel (on/off per banner part), Layers panel, resizable panels, light/dark UI, keyboard shortcuts, tooltips.
* Export (`export.ts`, `ExportDialog.tsx`): PNG/JPG/WebP, scales 0.5–4×, name templates, ZIP (own writer `makeZip`), clipboard copy, drag-out file to other apps, pixel cap `MAX_PIXELS = 110e6`, preflight warnings, cancellation flag in `runExport`.
* Facebook preview window (phone / desktop / link post) using the same renderer.
* `.esb` project files + recent list (6).

**Newsroom helpers (`newsroom.ts`)**: `suggestHighlight`, `generatePlatformCaption` (facebook/linkedin/twitter/telegram; hard-coded `https://esbpowerline.com` link), `detectCategory` (regex, Bengali+English), `parseArticleHtml` (regex over raw HTML), `polishJournalisticEnglish`, `translateBengaliToEnglish` (MyMemory), `SECTOR_IMAGE_SUGGESTIONS` (static Unsplash URLs per category).

**Absent**: media library, video/audio import or playback, timeline, recording, waveform, captions/subtitles, speech, project hub/home, workspace navigation, backend jobs, AI provider settings, user accounts.

---

## 4. Working / partial / mocked / broken matrix

| Capability | Status | Evidence / note |
|---|---|---|
| Banner rendering vs Figma | **Working** | `golden-test.mjs`: `social-01` 292 px (0.013 %), `web-01` 988 px (0.048 %) — pass |
| Editor interactions, undo/redo, layers, export, projects | **Working** | `ui-test.mjs` 167 PASS "ALL PASS"; `date-test.mjs` 6 PASS; fuzz not re-run |
| Electron bridge / native save / filename sanitising | **Working** | `electron-test.mjs`: 7 PASS (isolated profile) |
| `.esb` project save/open | **Working** for banners | `project.ts`; images base64-inlined — fine for photos, unusable for video |
| URL import (`esb:fetch-url`) | **Partial** | Works against live pages when allowed; test (`ui-test.mjs` l.744+) **mocks `window.esb.fetchUrl`**; real fetch path has no timeout/size/SSRF checks; sites that block bots just fail with `HTTP nnn` |
| Bengali→English | **Partial, editorially weak** | Headline only; MyMemory MT; test asserts `Tk 592 crore` / `30 MMCFD Gas` **against the live public API** (mock covers only `fetchUrl`/`fetchImageData`) → test depends on a third-party service staying identical |
| "Polish" step | **Risky** | blind regex substitutions: `worth→for`, `government→Govt`, `Digging→Drilling`, `Rs→Tk`, `million cubic feet→MMCFD` (units rewritten without context) |
| Category detection | **Partial** | keyword regexes; defaults to `'01'` when nothing matches (`parseArticleHtml`) — silently mis-files |
| Sector photo suggestions | **Partial / provenance risk** | Hard-coded `images.unsplash.com` photo IDs, not tied to the story; licence/credit not recorded; availability unverified [U] |
| Platform captions | **Working**, template strings | always links `esbpowerline.com`, not the article URL |
| Article body extraction, claim/entity extraction, source attribution, fact check | **Missing** | |
| Video / audio / timeline / recording / captions | **Missing** | |
| Workspace navigation / project hub | **Missing** | single editor view |
| Lint | **0 errors, 45 warnings** (`npx oxlint`): mostly `react-hooks/exhaustive-deps`, React-Compiler `refs`/`purity` in `Stage.tsx` | |
| Type check | **Pass** (`tsc -b` exit 0) | |
| Production build | **Pass** (`vite build --outDir <scratch>`; JS 458 kB / 144 kB gz, CSS 84 kB) — built to scratch so the live `dist/` was untouched | |
| `npm run build` as-is | Not run (would overwrite `dist/`, which the packaged app loads) | |

Mocked-as-finished UI: none found. The bridge mocks exist only inside tests.

---

## 5. Reusable components and key paths

| Path | Reuse |
|---|---|
| `src/core/render.ts` (`renderScene`, `renderToCanvas`, `drawElement`) | Canvas renderer → also the compositor for video title/lower-third overlays and thumbnails (render a `Scene` to `OffscreenCanvas`/`ImageBitmap` per frame or per overlay) |
| `src/core/templates.ts` (`buildScene`, `defaultDoc`, `headlineSize`), `tokens.ts` (`FORMAT_LIST`) | Template engine; add formats (lower third, title card, end card, quote/stat already exist as `cardType`) as data |
| `src/core/types.ts` (`El`, `Scene`, `Doc`, `Override`) | Serialisable element model — keep, extend additively only |
| `src/export.ts` (`renderBanner`, `runExport`, `makeZip`) | Export queue pattern, progress + cancel signal |
| `src/store.ts` `record/undo/redo`, `edit()` pattern | Copy the history pattern for other workspaces; do not widen the banner `Doc` |
| `src/ui/controls.tsx`, `layout.tsx` (Splitter), `Icon.tsx`, `App.css` tokens | The "Quiet Studio" design system: 4 px grid, type 11/12/13/15/18, heights 28/32/36, radii 4/8/12/16, neutral ink accent |
| `src/core/newsroom.ts` `TAGS`, `LABEL_PRESETS`, `detectCategory` | Keep data; replace scraping/translation logic |
| `electron/main.cjs` IPC handlers | Pattern for new handlers (must add validation — §10) |
| `tools/*.mjs` | Test harness patterns (isolated `--user-data-dir`, Playwright-driven Electron) |
| `src/assets/images/esb-logo.png`, `esb-avatar.png`, `build/icon.*` | **Protected brand artwork** — see §10 |

---

## 6. UI / design-system assessment

* Strong, deliberate, already "non-AI-SaaS": neutral graphite + ink accent, Inter only in UI, hairline panels, resizable splitters, dense toolbars. User explicitly disliked a generic blue/AI look in an earlier pass and approved the current direction (memory: v1.5.0 "Quiet Studio"). **Preserve unchanged.**
* Accessibility: only ~46 `aria-`/`role=` occurrences across components; `ExportDialog.tsx` has 0. Keyboard shortcuts are rich; screen-reader semantics are thin. Canvas-based editor is inherently limited. [V count / I conclusion]
* Responsive: desktop-only (`minWidth 1100`, `minHeight 680` in `BrowserWindow`). No mobile/tablet target. Not a defect for an Electron app; do not add one.
* Monolith risk: `Stage.tsx` and `Panels.tsx` are each >1,000 lines with many `localStorage` reads inline; adding three more workspaces in the same files would be unmanageable → new workspaces get their own folders.
* The 45 lint warnings include React-Compiler "refs during render" in `Stage.tsx` (l.947, 1110, 1135). They are existing debt; do not "fix" them as a side effect of feature work (the Stage is perf-tuned and pixel-tested).

---

## 7. Media-processing feasibility

Probe: a throw-away Electron main script run with `node_modules/electron/cli.js`, isolated `userData`, loading a local `file://` page (the same origin type the packaged app uses). First attempt via a `data:` URL wrongly reported WebCodecs/`mediaDevices` as missing because `data:` is not a secure context — re-run from `file://` is the valid result. [V]

| Capability (Electron 45.0.0, this PC: 12 cores, 32 GB) | Result |
|---|---|
| `isSecureContext` on `file://` | true |
| `VideoEncoder.isConfigSupported` 1280×720 | `avc1.42001f` ✔ `avc1.640028` ✔ `vp09.00.10.08` ✔ `vp8` ✔ `av01.0.04M.08` ✔ `hev1.1.6.L93.B0` ✔ |
| `VideoDecoder` | avc1 ✔ vp9 ✔ hevc ✔ av1 ✔ |
| `AudioEncoder` | `mp4a.40.2` ✔ `opus` ✔ |
| `MediaRecorder.isTypeSupported` | webm vp9/vp8+opus ✔; mp4 avc1+aac ✔; audio/webm opus ✔; audio/mp4 ✔; audio/ogg opus ✘ |
| `canPlayType` | mp4 H.264/AAC, HEVC, VP9, VP8, AV1, mp3, m4a, opus: "probably" |
| `navigator.mediaDevices`, `AudioContext`, `OfflineAudioContext`, `OffscreenCanvas`, `canvas.captureStream`, `showSaveFilePicker`, WASM | present |
| `crossOriginIsolated` / `SharedArrayBuffer` | **false / undefined** |

Caveats [I/U]:
* Encoder support was measured on the home PC only. Hardware vs software encode paths differ by GPU/driver; the office PC (`esbpl`, RTX 3060 per memory) and any other target must be probed at runtime — **never hard-code a codec**.
* HEVC/AAC availability inside Electron depends on the bundled `ffmpeg.dll` (present in `node_modules/electron/dist`); patent/licensing implications for *distributing* H.264/AAC encoders are a business question, not verified here. [U]
* WebCodecs provides encode/decode of **frames/chunks only**. It does not demux/mux containers. A container library is required (see below).
* A native `ffmpeg.exe` **is on this PC's PATH** (winget `Gyan.FFmpeg` 9.0.2 "full_build" → GPL). It is a user install, not part of the repo; the app cannot rely on it, and redistributing a GPL build inside the product has licence consequences. `ffmpeg-static` on npm is GPL-3.0-or-later. [V for presence/licence strings, U for legal advice]
* `ffmpeg.wasm` (`@ffmpeg/ffmpeg` 0.12.15, MIT wrapper): multithreaded core needs `SharedArrayBuffer` → needs COOP/COEP; in Electron `file://` that means a custom protocol with response headers. Single-thread core is slow. **Rejected as primary.**
* Candidate container libraries checked on npm today: `mediabunny` 1.62.0 (**MPL-2.0**, demux+mux+WebCodecs glue, updated 2026-10-20), `mp4-muxer` 5.2.2 (MIT, mux only), `webm-muxer` 5.1.4 (MIT). Versions/licences from `npm view`; API fit **not** verified. [R: Gemini must install nothing until a spike proves it]

**Recommended pipeline [R]:** decode with `<video>`/WebCodecs for preview and `VideoDecoder`+demuxer for export; composite each output frame on `OffscreenCanvas` in a Worker using the *existing* `renderScene` for overlays; encode with `VideoEncoder`/`AudioEncoder`; mux with a library chosen by spike; mix audio with `OfflineAudioContext`. Fallback if spike fails: main-process child process running a **bundled, LGPL-licensed** ffmpeg with argument arrays (never a shell string), as an *optional* Phase-6 path.

Rejected: `MediaRecorder` real-time capture as the export engine (real-time only, drops frames under load, no frame-exact trims, variable GOP); server-side rendering (there is no server and the product is deliberately offline); WebCodecs-only without a muxer (cannot produce files).

---

## 8. Editorial workflow & source-ingestion assessment

* Ingestion today: `ipcMain.handle('esb:fetch-url')` → `fetch(u.href)` with a **spoofed Chrome User-Agent** + `ESBStudio/1.6` suffix, default redirect-following, no timeout, no size cap, no scheme or address check, whole body decoded as UTF-8 text (`res.text()` — wrong for non-UTF-8 pages). [V]
* Parsing: regex over HTML (`parseArticleHtml`), reading `og:title`, `og:image`, `og:description`, `article:published_time`, `<img>`, `<source srcset>`. Body text, author and publisher are **not** captured (`author?` exists in the type and is never set). Entity decoding is five hard-coded numeric entities. The publisher-suffix stripper is a hard-coded list of outlets (Bonik Barta, Daily Star, Prothom Alo, TBS …). [V]
* Translation: one HTTP GET to `api.mymemory.translated.net` per headline with the **source text in the URL** (third-party disclosure, rate/length limits unverified [U], quality is raw MT). Failure path silently returns the Bengali text. [V]
* Everything downstream treats the English headline as authoritative: it overwrites `content.headline`, `highlight`, `date`, `categoryId` and imports `og:image` into the banner **without recording source, author, credit or licence**. [V]
* There is no draft/source comparison, no claim list, no attribution field, no revision history, no checklist.
* The existing fixture (`ui-test.mjs`) is a Bonik Barta (Bengali) gas-field story — evidence the real use case is Bengali energy-sector news → English banners/posts.
* Sensible deterministic building blocks that need no AI: Bengali-digit → ASCII normalisation, number/date/currency/unit extraction from both source and draft and a diff, quote-mark extraction, proper-noun lists (BERC, PGCB, BPDB, Petrobangla …, partly present in `TAGS`).

---

## 9. Storage, deployment, integration constraints

* Deployment = copy of an unpacked Windows folder; shortcut on the Desktop. No auto-update, no installer, no code signing (`signAndEditExecutable:false`). Users run the packaged app for real work and **their in-progress headline autosaves in the Electron profile** (`%APPDATA%\ESB Banner Studio`, deliberately kept after the rename — memory). Storage keys and project magic string `esb-banner-studio` must not change. [V/memory]
* `localStorage` ~5-10 MB quota class limits; a project with long video cannot live there. IndexedDB would hold blobs but the current single-key rewrite pattern does not scale.
* No network is required today; the product's identity is "offline, exact, local". Anything that calls out (translation, LLM, stock) must be **optional, visible, and off by default**.
* Windows-only packaging today; the app also runs from `npm run dev` in Edge for tests.
* Secrets: none stored today. If an LLM key is added, Electron `safeStorage` in the main process is the appropriate place; the renderer must never see it. [R]
* Disk: nine `release-*` folders ≈ 391 MB each, `tools/out` 147 MB (incl. a 36 MB export zip, demo mp4), `node_modules` 581 MB. Not part of any source of truth; do not touch.

---

## 10. Security & reliability findings

| # | Sev | Finding | Evidence |
|---|---|---|---|
| S1 | **High** | **SSRF-capable fetch**: `esb:fetch-url` and `esb:fetch-image-data` accept any renderer-supplied URL (http/https, localhost, LAN, `169.254.169.254`, redirects followed). Impact is bounded because the app is local and the renderer is sandboxed, but any XSS/untrusted-content bug turns the main process into a LAN scanner/proxy; and pasted URLs from untrusted sources can reach internal devices (the user's Pi/router at `192.168.0.x` are reachable). | `electron/main.cjs` l.109-137 |
| S2 | **High** | **Arbitrary file read/write by path from renderer**: `esb:read-project` reads any path string; `esb:save-image` with `dir` writes into any directory the renderer names; `esb:save-project` with `existingPath` overwrites any path. Filename is `basename`d, directory is not constrained. | `main.cjs` l.66-105 |
| S3 | Med | No Content-Security-Policy in `index.html` and no `session` permission handler; Electron's default grants permission requests (camera/mic/etc.) when no handler is set [I — confirm in Electron 45 docs before relying]. A mic feature must add an explicit allow-list handler for `media` only from the app's own origin. | `index.html`, `main.cjs` (grep) |
| S4 | Med | **Source text leaves the machine unannounced** to MyMemory in a GET URL. | `newsroom.ts` `translateBengaliToEnglish` |
| S5 | Med | Browser-UA spoofing to defeat bot blocking conflicts with the brief's "permitted mechanisms" rule. | `main.cjs` l.112-115 |
| S6 | Med | Image import ignores provenance: Unsplash suggestions and `og:image` flow into the banner with no credit/licence field. Risk is copyright and misattribution. | `Panels.tsx` `applyPhoto`, `SECTOR_IMAGE_SUGGESTIONS` |
| S7 | Med | Editorial: blind unit/word rewrites and silent fallback to untranslated text; category defaulting to `01`. | `polishJournalisticEnglish`, `parseArticleHtml` |
| S8 | Low | `esb:fetch-image-data` base64-encodes the whole body over IPC with no size cap. | `main.cjs` l.126 |
| S9 | Low | `prepare-drag-file` temp files in `%TEMP%\esb-studio-drag` never cleaned. | `main.cjs` l.139 |
| S10 | Low | IndexedDB images record rewritten in full on every image-list change; errors swallowed. | `store.ts` `persistImagesToIdb` |
| R1 | Med | **No version control, no CI, no unit tests**; test suite needs system Edge + Playwright; ui-test depends on live MyMemory. | repo root |
| R2 | Low | README documents up to v1.5 though package is 1.5.4; memory index is also behind the code (newsroom layer is newer than the notes). Treat code as truth. | README, `package.json` |
| R3 | Info | `dist/` was modified at 20:10 on the audit day — the user (or another session) is actively building. Expect concurrent edits. | file mtimes |

**Protected brand artwork:** `src/assets/images/esb-logo.png`, `esb-avatar.png`, `build/icon.png|ico`, `public/favicon.svg`; the banner's own template geometry is Figma-matched and golden-tested.

---

## 11. Testing baseline (observed 2026-10-22)

| Command | Result |
|---|---|
| `npx oxlint` | 0 errors, 45 warnings |
| `npx tsc -b` | exit 0 |
| `npx vite build --outDir <scratch>` | success, 132 ms; `index-*.js` 458.46 kB (gzip 144.10 kB), `index-*.css` 83.79 kB |
| `npm run test:golden` | exit 0 — `social-01` 292 px differ (0.013 %), `web-01` 988 px differ (0.048 %) |
| `npm run test:ui` | exit 0 — 167 PASS lines, "ALL PASS"; then `date-test.mjs` 6 PASS |
| `node tools/e2e/electron-test.mjs` | 7 PASS (isolated temp profile) |
| Not run | `tools/e2e/fuzz.mjs`, `tools/e2e/packaged-check.mjs`, `tools/audit/perf-ui.mjs`, `tools/audit/overflow-audit.mjs`, `npm run dist` |

The golden test currently exercises 2 cases (the memory notes describe 10 categories); coverage of the other categories by pixel diff is [U].

---

## 12. Architecture recommendations and rejected alternatives

**Recommended (smallest viable evolution):**
1. Keep Electron + Vite + React + Zustand. Add a thin **workspace shell** (`src/shell/`) with a left rail: Home · Editorial · Graphics · Video · Audio. The existing `App.tsx` editor becomes the Graphics workspace *unchanged* (mount it, don't edit it beyond the minimum to mount).
2. One new Zustand store **per workspace** (`editorial`, `media`, `timeline`) in their own folders. Do not widen `Doc` in `core/types.ts` except additively.
3. **Hardened main-process services** in `electron/` (split into modules): `net-guard` (URL/SSRF), `fs-scope` (path allow-list using user-picked roots), `secrets` (`safeStorage`), `media-io` (stream large files, never base64 whole videos over IPC). Register a `session` permission handler and a CSP.
4. **Project format v2**: a project *folder* (`project.json` + `media/` references by relative path/hash, relink on missing) because video cannot be base64-inlined. Keep reading v1 `.esb`.
5. **Media in Workers**: demux/decode/composite/encode in a Worker; progress via `postMessage`; cancellation via `AbortSignal`-style flag; frame-by-frame verification via `ffprobe`-free checks (decode the output again with WebCodecs and compare duration/dimensions).
6. **Editorial** is a pipeline of small pure functions (extract → normalise → claims/entities → draft → verify) with an optional LLM adapter. Offline mode produces the *review scaffolding* (source, numbers/dates/quotes table, checklist) without any AI.
7. Add a unit-test runner for pure modules (see master prompt: pick the lowest-friction option compatible with Vite — verify in `npm view` before installing).

**Rejected:** web-app rewrite (Next.js etc.); adding a server/DB; Redux/state-library swap; replacing the Canvas renderer with Konva/Fabric (earlier removed on purpose, pixel fidelity); `ffmpeg.wasm` as primary; MediaRecorder as the export engine; stock-footage or TTS services as a dependency; cloud rendering.

---

## 13. Prioritised roadmap (condensed; full detail in the master prompt)

* **Phase 0** safety net (snapshot/backup, git recommendation, baseline re-run, add `window.esb` typings, unit-test runner, lock current behaviour with characterisation tests).
* **Phase 1** security hardening of existing IPC + shell with workspaces + Graphics workspace unchanged + new formats as data (lower third, title card, end card, thumbnail variants) + project v2 scaffold.
* **Phase 2** Editorial Desk (hardened ingest, real body extraction, source panel, claim/number/date/quote diff, optional LLM adapter, provenance for images).
* **Phase 3** Media library + preview player + codec/limit detection + spike deciding mux/demux library.
* **Phase 4** Timeline + trim/split/export (video), recording + waveform + trim/gain/fades + mix (audio).
* **Phase 5** News-to-video assembly (storyboard → captions → branded sequence), presets.
* **Phase 6** optional services, performance, accessibility pass, installer.

Sequence differs from the brief in one respect: security hardening moves *before* any new feature (Phase 1), because three of the new features (URL ingest, file import, mic) widen the main-process attack surface.

---

## 14. Assumptions and unresolved questions

1. **Target = this Electron desktop app on Windows.** If the owner actually wants a hosted web product, this audit's architecture does not apply. [U — ask]
2. Which LLM/translation provider (if any), under what budget and data-handling rules? Source text is third-party content; the owner must consent to it leaving the PC. [U]
3. Is the Bengali→English output meant to be a *draft for a journalist* or an auto-published article? Brief says the former; the codebase has no publish path to the CMS (`esbpowerline.com`); memory records an unanswered earlier question about CMS login. [U]
4. Redistribution legality of H.264/AAC encoding and any bundled ffmpeg for a commercial product. [U]
5. Whether other machines (office PC, laptops) share the same codec/GPU support. [U]
6. Whether a git repo is wanted. Recommended; not created by this audit.
7. Hard minimum hardware / typical clip length and resolution the newsroom works with. [U] (affects memory limits and proxy-media decisions)
8. Licensing of the Unsplash suggestions and of every font/asset a new template might add.
9. MyMemory's real length/rate limits; not tested to avoid sending content out. [U]
10. Hardware vs software encoder behaviour per GPU. [U]
