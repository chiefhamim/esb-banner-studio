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

---

## Phase 4/5 pre-build (libraries) (2026-11-02, branch `video-pre-audio-ai`)

Pure TypeScript processing libraries for Phase 4 (audio) and Phase 5 (AI editing), with tests. **No UI and no engine
wiring**: those phases add the panels, the mixer/export hookup and the review flows, and pass the gate then. Every
module takes `Float32Array` PCM (one array per channel) and returns new arrays or plain data; nothing touches the DOM.
Every AI or detector result is a proposal/draft (`applied: false`, `draft: true`), never applied here.

### Modules and APIs

`src/video/audio/`
- `fft.ts`: `FFT` (radix-2, in place), `hann`, `downmix`.
- `loudness.ts`: EBU R128 / BS.1770-4. `kWeighting(sr)` (libebur128's bilinear form, so 48 kHz gives the published
  coefficients), `measureLoudness(channels, sr)` → `{ integrated, range, rangeLow, rangeHigh, momentary[],
  shortTerm[] (every 100 ms), momentaryMax, shortTermMax, truePeak, samplePeak, truePeakPerChannel }` (absolute −70 /
  relative −10 LU gate; LRA −20 LU gate, 10th–95th percentile; weights 1/1/1/0/1.41/1.41 for 5.1);
  `truePeakEnvelope` / `truePeakOf` (4× polyphase Kaiser-sinc, 32 taps a phase), `interpolator(taps, cutoff, beta)`.
- `normalize.ts`: `LOUDNESS_TARGETS` (−14 web, −16 podcast, −23 EBU); `normalizeGain(report, {target, ceiling})` →
  `{gainDb, predictedTruePeak, limit}`; `limiterGain` / `limitTruePeak` (linked look-ahead true-peak limiter: sliding
  minimum + centred average, so the gain is never above what a peak needs, smooth release; it reads peaks through a
  stricter 64-tap interpolator with a 0.4 dB margin); `normalizeLoudness(channels, sr, {target, ceiling})` (gain →
  limit if needed → re-measure, up to 4 passes to land within 0.1 LU) → `{channels, gainDb, limited, before, after}`.
- `ducking.ts`: `duckingCurve(voiceChannels, sr, {threshold, ratio, depth, attack, release, hold, window, rate})` →
  `{rate, gainDb: Float32Array}` (≤ 0 dB); `curveAt`, `applyGainCurve`, `curveToVolumeKeyframes` (linear 0..1 volume
  keyframes, simplified).
- `fades.ts`: `fadeGain('linear' | 'equal-power' | 'log', x)`, `crossfadeGains`, `clipFadeGain(spec, t, dur)`,
  `applyFades`, `crossfade(a, b, sr, overlap, curve)`.
- `denoise.ts`: the built-in fallback. STFT (Hann, 75 % overlap, weighted overlap-add) + decision-directed Wiener gain
  with an 18 dB floor and light cross-bin smoothing; the noise spectrum comes from a marked noise-only range
  (`noiseRange`) or the quietest 10 % of frames (`estimateNoise`). `denoise(channels, sr, {fftSize, reduction,
  strength, smoothing, noiseRange})`. Two light passes, so a long clip never holds every spectrum in memory.
- `onsets.ts`: `detectOnsets(channels, sr)` → `{onsets: {t, strength}[], flux, hopSec, tempo: {bpm, confidence},
  beats[]}`. Spectral flux (log magnitude, 10 ms hop), adaptive median threshold, peak picking, each onset refined to
  the 1 ms block with the biggest energy jump; `estimateTempo` (flux autocorrelation, 60–200 BPM, mild 120 BPM prior);
  `beatGrid`.
- `summary.ts`: `rmsSummary` / `rmsOver`, RMS on the same 200 / 50 / 12.5 / 3.125 bins-per-second ladder as the
  engine's waveform. The min/max waveform itself is **not duplicated**: `src/video/engine/peaks.ts` (PeakBuilder,
  pyramid, levelFor, cache) already covers it.
- `curve.ts`: `simplify` (Ramer–Douglas–Peucker), `toKeyframes` (→ `timeline.ts` `Keyframe {t, v, ease}`), `valueAt`.

