# Video Desk Pro: master prompt and phase plan

> Written 2026-11-01 after reading every file in `src/video/` and checking the current YouTube Data API v3 and Meta Graph API documentation.
> Goal: make the Video desk a fast, story-aware short-form and long-form editor with built-in publishing. It should be as capable as the best consumer editors (CapCut class) for newsroom work, stronger where ESB has its own data (stories, Grid figures, brand), and still in ESB's own design.
> One phase per session. Progress goes in `docs/VIDEO_PRO_PROGRESS.md` (create it in Phase 0).

---

## How to run

Paste this into Claude Code from `C:\Users\User\esb-banner-studio`, changing only the phase number:

```text
Read CLAUDE.md, docs/VIDEO_PRO_PLAN.md and docs/VIDEO_PRO_PROGRESS.md (create it if missing).
Execute PHASE <N> of VIDEO_PRO_PLAN.md, and only that phase.
Before writing code, state the scope, the files you will touch, the risks and the acceptance tests, then build.
Follow every rule in "Non-negotiables". Run every check in "Verification" and wait for the results.
Inspect the result visually in the running app (screenshots of the Video desk in both themes at 900, 1366 and 1920 px).
Update docs/VIDEO_PRO_PROGRESS.md with what was done, the measured numbers, known gaps and the next step.
Commit only the files you changed, with a clear message. Do not push. Do not post anything to YouTube or Facebook.
Report in the CLAUDE.md §12 format.
```

---

## Non-negotiables (apply in every phase)

1. **Never invent content.** No preset, template, sample or AI step may put a made-up name, title, figure, quote or date on screen. Presets ship with empty fields and labelled placeholders ("Speaker name"), which are drawn in the editor only and never rendered into an export. Story-driven text comes word for word from the Editorial draft. Grid figures come from esbpowerline.com data with the source date shown.
2. **AI output is a draft.** Every AI result (transcript, cut list, reframe, captions, voice, title, description) is shown marked as AI, editable and undoable before it touches the timeline or a post. A synthetic voice carries a visible "AI voice" disclosure on screen and in the description.
3. **Nothing goes live without the owner pressing Approve** for that specific post. Rendering and drafting may run on their own; posting may not. Scheduled posts are approved when scheduled and can be cancelled until they go out.
4. **No user work is ever lost.** Autosave, crash recovery, media that relinks, undo for every edit. Never revoke a blob or delete a cache file anything still uses.
5. **Licensing.** No downloaded third-party effects, music, stickers or fonts unless the licence allows commercial newsroom use, and the licence goes in `docs/VIDEO_ASSETS_LICENCES.md`. The music library reads only from a folder the owner chooses. Everything else (transitions, titles, stickers, LUTs) is ESB's own work, drawn in code or made in the repo.
6. **Secrets stay in the main process.** OAuth refresh tokens and Page tokens for publishing are encrypted with `safeStorage` (like the Outreach app password), never returned to the renderer, never logged, never in a URL.
7. **"Planned" is not "working".** A control that is not built does not appear, or is labelled Planned. Never fake a waveform, a progress bar or a success state.
8. **Protect what works.** Editorial, Graphics and Outreach must not regress. Keep `exportVideo.ts`'s frame-exact principle (each frame drawn after its sources are at the exact instant, stamped i/fps). Never go back to MediaRecorder for export.
9. **ESB design.** Use the studio tokens, the shared `Tabs`/`Seg`/`Panel`/`Dialog` controls, Inter (ESB Sans) for UI and Hind Siliguri for Bangla. Correct Bangla shaping in every text renderer. Use our own visual language, not another app's. The window minimum is 900 px.
10. **Another Claude session works in this repo** (Graphics). Commit only your own files; never reformat theirs.

---

## Current state (baseline, 2026-11-01)

Works: WebCodecs export through `mediabunny` (MP4 H.264 + AAC, WebM fallback, true length and speed), 4 aspects, trim/split/move/snap, undo/redo, track mute/lock, mic voiceover, Story → video first cut, `tools/e2e/video-test.mjs` with ffprobe.

