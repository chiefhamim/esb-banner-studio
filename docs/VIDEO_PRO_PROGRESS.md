# Video Desk Pro: progress

Plan: `docs/VIDEO_PRO_PLAN.md`. One section per phase, newest last.

---

## Phase 0 — Make what exists honest and usable (2026-11-01, branch `video-pro`)

### What changed

**Footage sound.** Adding footage that has sound (read from the file's tracks with mediabunny at import) puts a V1 clip and a linked A1 clip (`linkId`) on the timeline. The pair moves, trims, splits and deletes together (`timeline.ts`: `linkedIds`, `moveClip`, `trimClipLeft/Right`, `splitClip`, `deleteClip`); the inspector shows volume, a "Sound on" switch and **Unlink**. Preview plays every audible audio clip (keyed by clip, honours clip and track mute); export mixes them. Trims stop at the end of the source file (`srcDuration`).

**Persistence (interim, before Phase 1's project folder).**
- Desktop: **Import media** opens main's own dialog (`esb:video-import`); a drop is resolved by the preload from the `File` object (`webUtils.getPathForFile`, page script cannot pass a path string). Approved paths live in `userData/video-media.json`; the renderer gets only `esb-media://m/<id>` URLs, served by main with byte ranges and CORS (`electron/video-media.cjs`, registered as a privileged scheme on the editor's session only; the CMS window's session cannot use it).
- `.esbvideo` projects (Save / Save as with Ctrl+S / Ctrl+Shift+S; dialog defaults to `Pictures/ESB Banners/Video`) keep each file's path, size and mtime; runtime URLs are never written. Open resolves the paths (`esb:video-resolve`); a missing file shows a warning row and **Relink** (`esb:video-relink`), and the export is refused until it is relinked. Opening a project in the dialog approves the media paths it lists (existing files with media extensions only).
- Story → video stills (rendered banner and photo) are written by main to `userData/video-stills/` (`esb:video-store-still`, image bytes checked) and become bin items, so a saved story video reopens with its pictures.
- Autosave every 10 s while there are unsaved changes (`projectIO.ts`): desktop → `userData/video-autosave/snap-*.json` (temp + rename, last 5, a damaged newest falls back to the previous); browser → localStorage. The empty desk shows a **Restore unsaved video** card (name, clip count, time) with Restore / Discard. Saving to a file clears the snapshots.
- Browser (dev server): imports are object URLs for the session; the bin says so.

**Compositor.** `layersAt()` returns every visual clip under the playhead in track order (footage, then overlays, then captions; a lower track first) with its opacity; overlapping V1 clips crossfade across the overlap. The timeline lane stacks overlapping clips in rows so both are visible and clickable.

**Overlays.** New renderers for `headline` (lower-half headline with a dark ramp, accent bar from the story category, optional kicker, up to 4 lines, Bangla in Hind Siliguri) and `card` (centred dark card, accent bar, title + text). Story → video uses `headline` when the banner cannot be rendered, with the category colour as accent. Lower third / breaking keep their look; the fake "সরাসরি" (live) label was removed from the breaking pill.

**Bin pictures.** **Add** puts a picture on V1 as a full-frame still with the slow move (Ken Burns); the layers icon adds it to V2 as an overlay.

**No invented content.** The demo timeline and all preset values are gone (no "Engr. Rezwanul Khan", "30 MMCFD", "16,500 MW"…). A new project is empty with a **Start a video** card (Import media / Build from story). Presets start with empty fields; their labels ("Speaker name", "Card title", "Caption text") are drawn dimmed in the editor only (`fieldText`, `editor: true`) and never exported — a title with nothing typed in is left out of the file and the export sheet says so. The REC dot is gone; the ESB bug is now the official logo on a white plate (the wordmark's black/green letters vanished on the old dark chip) sized off the frame's short side, with an on/off switch on the Overlays tab (`project.bug`).

**Footage transform.** Per clip: Fill / Fit, scale 10–400 %, position X/Y, crop on each edge (≤ 45 %), Reset frame (`footageRect()`; also applies to stills under their slow move).

**Export streams to disk.** Desktop: the place is chosen first (`esb:video-export-begin`), then mediabunny's `StreamTarget` writes 8 MB pieces through `esb:video-export-write` (id, position and size checked in main; appends at the end or patches inside what was written), written into `<name>.partial` and renamed only if it ends well and the header is MP4/WebM (`esb:video-export-end`). No 2 GB cap and no copy of the file in memory. Footage frames are decoded by mediabunny at exactly the export's frame times (`samplesAtTimestamps`, frame-exact; `<video>` seek fallback for sources it cannot decode); sound is decoded per clip and mixed in 10 s pieces interleaved with the picture. Browser keeps `BufferTarget` + download. The export runs to the end of the last clip (not the ruler length).

**Owner/lead UI fixes in this phase:** black thumbnails (wait for a decoded frame, retry once further in if still black); story cut without a photo labels its stills "Banner (no photo)" / "Close · banner"; the Story panel scrolls back to its headline after Build; **New** with an in-app confirm (shared `Dialog`) when there are unsaved changes; the view length follows the content (30 s ruler only when empty; every shown length uses `contentEnd`); the aspect picker shows "16:9" with the use in the hint, so it never cuts at 900 px; the inspector scrolls inside itself and the media list keeps ≥ 168 px; the media meta is one text line (footage picture size moved to the tooltip) and the bin's Add is an icon button, so the name and facts get the room; lanes run to the right edge; the bug is legible.

### Files
- New: `electron/video-media.cjs`, `src/video/media.ts`, `src/video/projectIO.ts`, `src/styles/video.css`, `tools/e2e/video-electron-test.mjs`, `tools/fixtures/video/make-fixtures.mjs`, `tools/fixtures/video/speech-6s.mp4` (synthetic: test pattern + Windows SAPI voice reading a neutral sentence, 340 KB), `tools/unit/video-main.test.ts`, `tools/unit/video-no-invented-content.test.ts`, this file.
- Changed: `src/video/{timeline,compositor,exportVideo,videoStore,VideoWorkspace,ExportSheet,StoryVideoPanel,storyVideo}.ts(x)`, `electron/main.cjs` (Video IPC + protocol), `electron/preload.cjs`, `index.html` (CSP: `esb-media:` in img/media/connect), `package.json` (`test:electron` also runs the Video suite), `tools/e2e/video-test.mjs`, `tools/audit/text-fit-audit.mjs` (Video states), `tools/unit/{video,video-export,story-video}.test.ts`, `CLAUDE.md` §7 (export engine + media notes).
- No new dependencies.

### Acceptance (measured 2026-11-01 on this PC)
| Test | Result | Measured |
|---|---|---|
| MP4 with speech exports with its sound | PASS (browser and desktop) | AAC stream; speech span −25.3 dB mean vs source −25.2 dB; silent lead-in −91 dB |
| Save, quit, relaunch, open: footage plays | PASS (desktop) | canvas readable, σ 130, 9 % of samples change after 1.2 s of play |
| Kill the renderer mid-edit → restore card with the last state | PASS (desktop, `forcefullyCrashRenderer` + reload) | card "“Edited after save” · 2 clips"; Restore brings back title and both clips |
| Two overlays at once both render (pixel check) | PASS | lower-third stripe and card accent in the same exported frame |
| 10-minute 1080p export holds RAM under 1.5 GB | PASS | peak 1,321 MB working set over all Electron processes (idle app before export 933 MB; renderer peak 677 MB, GPU 402 MB); 600.0 s file, 727 MB, AAC; rendered in 127 s. First run with mediabunny's default 64 MB URL cache: 1,428 MB — capped at 16 MB |
| `grep` finds no fabricated names or figures in `src/video` | PASS | `tools/unit/video-no-invented-content.test.ts` (old demo strings, honorific + name, number + energy unit in any string) |

Also checked: crossfade mid-overlap ≈ half red/half green; frame 29 red / 30 green (frame-exact); a title with nothing typed in leaves no pixel; fit + 50 % + offset lands where set; headline accent drawn; bug on/off; missing media blocks export; relink after a move; main refuses a bogus export id, unapproved paths, a project path outside scope, path strings posed as drops, unknown media ids and non-JSON snapshots.

### Checks
- `npm run lint`: 0 errors (warnings only, pre-existing kinds).
- `npm test`: 820 passed (73 files; baseline 780).
- `npm run build`: ok.
- `npm run test:video`: 35/35 PASS.
- `npm run test:electron`: 51 PASS, 0 FAIL (`electron-test.mjs` + `video-electron-test.mjs`); `VIDEO_LONG=1` run as above.
- `node tools/audit/text-fit-audit.mjs` (1280/1366/1600/1920; new Video states: start screen, every bin tab, overlay inspector with a long headline, media imported, footage and sound inspectors, story built, export sheet, New confirm): **0 text-fit problems**, 0 Video steps skipped. The first run found 3 `hidden` spans in the media meta line; it is one ellipsised text line now. Remaining Video ellipses are deliberate (long clip titles on the timeline, the status-bar selection, a long file name in the bin).
- Screenshots (uncommitted): `tools/out/video-phase0/` — empty, project with footage + overlays, footage inspector, empty card inspector, export sheet, New confirm; light/dark × 900/1920.

### Known gaps
- Preview playback still seeks the `<video>` element when it drifts > 0.08 s (stutter on long GOP sources); not measured this phase — Phase 1's decode engine replaces it.
- Overlapping clips on A1 sum without a fade; only V1 crossfades.
- The mediabunny decode path needs WebCodecs support for the codec (H.264/VP8/VP9/AV1/HEVC where the GPU has it); other sources use the slower `<video>` seek path in export.
- A project opened in the browser cannot find its media (no paths there); the desktop app is the persistence path.
- Media approval is per file path; Phase 1 moves media into the `.esbvideo` folder with `esb-media://<project>/<file>`.
- Visual tracks have no hide toggle (the mute button now shows on audio tracks only).
- Drag-moving or trimming a clip pushes one undo step per pointer move (as before).

### Next step
Phase 1: the `.esbvideo` project folder and a shared decode engine with a frame cache (the export already decodes with `samplesAtTimestamps`; the preview should use the same path), then proxies and the WebGL2 compositor.

---

## Phase 0 fix round (2026-11-01, branch `video-pro`)

Findings of the security, performance, UI and correctness reviews of commit 0f6a9fb. Each was re-checked against the
code (or a screenshot) before it was changed.

### Security
| ID | Status | What was done |
|---|---|---|
| S1 | fixed | `esb:video-open-project` approves nothing: a project's paths play only if already in the registry (projects saved by this app); the rest come back missing → Relink. `isMediaPath` refuses UNC and device paths (`\\server`, `//server`, `\\?\`, `\\.\`) everywhere (registry load, add, resolve, drops, relink). The open filter is `.esbvideo` only. Unit test + Electron test (a crafted project naming a file this app never imported and a network share: both missing, the file's id answers 404, the registry file is unchanged). |
| S2 | fixed | Stills and voiceover takes go through `storeGenerated`: content-hash names (the same bytes are one file), a cap per folder (stills 5,000 files / 4 GB, takes 2,000 / 8 GB); past it the write is refused and nothing older is deleted. The registry is capped at 20,000 (newest kept); its writes are debounced (one write per import burst, flushed at quit). |
| S3 | fixed | `MAX_EXPORT_BYTES` 256 GB → 50 GB, and `begin` refuses a drive with under 512 MB free. |
| S4 | fixed | esb-media sends `Access-Control-Allow-Origin` only for the app's own page (`file://` / `null` packaged, the dev server's origin), `Cross-Origin-Resource-Policy: same-site`, `Vary: Origin`. |
| S5 | fixed | Comments in `main.cjs` and `video-media.cjs` now say what is true: naming a path never grants a read; the renderer does see the paths of files the editor imported. |

### Performance / robustness
| ID | Status | What was done |
|---|---|---|
| P1 | fixed | Playback position comes from the wall clock (start time + start position; a seek moves the origin), in a `PlaybackEngine` with one effect on `playing`. `VideoWorkspace` subscribes with `useShallow` and never to `currentTime`; only the header timecode, transport time, playhead (moved by `transform`) and Split button follow it. The monitor draws outside React (store subscription → one rAF draw). Lanes and ruler are memoised; the keyboard is one listener; export progress reaches React at most 10 times a second. |
| P2 | fixed (minimal) | While playing, the active footage `<video>` plays; it and each sound are re-seeked only when they drift more than 0.25 s (or after a seek); the monitor no longer seeks during playback. Paused: exact-frame seek as before. The shared decode engine is Phase 1. |
| P3 | fixed | `beginGesture` / `endGesture`: a clip drag, a trim drag or a slider drag is one undo step (a gesture that changed nothing leaves none). Unit + browser tests (25 pointer moves = 1 step; a volume slider drag = 1 step). |
| P4 | fixed | Imports probe at most 4 files at once (`mapLimit`). Unit test. |
| P5 | fixed | A new, opened, restored or story-built project prunes every cached `<video>` and picture nothing uses (`pruneMediaCache`). Sound plays from one `<audio>` per source file (`preload=metadata`), released when no clip uses it. |
| P6 | fixed | `resolvePaths`, the protocol's stat, project open and every export write are async (`fs.promises`, `fs.write`); the size is claimed before the write, so overlapping pieces are still checked. |
| P7 | deferred → Phase 1 / 4 | Footage readers already close after their clip's last frame; audio readers stay open to the end (16 MB cache each) and the `decodeAudioData` fallback still reads a whole file. Phase 1's decode engine and Phase 4's audio graph replace both, so they are not reworked twice. |
| P8 | fixed | Main aborts the export (closes the file, removes `.partial`) on `render-process-gone` and on a main-frame navigation or reload (`abortActive`). Unit test + Electron test (reload mid-export → no `.partial`, no target). |
| P9 | fixed | `loadProjectText` drops an answer that arrives after a newer open; the thumbnail refresh stops when another project is put on the desk (`generation`). |
| P10 | fixed | The registry keeps the newest 20,000 entries (it kept the oldest). |
| P11 | fixed | Media elements are released with `removeAttribute('src'); load()`. |

**P1 measured** (`node tools/e2e/video-playback-measure.mjs`; dev server, headless Edge, 1366 × 768, 3 s of play, title and caption clips; "before" is commit 13ab8d1 run from a scratch worktree):

| Clips on the desk | Before: playhead after 3.0 s | After |
|---|---|---|
| 0 | 1.98 s (66 %) | 3.00 s (99.7 %) |
| 60 | 1.82 s (60 %) | 2.99 s (99.7 %) |
| 200 | 1.10 s (36 %) | 2.99 s (99.7 %) |

The playhead updates about 94 times a second after (90 before; headless has no vsync). The loss came from the loop's
effect restarting on every `currentTime` change and dropping the elapsed frame each time. `test:video` now asserts
3.0 ± 0.1 s with 0 and 60 clips.

### Correctness (fourth review)
| ID | Status | What was done |
|---|---|---|
| C1 | fixed | A voiceover take is written by main to `userData/video-takes` (`esb:video-store-take`: WebM/Ogg/WAV/M4A header checked, ≤ 512 MB, capped folder) and registered by path, so save/reopen and crash restore keep it. If main refuses, the take plays this session and the desk says it is not on disk. Unit test (bridge stub; the saved file keeps the path). |
| C2 | fixed | Removing a bin item hides it (`removed`) instead of deleting it: it is still saved while a clip uses it, a missing hidden item still shows in the bin with Relink, and the removal is an undo step (undo shows it again, redo hides it). Nothing is revoked on remove. The export blocker has a "Show missing files" button that opens Media. Unit tests. |
| C3 | fixed | Open asks first when there is unsaved work (like New; "Save first" saves, then continues). Snapshot file names carry a project tag; saving clears only that project's snapshots, so the replaced project's unsaved work stays restorable. Unit + browser tests. |
| C4 | fixed | `groupLocked`: an edit of a clip that is, or is linked to, a clip on a locked track is refused as a whole (move, trim, split, delete); the pair is never split up silently. Unlink first to edit one side. The inspector says so and disables Delete. Unit tests. |
| C5 | fixed | `end(ok)`: if the chosen file cannot be replaced, the finished render is renamed to a free name (`name (2).mp4`) and the sheet says so; it is never deleted. Unit test. |
| C6 | fixed | `saveProject` marks the project saved only if its revision did not move during the save (and only then clears its snapshots). Unit test. |
| C7 | fixed | Browser snapshots prune the oldest when storage is full and throw if even one does not fit; the status bar then says "autosave failed" (tooltip: why) instead of "autosaved". Unit test. |
| C8 | = P8 | |

### UI
Screens: `tools/out/video-phase0-fix/` (light/dark × 900/1366/1920). `tools/e2e/video-shots.mjs` now also covers the
restore card, the New confirm (after its open animation), missing media with Relink, a linked clip and an empty card;
`demo-default` was dropped (it is the `empty` start screen since Phase 0).

| ID | Status | What was done |
|---|---|---|
| U1 | fixed | The inspector left the bin. From 1180 px it is its own 296 px column right of the monitor (as Graphics' Inspector sits right of its artboard), scrolling by itself, and the bin keeps its full height. Below 1180 px it takes the bin's place in the left column (its close button or any tab goes back), because a third column would squeeze the monitor below use at 900 px. Transform fields are one per row. |
| U2 | not a bug | The washed-out dialog was captured mid-fade (the old shot script did not wait for the open animation). The harness now waits for `document.getAnimations()`; the `new-confirm` shots show a solid dialog. |
| U3 | fixed | The kicker had the class `card`, which picked up the global `.card` box. Tags use `data-tag` now. |
| U4 | fixed | Status notes clear after 4 s, a newer note replaces the old, and putting another project on the desk clears it. `loadProject` defaults to clean (opened = saved); restores and story builds pass `dirty: true`. A new empty desk reads "New video", not "Saved". |
| U5 | fixed | The draft choice ("First 10 s") appears only when the video is longer than 10 s; otherwise Length reads "0:08.0 · the whole video". |
| U6 | fixed | Export sheet: Cancel is a quiet ghost button; Export MP4 is the filled primary (weight 600). |
| U7 | fixed | An empty text card draws a dashed outline with "Text card / Type its title and text in the inspector", on the monitor only. Clip names keep 14 px clear of the trim grips and ellipsise. |
| U8 | fixed | The header and the transport both show the playhead as timecode (`00:00:02:15`); the header chip's tooltip says hours:minutes:seconds:frames. Durations and the ruler keep the short form. |
| U9 | fixed | Bin actions are 28 px boxes with a fill, in one right-aligned group (overlay · add · remove), so rows with 2 and 3 actions line up. |
| U10 | fixed | Position X / Y and the crops are full-width rows (crops under a "Crop" subhead). |
| U11 | fixed | A caption moves up above a lower third or breaking strap on screen at the same time (`captionLimit`), in the preview and the export alike. |
| U12 | fixed | Split is disabled unless there is a clip it can cut under the playhead (and it is not locked); Split / Delete are quiet `subtle` buttons. |
| U13 | fixed | No ESB bug on an empty timeline; the start card has more margin under 1100 px. |
| U14 | fixed | The "empty field" hint shows only while a field is empty. |
| U15 | fixed | One line above the overlay cards says titles start empty; the cards lost the repeated sentence and the separate name line; a fade at the foot of the bin shows there is more below. |
| U16 | fixed | Video sliders draw their filled part in `--text-2` over `--fill-active` (visible in dark). Audio and missing bin tiles show an icon. |
| U17 | fixed | The Story summary's two facts each stay on one line and wrap as a pair. |
| U18 | fixed | The browser-only note is one line with an icon under the bin list; it never shows in the desktop app (`hasDiskMedia()`). |

### Known gaps after this round
- Two clips of one file at different points share one `<video>` / `<audio>` element in the preview (the first active clip drives it). Phase 1's decode engine gives each clip its own reader.
- Text typed in the inspector is one undo step per keystroke (drags and sliders are gestures).
- P7, as above.

---

## Phase 1 — Part A: project folder, media IO, proxies (2026-11-01, branch `video-p1-io`)

Part B (decode engine, WebGL2 compositor, timeline v2, waveforms, filmstrips, preview) is built in parallel on its own branch; this part gives it the files.

### What changed
**Project folder.** Save (first time, or Save as) makes `<Pictures>/ESB Banners/Video/<name>.esbvideo/` in main's own dialog: `project.json`, `media/`, `proxies/`, `cache/`, `autosave/`, `renders/` (`electron/video-project.cjs`). `project.json` is schema v2 (`src/video/projectFolder.ts`): `format`, `version`, `savedAt`, `settings` (import mode, proxies on/off), `media[]` (storage `reference` or `copy`, path or `media/<name>`, size, mtime, quick hash, codec, fps, key-frame interval…) and `timeline` = exactly what `serializeVideoProject` writes minus its bin (Part B owns its shape and its migrations). Migrations run step by step (`MIGRATIONS[1]`: the Phase 0 single file → v2); a newer schema is refused, not half-read. A Phase 0 single-file `.esbvideo` still opens and saves in place; Ctrl+Shift+S turns it into a folder. Open takes a folder's `project.json` (Windows' file dialog cannot pick a folder and a file at once). Autosave of a folder project goes to its `autosave/` (temp + rename, last 5); the restore card offers the newest snapshot of userData and every known folder, and a restored snapshot knows its folder, so Save writes back without a dialog. Export suggests the folder's `renders/`.

**Import: link or copy.** With a folder open, the bin shows *On import: Link | Copy* (saved in settings). Copy is done by main (`.copying` + rename, the same file reused, another file of that name gets `name (2).ext`, free-space check). Copies are resolved through the folder the editor opened, so a moved project folder still plays its own media.

**Security.** The renderer names a folder only by an opaque id main handed out (created or opened in main's dialog; `userData/video-folders.json`, at most 200), and a file in it only as `<media|proxies|renders>/<name>`; every such path is resolved to its real location (junctions and symlinks followed) and refused unless it is still inside the folder's real location. `..`, `%2F`, data streams (`clip.mp4:x`), device names, trailing dots, UNC and device roots are refused; a `media/` junction to another folder is refused. `cache/` and `autosave/` are never served by the protocol. Relink search outside the project happens only next to a file this app imported before (the registry), so a crafted project cannot make main scan or approve anything else.

**Relink by hash.** Every file gets a quick hash in main (size + first/middle/last 64 KB). When files are missing on open, main looks in the project's `media/` and, for files this app imported before, their old folder and its sibling folders (one level, at most 40 folders and 20,000 entries, same size first, links not followed). The bin says "N files are missing. It was / N of M were found again" with **Relink all**.

**Background proxies.** Every bin entry's facts are read (`proxies.ts`: hash from main; codec and fps from packet stats, key-frame interval from key packets, metadata only). Footage over 1080p or with key frames more than 1 s apart gets a proxy: 540 px on the short side, H.264, a key frame every 0.5 s, sound kept, made by mediabunny's `Conversion` in a dedicated worker (`proxyWorker.ts`), streamed piece by piece to main (`esb:video-proxy-*`, `.partial` renamed when it checks out), one at a time, with progress and cancel, named `proxies/<hash>.mp4` (or the app's library `userData/video-library` before the project has a folder; 20 GB cap there). On open a finished proxy is found again at once; a half-made one is deleted and redone. Exports never read proxies.

**Contract for Part B (`src/video/media.ts`, JSDoc there).**
- `previewUrlFor(assetId: string): string` — the ready proxy's `esb-media://p/<folder>/proxies/<hash>.mp4`, else the original's URL ('' when missing).
- `exportUrlFor(assetId: string): string` — always the original ('' when missing).
- `onProxyReady(cb: (assetId: string) => void): () => void`.
- `readCache(key: string): Promise<Uint8Array | null>` and `writeCache(key: string, bytes: Uint8Array): Promise<void>` — the project's `cache/` (the library when there is no folder; memory in the browser); key `[a-z0-9-]{1,80}`, at most 32 MB each, 1 GB per folder; past the cap a write is refused (nothing evicted).
- `mediaInfo(assetId)` → `{ codec, fps, width, height, duration, hasAudio, sizeBytes, keyframeInterval, proxy: 'none' | 'pending' | 'ready' | 'failed', missing }`.
- Phase 0 exports unchanged (`inputFor`, `probeMedia`, `assetFromEntry`, `resolveAssets`, …).

**Bin UI** (`src/video/BinCard.tsx`, `src/styles/video-bin.css`, classes `vw-bin-*`; the row keeps `vw-media-*` for the tests): facts line (length · codec · fps · picture size · sound · file size; wraps rather than cuts), proxy badge (Proxy n % with a bar and stop · Proxy ✓ · Proxy failed → try again · Make proxy after a cancel), *In project* for copies, Not found / found again, Relink all.

### Files
- New: `electron/video-project.cjs`, `src/video/projectFolder.ts`, `src/video/proxies.ts`, `src/video/proxyWorker.ts`, `src/video/BinCard.tsx`, `src/styles/video-bin.css`, `tools/unit/video-project.test.ts`.
- Changed: `electron/video-media.cjs` (`esb-media://p/…` route; the snapshot tag reads `timeline.id`), `electron/main.cjs` and `electron/preload.cjs` (Video IPC only), `src/video/media.ts`, `src/video/projectIO.ts`, `tools/e2e/video-electron-test.mjs`, `tools/e2e/video-shots.mjs` (7 bin states), `tools/fixtures/video/make-fixtures.mjs` (`--4k`; the committed speech fixture is no longer remade when only `--4k` or `--long` is asked).
- Outside the listed scope: `src/video/VideoWorkspace.tsx` — the bin rows come from `BinCard` (the old `MediaCard` removed), imports pass the link/copy option and report refused files, Open passes the folder, a manual Relink resets the storage. No new dependencies.

### Measured (2026-11-01, this PC, `npm run test:electron`)
| Check | Result |
|---|---|
| 4K fixture (3840×2160, 30 fps, 4 s, 3 s GOP, 8.4 MB) → proxy | import → proxy ready 5.5–5.7 s; worker 4.4–4.9 s; 960×540 H.264, 8 key frames, max gap 0.500 s, 250 KB |
| mediaInfo of the fixture | avc, 30 fps, 3840×2160, key-frame interval 3 s (from packets), proxy ready |
| Preview vs export URL | `esb-media://p/<id>/proxies/<hash>.mp4` vs `esb-media://m/<id>` |
| Export reads the original | 1920×1080; centre-crop sharpness (mean abs Laplacian): export 2.79, original → 1080p 2.36, proxy → 1080p 1.06 |
| Restart | proxy deleted while closed → pending on open → cancel leaves no `.partial` → Make proxy → ready; proxy present → ready in 77–125 ms, not remade |
| Relink by hash | renamed file in the same folder found; Relink all → the footage plays |

### Checks
- `npm run lint`: 0 errors. `npm run build`: ok. `npm test`: 864 passed (75 files; +24 in `video-project.test.ts`: confinement incl. traversal, UNC, junction, ADS and device names, the protocol route, copy, quick hash, relink by hash, cache caps, proxy rules, v1 → v2 migration with the timeline unchanged, the v2 round trip, hostile records, a newer schema refused).
- `npm run test:video`: all PASS. `npm run test:electron`: 65 PASS, 0 FAIL (Phase 0 checks adapted to the folder: project.json, autosave in the folder, Relink all).
- Screens: `tools/out/p1-io/` (`bin-normal`, `bin-proxy-pending`, `bin-proxy-ready`, `bin-proxy-failed`, `bin-proxy-cancelled`, `bin-missing`, `bin-missing-found`; light/dark × 900/1366/1920), inspected.

### Known gaps
- The Phase 0 preview still plays `clip.sourceUrl` (the original): switching the monitor to `previewUrlFor` is Part B's engine.
- Save as into a new folder keeps media copied into the old folder as references (absolute path); they are not copied again.
- Relink search does not look next to the project folder itself, nor outside the project for a project from another PC (the registry is empty there): those use Relink by hand.
- One proxy is made at a time; a proxy made before the project has a folder stays in the app's library (it is found from there, not moved).
- `text-fit` and `center` audits were not re-run for the new bin states (screens inspected by eye).

## Phase 1 — Part B: decode engine, WebGL2 compositor, timeline v2, waveforms, smooth preview (2026-11-01, branch `video-p1-engine`)

Part A (project folder, media protocol, proxies, bin metadata) is built in parallel on `video-p1-io`; this part
consumes its contract through one adapter and works on its own until the merge.

### What changed

**Decode engine (`src/video/engine/`).** One `SourceDecoder` per source file (mediabunny demux + WebCodecs
`VideoSampleSink`); decoded frames are copied out at once into ImageBitmaps (a hardware decoder's few output buffers
are never held) and kept in a `FrameCache` keyed by (source, frame index) with an LRU byte budget (640 MB). Paused:
`exact(t)` decodes the frame under the playhead, coalescing a fast scrub to its newest request; the monitor holds the
nearest earlier cached frame meanwhile, so it never flashes black. Playing: a `FrameStream` per footage clip decodes
sequentially 0.4 s ahead of the playhead (and 1 s before a clip starts); a stream that falls behind is restarted at the
playhead (frames dropped, never late). Two clips of one file share the cache but have their own streams. A file the
decoder cannot read falls back to its `<video>` element (labelled `live`, re-uploaded each draw). The preview's
`<video>` seeking is gone.

**One render path (`engine/render.ts`).** `renderFrame(compositor, project, t, w, h, { frames })` draws the monitor
and every export frame. The monitor gets frames from the preview engine (`previewUrlFor` = the proxy when Part A has
one); the export decodes the originals (`exportUrlFor`) exactly at each frame time with `samplesAtTimestamps`, as
before. Everything else — order, transforms, crossfades, titles, the bug — is decided once.

**WebGL2 compositor v1 (`engine/glCompositor.ts`).** Unlimited layers as textured quads over black, premultiplied
alpha; per layer: position, scale, rotation around an anchor (`clip.rotation`, `anchorX/Y`), crop (UV), opacity,
fit/fill. Crossfade is a two-input pass (outgoing and incoming each drawn into their own framebuffer, mixed by the
progress in one shader, then laid over the layers below — so fit bars on the incoming clip show the outgoing one
fading out, not stuck at full). Titles, captions, picture overlays, the offline slate and the ESB bug are drawn by
Canvas 2D (`compositor.ts`, now only a rasteriser; Bangla shaped by the browser) once per change and kept as textures
by content key (words, accent, place, frame size, editor/export, picture loaded, fonts loaded). No WebGL2 → the
monitor shows a clear message and the export stops with the reason (`GLUnavailableError`); never a wrong frame.
Inspector: Rotation for every visual clip; Position X/Y for titles and captions too.

**Timeline model v2 (`timeline.ts`).** Track kinds `video | overlay | text | caption | audio`, any number of each.
Visual tracks draw in list order from the bottom up (the top of the list covers the rest), so reordering a track
changes what covers what; a track can be hidden (not drawn, not exported). Pure, unit-tested edits: `addTrack`
(free ids V3, T1, C2, A2…), `removeTrack` (its clips go; partners elsewhere are unlinked; refused when locked),
`moveTrack`, `renameTrack`, `setTrackHidden`, `trackAccepts`/`canPlaceOn` (a text track takes titles and captions;
footage only goes on video tracks), `trackForKind`, `ensureTracksFor`. Clips keep their link groups (`linkId`) and
Phase 0's lock/link/undo-per-gesture rules; dragging a clip over another lane that takes it moves it there. Phase 2
fields are typed and carried, not read: `speed`, `keyframes`, `effects`, `transitionIn/Out`. **Migration:**
`migrateTimeline(raw)` (pure) runs inside `deserializeVideoProject`; `serializeVideoProject` writes
`timelineVersion: 2`. A v1 timeline (no `timelineVersion`) gets its visual tracks ordered so the v2 rule draws exactly
what v1 drew (v1 drew footage, then overlays, then captions whatever their place); clips are untouched. Both versions
are cleaned: repaired ids/kinds, duplicate ids renamed, a clip whose track is gone gets one (never dropped), bad
numbers made safe. A new project lists C1 · V2 · V1 · A1 (same drawing as before).

**Timeline UI.** Track headers: show/hide (visual) or mute (sound), lock, and a ⋯ menu (Move up, Move down, Remove
track and its N clips — Ctrl+Z brings it back). **+ Track** in the timeline toolbar adds Footage / Overlays / Text /
Captions / Audio tracks. Headers are 184 px so "Captions" fits beside three tools.

**Playback (`VideoWorkspace` `PlaybackEngine`, `engine/audioEngine.ts`).** The wall clock stays (Phase 0's fix); it
starts 60 ms in the future so the first sound is scheduled and the first frames decoded before it moves. Sound is one
Web Audio graph — clip gain (volume, clip mute) → track gain (track mute) → master — replacing the `<audio>` element per
file: each audible clip (footage sound on its linked A-track clip, music, voiceover) is decoded in pieces by mediabunny
(`AudioBufferSink`) ≤ 1.5 s ahead and every piece is started at the AudioContext time that matches its timeline time,
mapped from the same wall clock with `getOutputTimestamp()` (so output latency is accounted for). A volume or mute
change moves a gain; a move/trim restarts the schedule. `clipGain` is the one rule for preview and export.

**Waveforms and filmstrips (`engine/peaks.ts`, `engine/filmstrip.ts`, `engine/laneCanvas.ts`).** Waveforms come
from decoded PCM: min/max peaks at 200 bins/s with three coarser levels (50, 12.5, 3.125); the lane draws the coarsest
level with a bin per device pixel. Filmstrips: a frame a second (≤ 600 tiles) decoded from the preview source into one
JPEG sprite. Both go through `writeCache`/`readCache` (Part A's `cache/`; a session LRU before the merge or when Part
A refuses a write past its cap). They are drawn imperatively into ONE canvas over the visible part of the lanes (it
follows the scroll; redrawn on DOM changes of the lanes, scroll, resize, and when a waveform/strip finishes) — no React
re-render per frame or per tile, and a long clip at high zoom never needs a canvas wider than the window. A clip whose
sound is still being read shows no waveform (never a placeholder). Background reading waits while the preview plays
(`engine/background.ts`).

**Adapter to Part A (`engine/mediaSource.ts`).** Looks up `previewUrlFor`, `exportUrlFor`, `onProxyReady`,
`readCache`, `writeCache`, `mediaInfo` by name on `src/video/media.ts` at call time. `''` from Part A (missing or
unknown asset) falls back to the clip's own URL, which `relinkClips` already clears for a missing file (so offline stays
offline, and a browser-session import still plays). A rejected `writeCache` keeps the entry in memory only. A proxy
arriving redraws the monitor; the next draw decodes the proxy (its URL is the decoder key).

### Files
- New: `src/video/engine/{mediaSource,frameCache,decoder,previewEngine,glCompositor,layerMath,render,still,audioEngine,peaks,filmstrip,laneCanvas,background}.ts`,
  `tools/e2e/video-engine-test.mjs`, `tools/fixtures/video/engine-fixtures.mjs`,
  `tools/unit/video-timeline-v2.test.ts`, `tools/unit/video-engine.test.ts`.
- Changed: `src/video/{timeline,videoStore,compositor,exportVideo,VideoWorkspace}.ts(x)`, `src/styles/video.css`,
  `tools/e2e/{video-playback-measure,video-shots,video-electron-test}.mjs`, `tools/unit/video.test.ts` (new default
  track order), `package.json` (`test:video` also runs the engine suite).
- No new dependencies.

### Acceptance (measured 2026-11-01 on this PC: RTX 3060, headless Edge, dev server)
| Test | Result | Measured |
|---|---|---|
| 1080p30 playback, 3 video layers + lower third + caption, 60 s | PASS (≤ 1 % dropped) | two runs: **1 dropped of 1,798 (0.06 %)** and **8 of 1,798 (0.44 %**, frames 1–2 at the start and single frames spread over the minute); ~5,500 draws in 60.0 s; playhead 59.93 s after 60.0 s wall; cache 633 MB. A frame counts as dropped if the monitor never drew it with every footage layer exact (held or skipped). Before background reading waited for playback: 55 of 1,798 (3.1 %), with three filmstrips decoding at the same time |
| Scrub shows the frame under the cursor within 50 ms (540p all-keyframe fixture standing in for a proxy) | PASS (p95 ≤ 50 ms) | 40 random seeks: p50 21 ms, p95 22 ms, max 22–33 ms over three runs (seek → that exact frame drawn, including the wait for the next animation frame) |
| Golden frames: preview == export at 10 timestamps | PASS | 1080p, footage + rotated/cropped fit inset + crossfade + Bangla lower third + Bangla caption + card at 80 %: mean difference 0.45–0.72 % of full scale; pixels off by > 48 levels 0.23–0.78 %. Both frames come from the same `renderFrame`; what differs is H.264 at 10 Mb/s on the test pattern's sharp edges |
| v1 project opens unchanged | PASS | a Phase 0 file (V2/V1/C1/A1, lower third + caption + card) opens with every clip's track, time and words equal, tracks C1 · V2 · V1 · A1, the lower-third stripe drawn where it was; unit tests prove the layer order is identical for any v1 track order, the migration is pure and a v2 file reopens unchanged |
| A/V sync, flash + beep fixture | PASS | export: flashes at 1/3/5/7 s, beep onsets at 1.000/3.000/5.000/7.000 s → 0 ms; preview: beep heard 6–19 ms before the draw of its flash frame (under one frame; the draw reaches the screen at the next vsync, ~16 ms later). Heard time comes from a tap on the master (its own 43 ms buffer delay calibrated out) mapped to wall time with `getOutputTimestamp` |

Also: waveform (real PCM) and filmstrip drawn on the lanes (lane canvas reports 1 waveform + 1 strip, 0 pending);
track add / move / remove / undo through the UI; no page errors.

### Checks
- `npm run lint`: 0 errors (warnings only, existing kinds).
- `npm test`: 872 passed (76 files; 820 after the Phase 0 fix round + `video-timeline-v2.test.ts` and `video-engine.test.ts`).
- `npm run build`: ok.
- `npm run test:video`: 55 PASS, 0 FAIL — `video-test.mjs` (every Phase 0 export check, now through the WebGL2 path) + `video-engine-test.mjs` (the table above).
- `npm run test:electron`: 53 PASS, 0 FAIL (`video-electron-test.mjs` reads the WebGL2 monitor through a 2D copy).
- `node tools/audit/text-fit-audit.mjs`: 0 text-fit problems (no Video step skipped; the skipped steps are Editorial publish/outputs and Home under load). `node tools/audit/center-audit.mjs`: 0.
- Screens: `tools/out/p1-engine/` (light/dark × 900/1366/1920); new states `multi-track`, `waveform-lane`,
  `add-track-menu`, `track-menu`, `track-removed`.

### Known gaps
- Speed, keyframes, effects and transitions are typed and saved, not played (Phase 2).
- Audio clips that overlap still simply sum (no fades); waveforms are mono (all channels folded).
- The preview cache holds frames at source size (≤ 1080p expected once Part A's proxies are in; a 4K original without a
  proxy costs 33 MB a frame).
- A/V sync was measured in headless Edge (its audio clock and a tap), not with a microphone at the speakers.
- Two of 150 shots in the first screenshot run showed a half-decoded footage frame at t = 1 s. It could not be made
  to happen again in 800 isolated decodes; the likely path is the `<video>` fallback taken when the decoder failed to
  open under load, drawn mid-seek. Now the decoder retries once before falling back (and says why in the console), and
  the fallback never uploads a frame while its element is seeking. The second full run (`tools/out/p1-engine/`, 150 shots) has none.
- An export whose source URL was revoked under it (browser session: opening another project releases the old
  imports) waits instead of failing — not reachable from the UI, seen only in a test that did it on purpose.

### Next step
Phase 2 (pro editing) on top of the v2 model: speed and keyframes are already in the type; the compositor's layer pass
takes them per frame.


## Phase 1 fix round — Part A (2026-11-01, branch `video-p1-io`)

Main process, project IO and security after the Phase 1 review, plus the bin items from the UI review (B4–B19). Every
item was re-checked before it was fixed; all of them reproduced.

### Security
- **S1 predictable temp names — fixed.** Every temp file is now `<target>.<16 random hex>.tmp` (or `.partial`) opened
  with `'wx'` and renamed into place (`writeFileAtomicSync` / `writeFileAtomic` / `tempName` in `video-media.cjs`):
  project.json, cache entries, proxies and exports (`createExportWriter`), autosave snapshots, the media and folder
  registries, stills/takes. A link or hard link planted at the old names (`project.json.tmp`, `<key>.bin.tmp`,
  `<hash>.mp4.partial`) is never written through. `cleanFolder(root)` clears stray `*.tmp|*.partial|*.copying` (plain
  files and links only, never followed) in the root and every subfolder: on open, on a Save into an existing folder
  (`createProjectFolder`), and the first time any folder id is used in a session (`cleanOnce` in `folderRoot`, also the
  library).
- **S2 cache cap under parallel writes — fixed.** Writes to one cache folder run one after another (promise chain per
  folder); 40 parallel writes keep exactly the 10 that fit, the same key written 40× counts once.
- **S3 proxy writes — fixed.** Per proxy: at most 2 × its source (≥ 256 MB, ≤ 8 GB; the renderer names the source by
  the esb-media URL main handed out, else 8 GB). Per folder: the running total (folder bytes + this file) stays under
  100 GB (project) / 20 GB (library). Free space is checked at begin and again every 64 MB of growth (1 GB floor).
- **S4 folder ids — fixed.** `folderId(path, secret)` = HMAC-SHA256 with a per-install secret (`userData/video-folder-
  secret`, 32 random bytes, made once with `'wx'`). The registry still stores paths, so a lost secret only re-keys the
  ids. Snapshots name their folder by the id main returns with them, so restore keeps working. (Media ids `esb-media://m/`
  are still a plain hash of the path: the renderer knows those paths anyway; not in this round's scope.)
- **S5 autosave restore — fixed.** Each folder's `autosave/` goes through `confinedDir` (a junction out is skipped);
  `latestSnapshotIn(dirs)` lists names only, sorts every candidate newest first by the time in its name, then reads
  (async) only plain files ≤ 25 MB, at most 8, until one parses. Startup no longer reads up to 50 × 25 MB synchronously.
- **S6 relink search — fixed, kept simple.** One search at a time in main (queued); at most 200 hashes per search, 20 s
  budget; a hash that takes over 1.5 s marks its folder slow and the rest of that folder is skipped. Cloud placeholders
  (OneDrive online-only) cannot be detected cheaply from Node (no file-attribute API; `stat().blocks` is not reliable
  on Windows), so the slow-hash rule is what keeps a search from downloading a cloud folder: at most one file per such
  folder is read.
- **S7 — fixed.** `esb:video-media-facts` (and everything else through `pathForMediaUrl`) answers only media
  extensions; `confinedFile` now checks that the subfolder's real location is the folder's own `<sub>` and that the
  file's real location sits directly in it (a `proxies/x.mp4` link into `cache/` is refused).
- **S8 — fixed.** Every esb-media answer carries `X-Content-Type-Options: nosniff`. Origin `null` is needed: the
  packaged app is loaded with `loadFile` (file://, an opaque origin Chromium reports as `null`), so it is accepted only
  when there is no dev server; in development only the dev server's origin is.

### Correctness
- **C3 relink keeps the old proxy — fixed.** `previewUrlFor` and `mediaInfo().proxy` use a proxy only while
  `proxyIsCurrent`: facts and hash read from the current URL and the proxy made from that hash (`hashUrl`,
  `proxyHash`). Right after a relink the preview (and a filmstrip cached from it) gets the new original. The pipeline
  also resets the proxy fields at once when an entry's URL changes (`sourceChanged`, from the store subscription, so
  `VideoWorkspace.relink()` needed no change), drops a queued proxy of the old file, and a proxy finished for the old
  file is not given to the entry.
- **C6 — fixed.** Saving a Phase 0 single file adds hash / codec / fps / key-frame interval to each media record
  (`singleFileText`; read back by the v1 → v2 migration, ignored by Phase 0 builds). A failed re-hash after a relink keeps
  the previous hash (relink-by-hash still has it) but nothing proxy-related trusts it (`hashUrl` ≠ the new URL).

### Performance
- **P5a — fixed. New API for the engine:** `holdProxies(reason: string): () => void` in `src/video/media.ts`
  (re-exported from `proxies.ts`; `proxyHolds()`, `proxiesHeld()`; `window.__videoMedia.holds()`). Call it when
  playback starts and when an export starts; call the returned `release()` (idempotent) when it ends. Holds nest. While
  held no proxy starts, and the running one pauses: the page stops acking its 4 MB pieces, so the encoder stalls after
  at most one more piece; Cancel while held terminates the worker. **Not yet called:** the engine fixer wires it into
  playback and export (Part A does not edit `src/video/engine/*`).
- **P2 — fixed.** `LONG_GOP_SECONDS = 0.5`, `>=` (with 5 ms slack for packet-time rounding): footage larger than 540p
  with key frames ≥ 0.5 s apart, or over 1080p, gets a proxy. New guard: a source 540p or smaller never gets one (the
  proxy would be an upscale — the 640×360 speech fixture started making one). Measured (dev server, headless Edge,
  `tools/out/p1-fix/scrub-gop.mjs`, the engine test's method, 40 random seeks, 2 runs): 1080p30 1 s-GOP original
  p50 20–21 ms / p95 50 ms / max 50; its 540p 0.5 s-GOP proxy (ffmpeg with the worker's settings) p50 20 / p95 30 /
  max 30–31 ms.
- **P11 — fixed.** esb-media://p resolves through `createConfinedResolver` (1.5 s memo per folder + file, dropped when a
  proxy of that folder finishes); a request costs one async stat for a hot file instead of 2 realpath + 2 stat. A file
  removed inside the window is a 404 and is resolved again after it.

### Bin UI (lead's review)
- **B4** a file found again by hash: the row says "Found as <name> in …\<folder>\<folder>" with **Use it**
  (`.vw-bin-use-found`), no "Not found", no Relink; the banner says "N files were found again in a new place." (Use all
  `.vw-bin-relink-all` when more than one) and names only the still-missing ones as missing.
- **B5** "Proxy failed: <reason>" (wraps up to 3 lines; whole text in the tooltip) + **Retry** (`.vw-bin-proxy-retry`).
- **B7** facts are two fixed lines — "0:06.0 · H.264 · 29.97 fps" / "3840×2160 · silent · 1.7 GB" — never wrapped
  mid-list. The row is a grid now: the name shares its line with the actions and the facts run under the actions to the
  right edge (beside the buttons they had ~140 px and were cut). "sound" is no longer printed; only "silent" is.
- **B8** one proxy line with real 28 px buttons: "Proxy 42 % ▬ [Cancel]" (`.vw-bin-proxy-cancel`, keeps
  `.vw-bin-proxy-x`), "✓ Plays from proxy", "Proxy failed: … [Retry]", "No proxy [Make proxy]" (`.vw-bin-proxy-make`).
- **B9** ready = "✓ Plays from proxy" (tooltip: exports read the original) and "Copied into project" (tooltip) — on
  one line where the bin is wide enough, else the next line.
- **B19** "On import" and the browser note are indented 6 px like the rows' thumbnails.

### Files
`electron/video-media.cjs`, `electron/video-project.cjs`, `electron/main.cjs` (Video IPC only), `electron/preload.cjs`
(`videoProxyBegin` passes the source URL), `src/video/media.ts`, `src/video/proxies.ts`, `src/video/projectIO.ts`,
`src/video/BinCard.tsx`, `src/styles/video-bin.css`, `tools/unit/video-project.test.ts` (+15: S1–S8, P11, the 540p
guard), new `tools/unit/video-p1-media.test.ts` (C3, C6, holdProxies), `tools/e2e/video-electron-test.mjs` (random
`.partial` names, Use it, "silent"). Not touched: `src/video/engine/*`, `VideoWorkspace.tsx`, `proxyWorker.ts`,
`tools/e2e/video-shots.mjs`.

### Checks
- `npm run lint`: 0 errors. `npm run build`: ok. `npm test`: 913 passed (78 files).
- `npm run test:video`: 55 PASS, 0 FAIL. `npm run test:electron`: 66 PASS, 0 FAIL (4K → proxy ready 5.3 s, worker
  4.7 s; proxy re-found on restart in 146 ms; export still as sharp as the original).
- Screens: `tools/out/p1-fix/` (`bin-normal`, `bin-proxy-pending`, `bin-proxy-ready`, `bin-proxy-failed`,
  `bin-proxy-cancelled`, `bin-missing`, `bin-missing-found`; light/dark × 900/1366/1920), inspected.

### Known gaps
- `holdProxies` is not called until the engine fixer's playback/export change lands.
- The shot harness seeds the found file as `'C:\Footage\…'` in a JS string (backslashes eaten), so its found row shows
  no folder; real paths show it (electron test: "Found as moved-speech.mp4 in …\esb-vwork-…\footage").
- The failed-proxy reason is clamped to 3 lines (tooltip has all of it).
- Media ids (`esb-media://m/<id>`) are still unsalted hashes of the path.

## Phase 1 fix round — Part B (2026-11-01, branch `video-p1-engine`)

Review findings on the decode engine, compositor and playback, plus the lead's screenshot review (U-items), fixed on
`video-p1-engine` (from f4e6d23). Measured on this PC (RTX 3060, headless Edge, dev server, 1366 × 768 unless said).

### Correctness
- **C1 frame-cache alias → closed bitmap (confirmed).** `aliasOf` made a second entry sharing the original's bitmap;
  evicting the original closed it and the alias still answered "exact". Aliases are now part of `FrameCache`
  (`alias(source, index, target)`): they point at the real entry, cost no bytes and are dropped with it (evicted,
  replaced, cleared); `get`/`peek`/`nearestBefore` resolve through them and can never return a closed bitmap.
  Unit test evicts the original, then hits the alias.
- **C2 proxy timestamps (confirmed).** mediabunny's Conversion without a trim shifts a file to start at 0, so a
  source whose first frame is at 1.5 s previewed 1.5 s ahead of its export and sound. The proxy now keeps the
  source's timestamps (`trim: { start: 0 }`, settings in `engine/proxyOptions.ts`, used by `proxyWorker.ts`). e2e:
  a fixture made with `-output_ts_offset 1.5` converted with the worker's settings: first video/audio timestamps
  1.5 / 1.479 s in both, the frame at 3.0 s is the same frame.
- **C4 proxy ready mid-playback (confirmed).** The clip switched to a decoder that had nothing yet (black) and the
  original's decoder was never released. The engine remembers the URL each clip last drew from and keeps drawing
  from it until the new decoder has a frame; a debounced prune (`schedulePrune`, also after every clip edit) then
  disposes the old decoder. e2e: proxy made ready 1.2 s into playback → 761 draws, 0 blank, the clip on the proxy,
  the original's decoder gone.
- **C5 drain after dispose (confirmed).** `drain()` could hit a null sink (TypeError) and leave the waiting promise
  unresolved (`still.ts` hung). Every exact request now resolves (null when disposed/replaced/failed), never rejects;
  a `createImageBitmap` rejection closes the sample and its frame and resolves null. Unit tests for both.

### Performance
- **P1 cache thrash (confirmed; both named causes).** Preview frames are decoded at the monitor's device-pixel
  height (steps 360/540/720/1080/1440/2160; the golden still and every export decode full size). While playing, the
  cache is told which index windows each source still needs: frames behind the playhead go first, then — only if the
  windows alone are over budget — the furthest-ahead ones. The look-ahead (≤ 0.5 s) is sized so all streams fill at
  most half the budget. Found while measuring: `createImageBitmap(…, resizeQuality: 'medium')` capped the copy at
  ~240 frames/s for the whole page (bench: 'low' 473/s; decode alone 453–530/s), so the scaled preview uses 'low';
  playback started before the streams had frames, so the clock now waits (≤ 700 ms, typically 30–400 ms) until every
  stream under the playhead is 0.5 s ahead; and a filmstrip being read now closes its decoder at once when
  playback/scrub/export starts (it used to finish its queue of 4K key-frame decodes into the first frames of play).

  Dropped frames, 8 s play at the default 640 MB budget, the reviewer's probe (`perf-probe.mjs`, his 4K fixtures):

  | Case | Before | After (5 runs: min–max, median) |
  |---|---|---|
  | 3 × 1080p30 | 0 % | 0 % every run |
  | 10 × 1080p30 | 97.5 % | 0–3.2 %, median 0.5 % |
  | 2 × 4K30 | 99.2 % | 2.2–3.8 %, median 3.0 % |
  | 1 × 4K60 | 99.6 % | 0.9–2.6 %, median 1.3 % |
  | 1 × 4K30 | 36.6 % | 0.8–4.2 %, median 2.5 % |

  The ≤ 2 % target is met at the median for 10 × 1080p and 4K60, not for 2 × 4K30 nor in every run of 4K30. What is
  left is not the engine keeping up: in the instrumented e2e runs every dropped frame was a *skipped* draw (0 *held*
  frames — every frame drawn was the exact one); a CPU profile of a 2 × 4K30 run shows the main thread ~95 % idle with
  no long tasks; the drops are the first 0.1–0.2 s and scattered single frames. The page's animation frames are not
  delivered while the GPU process is saturated decoding 4K at full size (headless Edge). Proxies remove that load.
  `video-engine-test.mjs` runs the four cases on its own 4K fixtures (generated into `tools/out/video-fixtures`, not
  committed): ≤ 2 % passes; 2–6 % with only skipped draws prints a NOTE; held frames or > 6 % fail.
- **P2b scrub on 1 s-GOP originals.** Exact decodes are one `getSample` (walking the GOP frame by frame was measured
  slower: p50 153–169 vs 116 ms on 3 layers) and are serialised across sources (parallel seeks of several layers
  fight over the hardware decoder). While scrubbing fast on a long-GOP file the key frame before t is decoded first
  (one decode) and held on screen. 1080p 1 s-GOP fixture, no proxy, seek → exact frame drawn: 1 layer p50 20 / p95
  40 ms (60 seeks 300 ms apart), p50 19 / p95 37 ms (150 seeks 40 ms apart); 3 layers p50 117 / p95 240 →
  p50 90 / p95 200 ms (the reviewer's figure before: p95 139 ms).
- **P3 audio fallback (confirmed).** A file mediabunny cannot read is decoded whole by Web Audio once per URL for the
  session (shared by every restart and loop; files ≤ 96 MB, ≤ 512 MB of PCM kept); a bigger file or a failed decode
  marks the source "Sound not supported" and the status bar says so (no OOM, no retry each play). A file with no sound
  track is no longer fetched at all (it used to be fetched and decoded whole on every play).
- **P4 text textures evicted mid-frame (confirmed).** A static texture used in the frame being drawn is pinned
  (frame counter), so a later upload in the same frame cannot delete it. Unit test (fake WebGL context).
- **P5b background work during scrub/export.** Background holds are counted per reason (playback; scrub, until the
  paused playhead has been still 400 ms; export). Playback and export also call Part A's `holdProxies(reason)`
  (looked up by name on media.ts, a no-op without it).
- **P7 filmstrip sprites.** An LRU capped at 96 MB of sprites; a project switch releases the strips (and the sound
  fallback buffers) of media the new project does not use.
- **P8 WebGL context loss.** The compositor rebuilds programs, buffers and textures on `webglcontextrestored`; the
  monitor shows the slate while lost and redraws when restored (e2e with `WEBGL_lose_context`). The export checks
  `isLost()` around each frame and fails with a clear message instead of encoding black frames.
- **P10 export samples / late frames.** An export frame's decoded samples are closed in a `finally`; a frame a stream
  decodes after `dropSource` is closed, never cached (unit tests for both late paths).
- **P12 FrameStream polling.** A stream far enough ahead sleeps until its target moves (the engine moves it each
  tick): no 4 ms wake-ups; a 250 ms timeout only as a safety net.

### UI (the lead's screenshot review)
- **U1** Root cause: with more tracks than fit, the ruler (a flex item) shrank to 1 px and every lane rose 27 px above
  its header. The ruler and the "Tracks" corner are pinned (sticky) at the top of one scroller; the harness now checks
  that every header is level with its lane and the ruler is on screen (`geometry` in manifest.json): 0 problems.
- **U2 / U13** A monitor/timeline divider (drag, Up/Down keys, double-click = balanced), remembered in localStorage
  `esb-banner-studio/video/timeline-height`. Until dragged, the timeline gets what the monitor's picture cannot use
  (at 900 × 900 it grows to ~420 px instead of black bars over and under the picture), at least 280 px. A visible
  vertical scrollbar and an "N more tracks" chip at the foot of the headers (click scrolls to them).
- **U3** Waveforms on a dB scale (−48 dBFS floor), symmetric peak bars, ≥ 1 px for any sound; a span with no sound
  says "Silent". A −18 dBFS tone now fills ~62 % of the band.
- **U6 / U15 / U16** Link icon + title left-aligned in one band for every clip; on a short clip the duration hides
  first (container query); the label stays inside the visible part of a clip whose start is scrolled away.
- **U10** Track tools are 28 × 28 px; ⋯ stays pressed while its menu is open (and toggles it).
- **U11** Add-track menu: an icon per kind and distinct one-liners; "+ Track" shows its open state.
- **U12** Video menus are solid (`.popover.vw-solid`), no glass over the clips.
- **U14** Filmstrip tiles have a 1 px gap and a hairline edge (light pictures such as banners read as tiles).
- **U17** Editor-only monitor words (Media offline, the empty card's hint) have a legible minimum (11–15 CSS px).
- **U18** While the inspector holds the bin's place, no bin tab reads as selected.
- **U20** Restore card: "autosaved 10:00 AM" (no seconds).
- **Harness** (`tools/e2e/video-shots.mjs`): the sample clip has real sound (the committed speech fixture's audio),
  so the bin, the linked A1 clip and its waveform are true; the 4K stand-in reads 34 MB (6 s at ~45 Mb/s); seeded
  Windows paths keep their backslashes (`String.raw`); `tab-media` dropped (same picture as `timeline`); monitor
  states shot in the first theme only; new states `tracks-scrolled`, `tracks-below`, `bin-proxy-0`, `bin-proxy-99`
  (`waveform-lane` is now footage with its real sound).

### Files
- Changed: `src/video/engine/{frameCache,decoder,previewEngine,still,glCompositor,background,filmstrip,audioEngine,laneCanvas}.ts`,
  `src/video/{exportVideo,proxyWorker,compositor}.ts`, `src/video/VideoWorkspace.tsx`, `src/styles/video.css`,
  `tools/e2e/{video-engine-test,video-shots}.mjs`, `tools/fixtures/video/engine-fixtures.mjs`.
- New: `src/video/engine/proxyOptions.ts`, `tools/unit/video-engine-fixes.test.ts`.

### Checks
- `npm run lint`: 0 errors (warnings only, existing kinds).
- `npm test`: 906 passed (78 files; +`video-engine-fixes.test.ts`: C1 ×3, P1 eviction ×2, C5 ×2, P10 ×2, P4).
- `npm run build`: ok.
- `npm run test:video`: 62 PASS, 0 FAIL — new: P8 context loss/restore, C2, C4, P1 ×4 (this run: 2 × 4K30 1.7 %,
  4K60 1.3 %, 4K30 0 %, 10 × 1080p 0 %, all drops skipped draws, 0 held). Existing acceptance unchanged: 60 s 3-layer
  1080p 0.33 % dropped, scrub (540p all-key) p50 20 / p95 37 ms, golden frames worst mean 0.72 %, A/V preview
  −7…−10 ms, export 0 ms.
- `npm run test:electron`: exits 0; video-electron-test all PASS; electron-test reports one FAIL, "signing out clears
  the site session" (Editorial sign-out, electron/siteApi — not touched here; same on a rerun).
- `node tools/audit/text-fit-audit.mjs`: 0 text-fit problems (clip titles ellipsise on purpose). `center-audit`: 0.
- Screens: `OUT=tools/out/p1-fix PORT=5293 node tools/e2e/video-shots.mjs` — 204 shots, 0 n/a, 0 failed, 0 timeline
  geometry problems.

### Known gaps
- 2 × 4K30 (and some runs of 4K30) without proxies stay above 2 % on this PC in headless Edge — skipped draws while
  the GPU process decodes 4K at full size, not late frames (see P1). Not measured in the Electron window.
- Preview frames are scaled with the cheap bilinear filter ('low'); a 4K source on a small monitor can alias slightly
  in the preview (the export always decodes full size).
- Scrub of three 1 s-GOP 1080p originals at once is still p95 200 ms without proxies (one layer: 40 ms).


## Phase 2 — Part A: editing operations, keyframes, speed (2026-11-02, branch `video-p2-edit`)

Built from `video-pro` 18ee407 (Phase 1 passed) in parallel with Part B (effects rendering, and PLAYING speed and
keyframes in the engine) on `video-p2-fx`. This part owns the model, the edit operations and the UI; the engine reads
keyframes and speed through the contract below, so on this branch alone keyframes and speed are edited, saved, undone
and laid out on the timeline, but the monitor and the export do not apply them yet (see "Before the merge").

### Contract for Part B (pure, JSDoc'd, unit-tested)
- `src/video/keyframes.ts` — `sampleProp(clip, prop, tLocal, fallback): number`. Keys live at
  `clip.keyframes[prop] = { t, v, ease?, bezier? }[]`, `t` = seconds from the clip's start on the timeline. `ease`
  shapes the segment to the next key: `linear | easeIn | easeOut | easeInOut | bezier` (+ `bezier: [x1, y1, x2, y2]`),
  or the four numbers directly; the hyphenated Phase 1 spellings read the same. Exact at a key, held before the first
  and after the last; any property name works (`fx.<effectId>.<param>` too). Named props `x y scale rotation opacity
  cropL cropR cropT cropB volume` map to the clip fields `offX offY scale rotation opacity crop* volume` (`PROP_FIELD`).
- `src/video/speed.ts` — `sourceTimeAt(clip, tLocal): number` = ABSOLUTE source seconds (includes `in`; exactly
  `in + tLocal` for a clip with no speed fields); `clipDurationFor(clip)` = the timeline length that plays `[in, out]`;
  `audioRateAt(clip, tLocal): number` = |rate| (0 inside a freeze); `clip.preservePitch` (default true);
  `audioPlaybackAt` returns `{ rate, reverse, preservePitch }`. Model: `clip.speed` = a constant 0.1–10 or
  `{ ramp: Keyframe[] }` (speed over clip-local time, eased, integrated through a cached 1 ms table); `clip.freezes =
  [{ at, dur }]` (clip-local; the picture holds and the clip grows by `dur`); `clip.reverse` (plays `out` → `in`).
  `speed` is never negative or 0 (reverse and freeze have their own fields).

### What changed
**Edit operations (`timeline.ts`, all pure; every gesture is one undo step in the store).** Ripple delete (every
track moves up by the gap, so linked footage and sound stay in sync; refused when a clip that would move is linked to
one on a locked track), ripple trim (the left edge keeps the start, the right edge the first frame; later clips
follow), roll (`rollEdit`: the cut between two touching clips moves, total length unchanged), slip (in/out move;
timeline place and keyframes unchanged; limited by the file), slide (the clip moves; the neighbour before ends later
and the one after starts later by the same amount, their total unchanged), insert / overwrite (`insertClips` splits
the target tracks at the point and pushes every track; `overwriteClips` clears what is under; linked partners are cut
the same way), lift / extract of the in–out range (I/O) or the selection, `magnetize` (the main footage track closes
its gaps; a crossfade overlap stays; applied after each edit and at the end of a drag, so a drag can reorder), markers
(add / name / colour / move / remove / jump, saved), groups (`groupId`: move and delete as one; links still trim
together), compound clips (`compound: { tracks, clips }`, a nested timeline; `flattenCompounds` gives the monitor, the
sound and the export its inside at its place and window; `compoundView` / `writeCompoundView` open and edit it in
place; `breakCompound`), copy / paste (insert or overwrite) and paste attributes (transform, crop, opacity, volume,
speed, keyframes). Trims and splits are speed-aware through one `subClip` (source in/out follow speed, freezes and
direction; keyframes, ramps and freezes are cut so the kept part looks the same). Phase 0 lock/link rules kept: a lock
protects its clips through links and groups.

**Store (`videoStore.ts`).** `project` stays the root (what is saved; tests can still set it), `compoundPath` is the
open compound, `viewOf(s)` the timeline being edited (memoised). New state: `tool`, `editMode`, `rate` (J/K/L),
`range` (I/O), `selectedIds` (Shift/Ctrl+click), `clipboard`, and actions for all of the above. Undo with a compound
open falls back to the deepest part of the path that still exists.

**UI (`VideoWorkspace.tsx`, new `TimelinePro.tsx`, `video.css`).** Toolbar: tool menu (Select V, Ripple B, Roll N,
Slip Y, Slide U, plus Overwrite / Insert for drops and pastes), magnetic main track (Ctrl+M), Markers (count; list with
name, colour, jump, delete), shortcuts sheet (? or the keyboard button). Ruler: marker flags (drag = move, click =
jump, double-click = name) and the in–out band. Clips: multi-selection, the selection's linked partners outlined,
group / compound / speed tags (`2×`, `ramp`, `◂` reverse); double-click (or Enter) opens a compound with a breadcrumb
(Esc closes); bin items drag onto a lane (insert or overwrite). Inspector: a ◆ beside every keyframable property (adds
or removes a key at the playhead; an animated slider shows and sets the value at the playhead); a keyframe lane under
the selected clip while it has keys (property filter; drag a ◆ to move, click = playhead there, right-click or Enter =
ease menu, Custom curve… = a cubic-bezier editor with presets, Del removes, double-click adds); Speed (0.1–10× field,
0.5/1/2/4× chips, ramp presets Speed up / Slow down / Hero moment / Bullet / Montage with an editable log-scale curve,
Freeze frame at the playhead, Reverse, Keep the voice's pitch; the linked sound follows and later clips move). J/K/L
shuttle: L 1× → 2× → 4× (2× and 4× silent: the sound engine plays 1× only), J backwards as an exact-frame scrub, K
stops. The monitor, preview sound and export get `flattenCompounds(view)` (cached per project), so compound clips
play and export now.

### Files
- New: `src/video/keyframes.ts`, `src/video/speed.ts`, `src/video/TimelinePro.tsx`, `tools/unit/video-p2-edit.test.ts`.
- Changed: `src/video/timeline.ts` (types `freezes`, `reverse`, `preservePitch`, `groupId`, `compound`, project
  `markers`, `magnetic`; speed-aware trims/split; compound-aware save, relink, missing media and migration; the ops),
  `src/video/videoStore.ts`, `src/video/VideoWorkspace.tsx`, `src/video/BinCard.tsx` (draggable: one attribute),
  `src/styles/video.css` (appended block), `tools/e2e/video-test.mjs`, `tools/e2e/video-shots.mjs`,
  `tools/audit/text-fit-audit.mjs`. No engine file touched. No new dependencies.

### Acceptance (measured 2026-11-02)
| Test | Result |
|---|---|
| Unit: every edit op (`video-p2-edit.test.ts`, 32 tests) | PASS — ripple delete keeps linked A/V in sync and closes the gap on every track (c 10 → 5, title 12 → 7); ripple trim ±; roll keeps total length (a+b = 10 s, end unchanged); slip keeps start 5 / length 5 (in 10 → 13); slide keeps the neighbours' total (a 5 → 6, c 5 → 4) and the timeline end; insert/overwrite/lift/extract; magnetize; markers; groups; compounds (flattened layers equal the original at 4 times); paste attributes; store: one undo step per ripple-trim drag, magnetic close in the same step, compound open/edit/close/undo, J/K/L, copy/insert-paste |
| `sampleProp` exact at keys and eases mid-way | PASS — exact at 3 keys; mid-segment linear 50, ease-in 31.5357, ease-out 68.4643, ease-in-out 50 (12.9162 at ¼), bezier(.25,.1,.25,1) 51.3315 at 0.3 — CSS cubic-bezier reference values (independently computed) |
| `sourceTimeAt`: 2×, ramp, freeze, reverse | PASS — 2× of 10 s = 5 s long, t 2.5 → 5; ramp 1×→3× over 4 s plays 8 s (t 2 → 3.0, t 1 → 1.25, ±1e-4), presets monotone and end exactly at `out`; freeze 2 s at 3 s → 12 s long, t 3–5 hold source 3, t 12 → 10; reverse 2× of [2, 8] = 3 s, t 0 → 8, 1 → 6, 3 → 2; trims/splits of 2× and reversed clips keep the mapping |
| Export: keyframed move at exact pixel positions at three times (`video-test.mjs`) | PENDING-MERGE (written against the contract; it turns into a real check by itself once an engine file calls `sampleProp`). Geometry validated now: the unanimated picture spans x 720–1199 exactly (480 px, centred); after the merge it must start at 432 / 720 / 1008 (±2 px) at 0.5 / 1.0 / 1.5 s |
| Export: 2× clip plays its source twice as fast | PENDING-MERGE (same switch on `sourceTimeAt`); the 2× clip of a 2 s file is already 1 s on the timeline (export 4.0 s: PASS) |

### Checks
- `npm run lint`: 0 errors (warnings only, existing kinds).
- `npm test`: 955 passed (80 files; +32 in `video-p2-edit.test.ts`; every earlier test unchanged and passing).
- `npm run build`: ok.
- `npm run test:video` (`ESB_PORT_OFFSET=40`): 70 PASS, 0 FAIL, 2 PENDING-MERGE (above). New UI checks: B picks
  Ripple; Shift+Del ripple-deletes a linked pair in one undo step (next pair 4 → 2 s on V1 and A1); M drops a marker
  at the playhead; the Scale ◆ adds `{ t: 1, v: 1 }` and the keyframe lane appears; Ctrl+Alt+G makes one compound
  (4 clips, 4 s); double-click opens it in place; Esc closes it. Engine suite unchanged.
- `npm run test:electron` (`ESB_PORT_OFFSET=40`): exit 0, 66 PASS, 0 FAIL (the known intermittent sign-out check did
  not occur this run).
- `node tools/audit/text-fit-audit.mjs`: 0 text-fit problems (new steps: tools menu, markers list with a long name,
  speed ramp, keyframe lane, shortcuts sheet; no Video step skipped). `center-audit`: 0 (the narrow Delete button was
  1 finding until its label was hidden as an element, not by font-size 0).
- Screens: `OUT=tools/out/p2-edit PORT=5292 node tools/e2e/video-shots.mjs` — 276 shots (light/dark × 900/1366/1920),
  0 n/a, 0 timeline-geometry problems; one timeout (`markers`, light 900) passed on a rerun and was replaced. New
  states: `tools-menu`, `markers`, `keyframe-lane`, `ease-menu`, `curve-editor`, `speed-panel`, `speed-ramp`,
  `compound-open`, `compound-clip`, `multi-select`, `shortcuts-sheet`, `paste-attributes`. Found by looking and fixed:
  marker ids collided within one millisecond (all three markers renamed together), a selector returning a new array
  looped Paste attributes, the speed field stretched full width, ramp labels sat on the curve's end points.

### Before the merge (for the lead)
- Part B's adapter (`engine/animation.ts` on `video-p2-fx`, read only) matches this contract: absolute
  `sourceTimeAt` (it probes for this), `audioRateAt` as a number (changed here to match), `clip.reverse`,
  `clip.preservePitch`. One gap on its side: its `isPlainSpeed` looks at `speed` and `reverse` only, so a clip with
  only `freezes` takes the 1:1 fast path; it must also test `freezes?.length`.
- Both branches change `VideoWorkspace.tsx` and `timeline.ts`. Here the monitor, playback, sound, still and export get
  `playable(viewOf(state))` (compounds flattened; the open compound shown on its own) instead of `state.project`;
  Part B's edits to those spots must be re-applied on top. In `timeline.ts` both add `Clip` fields and lines in
  `migrateTimeline` (Part B: effects, blend mode, adjustment; here: compound) — adjacent, not overlapping in meaning.
- The two PENDING-MERGE lines in `video-test.mjs` switch on by themselves after the merge.
- The engine never sees `compound`: it always gets flattened projects (clip ids `compoundId/innerId`).

### Known gaps
- On this branch alone the preview and the export ignore keyframes and speed (Part B plays them). A retimed clip
  already has its new length, so before the merge a 2× clip shows the first half of its span at 1×.
- 2× / 4× shuttle is silent; J (backwards) shows exact frames as a scrub would, not smooth reverse playback.
- A compound's own transform and keyframes are not applied to its inside (its opacity and volume are); speed on a
  compound is not offered.
- A keyframe segment cut by a trim or split keeps the earlier key's ease shape for the rest of that segment (exact for
  linear).
- Insert / ripple refuse (with a status note) rather than pull a linked pair apart when a locked track is involved.

### Next step
Merge with Part B, see the two PENDING-MERGE checks pass, then Phase 3 (text and titles).

## Phase 2 — Part B: effects rendering, speed and keyframes in the engine (2026-11-02, branch `video-p2-fx`)

Part A (edit operations, keyframe and speed MODELS + UI, markers, groups/compounds) is built in parallel on
`video-p1-io`; this part draws and plays what those models describe, through one guarded adapter, and works on its own
until the merge.

### What changed

**Adapter to Part A (`engine/animation.ts`).** `sampleProp`, `sourceTimeAt`, `clipDurationFor`, `audioRateAt` and
`preservePitch` are the only animation/speed functions the engine calls. Part A's `src/video/keyframes.ts` and
`src/video/speed.ts` are picked up with `import.meta.glob` (present → used; absent, missing a function or throwing →
fallback), so this branch builds without them. The fallbacks read the v2 clip fields directly: `keyframes[prop]`
(linear / ease-in/out in both spellings / bezier), `speed` (constant 0.1–10×, `{ ramp }` integrated), `reverse`,
`freezes` — the field shapes Part A's model uses. Two guards: Part A's `sourceTimeAt` is probed once for absolute vs
in-relative times, and a reversed clip's time gets −1 ms (`out − P(0)` is the first frame after the span; −1 ms shows
frame N−1−k at timeline frame k, which the reverse export test checks).

**One render path, per frame (`engine/render.ts`, `engine/fxResolve.ts`).** Position x/y, scale, rotation, opacity and
crop are sampled each frame (`poseAt`, a reused object; a clip without keyframes reads its fields as before). A clip's
`effects` and `blendMode` resolve into a pooled `LayerFx` (no allocation per frame once its LUT and key colour have been
seen); an adjustment layer (an overlay clip with `adjustment: true`) becomes an `adjust` item drawn in track order.
Footage source time is `sourceTimeAt` everywhere (monitor, golden still, export, the `<video>` fallback).

**Compositor (`engine/glCompositor.ts`).** Plain layers keep Phase 1's shader (the Phase 1 goldens are unchanged). A
layer with effects goes through one "uber" fragment shader switched by flags: sharpen (one output pixel), chroma key
(BT.709 chroma distance, tolerance/softness, spill suppression along the key's chroma direction), colour (exposure,
shadows, highlights, contrast, temperature, tint, saturation, vibrance — in sRGB, clamped), a .cube LUT (`RGB16F` 3D
texture, hardware trilinear, domain, intensity), vignette, up to 4 masks (rectangle/ellipse in the layer's own frame,
feather as a share of its shorter side, invert) and the blend mode: normal by hardware blending; multiply, screen,
overlay, add, darken, lighten and soft light (W3C formulas) by copying the frame below (`blitFramebuffer`) and blending
in the shader. Blur: the layer is first drawn at its drawn size (capped at the frame) into a framebuffer with
key/colour/LUT, blurred there in two separable Gaussian passes (radius in export pixels, scaled to the output, so
preview == export), then laid in with the rest. Adjustment layer: the frame so far → its effects → mixed back by
opacity × masks. Every sampler has its own texture unit, set once (a `sampler3D` left on unit 0 beside `uTex`
invalidated every draw — caught by the golden test). Framebuffers are made per frame size, LUT textures once per text
(4 kept), vertices go through one reused buffer.

**Effects model (`src/video/effects.ts`).** Types, parameter definitions (ranges, defaults, units), `newEffect`,
`withEffect`/`setParam`, `sanitizeEffects` (run by `migrateTimeline`: known types only, values clamped, per-type caps,
safe ids, a LUT whose text does not parse is dropped), `parseCube` (TITLE, LUT_3D_SIZE 2–65, DOMAIN_MIN/MAX,
LUT_3D_INPUT_RANGE; refuses 1D LUTs, wrong counts and stray words, with the reason), `compactCube` (what the project
stores, ≤ 8 MB; a 33-point cube is ~0.8 MB), `applyLutCpu` (reference), chroma helpers. `Clip` gains `blendMode` and
`adjustment` (timeline.ts, typed only).

**Speed playback.** Preview (`engine/previewEngine.ts`, `engine/decoder.ts`): a speed-changed clip shows the source
frame of the timeline frame under the playhead (as the export does at i/fps); forward streams decode up to the last
frame the look-ahead needs and, above 1.05×, copy only the frames that will be shown (`want` set); reverse uses
`ReverseStream`: GOP by GOP from the key frame below, each decoded forward once into the cache (its wanted frames, one
GOP of lead below the look-ahead) and shown last first; a freeze is one exact decode. Export (`exportVideo.ts`):
forward stretches through `samplesAtTimestamps`, reversed stretches through `reverseRun` (GOP chunks copied to
ImageBitmaps, ≤ 512 MB at once; a bigger GOP is decoded again for its lower part). Proxies serve the preview as before.

**Speed sound (`engine/timeStretch.ts`, `engine/pcmSource.ts`, `engine/speedAudio.ts`).** One pure-TS renderer for
preview and export. preservePitch (default): mapping-driven WSOLA — 42.7 ms Hann grains every 21.3 ms, each centred on
the source position `sourceTimeAt` gives and moved up to ±10 ms to the best normalised cross-correlation with the
previous grain's natural continuation (4× decimated search, ±4 sample refine); reverse grains read backwards;
|rate| < 0.05 (a freeze) is silent. preservePitch = false: linear-interpolated resampling (the pitch follows the
speed). Quality: tones and speech keep their pitch from 0.25× to 4× (unit tests: 440 Hz at 0.5/2/4× within 2 Hz,
click-free joins between pieces, rate 1 reproduces the input within 1e-4); below ~0.5× steady sounds get a slight
phasiness, transients smear by up to a grain, above ~4× syllables are skipped. Source PCM is read in 2 s blocks (LRU of
24), so reverse walks the blocks backwards once each. The preview schedules 0.5 s pieces on Web Audio at the context
time of their first sample. Volume keyframes: a gain curve (100 values a second) in the export and the preview.

**UI.** Inspector sections (collapsed by default; open state for the session): `EffectsPanel.tsx` — blend mode; Add
effect → Mask, Chroma key (footage only), Blur, Sharpen, Vignette; per effect on/off and remove; key colour as a hex
field plus Pick from the monitor (the key is left out of the monitor — never the export — until the click, a 5×5
average, Esc cancels). `ColourPanel.tsx` — eight sliders (double-click a label to reset), Reset colour, Load/Replace
.cube (the parser's reason when refused), LUT name and size, intensity. Overlays tab: an "Adjustment layer" card (5 s
at the playhead on the overlay track, a neutral colour effect); the inspector reads ADJUSTMENT and hides
position/rotation for it. Styles in `src/styles/video-fx.css`.

### Files
- New: `src/video/{effects.ts,EffectsPanel.tsx,ColourPanel.tsx}`,
  `src/video/engine/{animation,fxResolve,timeStretch,pcmSource,speedAudio}.ts`, `src/styles/video-fx.css`,
  `tools/e2e/video-fx-test.mjs`, `tools/unit/video-effects.test.ts`.
- Changed: `src/video/engine/{glCompositor,render,layerMath,decoder,previewEngine,audioEngine}.ts`,
  `src/video/exportVideo.ts`, `src/video/timeline.ts` (two typed fields; `sanitizeEffects` in `migrateTimeline`),
  `src/video/VideoWorkspace.tsx` (mounts the two sections and the card, ADJUSTMENT label, dev handle
  `animationSource`), `tools/fixtures/video/engine-fixtures.mjs` (greenscreen, counter),
  `tools/e2e/{video-playback-measure,video-shots}.mjs`, `tools/unit/video-timeline-v2.test.ts` (effects are validated
  now), `package.json` (`test:video` also runs the fx suite).
- No new dependencies.

### Acceptance (measured 2026-11-02 on this PC: RTX 3060, headless Edge, dev server)
| Test | Result | Measured |
|---|---|---|
| Golden frames preview == export for each effect (15 cases: colour, LUT, two masks, chroma key, blur, sharpen + vignette, seven blend modes, adjustment layer, keyframed x/scale/rotation/opacity/crop) | PASS (≤ 1 %) | mean difference 0.47–0.68 % of full scale; pixels off by > 48 levels 0.02–0.52 %. Each effect also changes the picture (2–12 % mean), so a no-op could not pass |
| LUT export vs a CPU reference frame | PASS (≤ 1 %) | 33-point cube, trilinear on the CPU over the app's decoded source frame: mean 0.62 %, 0.25 % of pixels > 48 levels (the LUT itself moves this frame 3.3 %). Against ffmpeg's own decode of the source it is 3.7 %: ffmpeg and the browser convert this untagged YUV with different matrices, before any LUT |
| Chroma key, green-screen fixture with a spill fringe | PASS (< 1 %) | green-spill pixels 83.8 % before → 0.00 % after; subject kept (204, 152, 116), screen black |
| 2× clip: length and pitch | PASS | 8 s of source → 4.01 s file; the 440 Hz tone measures 440.0 Hz (preservePitch) and 880.0 Hz (preservePitch = false); preview through Web Audio 440.3–440.9 Hz |
| Reverse clip frame order (counter fixture) | PASS | 120 frames, 119 → 0, every step −1. Also: 2× forward shows every second frame; a 1×→3× ramp's steps grow 1 → 3 |
| 1080p30, 3 layers + colour + LUT + blur, 60 s | PASS (≤ 2 %) | 2 dropped of 1,797 (0.11 %), 5,510 draws, cache 639 MB (a 30 s run: 0 of 897) |
| Preview: a 1080p clip reversed at 2× (1 s GOP, no proxy) | PASS (≤ 5 %) | 2–3 dropped of 88 (2.3–3.4 %), single frames |

### Checks
- `npm run lint`: 0 errors (warnings only, existing kinds; none in the new files).
- `npm test`: 952 passed (80 files; + `video-effects.test.ts`).
- `npm run build`: ok.
- `npm run test:video`: 78 PASS, 0 FAIL — video-test and engine-test unchanged (golden worst mean 0.72 %, 60 s
  3-layer play 0.06 % dropped, scrub p95 32 ms, A/V export 0 ms) + the fx suite above.
- `npm run test:electron`: 66 PASS, 0 FAIL.
- `node tools/audit/text-fit-audit.mjs`: 0 text-fit problems (17 deliberate ellipses; skipped steps are Editorial publish/outputs/sign-in and Home, as before). `node tools/audit/center-audit.mjs`: 0.
- Screens: `OUT=tools/out/p2-fx PORT=5293 node tools/e2e/video-shots.mjs` — 237 shots, 0 n/a, 0 failed, 0 timeline geometry problems; new states
  `effects-panel`, `colour-panel`, `lut-loaded`, `monitor-mask`, `chroma-key`, `adjustment-layer`.

### Known gaps
- Keyframe and speed UI are Part A's; until the merge the engine runs on the fallbacks (same field shapes). Filmstrips
  and waveforms on the lanes still show the source unretimed.
- Blend modes are not applied inside a crossfade (both inputs draw normal there); blur stays within the layer (its
  outer edge is not softened); colour math is in sRGB, not linear light.
- An adjustment layer ignores chroma key; a mask alone on an adjustment layer does nothing.
- Above ~3× the preview still decodes every source frame (only the shown ones are copied); at 10× on 1080p originals
  without proxies expect drops. Reverse without proxies needs a GOP decoded ahead (2.3–3.4 % drops at 2× on a 1 s GOP;
  longer GOPs are worse — proxies are all-intra).
- A 65-point LUT keeps ~5.5 MB in the project (and in each autosave snapshot).

### Next step
Merge with Part A, then rerun `npm run test:video` against Part A's speed.ts and keyframes.ts (the fx suite sets
`reverse`, `speed` and `keyframes` in Part A's shapes).

## Phase 2 — merge of Part A and Part B (2026-11-02, branch `video-pro`)

`video-p2-edit` then `video-p2-fx` merged with `--no-ff` onto 18ee407.

### Conflicts and how they were resolved
- `src/video/timeline.ts`: the `Clip` type keeps Part A's speed/freeze/reverse/pitch/keyframes/group/compound fields and
  Part B's `blendMode` and `adjustment`; `migrateTimeline` keeps both Part A's compound cleaning (recursive, so effects
  inside a compound are sanitised too) and Part B's effect / blend / adjustment cleaning.
- `src/video/VideoWorkspace.tsx`: Part A's call sites stay (`playable(viewOf(state))` for monitor, playback, sound, still
  and export). Inspector: COMPOUND / ADJUSTMENT header; position and rotation hidden for both; compound opacity slider
  as Part A had it; Effects and Colour sections mounted after Opacity for every visual clip except a compound (it is
  flattened into its clips, so it has no pixels of its own); Speed section after them. Adjustment layer card and the
  `animationSource` dev handle as Part B added them.
- `tools/e2e/video-shots.mjs`: both sets of states. `docs/VIDEO_PRO_PROGRESS.md`: both sections. `package.json` merged
  cleanly (`test:video` = video-test, video-engine-test, video-fx-test; Part A added no suite).

### Integration fixes
- **Reverse, fixed at the source.** `speed.ts sourceTimeAt` for a reversed clip is now `max(in, out − P(t) − REVERSE_EPS)`
  (1 ms): `out − P(0)` was the start of the first frame after the span. Convention (documented in speed.ts): frame k of
  a reversed clip shows source frame N−1−k. `sourceTimeUnclamped` (trims, splits) stays exact. Part B's adapter no
  longer subtracts anything and no longer probes for absolute vs relative times (Part A's is absolute by contract);
  its fallback keeps the same ε. Part A's tests updated (8 − ε, 6 − ε, 2; frame-index checks 179/177/1 at 2× and
  119 − k at 1×); Part B's reverse export test still reads 120 frames 119 → 0.
- **Compounds.** The engine still only gets flattened projects. `flattenCompounds` keeps inner clips' `effects`,
  `blendMode` and `adjustment`; a compound's opacity/volume now also scale an inner clip's opacity/volume KEYFRAMES
  (keys win over the plain field when sampled, so before this a compound at 50 % did nothing to an inside clip that
  animated its opacity). Unit-tested in `tools/unit/video-p2-merge.test.ts`.
- **Freeze-only clips.** Part B's `isPlainSpeed` tests `freezes`; covered by a unit test and a new export check (a clip
  with only a 1 s freeze shows red inside the hold and green after it). The preview sound's schedule key now includes
  `freezes`, so adding/removing a freeze reschedules the sound.
- **Lane filmstrips and waveforms** map through `sourceTimeAt` (a 2× clip's strip shows the frames it plays, a reversed
  clip's runs backwards, a freeze is silent on the waveform); plain clips keep the old fast path.
- The two PENDING-MERGE checks in `video-test.mjs` are now unconditional checks, plus one asserting the engine's
  `animationSource` is `part-a` for both models.

### Checks (2026-11-02)
- Keyframed move: left edge 432 / 720 / 1008 px at 0.5 / 1.0 / 1.5 s (right edge 911 / 1199 / 1487) — exact. 2× export:
  pixel at 0.6 s = [0, 214, 0] (green, source 1.2 s). Freeze-only: [253, 23, 0] in the hold, [0, 214, 0] after.
- `npm run test:video` (`ESB_PORT_OFFSET=40`): 90 PASS, 0 FAIL, 0 PENDING; 2 NOTEs are the Phase 1 4K30 / 10 × 1080p
  drop notes documented above (skipped draws while the GPU is busy).
- `npm run lint`: 0 errors. `npm test`: 990 passed (82 files). `npm run build`: ok. `npm run test:electron`
  (`ESB_PORT_OFFSET=40`): 66 PASS, 0 FAIL. `center-audit`: 0. `text-fit-audit`: 0 text-fit problems (18 deliberate
  ellipses; the usual Editorial publish/outputs/sign-in and Home steps skipped, as before).

### Known gaps
- An adjustment layer or blend mode inside a compound acts on everything below it on the flattened timeline,
  including the parent's clips under the compound (an NLE would composite the compound first). A compound's own
  transform, keyframes and effects are not applied (opacity and volume are).

## Phase 2 fix round (2026-11-02, branch `video-p2-fix`)

From `video-pro` ed6b06b (Phase 2 merged). The security, correctness and performance reviewers' findings, each
re-checked against the code before it was fixed (all were real), each with a regression test in
`tools/unit/video-p2-fix.test.ts` (40 tests; the reviewers' probes reused where they measured something). In parallel a
UI fixer works on the screenshot findings (`video-p2-ui`); this round kept to logic, data and engine files and touched
their files only where the logic needed a hook (listed under Files).

### Security / input
- **S1 fixed.** `migrateTimeline` no longer copies keyframes, ramps and freezes as they are: `sanitizeKeyframes`
  (keyframes.ts: a plain object read through a null-prototype copy; property names only from `PROPS` or
  `fx.<one of the clip's own effect ids>.<a numeric parameter of that effect>`; at most 64 properties × 1000 keys;
  finite `t` 0…1e5 and `v`; known eases, a bezier of four finite numbers with x clamped 0..1 and y −10..10; sorted, one
  key per moment), `sanitizeSpeed` (finite constant clamped 0.1–10, 1 → unset; or a ramp through the same key cleaner,
  speeds clamped, ≤ 256 keys), `sanitizeFreezes` (finite `at` ≥ 0, 0 < `dur` ≤ 3600, ≤ 64, sorted, overlaps merged),
  `reverse` only `true`, `preservePitch` only `false`, `srcDuration` finite ≥ 0, `linkId`/`groupId` short strings, every
  time ≤ 1e5 s, `out ≥ in`. All seven crafted cases of the reviewer's probe (+ `__proto__`/`constructor` names) load and
  every inspector, engine and edit function on them runs without throwing. **Error boundaries:** `src/ui/DeskBoundary.tsx`
  around every desk in `App.tsx` (Home, Editorial, Graphics, Video, Outreach) and a second one inside the Video desk whose
  "Try again" reopens it with nothing selected, on the main timeline, paused (project and undo history kept); "Go to
  Home" leaves. A render error now shows that card in the desk's place instead of a blank window (screenshot state
  `desk-error`: crafted keyframes put straight into the store, past the open-time cleaning).
- **S2 fixed.** After S1 Part A's speed.ts no longer throws on file input, so the fallback is rarely used; it was fixed
  anyway: `engine/animation.ts` reads a clip's ramp and freezes once per array (WeakMap caches, capped at 256 keys /
  64 freezes) and integrates the piecewise-linear ramp exactly (trapezoids between keys, minus the frozen spans) instead
  of `ceil(t·240)` steps that re-filtered and re-sorted per step: a 600 s, 200-key ramp with a freeze runs well under
  2 ms per look-up alone (the test's bound is 10 ms, for a loaded suite; was 72–881 ms), and equals a 200,000-step midpoint sum to 1e-5. speed.ts's `Math.max(...fs.map())`
  spread is gone (the table no longer needs it, see P6); freezes are filtered and sorted once per array (`freezesOf`).
- **S3** = C1.
- **S4 fixed.** Compound clips nest at most `MAX_COMPOUND_DEPTH` = 16: deeper insides are emptied on open (3,000 levels
  open and save as a < 200 kB file; they overflowed the stack before), and `makeCompound` / Ctrl+Alt+G refuse past it
  with a note (the store passes the open compound's depth). Project JSON (`projectJson`, used by
  `serializeVideoProject`, `buildProjectDoc` and the Phase 0 single file) is indented only while it is ≤ 1 MB compact,
  compact above that.
- **S5 fixed** by S1's whitelist: a `__proto__` key is just a name that is not allowed; the cleaned objects are built
  from allowed names only.
- **S6 fixed.** On open, a clip's `sourceUrl` and an asset's `url` from the file are never kept (only this run's
  `esb-media:`/`blob:` URLs could be, and those are never saved), so a crafted `https://…` or `file:` URL can no longer
  make mediabunny's UrlSource or the sound reader fetch it: such a clip is offline until relinked. Thumbnails keep only
  inline `data:image/(png|jpeg|webp)` pictures (< 2 MB), which an `<img>` cannot fetch anything with.

### Correctness
- **C1 fixed (HIGH).** A LUT's text is kept once per project by content id. `effects.ts`: `lutId(text)` (64-bit FNV-style
  hash + length), `registerLut` (parses once, keeps the text in a session registry; content-addressed, so the undo
  history and other projects can never disagree), `lutText`, `lutOf(effect)`, `lutsUsed(clips)`. A clip's LUT effect
  carries `params.lut = <id>`; the project file carries `luts: { id: text }` for the ids its clips use
  (`serializeVideoProject`); open registers each text once and maps the file's keys (`deserializeVideoProject` →
  `migrateTimeline` → `sanitizeEffects(…, lutRef)`); an older file with the text inline in each clip is migrated to one
  id; an in-memory effect that still carries `cube` (the engine tests set one) is registered on first use. Splits and
  pastes copy the id only: a 65-point LUT on a clip split four times saves at < 1.2 × the LUT text with ONE copy (was
  5 copies, 27.6 MB, over main's 25 MB cap). Budget: at most 8 distinct LUTs and 16 MB of LUT text per project; the
  Colour panel refuses a LUT over it with the reason. Save and autosave failures are loud: a project text over 25 MB is
  refused before main with "the project is N MB, over the 25 MB a project may be…" (`projectIO.checkedSize`), a failed
  autosave shows a status-bar note ("Autosave failed: … Your work is not saved yet — try Save (Ctrl+S)") once per reason
  besides the persistent "Unsaved · autosave failed" label, and Save failures already flashed.
- **C2 fixed (HIGH).** `keyframes.ts insertKeyAt` splits a segment exactly: the cut is found on the ease's cubic bezier
  (u solved to ~1e-12; `cubicBezier`'s tolerance went from 1e-7 to 1e-12) and split with de Casteljau; each half is
  renormalised into a key whose ease is the sub-curve (`'bezier'` + points), so the sampled curve is identical before and
  after. `cutKeyframes` (trims, splits, `subClip`, ramp cuts) inserts keys at both cut edges this way. Measured: easeIn /
  easeOut / easeInOut / an overshooting custom bezier, split anywhere: max difference < 1e-6 over 400 samples; the
  easeInOut opacity split at 3 s and the rampUp / hero / bullet / montage ramps split at 2 s, tail-trimmed and
  head-trimmed play the same source time at every moment (< 1e-6; the reviewer measured ~0.43 s skipped at the cut).
  Not exact only for an overshooting curve whose cut lands on its start or end value (no bezier from v to v can hold the
  bump): there the old behaviour is kept and `exact: false` says so. Retimed forward `sourceTimeAt` clamps to `out`.
  Note: an eased key that was split now reads as "Custom curve" in the ease menu (it is one).
- **C3 fixed.** `withFreeze` on a ramp splits the ramp exactly at the freeze point and moves only the curve after it:
  a flat key at `at` and the split key's copy at `at + dur` carry the rest of the curve. Every frame before and after
  the freeze plays as before (rampUp and hero, < 1e-6); `withoutFreeze` closes it back up to the same mapping.
- **C4 fixed.** `retimeClip` returns the project unchanged when the ripple is refused (it used to apply the change and
  overlap clips). The speed panel already said why; Paste attributes now reports "N kept their speed: the change would
  move a clip linked to one on a locked track" (`pasteAttributes(…, report)`, store returns `{ ok, refused }`).
- **C5 fixed** (simplest correct rule): a compound covers `[first start, last end]` on its home track, so a clip on that
  track inside the span that is not selected is refused with a note naming it ("… lies inside that span but is not
  selected; the compound clip would cover it. Select it too, or move it." — `compoundProblem`, store `compoundIssue`).
  Data side of the UI review's "compound labelled Caption (empty)": a compound of titles and captions took the kind of
  the first track in the list (the caption track); the home track is now a video track, else an overlay track, else a
  text track, so it is an overlay compound. A compound of captions only is still a caption-kind clip (the caption track
  takes nothing else): the label and inspector must test `clip.compound` (UI fixer).
- **C6 fixed (partly, the rest Planned).** `flattenCompounds` applies the compound's opacity and volume KEYFRAMES to
  its inside: the compound's keys are cut exactly to each inner clip's window (C2's machinery); keyed × plain is the keys
  scaled (exact), keyed × keyed is sampled every 1/60 s and at every key (within 2e-3 of the product). A compound's own
  position, scale, rotation, crop and effects are NOT applied, so they are not offered: `attrGroupsFor(compound)` is
  opacity, volume and keyframes (opacity/volume keys only), and the inspector already hides the transform rows for it.
  Composing a compound's transform onto footage, stills and full-frame titles is Planned (crop cannot be composed per
  clip at all; it needs the compound drawn into its own layer first).
- **C7 fixed.** A marker's name is typed into a draft and committed once on Enter or blur (Esc restores): one undo
  step per edit (`TimelinePro.tsx MarkerName`); e2e check "Typing a marker name and pressing Enter is one undo step".
- **C8 fixed.** `rippleShift` returns the markers rippled with the clips (`rippleMarkers`): markers at or after the edit
  point move by the amount actually used; one inside a span that closed lands where it closed (never dropped). Ripple
  delete, ripple trim, extract, insert and speed changes use it. Option `project.rippleMarkers` (default on, saved when
  off), a switch "Markers follow ripple edits" in the Markers list, one undo step.
- **C9 fixed.** A freeze at the clip's end holds the last frame: `clipDurationFor` counts a freeze that starts where
  the content ends (constant speed and ramps; the engine fallback too), and the held frame is `out`'s (clamped).
- **C10 fixed.** `sanitizeEffects` reports the ids it renamed (a duplicate or an unsafe id); `sanitizeKeyframes` copies
  `fx.<old>.*` keys to `fx.<new>.*` before the whitelist, so a renamed effect keeps its animation.
- **GAP fixed.** Paste attributes has "Effects, colour and blend" (`effects`, `blendMode`, and the effects' own
  `fx.<id>.*` keys); pasting Keyframes onto a clip drops effect keys for effects it does not have.

### Performance (lead's review)
- **P1 / P8 fixed** with C1: each distinct cube is parsed once per session (`registerLut` → `cachedCube(text, id)`;
  opening a project, `describeSnapshot` and every split/paste reuse it), and the parse cache and the compositor's 3D
  texture cache are keyed by the LUT id, never by the multi-MB text (a Map look-up of that text hashed it per frame).
- **P2 fixed.** Forward decode streams keep frames above the highest index the look-ahead wants (`FrameStream.wantMax`);
  only skipped indexes below it are closed. Hero-moment ramp preview check added to `video-fx-test.mjs` (≤ 2 %).
- **P3 partly fixed.** The audio engine keeps a `PcmSource` per URL across play/seek restarts (4 idle ones kept), so a
  restart no longer decodes its source blocks again. Moving the WSOLA stretcher to a Worker: deferred (it needs the
  stretcher and its PCM windows behind a message protocol; the cost is ~10 ms per 0.5 s piece per clip on this PC —
  next in line).
- **P4 deferred.** The reverse export of long-GOP 4K footage still re-decodes a GOP for each 512 MB chunk; decoding each
  GOP once needs frames copied at a bounded (downscaled) size, which trades quality for a zoomed clip — a decision for
  the lead. Proxies/all-intra sources are unaffected.
- **P5 fixed.** Frame-cache windows carry their direction: a reverse stream's window counts "needed later" from its top
  (the playhead), so over budget the cache evicts the frames it needs last, not next (`FrameWindow`).
- **P6 fixed.** The ramp table's cells end on every key and freeze edge and are integrated with 3-point Gauss–Legendre
  (≤ 200 cells a second, ≤ 40,000), and a time inside a cell is integrated the same way from its start: accurate to
  ~1e-9 s, about 25× fewer cells than the 1 ms table, and independent of the clip's length (one table per committed
  ramp; `withRamp` building with the old length costs nothing extra). A 600 s eased ramp: the first `clipDurationFor`
  builds the table (bound 250 ms in a loaded suite; a few ms alone), another length reuses it (bound 30 ms).
- **P7 deferred** (large-radius blur as a downsample chain): shader work that needs the blur goldens redone; the current
  blur is correct, only slower and slightly banded past ~40 px.
- **P9 partly fixed.** `fxResolve` no longer builds `fx.<id>.<key>` strings or searches the parameter list per frame
  (made once per effect id and key), freezes and ramps are filtered/sorted once per array in speed.ts and the engine
  adapter, the table's spread is gone. `render.ts`'s per-frame quad arrays: not changed (left with the renderer's owner).

### Files
- Logic/data/engine: `src/video/{keyframes,speed,timeline,effects,videoStore,projectIO,projectFolder}.ts`,
  `src/video/engine/{animation,fxResolve,decoder,previewEngine,frameCache,audioEngine}.ts`; new `src/ui/DeskBoundary.tsx`;
  `src/App.tsx` (each desk wrapped).
- Small hooks in UI-owned files (for the UI fixer's merge): `ColourPanel.tsx` (stores the LUT id and checks the budget;
  ~12 lines), `TimelinePro.tsx` (MarkerName draft input, the ripple-markers switch, the Paste attributes note),
  `VideoWorkspace.tsx` (the desk's own boundary, the autosave-failure note, Ctrl+Alt+G's reason, dev handles
  `rampPreset` and `lutText`).
- Tests: `tools/unit/video-p2-fix.test.ts` (new), `tools/e2e/video-test.mjs` (marker name = one undo step),
  `tools/e2e/video-fx-test.mjs` (Hero ramp preview; the LUT import checks the id), `tools/e2e/video-shots.mjs`
  (`desk-error` state).

### Checks (2026-11-02, `ESB_PORT_OFFSET=40`)
- `npm run lint`: 0 errors (warnings only, existing kinds). `npm test`: 1030 passed (83 files; + 40 in
  `video-p2-fix.test.ts`; one run had a timing test fail under load, so its bounds were made generous; the next full runs were green).
  `npm run build`: ok.
- `npm run test:video`: 93 PASS, 0 FAIL (video-test, engine-test, fx-test); new: Hero-moment ramp preview 0 dropped of
  184 frames (≤ 2 % required), the LUT import stores an id (`lut-93147a8b159c7362-h7ba`, 802,630 chars once); goldens,
  reverse 119 → 0, 2× pitch 440/880 Hz, 30 s 3-layer FX play 0.22 % dropped unchanged. `video-test.mjs` rerun after the
  marker check was added: 55 PASS, 0 FAIL ("Typing a marker name and pressing Enter is one undo step": history 5 → 6; the
  first try found 2 steps — Enter's blur committed again — fixed).
- `npm run test:electron`: exit 0, 66 PASS, 0 FAIL.
- `text-fit-audit`: 0 text-fit problems (17 deliberate ellipses). `center-audit`: no problems.
- Screens: `OUT=tools/out/p2-fix PORT=5292 STATES=desk-error,markers,paste-attributes,lut-loaded,colour-panel,
  compound-clip,compound-open,speed-panel,speed-ramp,keyframe-lane node tools/e2e/video-shots.mjs` — 60 shots, 0 n/a,
  0 failed. Looked at: the Video desk's error card (message, Try again, Go to Home), the Markers list with "Markers follow
  ripple edits", Paste attributes with "Effects, colour and blend", a loaded LUT (name, 17³) and a titles + caption
  compound now on V2 labelled COMPOUND (no caption fields).

### Known gaps
- C6: a compound's own position, scale, rotation, crop and effects are not applied (and not offered) — Planned; its
  opacity/volume keys are. Keyed × keyed opacity is sampled at 60 Hz (within 2e-3).
- C2: an overshooting custom curve cut exactly at its start/end value keeps the old approximate split (`exact: false`).
- P3 (stretch in a Worker), P4 (reverse 4K export decodes long GOPs more than once), P7 (large-radius blur chain) and the
  render.ts part of P9 are deferred (reasons above).
- The LUT registry keeps every LUT text seen in the session (needed while undo can bring one back); at most a few
  tens of MB in practice.

### Next step
Merge with the UI fixer's `video-p2-ui` (overlaps: `TimelinePro.tsx`, `VideoWorkspace.tsx`, `ColourPanel.tsx` — small
hooks listed under Files), then P3's Worker stretcher before Phase 3.

## Phase 2 UI fix round (2026-11-02, branch `video-p2-ui`)

Worked from the reviewer's notes on `phase-2/after`. Every item re-checked on the shots first, then in the app at
900 / 1366 / 1920 in both themes. Files: `EffectsPanel.tsx`, `ColourPanel.tsx`, `TimelinePro.tsx` (visual parts),
the inspector and timeline display in `VideoWorkspace.tsx`, `styles/video.css`, `tools/e2e/video-shots.mjs`, one
line in `tools/audit/text-fit-audit.mjs`.

### What changed
1. **The shell no longer scrolls.** `.video-workspace`, the stage row, bin, monitor, inspector and timeline columns
   are `overflow: clip` (Outreach's fix), and the inspector never calls `scrollIntoView`: opening a section scrolls
   the inspector's own scroller (`revealInInspector`) so the section sits under the sticky head. The harness no
   longer scrolls anything itself; `section-jump` and every state's geometry check report any desk scroll.
2. **Compound clips** read "Compound · N clips" on the block and in the status bar (a renamed one keeps its name).
   The inspector header says COMPOUND with the name; the body is name, Open / Break apart, Opacity, metrics — no
   caption field, no sections. (Data: see "For the lead".)
3. **Chroma key row**: label · 24 px swatch · hex · Pick on one 32 px grid row (the hex field keeps a half-typed
   value). Picking shows a banner on the monitor ("Click the screen colour · Esc cancels") and a loupe beside the
   pointer with the current key and the colour under it.
4. **Adjustment layer** (Overlays tab card): it goes on its own track named "Adjustment", made at the top of the
   picture tracks (captions stay above) the first time and reused after; track + clip are one undo step. So it no
   longer stacks on V2 with the titles (17 px rows) and it only greys what is below it.
5. **Inspector at 1366×768**: a sticky head (kind word, clip name, delete, close) with a jump strip under it
   (Transform/Sound/Opacity · Speed · Colour · Effects · Keys — the shared segmented control, only the sections the
   clip has). Every section is an accordion (`useInspectorUi`, one open at a time, Transform on launch; a section
   the next clip lacks falls back to the first). New Keyframes section: previous / next key, each animated property
   with its key count and "Show" (the lane shows just that property, with its curve). At 900 the tabs are replaced,
   while a clip is open, by a bar "‹ Media · CLIP INSPECTOR" that goes back.
6. **Keyframe lane**: 34 px lane and head, 28 px targets, 10–12 px shapes (diamond linear, dot eased, `--warning`
   diamond custom, square hold) ringed in the page colour, keys at the clip's ends drawn 8 px inside it, a legend
   held at the lane's right edge, 28 px property select. The balanced timeline height grows by the lane, and the
   "N more tracks" cue now counts a track more than 8 px cut (it counted only tracks wholly below).
7. **Curve editor**: 240 px square, 28 px grips (a transparent 14 px-radius hit circle), grid, x1 y1 x2 y2 number
   fields (Enter / blur commit, Esc reverts), presets Linear · Ease in · Ease out · S-curve · Overshoot (the current
   one shown selected) and Hold, Done. It opens over the bin column under the header, so it never covers the
   monitor's transport. Hold is also in the ease menu.
8. **Speed**: field (32 px) + 0.5× 1× 2× 4× as the shared segmented control (the selected one is the raised chip,
   dark-mode chip in dark); "Add a ramp / Change ramp" + "Freeze frame" share the next 32 px row. Freeze stays
   hoverable when it cannot act: its tooltip and a one-line hint say why (outside the clip, already on a freeze,
   locked). While a ramp runs the field reads "Varies" (typing a speed makes it constant).
9. **Ramp graph**: 11 px labels in a 40 px gutter, a time axis (0, middle, end in seconds), the end point clear of
   the labels; the hint uses non-breaking hyphens so "right-click" never splits.
10. **Masks on the monitor**: with Effects open, the mask being edited (the first enabled one, or the one last
    clicked; marked "On the monitor") draws its outline, the feather edge (dashed) and four corner grips plus a
    feather grip over the monitor, placed by the clip's pose at the playhead (fit/scale/offset/crop/rotation, the
    still's slow zoom). Drag inside to move, a corner to resize (the opposite corner stays), the round grip sideways
    to feather; each drag is one undo step.
11. **Markers**: flags and names live in the ruler's lower band, so "0:05.0" is never covered; a name stops before
    the next flag (hidden when there is < 28 px). The in–out band is labelled "In–out · 3.0 s" with a tooltip.
12. **One time format**: the markers list and flag tooltips use the header's timecode (00:00:08:06); the separate
    "6f" column is gone.
13. **Track names** (display only): picture tracks are numbered from the bottom (V1 lowest), text / caption / sound
    tracks from the top, so the numbers follow the order on screen; a default name is the kind, numbered when two
    share it ("Footage", "Footage 2"); a name the editor gave (or "Adjustment") is kept. Used in the headers, their
    aria labels, the track menu heading, "Added …" and the linked-clip note. Track ids are unchanged.
14. **Compound breadcrumb**: neutral surface (no lavender), 36 px bar, 28 px Back and crumbs, "Plays on its own" at
    narrow widths.
15. **Shortcuts sheet**: mouse actions are words, keys are keycaps ("Enter / double-click"); a "More below" fade
    shows while the list scrolls.
16. **900 px toolbar**: Markers and Delete have aria labels and tooltips with their keys (Delete says to select a
    clip first when disabled).
17. **LUT row**: "17-point cube" (tooltip 17×17×17); Load/Replace .cube, Reset colour and Add effect are 28 px.

### Harness (`tools/e2e/video-shots.mjs`)
- New states: `adjustment-track`, `inspector-scrolled`, `section-jump`, `mask-handles`, `chroma-pick`,
  `curve-numeric`, `toolbar-tip`. `monitor-mask` is shot in both themes. `openSection` uses the jump strip (as an
  editor would) and no longer scrolls anything; the speed states open Speed first; `adjustment-layer` adds the layer
  with the Overlays tab's card.
- Geometry check (every state): keyframe lane level with its header, no diamond cut by the lane edge, a track cut
  more than 8 px at the foot must come with the "more tracks" cue (it missed A1 under the keyframe lane), and the
  desk / document never scrolled.

### For the lead (logic side)
- **Compound kind**: `makeCompound` gives a compound of titles + caption `kind: 'caption'` and puts it on C1 (its
  `home` is the first used track when none is footage, and `kind` follows that track). The UI now checks
  `clip.compound` first everywhere it labels or inspects, but the clip's kind is still "caption" in the data (a
  caption-only lane holds a picture compound). Suggest: a compound of mixed kinds = `overlay` on the top picture
  track among them.
- **Adjustment layer on its own track**: confirmed the render only greys what is below. In the old shots the layer
  sat on V2 with the lower third and greyed it too (same track, earlier in the list) — the per-spec answer is that a
  layer affects tracks below only; a clip on the same track is not "below". With the card now making its own track
  this no longer happens from the UI, but the engine still applies an adjustment to a clip on its own track that
  starts before it (`layersAt` orders a track's clips by start, and `renderFrame` adjusts everything drawn so far).
  An adjustment layer placed by hand on a title track still greys those titles. Engine is yours.
- **Data change made (smallest)**: a `hold` ease, for the curve editor's Hold preset — `Ease` type (`timeline.ts`),
  `EASE_LABEL` / `easeName` / `easePoints` / `applyEase` / `setKeyEase` (`keyframes.ts`), the fallback `ease()` in
  `engine/animation.ts`. Unit test `tools/unit/video-p2-ui.test.ts`. Nothing else in the data model changed.
- The marker-name input (your undo fix) was not touched; the time button and frame column next to it were.

### Checks (2026-11-02, `ESB_PORT_OFFSET=80`)
- `npm run lint`: 0 errors. `npm test`: 993 passed (83 files, +3 in `video-p2-ui.test.ts`); one run of four had a single
  unrelated failure that did not repeat (timing). `npm run build`: ok.
- `npm run test:video`: 91 PASS, 0 FAIL; 1 NOTE = the known Phase 1 10 × 1080p drop note (2.6 %, skipped draws while
  the GPU is busy).
- `text-fit-audit`: 0 text-fit problems (21 deliberate ellipses, incl. the inspector head's clip name, which has a
  tooltip). `center-audit`: 0.
- `video-shots.mjs` → `tools/out/p2-ui`: 354 shots, 0 n/a, 0 failed, 0 geometry findings. Looked at every touched state
  in both themes at 900 / 1366 / 1920.

## Phase 2 fix rounds merged (2026-11-02, `video-pro`)

`video-p2-fix` (e58ccaf) then `video-p2-ui` (a8353dc) merged with `--no-ff`. Conflicts were only in the markers list
(`TimelinePro.tsx`: the logic side's `MarkerName` draft input + the UI side's header-timecode time button), the
`VideoWorkspace.tsx` imports and these notes; every logic hook (DeskBoundary, autosave-failure note, Ctrl+Alt+G reason,
ripple-markers switch, paste-attributes speed note, LUT id + budget, dev `rampPreset`/`lutText`) is in the UI's design.

### Seams fixed after the merge
- **Hold ease × the logic side.** `sanitizeKeyList` accepts `hold` (it was missing from the whitelist, so a saved hold
  came back linear). `insertKeyAt` splits a hold segment into two holds (it went through the bezier path with
  `easePoints(hold)` = the diagonal and turned the step into a ramp); `cutKeyframes` (trim, split, sub-clip) inherits it.
  A compound's keyed × keyed opacity also samples a moment just before every key, so a held step stays a step instead
  of a 1/60 s ramp. Tests: `tools/unit/video-p2-merged.test.ts`.
- **Adjustment layer = tracks below only** (the UI fixer's note). `renderFrame` put an adjustment after every draw so
  far, which included clips on its own track that start earlier (`layersAt` orders a track by start). It now goes in at
  the start of its own track's draws, so it acts on the tracks below and never on a clip beside it. Unit test (draw
  order, same as the layer on its own track between V1 and V2) and a browser golden in `video-fx-test.mjs`: a lower
  third on V2 with an adjustment layer later on V2 = the lower third on a track above (0 % difference) while the
  footage is still greyed (37.7 %).
- **Compound inspector** shows Volume when the compound holds sound, matching `attrGroupsFor(compound)` (opacity,
  volume, keyframes); no transform, crop or effects.
- **Markers list**: the timecode button is tabular and 92 px minimum, so the name fields line up row to row.

### Checks (2026-11-02, `ESB_PORT_OFFSET=40`)
- `npm run lint` 0 errors · `npm test` 1041 passed (85 files) · `npm run build` ok.
- `npm run test:video` 94 PASS, 0 FAIL, 1 NOTE (the known 2 × 4K30 drop note, GPU busy).
- `npm run test:electron` 66 PASS, 0 FAIL. `text-fit-audit` 0 problems (20 deliberate ellipses), `center-audit` 0.
- `video-shots.mjs` → `tools/out/p2-merged`: 360 shots, 0 n/a, 0 failed, 0 geometry findings. Looked at compound-clip,
  markers, keyframe-lane, curve-editor, speed-panel, speed-ramp, lut-loaded, effects-panel, desk-error and
  adjustment-track in both themes at 1366 and 900.

---

## Phase 3 pre-build (titles & data cards) (2026-11-02, branch `video-pre-titles`)

Pure, tested libraries for Phase 3 in `src/video/titles/` (barrel `index.ts`). **Nothing is wired yet**: the
engine, compositor, timeline and UI do not import them. The Phase 3 session integrates them and passes the gate.

### APIs
- **`segment.ts`** — `graphemes(text)` (Intl.Segmenter clusters; `joinConjuncts` re-joins a hasanta-split conjunct
  on engines without Unicode 15.1 GB9c; ZWNJ respected), `breakTokens(para)` (Segmenter words; punctuation stays on its
  word, break after a hyphen/en dash), `hasBanglaText`.
- **`layout.ts`** — `layoutTitle({ text, font, maxWidth, align, maxLines }, measure)` → lines / words / grapheme
  clusters with x offsets measured as prefix widths (browser shaping respected), baselines from the Inter / Hind
  Siliguri metrics in `core/fonts.ts`, `truncated` + ellipsis past `maxLines`, over-long words split between clusters.
  The `Measurer` is injected (`canvasMeasurer(ctx)` in the app, a fake in tests); `createLayoutCache()` = lay out once.
- **`anim.ts`** — `TextAnimSpec { duration, in?, out? }`, `AnimPhase { effects: fade|appear|slide|scale|blur|mask,
  unit: all|line|word|grapheme, duration, delay, stagger, easing, direction, distance, fromScale, blurPx, order }`;
  `evalTextAnim(spec, tLocal, layout)` → `{ unit, states[{opacity, dx, dy, scale, blur, clip}], block, settled,
  hidden }` (the finer of the in/out units; the out phase ends exactly at `duration`). Presets: `typeOn(cps)`,
  `wordByWord`, `lineByLine`, `slide(dir)`, `scaleIn`, `fade`, `maskReveal(dir)`, `blurIn`. `easing.ts`: named
  curves, `esb` = cubic-bezier(0.16, 1, 0.3, 1), any bézier; the ends are exact.
- **`draw.ts`** — `drawTitle(ctx, layout, animFrame | null, style, { x, y, karaoke })` (Canvas 2D / OffscreenCanvas):
  fill or linear gradient, stroke, shadow, background box (block or per line), italic as the Graphics desk's 12°
  shear. Settled units are drawn as whole words (exact shaping); moving units piece by piece (a cluster at least).
- **`karaoke.ts`** — `matchTimings(layout, timings)`, `karaokeState(timings, t)` → the active word and past words;
  style `karaoke { past, active, future, activeBox }`.
- **`brand.ts`** — `ESB_BRAND` (name, kicker, esbpowerline.com, Facebook esbpowerlineofficial, YouTube @esbplbd),
  `FIXED_LABELS` (BREAKING / ব্রেকিং, Source: / সূত্র:), `BRAND_TEXT` (the only fixed strings a template may emit),
  `CATEGORY_PALETTE` 01–08 (CLAUDE.md §6), `resolveAccent`, `inkOn`, `fontFor(text, role, size)` (Inter 800/700/500
  roles, kicker .09em, numbers −.02em; Bangla → Hind Siliguri, no tracking, +2 px leading), `FRAME_SIZES`,
  `safeRect(w, h, { platform, config })` with `DEFAULT_SAFE_ZONES` (title-safe 90 %; 9:16 Reels/Shorts: bottom 20 %,
  right 13–14 %, top 8 % — a config).
- **`kit.ts`** — `lowerThird`, `nameStrap`, `headlineCard`, `breakingStrap`, `quoteCard` (quote + speaker + role +
  optional photo slot), `sourceLine` (nothing unless a source is given), `endCard` (logo slot = the protected
  `esb-logo`, drawn as-is). Each takes fields + `{ frame, measure, editor, platform, accent | categoryId, duration }`
  and returns a `TitleSpec` (`spec.ts`: text / rect / image / chart elements; each text has an `origin` input | brand |
  data and its `field`). Empty field: editor → dimmed label (`placeholder: true`); export → left out.
- **`grid.ts`** — `parseGridDay(json, isoDate)` (typed and checked; refuses a file for another day),
  `readMetric(day, id)` for evening/day peak generation and demand, max/min generation, energy generated / demand /
  not served, gas to power, max temperature, highest hourly load shed (with its hour), load shed at the evening-peak
  hour; `fuelMix`, `zoneSeries(demand | loadShed | generation)`, `zoneShedPct`, `hourlySeries`; `sharesOf` (derived);
  `gridSourceLine(dateLabel)`. Unpublished = null, never 0.
- **`numbers.ts`** — `formatExact` (the stored digits, grouped, optional Bangla digits; never rounded),
  `countUpText(spec, t)` (same decimals while counting, exactly `formatExact(target)` from the end on).
- **`charts.ts`** — `drawChart` bar / line / donut (ESB palette, or the site's own fuel colours), exact value labels.
- **`dataCards.ts`** — `gridNumberCard(figure, opts)` (label, count-up figure, unit · hour, source line, "Derived:
  formula" when derived), `gridChartCard(series, kind, opts)`.
- **`render.ts`** — `renderTitleSpec(ctx, spec, t, { measure, image, karaoke })` draws a whole spec (an export spec
  never draws placeholders); `settleTime` / `exitTime` / `titleIsStatic` tell the compositor when the raster stops
  changing.
- **`validate.ts`** — `validateTitleSpec(spec, { measure })` / `assertExportable`: required field empty, placeholder
  element, filler text (lorem ipsum, TBD, XXX, `[Name]`, `{{…}}`, `<name>`, "Your … here", the kit's own labels; an
  editor's `[insertion]` in a quote is allowed), text that no longer equals its field, brand text not in `BRAND_TEXT`,
  a data card without its source line, text cut by its line limit.

### Data source (verified in the website repo, read-only)
- URL: `https://esbpowerline.com/data/daily/<YYYY-MM-DD>.json` (`lib/data/grid/date-utils.ts dailyReportPath`); days
  published since the last deploy: `https://esbpowerline.com/api/data/daily/<date>.json` (same shape).
- Shape: the site's `GridDailyData` (`lib/data/grid/types.ts`): `systemStats` (+ `peakTimes`), `generationData`,
  `zoneGenerationData`, `regionalDemandData` + `regionalDemandSource`, `hourlyLoadData`, `borderImportsData`, … Units
  are not in the file: MW (peaks, zone demand/shed, hourly), MKWh (energy totals, fuel mix, zone generation), MMCFD
  (gas to power), °C. `systemStats.date` reads "21 Oct 2026"; the card shows it as stored.
- Derived values in the file, labelled as such here: `regionalDemandData[].pct` (loadShed ÷ demand × 100, rounded
  to 1 by the site's parser), zone demand when `regionalDemandSource` ≠ `p1-published`, `avgProductionCost` (not
  exposed). Fuel shares are computed here (`sharesOf`) and carry their formula.
- **Access is gated** (`middleware.ts`, `daily-access.ts`): production needs a same-site Referer/Origin, a non-bot
  user agent (node-fetch, curl, headless… are refused) and a date inside the tier window (visitor 7 days, member 30,
  paid plans longer). A plain fetch from the Studio will get 403.
- Fixture: `tools/fixtures/video/grid-daily-2026-10-21.json`, an unmodified copy of the site's public grid file for
  2026-10-21 (PGCB statistics and outage notes about substations and lines; no personal data).

### Tests
`tools/unit/video-titles.test.ts` (46): conjuncts ক্ষ / স্ত্র stay one cluster (built from code points), the
hasanta-join fallback, break tokens; layout with a fake measurer (offsets, alignment, truncation, a Bangla over-long
word); animation states at key times for every preset, the out phase, mixed units; karaoke; every template emits only
its inputs + `BRAND_TEXT` and validates; placeholders are editor-only; category accent; safe areas for 16:9 / 9:16 /
4:5 / 1:1 (9:16 inside the Reels zones); validation cases; the reader on the real fixture (values equal the JSON,
date check, null not 0, derived labels); exact formatting and the count-up's final value; data cards; a string scan
for invented names/figures in `src/video/titles`; a pixel smoke test with the optional `@napi-rs/canvas` (a lower
third is empty at t = 0 and at its end and drawn when settled; a donut card), skipped automatically if that native
module is absent. Checked by eye (napi canvas renders): lower third, breaking strap, Bangla quote card 9:16, big
number 9:16, zone bars 4:5, fuel donut 1:1, end card.

### Checks
- `npm run lint`: exit 0, no findings in the new files.
- `npm test`: 969 passed (80 files).
- `npm run build`: ok.

### What Phase 3 must still wire
- Timeline/clip model: a title clip carrying `{ template, fields, anim overrides, accent/category }`; build the spec
  with `editor: true` for the monitor and `editor: false` for export, and call `assertExportable` before an export.
- Compositor: rasterise with `renderTitleSpec` into the existing text-texture path, keyed by content + `t` only while
  `!titleIsStatic` (count-ups and in/out phases), then by content alone; pass the ESB logo and photos through `image`;
  wait for `document.fonts` before measuring (`canvasMeasurer` caches widths per font).
- Grid fetch: through main with the staff session or a same-site request (the static URL refuses direct access), a
  date + metric picker, and the card built from `parseGridDay` (acceptance: the number equals the JSON value).
- Decide the category palette: CLAUDE.md §6's 01–08 colours (used here) differ from the site's 10 categories that
  Editorial stories carry (`src/core/tokens.ts`); an explicit story accent already wins in `resolveAccent`.
- Karaoke captions need Phase 5 word timings; the intro/outro bumper, stickers and shapes are not started.
- Tabular numerals: canvas cannot switch on Inter's `tnum`, so digits may shift slightly while a figure counts up.