`src/video/ai/`
- `transcript.ts`: `Word {text, start, end, confidence, speaker?, estimated?}`, `Segment`, `Transcript {lang,
  duration, words, segments, origin, draft, reviewed}` (`makeTranscript`: a machine origin means `draft: true`;
  `AI_DRAFT_LABEL`); `buildSegments` (sentence end incl. the danda, pause, speaker change). Captions:
  `buildCues(words, {maxChars 42, maxLines 2, maxDuration 7, minDuration 0.8, maxGap 1})` with balanced two-line
  wrapping counted in grapheme clusters (`Intl.Segmenter`; an over-long word is cut by clusters, never inside a
  conjunct), `toSrt`, `toVtt`, `timecode`, `parseTimecode`, `parseCaptions` (BOM, CRLF, ids, settings, NOTE blocks,
  inline tags), `cuesToWords` / `importCaptions` (timings spread by length, marked `estimated`).
- `transcribe.ts`: `TranscriptionEngine {id, label, local, status(), transcribe(audio, opts)}` with `EngineState`
  ready / off / no-key / not-installed. `geminiEngine(deps?)`: downmix → 16 kHz → 16-bit WAV → base64 → `aiJson` with
  `attachment: {mime: 'audio/wav'}` (Gemini `inlineData`) on the editor's Gemini key (the main provider if it is
  Gemini, else the saved Gemini key); `aiPaused()` is checked before the job and before every chunk. Prompt: verbatim,
  never translate, keep fillers, `[inaudible]` instead of guessing; the answer is `{language, words}` with one
  TAB-separated `start end confidence speaker word` line per word (the AI layer's schemas are string-only).
  `planChunks` (≤ 10 min, and ≤ ~5.4 min so the WAV fits Gemini's ~20 MB inline request; 4 s overlap),
  `stitchChunks` (an overlap's words come from the chunk whose share holds their midpoint), `validateWords` (rejects
  negative, reversed, out-of-order, overlapping or past-the-end timings: a bad chunk is asked again once, then
  reported `rejected`, never repaired). Result `{transcript (draft, origin ai), chunks: ChunkReport[], complete}`.
  `whisperCppEngine(probe?)`: the interface and an honest "not installed" state; `transcribe()` refuses.
- `textEdit.ts`: `cutsForDeletedWords(words, deleted, {fps, handle, duration})` (cut from the previous kept word +
  handle to the next kept word − handle, never into a kept word, frame-snapped, runs merged), `keepRanges`,
  `rippleTime`, `mergeCuts`; `FILLERS` (EN hesitations um, uh, er, hmm…, discourse you know, I mean, like, so…; BN
  hesitations উম, উ, আ, হুম, ইয়ে…, discourse মানে, আসলে, তো, বলতে গেলে, কী বলব, বুঝলেন, আর কি…), `findFillers` (NFC,
  punctuation incl. the danda stripped, longest match first; `hesitation` vs the weaker `discourse`), `fillerCuts`;
  `detectSilences(channels, sr, {threshold −45 dBFS, minDuration 0.5, window 5 ms})`, `silenceCuts(silences, {fps,
  handle})`. All return `EditProposal {kind: 'proposal', applied: false, source: 'editor' | 'detector', cuts}`.
- `highlights.ts`: `sentences`, `findHighlights(words, {minSec 15, maxSec 60, ideal [25, 45], top 8, maxOverlap
  0.3})`: every window that starts and ends on a sentence boundary, scored 0.35 completeness (ends on terminal
  punctuation, does not start with and/but/so/এবং/কিন্তু/তাই…) + 0.25 speech density + 0.2 no fillers + 0.1 confidence +
  0.1 length, de-overlapped, deterministic. `rerankHighlights(cands, {context, deps})`: optional AI reorder through
  `aiFor('main')`; `applyOrder` takes ids only (unknown dropped, missing appended), so text and times always come
  from the transcript. Paused, no key or an error keep the heuristic order and say why.
- `reframe.ts`: `planReframe(frames: {t, box | null}[], {srcW, srcH, target '9:16' | '4:5' | '1:1', zoom, deadZone,
  maxSpeed, smoothing, anchorY, keepInside, clipIn})` → `{cropW, cropH, path: {t, cx, cy}[], keyframes: {offX, offY},
  clip: {fit: 'fill', scale}, insideRatio, fastMoves}`; detection gaps are interpolated; `cropSize`, `offsetsFor`
  (crop centre → `footageRect` offX/offY, tested against `footageRect` itself), `pathToKeyframes`. Detection is the
  input, out of scope.
- `src/editorial/aiProviders.ts` (the only shared file changed): `AiJsonRequest.attachment.mime` also takes
  `AudioMime` (`audio/wav|mp3|ogg|flac|aac`); audio for any provider but Gemini is refused before any network. PDF
  behaviour unchanged.

### Measured (this PC, `npm test`; ffmpeg 9.0.2 `ebur128=peak=true`, which prints one decimal)

| Fixture (ffmpeg lavfi) | I ours / ffmpeg (LUFS) | LRA ours / ffmpeg (LU) | TP ours / ffmpeg (dBTP) |
|---|---|---|---|
| pink noise, mono 48k | −26.65 / −26.7 | 0.07 / 0.1 | −12.98 / −13.0 |
| level steps 8/6/6 s, stereo 48k | −9.27 / −9.3 | 20.00 / 20 | −6.02 / −6.0 |
| speech-like AM, stereo 44.1k | −12.84 / −12.8 | 1.10 / 1.1 | −6.38 / −6.4 |
| 12 kHz sine at 45° (inter-sample), 48k | −0.58 / −0.6 | 0.00 / 0 | −0.81 / −0.9 |
| brown noise, stereo 48k | −17.40 / −17.4 | 0.31 / 0.3 | −6.40 / −6.4 |

All within ±0.3 LU / ±0.3 dB (worst: TP 0.09 dB on the inter-sample sine). EBU reference: a 1 kHz stereo sine at
−23 dBFS reads −23.0 LUFS.
- Normalise: bursty noise to −14 / −16 / −23 → −14.09 / −16.05 / −23.00 LUFS, TP −1.25 / −1.35 / −7.13 dBTP (−14 and
  −16 needed the limiter). ffmpeg reads the limited −14 result as **−14.1 LUFS, −1.2 dBTP**, an unlimited one as
  −14.0 / −10.8. (When the limiter read peaks through the meter's own short filter, ffmpeg still saw −0.5 dBTP; hence
  the stricter limiter filter and the 0.4 dB margin.)
- Ducking: music RMS under the voice lowered by the set 6 / 12 / 18 dB within ±0.5 dB; unchanged (< 0.05 dB) before
  the voice; back within 0.5 dB 1.5 s after it.
- Noise reduction (built-in): speech-like harmonic fixture + white noise at 5 dB SNR → 16.87 dB (**+11.9 dB**);
  low-frequency-heavy (AR 0.9) noise at 5 dB with a marked noise range → 11.33 dB (**+6.3 dB**). A clean signal with
  0 dB reduction reconstructs to < 1e-6 RMS error.
- Onsets: clicks at 120 BPM all found within 5 ms, none extra; tempo 90 / 120 / 128 / 150 BPM within 1 BPM; every
  click has a beat-grid point within 20 ms.
- Silence: spans 1.0–2.5 s and 4.0–4.8 s found within 1 frame at 30 fps (a 0.2 s dip ignored); with handle 0 the cut
  list is exactly [1, 2.5], [4, 4.8]; agrees with ffmpeg `silencedetect=n=-45dB:d=0.5` within a frame.
- Transcription (fake provider, no network): 70 s in 3 chunks of 30 s, every word once and in order after stitching,
  timings within the fake's ±0.1 s (≤ 150 ms); a bad first answer is retried and accepted; a chunk that stays bad is
  `rejected` with its reasons and only its own share is missing. With AI paused: the engine reports "off", transcribe
  and rerank send nothing (`fetch` never called). **Real Gemini word-timing accuracy is not measured** (it needs a
  key and a fixture with known timings: Phase 5 acceptance).
- Captions: every line ≤ 42 grapheme clusters and ≤ 2 lines for English and Bangla; SRT and VTT round-trip.
- Reframe: a face moving ±0.38 of the width (0.24 widths/s, a 0.5 s detection gap, ±0.01 jitter) stays fully inside
  9:16, 4:5 and 1:1 on every frame; no pan faster than the limit; the keyframes (a third of the frames or fewer)
  reproduce the path within 0.0025 of the frame; a jittering still subject never moves the camera.

### Candidate dependencies (not installed: the owner decides)

| For | Package / file | Version | Licence | Size |
|---|---|---|---|---|
| RNNoise denoiser (WASM) | `@shiguredo/rnnoise-wasm` | 2025.1.5 | Apache-2.0 (RNNoise itself BSD-3-Clause) | 4.8 MB unpacked (several builds; one is used) |
| RNNoise, alternative | `@jitsi/rnnoise-wasm` | 0.2.1 | npm licence field empty; repo jitsi/rnnoise-wasm is Apache-2.0, confirm before use | 2.1 MB unpacked |
| Face detection | `@mediapipe/tasks-vision` | 1.2.0 | Apache-2.0 | 44 MB unpacked (WASM for several targets; the face detector needs one) |
| Face model | `blaze_face_short_range.tflite` (float16, storage.googleapis.com/mediapipe-models) | latest | Apache-2.0 | 230 KB |
| Local transcription | whisper.cpp (a binary, not npm) + ggml models (huggingface ggerganov/whisper.cpp) | — | MIT | base 148 MB, small 488 MB, medium 1.53 GB; Bangla needs small or larger |

RNNoise runs at 48 kHz in 10 ms frames, so it fits behind the same `denoise(channels, sr)` shape; whisper.cpp would
run in the main process (a child process on a temp WAV) behind `whisperCppEngine(probe)`.

### What Phases 4 and 5 still have to wire
- Phase 4: decode clip audio for these functions (the export's 48 kHz mix and the waveform decode already produce
  PCM); meters (momentary/short-term/integrated LUFS, true peak) in the mixer; the loudness target in the export sheet,
  applied to the final mix and re-measured by ffmpeg in `video-test`; fades with handles on clips (`clipFadeGain` in
  the audio engine's gain rule); ducking as an editable volume lane on the music clip (`curveToVolumeKeyframes`; the
  audio engine must read `keyframes.volume`); denoise as a clip effect with a "mark noise" range and a cached processed
  file (never overwriting the original); beat markers on the timeline; RMS summaries next to the cached peaks.
- Phase 5: a transcript panel (AI-draft label, edit, mark reviewed) fed by `geminiEngine().transcribe` on decoded clip
  audio, with progress, cancel and the rejected-chunk report; the whisper.cpp probe in main; word selection →
  `cutsForDeletedWords` → a preview of every cut → ripple delete as one undoable step (keyframes and linked clips
  included); silence/filler sliders over `detectSilences` / `findFillers`; captions from the reviewed transcript
  (`buildCues`) and SRT/VTT export; local face detection (MediaPipe) sampling frames into `planReframe`, shown as
  editable offX/offY keyframes (needs Phase 2's keyframe reader); the highlight list with the optional AI rerank.

### Files
- New: `src/video/audio/{fft,loudness,normalize,ducking,fades,denoise,onsets,summary,curve}.ts`,
  `src/video/ai/{transcript,transcribe,textEdit,highlights,reframe}.ts`, `tools/unit/audio-fixtures.ts`,
  `tools/unit/video-audio-loudness.test.ts`, `tools/unit/video-audio-dsp.test.ts`,
  `tools/unit/video-ai-transcript.test.ts`, `tools/unit/video-ai-transcribe.test.ts`,
  `tools/unit/video-ai-edit.test.ts`. Fixtures are made by ffmpeg in `tools/out/audio-fixtures/` (git-ignored); none
  committed. The ffmpeg tests skip themselves when ffmpeg is not on PATH.
- Changed: `src/editorial/aiProviders.ts` (audio attachment type + Gemini-only guard), this file.

### Checks
- `npm run lint`: 0 errors (no warnings in the new files).
- `npm test`: 1,014 passed (84 files; 5 new files, 91 new tests).
- `npm run build`: ok.
