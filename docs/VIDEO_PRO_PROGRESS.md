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
