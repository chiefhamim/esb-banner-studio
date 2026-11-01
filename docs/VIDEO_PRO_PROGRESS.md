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
