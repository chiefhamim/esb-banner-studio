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