Defects to fix first (Phase 0):
- Footage sound is dropped. `getCachedVideo` mutes the element and `mixAudio` only reads A1 clips, so interview audio exports silent.
- Media are `blob:` URLs. `serializeVideoProject` writes `url: ''`, so a reopened project has no footage. There is no autosave.
- `renderCompositeFrame` draws only `clips.find(...)` per track: one clip per track at a time, so there are no overlaps, transitions or stacked overlays.
- Overlay types `headline` and `card` have no renderer. Story → video uses `headline` when there is no banner, so its title card shows only the photo.
- An image from the bin goes to V2 as a logo-sized overlay at the top left, not a full-frame still.
- The presets and demo timeline contain fabricated people and figures ("Engr. Rezwanul Khan, Chairman PDB", "30 MMCFD", "16,500 MW today"). The station bug blinks a REC dot on every video.
- Footage is always cover-cropped from the centre: no reposition, scale or crop.
- Export keeps the whole file in memory (`BufferTarget`), then copies it over IPC (2 GB cap).
- Preview playback seeks the `<video>` element every frame (`currentTime` drift > 0.08 s). Expect stutter; measure it.

---

## Architecture decisions (Phase 1 sets them; later phases build on them)

- **Project on disk:** `<Pictures>/ESB Banners/Video/<project>.esbvideo/`, containing `project.json` (versioned schema with migrations), `media/` (imported files copied or referenced by absolute path plus size, mtime and a quick hash for relinking), `proxies/`, `cache/` (thumbnails, waveforms), `autosave/` (last 5 snapshots, written as temp + rename) and `renders/`. All file access goes through main-process IPC, checked like `ipc-guard.cjs` (paths inside the project folder only).
- **Media URLs:** a custom protocol (`esb-media://<project>/<file>`) served by main with range requests, so `<video>`, WebCodecs and fetch can stream large files without blob copies. It must not be readable outside the editor window.
- **Decode:** `mediabunny` input (demux plus WebCodecs `VideoDecoder`) feeding a frame cache keyed by clip and frame, with look-ahead decode. The preview and the export share one engine. Proxies: 540p H.264 made in the background (in the export pipeline's worker) for any source over 1080p or with long GOPs, and swapped in for preview only. Export always uses the original.
- **Compositor:** WebGL2 (the 2D canvas stays only for text rasterising). Layers come from any number of tracks, ordered. Per-layer transform (position, scale, rotation, anchor), crop, opacity, blend mode, mask and effect chain run as shaders: colour (exposure, contrast, saturation, temperature, tint, highlights, shadows), LUT (.cube 3D texture), blur, chroma key, vignette, sharpen. Transitions are shaders with two inputs. Text and graphics are rasterised once per change to textures (Bangla shaped by the browser). Fallback: if WebGL2 is unavailable, show an error, never a wrong frame.
- **Timeline model v2:** unlimited tracks of kind `video | overlay | text | caption | audio`. Clips carry `link` groups (video plus its own audio), `speed` (constant, or a ramp curve), `keyframes: Record<prop, {t, v, ease}[]>`, `effects[]` and `transitionIn/Out`. Pure functions stay in `timeline.ts`-style modules with unit tests. Edits: ripple, roll, slip, slide, magnetic main track (optional), insert/overwrite, lift/extract, markers, groups, compound clips.
- **Audio:** a Web Audio graph shared by preview and export. Each clip has gain, pan and fades; buses for Voice, Music and FX; ducking (music sidechained to voice); noise reduction (RNNoise WASM, local); loudness measured to EBU R128 (integrated LUFS, true peak) with presets −14 LUFS (YouTube and Facebook), −16 and −23. Real waveforms are computed from decoded PCM and cached in `cache/`.
- **Rendering:** a render queue in its own hidden window or worker, so the editor stays usable. Each job has one project snapshot and N output presets. It streams to disk (mediabunny `StreamTarget` → main-process file write, no full buffer), checks each preset's platform spec before it starts, and supports cancel and resume. It survives closing the editor window, like Outreach's tray engine.
- **AI services:** one module per ability behind `aiFor(role)` plus the AI master switch (`aiPaused()`), local first where practical. New roles: `transcribe`, `video-copy`. Every request and result goes into Activity.

---

## Phases

Each phase lists deliverables, acceptance tests (they must pass) and what is out of scope.

### PHASE 0 — Make what exists honest and usable
Deliverables:
- Footage audio: each video clip gets a linked audio clip on A1 (or plays its own track) with volume and mute. Export mixes it. Unlinking is possible.
- Persistence (interim, before Phase 1's folder): imports are recorded by real file path through the main bridge, the project file saves paths, and reopening relinks or asks for missing files. Autosave every 10 s to userData (last 5 snapshots, written as temp + rename) with a "Restore unsaved video" card like Home's.
- The compositor draws every clip under the playhead in track order. A basic crossfade happens when two V1 clips overlap.
- Renderers for `headline` and `card` overlays in ESB style. Story → video's title card shows its headline.
- Bin images go to V1 as full-frame stills (Ken Burns). "Add as overlay" is a separate choice.
- Remove every fabricated preset value and the demo timeline. A new project is empty with a clear "Import media / Build from story" start. Remove the REC dot (keep the ESB bug, with an on/off switch).
- Footage transform: position, scale and crop per clip in the inspector, with a fit/fill toggle.
- Export streams to disk through main (no full-file buffer).
Acceptance:
- An MP4 with speech exports with its sound (ffprobe shows an audio stream and RMS above the noise floor in its time range).
- Save, quit, relaunch and open: the footage plays.
- Kill the renderer mid-edit: the restore card appears with the last state.
- Two overlays at once both render (pixel check).
- A 10-minute 1080p export holds RAM under 1.5 GB.
- `grep` finds no fabricated person names or figures in `src/video`.

### PHASE 1 — Engine: project folder, decode, proxies, smooth playback
Deliverables: the `.esbvideo` project folder, the `esb-media://` protocol, a decode engine with a frame cache, background proxies, WebGL2 compositor v1 (transform, opacity, crop, crossfade), timeline model v2 with a migration from v1, real waveforms, filmstrip thumbnails on clips, and the media bin with metadata (codec, fps, size, duration, missing/relink state).
Acceptance:
- 1080p30 playback with 3 video layers plus text at a steady 30 fps on this PC. Measure dropped frames over 60 s and record the number.
- Scrubbing shows the frame under the cursor within 50 ms on proxies.
- A 4K source gets a proxy automatically, and the export uses the original (check the export's resolution and sharpness).
- A v1 project opens unchanged.
- Golden-frame tests: the preview frame equals the export frame at 10 timestamps (pixel diff ≤ 1 %).
Out of scope: effects beyond transform and opacity.

### PHASE 2 — Pro editing
Deliverables: ripple, roll, slip and slide tools; insert/overwrite; J/K/L shuttle; markers; magnetic main track (toggle); groups and compound clips; linked A/V selection; copy and paste attributes; keyframes on every numeric property with ease curves (linear, ease in/out, bezier) and a mini curve editor; speed (constant 0.1×–10×, ramps, freeze frame, reverse for clips with proxies); masks (rectangle, ellipse, feather, invert); blend modes; chroma key; colour panel (the basic wheels and sliders listed above) plus .cube LUT import; adjustment layers; a shared keyboard map in the shortcuts sheet.
Acceptance: unit tests for every edit operation (ripple keeps sync, roll keeps duration, slip keeps position); a keyframed move exports to the exact pixel positions at three times; a 2× speed clip exports at half its source length with correct audio pitch handling (pitch preserved by default); a LUT export matches a reference frame.

### PHASE 3 — Text, titles and motion graphics (the ESB advantage)
Deliverables:
- A text engine: styles (fill, stroke, shadow, background box, gradient), animated in/out presets made in-house (type-on, word-by-word, slide, scale, mask reveal, blur in), per-word timing, correct Bangla.
- ESB title kit: lower third, name strap, headline card, breaking strap, quote card (speaker photo, quote taken word for word from the story), "Source:" line, end card with the site and handles (esbpowerline.com, Facebook esbpowerlineofficial, YouTube @esbplbd).
- **Data cards from real Grid data:** pick a date and a metric from esbpowerline.com's published daily data (generation, demand, load shedding, fuel mix, zone figures). The card animates the number or chart with the source date. Figures are read, never typed or rounded beyond the source.
- Category colours (01–08) apply to straps automatically from the story.
- The ESB intro bumper (the 8 s "Two halves unite" logo animation from `W:\08-Brand-Assets\ESB-Intro`, used only once the owner has approved a final render) and an outro, as optional template pieces.
- In-house sticker and shape set (arrows, circles, highlights, callouts).
Acceptance: Bangla conjuncts render the same in preview and export (golden frames); a data card's number equals the source JSON value for that date; text-fit audit 0 problems for long Bangla names.

### PHASE 4 — Audio
Deliverables: mixer (per track and per bus, meters), fades with handles on clips, auto ducking, noise reduction, loudness normalise to a target with an LUFS and true-peak readout, voiceover with countdown and punch-in, beat and marker detection on music, the music library from the owner's chosen folder (with licence notes), audio waveforms everywhere.
Acceptance: an export normalised to −14 LUFS measures −14 ± 0.5 integrated with true peak ≤ −1 dBTP (ffmpeg `ebur128`); ducking lowers music by the set dB under voice (RMS check); noise reduction improves a noisy fixture's SNR.

### PHASE 5 — AI editing (the "steroids")
Deliverables (each draft-first, undoable, labelled AI):
- **Transcription** in Bangla and English with word timings: Gemini audio input on the editor's key, or a local whisper.cpp model if the owner installs one. A reviewable transcript panel.
- **Text-based editing:** select words in the transcript, then delete or ripple-cut the media. Remove silences and filler words ("উম", "মানে", "um") with a threshold slider and a preview of every cut.
- **Auto captions** from the reviewed transcript in caption styles (word-highlight, karaoke, two-line block), placed in platform safe zones. Translate captions EN⇄BN as a separate reviewed track. SRT/VTT export.
- **Auto reframe** 16:9 → 9:16/4:5/1:1 following faces or the subject (MediaPipe face/object detection, local), shown as editable keyframes.
- **Background removal** for talking heads (local segmentation model), as an effect.
- **Highlight finder:** proposes 15–60 s Short candidates from a long interview, using the transcript (clear complete statements, quotes the story uses). The editor picks; nothing is auto-published.
- **Story → video v2:** a choice of templates, B-roll suggestions from the project's own media bin (matched by the editor's tags), more than one photo from the story, quote cards from real quotes, an optional data card, an optional AI voiceover (TTS) of the deck/body with the mandatory "AI voice" label and the owner's chosen voice.
- **Video copy:** YouTube title (≤ 100 chars), description (summary from the story, article link with UTM, chapters from markers, handles), tags, Facebook caption (reusing `facebookCaption.ts` rules). The same sanitisers as Editorial: no invented facts, numbers checked against the story.
Acceptance:
- Transcript word timings line up within 150 ms on a fixture with known timings.
- Silence removal on a fixture removes exactly the silent spans (±1 frame).
- The reframe keeps the face inside the 9:16 frame on a fixture where the subject moves.
- With AI paused (`aiPaused()`), no request leaves the app (network log) and local features still work.

### PHASE 6 — Templates and presets
Deliverables:
- Package templates, fully editable after applying: **News Short 9:16 (≤ 60 s)**, **Reel 9:16 (≤ 90 s)**, **YouTube report 16:9**, **Facebook feed 4:5**, **Grid daily update**, **Quote video**, **Explainer with data cards**.
- Each defines its structure, caption style, safe zones, music bus level, intro/outro and export presets.
- "Save as template" for the editor's own templates (their content stripped to placeholders).
- A brand kit (colours, fonts, logo bug position, end card).
- One-click "Make all sizes" builds linked sequences for 16:9, 9:16 and 4:5 from one edit, using auto reframe plus per-size overrides.
Acceptance: applying a template to a story and rendering produces files that pass Phase 7's platform validators, with no placeholder text in any export.

### PHASE 7 — Render queue, publishing and scheduling
Deliverables:
- **Render queue:** background, several outputs per job, progress per output, cancel/resume, survives closing the window, "Show in folder".
- **Platform validators** (checked again before upload, using the specs in the docs at implementation time). Facebook Reels as of 2026-11-01: 9:16, minimum 540×960 (1080×1920 recommended), 24–60 fps fixed, **3–90 s**, H.264/H.265, closed GOP 2–5 s, AAC-LC 48 kHz stereo ≥ 128 kbps.
- **Facebook publishing** (main process, existing Page token; check it has `pages_show_list`, `pages_read_engagement`, `pages_manage_posts`):
  - Reel: `POST /{page-id}/video_reels` upload_phase=start → upload to `rupload.facebook.com/video-upload/{video-id}` (`Authorization: OAuth`, offset, file_size) → poll `GET /{video-id}?fields=status` → `upload_phase=finish` with `video_state` PUBLISHED | SCHEDULED (`scheduled_publish_time` 10 min–29 days ahead) | DRAFT.
  - Feed video: resumable upload session (`/{app-id}/uploads`, `file_offset` resume) → `graph-video.facebook.com/{page}/videos` with title/description and the file handle.
  - Limit: **30 API-published Reels per Page per 24 h (moving window)**, enforced by the app itself.
  - The article link goes as the first comment, the same as banner posts.
- **YouTube publishing:**
  - Google OAuth for an installed/desktop app: loopback redirect plus PKCE, scope `https://www.googleapis.com/auth/youtube.upload` (plus `youtube.force-ssl` only if captions are uploaded). The owner creates the Google Cloud project and client once; give step-by-step instructions in the app.
  - `videos.insert` resumable upload (up to 256 GB, MIME `video/*`) with snippet (title, description, tags, categoryId, defaultLanguage) and status (privacyStatus, `publishAt` for scheduling, `selfDeclaredMadeForKids` false, and the altered/synthetic-content disclosure when an AI voice is used).
  - Then `thumbnails.set` with the Graphics desk's `yt` 1280×720 render, and `captions.insert` with the reviewed SRT.
  - Quota as of 2026-11-01: `videos.insert` costs 1 unit in the Video Uploads bucket, **100 calls a day**.
  - Verify at implementation: whether a project in OAuth "Testing" mode expires refresh tokens after 7 days (if so, guide the owner to publish the consent screen), the thumbnail rule for unverified channels, and the current Shorts length limit.
- **The Approve gate:** a Publish sheet like Editorial's (preview of the actual render, title, description, thumbnail, captions, destination, time), then Approve. Every post is logged with its URL in Activity. A failed step turns the job red with the platform's own error text. Retries are safe (no double posts: check by an upload key and title before retrying).
- **Results:** pull views, watch time and reactions (YouTube Analytics / Graph insights, read-only scopes added only if the owner agrees) into Activity next to Outreach's opens and clicks.
Acceptance:
- Validators reject a 95 s Reel and a 30 fps-variable file.
- A dry-run mode (`ESB_VIDEO_PUBLISH_DRYRUN=1`) runs the whole flow against a fake server in tests: the upload resumes after a cut-off at 50 %, and the Approve gate cannot be skipped from the renderer (main refuses a job without an approval token tied to that render's hash).
- The first real post happens only when the owner asks, as a private/unlisted YouTube upload and a Facebook DRAFT.

### PHASE 8 — Polish, performance and QA
Deliverables: a full UI pass to studio standards (both themes, 900–1920 px, center and text-fit audits at 0), shortcuts sheet, onboarding hints, accessibility (focus, contrast, 28 px targets), crash/soak test (2 h edit session with autosave), performance budgets written into tests, docs in CLAUDE.md's Video section.
Acceptance: `audit:center`, `audit:text-fit` and `audit:contrast` at 0 findings on every Video state; the soak test shows no memory growth over 5 % per hour; the export suite passes on the fixtures.

---

## Verification (every phase)

```bash
npm run lint          # 0 errors
npm test              # all pass; report the count
npm run build         # 0 errors
npm run test:video    # ffprobe/ffmpeg checks: duration, frames, cuts, audio, loudness where relevant
npm run test:electron
node tools/audit/text-fit-audit.mjs
node tools/audit/center-audit.mjs
```

New fixtures go in `tools/fixtures/video/`: synthetic clips made with ffmpeg (test patterns, tones, a counted beep track, a synthetic voice recording made in the repo). No real ESB footage or third-party media in the repo.

## Honest limits

- Licensed asset libraries (big effect, music and sticker catalogues) are not something to copy. ESB's set is made in-house or from the owner's licensed folder.
- Stabilisation, motion tracking for attached text, and AI generative video are possible later but heavy. They are not in this plan; add them only as Planned once Phases 0–7 are solid.
- Very long 4K timelines depend on this PC's GPU and disk. Proxies make editing smooth, but final renders of long 4K pieces take minutes, not seconds.
