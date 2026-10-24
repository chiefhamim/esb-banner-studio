# CLAUDE.md — ESB AI Studio: Master Cloud & Engineering Guide

> **Document Type:** Master Product Brief, Engineering Charter & Claude Cloud Instructions  
> **Product:** ESB AI Studio  
> **Organisation:** ESB PowerLine / Express Broadcast and Communication Ltd. (`esbpowerline.com`)  
> **Repository:** `chiefhamim/esb-banner-studio`  
> **Platform:** Desktop-first, Windows-compatible Electron application  
> **Current Stack:** Electron 45, Vite 8, React 19.3, TypeScript ~6.0.3, Zustand 5, HTML Canvas 2D, Vitest and Playwright  
> **Primary Audience:** ESB journalists, editors, graphic designers, video editors, and autonomous AI agents (Claude Code)  
> **North Star:** One coherent, exceptionally polished creative newsroom workstation for Editorial, Graphics and Video.

---

## ⚡ ULTRAMAX MASTER EXECUTION DIRECTIVE
*(Copy and run this single prompt with `claude --cloud "..."` or pass to Claude Code locally to execute the end-to-end evolution of ESB Studio)*

```text
You are acting as the Principal Software Architect and World-Class Product Designer (Apple / Linear / Mac-grade craftsmanship) for ESB PowerLine Studio.

Your objective is to elevate this application into an extraordinary, Mac-level newsroom suite where Editorial, Graphics, and Video work in seamless, harmonic cohesion. The studio must deliver a zero-friction "One Link Paste to Production-Ready English Story + Broadcast Graphics" experience that feels handcrafted with deep love, care, and mathematical precision.

Read CLAUDE.md thoroughly. Execute this transformation in disciplined, verified phases:

1. CONTEXT & ARCHITECTURAL MASTERY:
   - Understand the dual-engine architecture: Zustand stores (src/store.ts for Graphics, src/editorial/editorialStore.ts for Editorial, src/shell/shellStore.ts for Workspace Shell).
   - Understand the energy sector newsroom domain (ESB PowerLine: power, renewables, gas/LNG, transmission, finance, policy).
   - Preserve protected assets (esb-logo.png, esb-avatar.png, golden tests).

2. MAC-LEVEL CRAFTSMANSHIP & ANTI-AI-SLOP DESIGN:
   - Eliminate all form-like clunkiness. The Editorial Desk must read like a bespoke publishing document, not a settings dashboard.
   - Enforce the 4px base geometry scale (--s-0 through --s-11), strict typography hierarchy (Hind Siliguri for Bengali at 1.6 line-height, Inter / UI Grotesk / Oswald for English), and quiet graphite/zinc surface tokens.
   - Add buttery 60fps micro-interactions (cubic-bezier(0.16, 1, 0.3, 1)): smooth tab indicators, subtle button depth, seamless hover feedback, zero layout shifts (CLS = 0).
   - Ensure the left rail, center story document, and right preview rail are optically balanced with hairline 1px borders and refined padding.

3. ONE-LINK PASTE TO PRODUCTION-READY STORY PIPELINE:
   - Intake Experience: The empty state is a gorgeous, centered Mac-style launcher card. On pasting a URL (Prothom Alo, Bonik Barta, Daily Star, Samakal, etc.), collapse into an elegant top-bar source chip.
   - Robust Extraction: Strip all ads, boilerplate, copyright footers, newspaper branding blurbs, and physical addresses (Karwan Bazar, BDBL Bhaban, Dhaka-1215). Extract clean Bengali headline, deck, body paragraphs, and high-res photos.
   - Local Machine vs API Translation: Provide blistering fast translation with local neural fallback and cloud LLM integration. Enforce character budgets (Headline <= 104, Deck <= 200, Slug <= 80).
   - Inline Fact Verification: Green underline for verified figures, capacities (MW, MMCFD), currencies (Tk, Crore, Billion), and dates. Amber underline for discrepancies. Clicking any source chip smoothly scrolls and pulses the match in the story body.

4. HARMONIC GRAPHICS & EDITORIAL SYNCHRONIZATION:
   - True 2-way sync: Any edit to the headline, sector category (01-08), or photo in Editorial instantly updates the Graphics banner canvas and rail preview.
   - Trucent Line Break Tuner: Enable optical line break tuning directly on headline preview breaks to eliminate orphan words on news banners.
   - Companion Rail Previews: Instant switching between Banner (4:5), Web Article, and Facebook (1200x630) previews with 1-click 2x retina export and Supabase CMS publish gates.

5. VERIFICATION & RIGOR:
   - Run 'npm run build', 'npm test' (Vitest), and 'node tools/editorial-test.mjs' (Playwright).
   - Ensure 0 build errors and all automated acceptance tests pass cleanly. Never claim completion without running and verifying tests.
```

---

## 1. Product Vision

ESB Studio is not simply a news translator with a banner generator attached. It is the production environment through which ESB PowerLine turns source material into accurate journalism and publication-ready media.

The application brings three disciplines into one unified desktop experience:
1. **Editorial** — source intake, research, writing, translation, verification, editing and CMS publishing.
2. **Graphics** — professional, editable visual composition for news banners, social media, web, print and other formats.
3. **Video** — media organisation, timeline-based editing, motion graphics, titles, audio, preview and export.

The application feels like a purpose-built professional Mac application: quiet, precise, responsive, restrained and easy to understand. “Mac-like” means the quality of the interaction design and visual hierarchy—not copying Apple's branding or imitating a particular application pixel-for-pixel.

### The North-Star Workflow
A journalist pastes a source URL. ESB Studio extracts the available article and source metadata, prepares a draft, preserves the original source, flags facts that need review and provides a clean editing environment. The editor checks the copy and approves the story. The same approved story populates a graphics composition and provides approved material for a video package. The user can then adapt the assets for the required channels, inspect each result and export or publish them.

**One story. One project. Multiple coordinated outputs. No unnecessary re-entry.** Automation removes repetitive work, never editorial judgement.

---

## 2. Product Principles — Non-Negotiable

### 2.1 Quiet Studio Visual Language
- Neutral graphite application chrome; the content and canvas remain the visual focus.
- Restrained accent colours, used to communicate selection, state or ESB category—not as decoration.
- No generic AI-dashboard cards, gratuitous gradients, neon glows, oversized rounded containers or decorative glass effects.
- Use consistent spacing based on a 4 px grid, with a small, documented token system (`src/styles/tokens.css`).
- Crisp borders, controlled contrast, disciplined typography and carefully aligned controls.
- Dense enough for real production work, but never cramped or visually noisy.
- Use motion sparingly: fast, purposeful transitions that explain a state change (`cubic-bezier(0.16, 1, 0.3, 1)`). Respect reduced-motion preferences.
- Support light and dark appearances only if both can be maintained to the same quality standard.

### 2.2 Content First
The story, image, design canvas or video preview is the hero. Tool chrome should be quiet and predictable. Avoid UI that competes with the work.

### 2.3 Professional Density, Generous Usability
Use compact controls and meaningful information density, while keeping important interactive targets comfortable and accessible (≥ 28×28px). Do not shrink hit targets merely to make the UI look sophisticated. Keyboard focus, contrast, tooltips and clear selected/disabled states are required.

### 2.4 No “AI Slop”
- No fake data, placeholder metrics presented as real, invented sources or synthetic attribution.
- No generic generated layouts that ignore ESB's editorial identity.
- AI suggestions must be editable and visibly distinguishable from verified facts.
- Generated content is a draft until a human reviews it.
- Do not silently overwrite a user's work.

### 2.5 Accuracy Before Automation
- Preserve the original source URL and source text wherever legally and technically possible.
- Never invent quotes, facts, dates, figures, names, image credits or source attribution.
- Treat translation as translation, not permission to embellish.
- Show uncertainty and extraction failures explicitly.
- Distinguish **source-reported**, **cross-checked**, **editor-approved**, **derived** and **unknown** information.
- Publishing and destructive actions require clear confirmation and meaningful error handling.

### 2.6 Native-Feeling Desktop Behaviour
- Respect operating-system conventions where practical: menus, shortcuts, focus, window resizing, file dialogs and clipboard.
- Make the app feel coherent as a desktop product, not a web page trapped in a window.
- Support sensible window sizes and graceful layout changes.
- Avoid blocking the entire interface during extraction, rendering or export.

---

## 3. Information Architecture

Use one persistent application shell, with three primary workspaces and a shared project/media layer.

### Global Shell
- **Workspace switcher:** Home as its own button, then Editorial · Graphics · Video as one segmented control, at the start of every workspace header (`WorkspaceSwitcher` in `src/shell/WorkspaceRail.tsx`). There is no side rail. The ESB wordmark logo is in About only — it was removed from Home (the title stands alone with the three-stripe hairline vertically after it). Home's header carries the appearance toggle and **Quit** (desktop only, `esb:quit`; Ctrl+Q anywhere).
- **Tooltips:** one `Tooltips` layer mounted in `App.tsx` for every workspace (it once lived inside Graphics, so the other desks had none). A trailing shortcut — "Undo (Ctrl+Z)" — renders as a key chip. Use `data-tip`; a stray `title=""` is converted on first hover so the OS's grey tooltip never shows. Tooltips take the theme's own surface (`--tip-bg` white in light, `#2c2c31` in dark) — they were inverted.
- **Home fits one screen:** no scrollbar at any size down to about 1280 × 640 — hero, up to 3 recents, a 5-column format grid; sizes come from `vh` clamps and small-height media queries at the end of `home.css`.
- **Launch tile hover:** on Editorial / Graphics / Video the ICON line fills with its own shimmering SVG gradient (`home-ig-1..3`, userSpaceOnUse so flat lines still paint; defined in `HomeWorkspace.tsx`, SMIL-animated 6 s); names stay plain (the text-gradient version was replaced). Open project stays plain.
- **Dark "Studio" word:** the smoky glass look comes from `filter: drop-shadow` plus the title text-shadow over the transparent gradient fill (dark theme; the white theme has a lighter frosted version: white lip + faint blue glow) — the owner likes it, do not "fix" it. The vertical stripe hairline after the title carries the matching drop-shadow treatment per theme, is 6 px wide and is 6 px, three vivid bands, with a subtle light reflection that drifts down and back up at the same 9 s ease-in-out pace as the "Studio" sheen (still under reduced motion); the blend, conduit, Y-spin and X-roll animations were all rejected.
- **Dark Home picture:** `home-dark-gradient.jpg` — the 8K orange-to-cyan gradient master (7680×4320) resampled to 3840×2160 at JPEG quality 96 (~1 MB; a smooth gradient has no detail to lose, so 4K is twice a 1920 screen), with a fine monochrome dither grain over it (`.home-bg::before`, dark only) so the dark areas do not band. No vignette: the colour is in the corners and the middle is already dark. The smoke on "Ai" and "Studio" is lighter than it was on the old silk, because dark glass on a dark picture sinks. Light: `home-light.jpg`. The logo is not on Home.
- **Home cleanup (final):** unsaved-session recovery is the first card of Recent projects (no top banner); the hidden workspace switcher was removed from Home; `home.css` was pruned of rules for removed things (logo, video, glow, old stripe animations).
- **Home look:** `src/styles/home.css` (scoped to `.home-shell`, loads after studio.css) — centred hero (only the word "Studio" carries a slow green-teal-blue sheen, 9 s, off under reduced motion) with the ESB three-stripe hairline set vertically between the logo and the name, a launcher strip (one panel, four equal cells with hairline dividers: Editorial · Graphics · Video · Open project; no action buttons, no slogans; hover is only a brighter fill and firmer outline, nothing moves), a 2 : 1 split under it — New graphic (3 × 3 formats) beside Recent projects (equal height, up to 4), a footer pinned to the window bottom, "vX · Made with ♥ by Hamim Ruwayfi" (links to facebook.com/chiefhamim; name from package.json author), no top bar (only a floating settings / appearance / quit group top-right), frosted-glass panels (blur 6 px, about 50 % opaque, lit top edge; hover is a soft brightening plus a clearer outline (never a solid white slab); the corner controls are one folded round handle (⋯) that unfolds Settings · Appearance | Quit (hairline before Quit) on hover or keyboard focus; hover just brightens the glass), 8 px-radius buttons, UI-sans section labels (no mono on Home except the version chip), staggered rise-in. It was glassy and pill-shaped at first and read as too Mac, so the first block of the file is the glass version and the last block overrides it. Reduced motion turns the animation off.
- **Move the Home picture:** Home → Settings → "Move background…" lets the editor drag it and scroll to zoom (1×–3×), saved per theme in localStorage `esb-banner-studio/home-bg-pos`; Reset returns to centred. Done to finish.
- **Home background:** (picked in Home → Settings, the sliders button) `home-light.jpg` / `home-dark.jpg` in `src/assets/images/home/` (Artbeaut "Simple Soft White 02" for light, "Hued Bonus 06" for dark; picked by theme) drift on a 40 s transform-only loop (6 % overscan, ±3 % slide, scale ≤ 1.04, no rotation, so the picture stays at its real size) under a light veil of the page colour (18 % light, 40 % dark); Home's cards, buttons and header are frosted over it. Reduced motion stops it. **Settings** on Home lets the editor pick any image of their own (scaled to 1600 px, JPEG, kept in localStorage `esb-banner-studio/home-bg-light` / `-dark`, one per appearance); the reset button returns to the default.
- **Activity (task times):** `TranslateProgress.tsx` + `jobLog.ts`. Story translation, SEO and Social captions (and Publishing) each record a job — steps, the time of each step, and the provider · model that did it — into a history of the last 12. Beside the header's tools (left of "+") the latest job of each kind shows as `Story · Sonnet 5.5 · 1.7 s` (model names from 1600 px, all three kinds from 1500 px, only the latest below that); any of them opens the fixed-position history panel (portal, z 3200; it opens by itself when a job starts, closes with Esc or a click elsewhere, and stays until "Clear history"). Story jobs are fed by the desk's status text; SEO and Social report their own steps from `aiDesk.ts` (choosing the model, waiting on the provider, checking against the site rules).
- **Post as ESB News Desk:** a tick in the Organize panel (draft.postAsNewsDesk) sets `postAsNewsDesk` on the published article and the site preview byline, like the CMS tick.
- **Editorial AI chip:** a pill — dashed outline "Connect AI" (link icon) until a key is saved, then filled with the active provider's colours and named (Gemini / Claude / OpenAI / OpenRouter); label hides under 1180 px.
- **Canvas scrollbars:** `.stage-scroll` gets `fits` (overflow hidden) while the banner plus its 40 px margin fits the window; fit zoom leaves 40 px each side (it used 36, which overflowed by 8 px and always showed a scrollbar). Zoom in past the window and the scrollbars return.
- **Layers:** dialogs 2000, menus/popovers 2600, tooltips 3000. A Select inside a dialog must open in front of it (it once opened under the backdrop, pinned to the top edge); a menu takes the side with more room and scrolls inside it; Esc closes an open menu before the dialog under it.
- **Centering:** `node tools/center-audit.mjs` measures each control's icon + label box against its padding box at 900/1280/1920 in both themes; 0 off-centre or overflowing controls at the last run. A Select's label is one ellipsised line (`.select .select-label { display:block }` — `text-overflow` does nothing on the inline-flex it was).
- **Header is neutral:** `.topbar, .ed-head, .vw-header` re-declare `--cat` as a neutral so choosing a category never tints header buttons, focus rings or the avatar.
- **Selection colour:** the story's category colour (`--cat`, with `--cat-ink` for legible text on it) is set on the document root and marks *selection only*: the open panel's icon tile, switches and ticks that are on, the chosen collage, the picked keyphrase, menu highlights, the signed-in avatar. Everything else stays neutral, and hover never moves an element (no layout shift) — it answers with depth and colour.
- **Project control:** current project/story, save state, recent projects and project actions.
- **Global command/search palette:** search commands, actions, projects and assets; show relevant keyboard shortcuts.
- **Contextual toolbar:** controls relevant to the current workspace and selection.
- **Status area:** save/sync status, background jobs, export progress and actionable errors.
- **Inspector:** context-sensitive properties, not a permanently crowded wall of controls.

### Workspace 1 — Editorial (`src/editorial/`)
Purpose: turn source material into an accurate, publication-ready story.
The desk mirrors the esbpowerline.com CMS article editor (`components/editor/ArticleForm.tsx` in the site repo) inside the Graphics shell (same `.topbar`, `.left`/`.right` panels, `Seg`/`Tabs`/`Panel` controls).
- **Source column (left):** original article — link with Open / Re-fetch, extraction report chips, Bengali headline & deck, facts to check, numbered paragraphs (Hind Siliguri); a "New link" tab loads the next story. Slides over the editor under 1180 px.
- **Story editor (centre):** "Headline & deck" panel (headline ≤104, deck ≤200), then a standalone "Story" panel with Body (verified view / edit) · SEO (`SeoPanel.tsx` over `seo.ts`: focus keyphrase picked from the story's own keyphrases, a Google result preview cut where Google cuts it, title/description/slug builders, 17 checks) · Social captions · Preview (the site article page; hero = the rendered 16:9 Web banner or the bare photo).
- **CMS sidebar (right):** Publish (status, destination, dateline, pre-flight count, Review & publish), Featured image (`FeaturedImage.tsx`: the banner's photo slot 0 — reframe, zoom, tone, credit, **Edit in Graphics** round trip), Organize (category, tag pills, byline), Outputs (`GraphicsRail.tsx` → `OutputsPanel`: Banner · Web article · Facebook).

### Workspace 2 — Graphics (`src/components/`, `src/core/`)
Purpose: create accurate, polished and fully editable newsroom graphics.
- **Asset/layer panel:** layers, groups, lock/visibility, reorder, duplicate and rename.
- **Central artboard (`Stage.tsx`):** the largest practical area of the window, with zoom, pan, fit-to-screen and safe-area guides.
- **Inspector (`Panels.tsx`):** typography, text alignment, colour, image crop/position, opacity, spacing, effects and object geometry for the current selection.
- **Format controls (`FormatPicker.tsx`):** adapt design across 6 newsroom formats while preserving editable source.
- **Export controls (`ExportDialog.tsx`, `export.ts`):** 2x Retina PNG, WebP, custom ZIP export.

### Workspace 3 — Video (`src/video/`)
Purpose: assemble real video packages from footage, audio, graphics, titles and editorial content.
- **Media bin/source browser:** imported footage, audio, stills, graphics, title templates and generated proxies.
- **Preview monitor:** playback, transport controls, timecode, resolution/quality selection and safe areas.
- **Timeline:** multiple video/audio tracks, clips, trimming, splitting, snapping, zoom, track controls and waveform display.
- **Inspector:** selected clip, transform, crop, speed, audio level, keyframes, title settings and effect parameters.
- **Export/render queue:** destination, resolution, frame rate, progress, cancellation and errors.

---

## 4. Unified Story-to-Media Project Model

The shared project is the product's connective tissue. Editorial, Graphics and Video reference shared story and asset data rather than maintaining loosely synchronised copies.

### Shared Entities
- **Project:** ID, name, status, created/updated timestamps and local/CMS linkage.
- **Story:** source references, original language, translated copy, metadata, review status and publication status.
- **Fact/check:** extracted claim, source evidence, comparison result, reviewer and review state.
- **Asset:** file path or managed location, type, dimensions/duration, attribution, provenance and usage rights/notes.
- **Graphic document:** editable scene/layers, dimensions, format variants and linked story fields.
- **Video sequence:** timeline, tracks, clips, timing, transforms, audio and linked graphic/title assets.
- **Export job:** inputs, output settings, status, logs, destination and error details.
- **Revision/history:** recoverable changes and clear indication of unsaved work.

### One Source of Truth & Link vs. Copy
- Audit whether `bannerLink.ts` creates lifecycle or synchronisation risks between `useEditorialStore` and `useStore`.
- A linked headline updates dependent graphics automatically, but designers must be able to intentionally override styling or detach a field.
- The UI indicates whether content is linked, overridden or stale. Updating a story must never silently destroy intentional design decisions.

---

## 5. Editorial Integrity and Workflow

### One-Link Intake (`src/editorial/extract.ts`)
1. User pastes a URL.
2. Validate the URL via secure network/IPC guardrails (`electron/net-guard.cjs`).
3. Fetch and extract article text and metadata.
4. Filter out publisher self-promotion (e.g. *Bonik Barta* tagline) and office addresses (Karwan Bazar, BDBL Bhaban, Dhaka-1215).
5. Show publisher, canonical URL, extraction quality and any limitations.
6. Preserve source material separately from the translated draft. Allow manual paste when dynamic SPAs block raw fetch.

### Translation and Editing (`src/editorial/translator.ts`)
- Produce clear, publication-grade, active-voice English.
- Free services: text is split at sentence ends (`translateNet.ts` `chunkForTranslation`) so neither GTX nor MyMemory (500-char limit) ever receives or returns a cut-off paragraph; an untranslated chunk stays in Bengali and the desk says so.
- **AI providers** (`aiProviders.ts`, `AiSettingsDialog.tsx`): Gemini, Claude (official `@anthropic-ai/sdk`, streamed, `output_config` JSON schema + `effort`, system prompt cached with a `cache_control` breakpoint, no sampling params; **Auto = `claude-sonnet-5-5`**), OpenAI (strict `json_schema`) and OpenRouter. One key and model per provider (localStorage `esb-banner-studio/ai-settings`), and each **job** is given one provider: **Main** (header chip; translation, headline, deck, body, tags), **SEO** and **Social** (each "Write with AI" button; "Same as main" by default). `aiFor(role)` returns only the provider chosen for that job and only when it has a key — a job never falls back to another provider. The chip and the "Write with AI" buttons are filled with the chosen company's colour (`[data-provider]` in studio.css). Calls go from the app straight to the provider's host with the editor's key — no relay, nothing via esbpowerline.com.
- The **translation prompt is editable** in the AI dialog (empty = `JOURNALISTIC_TRANSLATOR_PROMPT`) and is sent first as the system prompt, followed by `REPLY_RULES` (which only maps the answer onto `TRANSLATION_SCHEMA`); the model's wording is kept exactly as written — `polishJournalisticBody` is for the free machine translation only. The reply is held to the site's character limits.
- A reply that stops early (Gemini `finishReason` ≠ STOP, Claude `max_tokens`/`refusal`, OpenAI `finish_reason` ≠ stop) is an error, never a shorter article; a reply with far fewer paragraphs than the source raises a visible coverage warning. On failure the free machine translation runs and the desk says so.
- **SEO and captions by AI** (`aiDesk.ts`): "Write with AI" on the SEO tab (keyphrase, tags, title, description, slug) and on Social (all four captions). Answers are sanitised — `sanitizeSeo` (keyphrase must occur in the story, `seoFields` limits, no site name, no dated slug) and `sanitizeCaptions` (every caption ends with `https://esbpowerline.com/articles/{slug}`, guessed site links replaced, X ≤ 280 with links counted as 23). A slug edit relinks every caption (`relinkCaptions`). Without AI the desk's captions are `storyCaptions` (headline, deck, ≤ 3 desk hashtags, link) — never the Graphics card templates, which read the headline's highlight phrase as a statistic ("⚡ the Sylhet —"). After an AI translation the captions are written in the background.
- Preserve meaning, factual nuance, names, quotations and numerical values.
- Enforce character budgets: **Headline ≤ 104**, **Standfirst / Deck ≤ 200**, **Slug ≤ 80**.
- Keep original Bengali headline and body accessible side-by-side for comparison.
- Visible review state for AI drafts; avoid silent fallback substitutions without indication.

### Fact Verification (`src/editorial/facts.ts`)
- Precise statuses:
  - **Matched (`.fact-verified`):** Green underline; detected value matches source.
  - **Mismatch (`.fact-unverified`):** Amber wavy underline; detected value differs.
  - **Needs review:** Ambiguous extraction or comparison.
- Bi-directional linking: Clicking a source chip smoothly scrolls to and pulses the match in the story body.

### Staff sign-in and the site connection (`src/editorial/siteApi.ts`, `SignInSheet.tsx`, `electron/main.cjs`)
- Sign-in is the site's own: Supabase Auth password grant, then the `profiles` row (role, status, full name) read with the editor's token — the same checks as the site's `app/login/actions.ts`. Error copy matches the site's `lib/auth-error-copy.ts`. There is no bypass or offline sign-in; sessions refresh with the refresh token (`ensureFreshSession`).
- "Open the CMS" in the desktop app writes the site's `@supabase/ssr` session cookie (`sb-<ref>-auth-token`, `base64-` + base64url JSON, chunked at 3,180) into a separate `persist:esb-site` profile and opens esbpowerline.com/cms in its own window, signed in as the editor. The format was verified by having `@supabase/ssr` 0.12.4 read the cookies back. Sign-out clears that profile and calls the auth service's logout.
- Publishing requires a signed-in staff session; the public key is never used to write, and an article is credited only to the signed-in account.

- **Banner upload on publish** (`electron/site-upload.cjs`, `src/editorial/siteConnect.ts`): with the Web-banner hero, publishing from the desktop app renders the 16:9 banner (1920×1080 JPEG) and POSTs it to the site's own `/api/upload` with the session cookie; the stored Supabase URL becomes the article image. The main process checks session cookie, type, signature and a **4 MB cap (Vercel refuses bodies over 4.5 MB)**, never follows redirects, and accepts only an https `*.supabase.co`/esbpowerline.com URL back. One upload per publish — far inside Supabase Pro storage and the route's 20/min limit. A `blob:`/`data:` image is never sent as `imageUrl`.
- **Connection check** (account sheet): site, auth health, session, role, Articles read, upload permission (an empty form the route answers 400 after auth — nothing stored), the active AI provider's key. Reads only.
- **Story queue** (`src/editorial/storyQueue.ts`, `StoryQueue.tsx`): every story keeps its own source/draft/checklist snapshot in localStorage (≤ 40, published then oldest shed first, active never). Status follows the work (Draft → Needs check → Approved → Published) unless set by hand. An import forks a new entry only when a different source arrives, so a failed fetch never duplicates.

### SEO must match what esbpowerline.com renders (`src/editorial/seo.ts`)
The site (`app/(public)/articles/[slug]/page.tsx`, `lib/seo.ts`) renders `<title>` = `seo.metaTitle` else the headline, **with no " | ESB PowerLine" suffix** (its SEO fix log stage 5 dropped it: ~15 of ~60 visible characters), and the description = `seo.metaDescription` else the excerpt, cut at **160**. `seo.heroImage.alt` is the image alt (headline fallback) and `seo.heroImage.caption` is printed under the photo.
- Never add a site-name suffix anywhere: the builders, the translator (`seoFields`, `stripSiteSuffix`), every provider's schema, `sanitizeSeo` and saved drafts all strip it.
- Never send the deck as `heroImage.caption` — it printed every Studio story's deck twice. Caption and alt text are their own fields (Featured image panel).
- The title check measures pixels as Google does (`titlePixels`, 580 px at 20 px Arial); a keyphrase only past the cut is a warning.
- Every translation path builds SEO fields with the same builders the panel grades, so a fresh story starts with passing fields.

### Publication Gate (`src/editorial/siteApi.ts`)
Before publishing to Supabase (`public.Article`):
- All 3 pre-flight items must be confirmed:
  1. Numbers, capacities, and currencies verified against source.
  2. Institutional names and ministries verified.
  3. Source credit and photo attribution preserved.
- Show destination, prevent accidental duplicates, provide recovery guidance on network errors. Never expose service keys in renderer.

---

## 6. Graphics Production Standards

### Editable-First, Export-Perfect
- The editable scene is the source of truth; exported images are deliverables. Preserve Canvas 2D renderer (`src/core/render.ts`).
- Core capabilities: Select, move, resize, align, group, lock, hide, duplicate, reorder layers; non-destructive image crop and focal point; guide and safe-area snapping; undo/redo; zoom/pan independent of export DPI.

### Newsroom Formats (`src/core/tokens.ts`)
- `fb45`: Facebook / Instagram Feed (1080 × 1350, 4:5) — Default
- `web`: Web Hero Article (1920 × 1080, 16:9)
- `sq`: Square Social / LinkedIn (1080 × 1080, 1:1)
- `story`: Vertical Story / Reel (1080 × 1920, 9:16)
- `social`: High-Res Social Grid (1598 × 1431)
- `yt`: YouTube Video Thumbnail (1280 × 720, 16:9)

### ESB Visual Identity & Category Palette
- Never redraw, recolour, stretch, or re-encode protected brand artwork:
  - `src/assets/images/esb-logo.png`
  - `src/assets/images/esb-avatar.png`
  - `build/icon.png` and `build/icon.ico`
  - `public/favicon.svg`
- Sector Categories:
  1. `01` Power Generation — `#00E5FF`
  2. `02` Gas & Petroleum — `#FF9100`
  3. `03` Transmission & Grid — `#FFEA00`
  4. `04` Renewable Energy — `#00E676`
  5. `05` Energy Finance & Economy — `#7C4DFF`
  6. `06` Policy & Regulation — `#FF1744`
  7. `07` Regional Energy Trade — `#2979FF`
  8. `08` Technology & Efficiency — `#E040FB`

---

## 7. Video and Motion: Staged Roadmap

Video must not destabilise working Editorial and Graphics features.
- **Stage A — Media Foundation:** Import local media, track missing files, relinking, metadata, background proxy generation.
- **Stage B — Functional Timeline:** Multi-track timeline, trim/split/move clips, playhead, snapping, zoom, synchronised playback.
- **Stage C — Titles & ESB Graphics:** Lower thirds, headlines, captions using approved story fields and editable graphics assets.
- **Stage D — Audio & Delivery:** Volume, fades, waveforms, export queue with progress and cancellation.
- *Rule:* If a capability is not yet implemented, label it **planned**, not **working**. Never render fake waveform placeholders.
- **Export engine (`src/video/exportVideo.ts`):** WebCodecs via `mediabunny` — every frame drawn after its footage has seeked and encoded with its own timestamp (i/fps), so the file is the timeline's true length at true speed. MP4/H.264 by default (WebM/VP9 fallback); the A1 track is mixed offline at 48 kHz (AAC where the OS encodes it — Windows/macOS — else Opus). Never go back to MediaRecorder + captureStream: it ties timing to the wall clock (the old exporter played at the wrong speed and was capped at 3 s). `tools/video-test.mjs` reads the files back with ffprobe/ffmpeg: duration, frame count, a frame-exact cut, audio placement.
- **Story → video (`src/video/storyVideo.ts`, Story tab):** a first cut from the Editorial draft — banner, photo stills with a slow move, one caption per sentence of the deck/opening paragraphs (no invented words), desk lower third, close card. Stills on V1 are `clip.still`; captions wrap to title-safe width.

---

## 8. Design System and Interaction Details

### Token System (`src/styles/tokens.css`, `primitives.css`, `base.css`, `studio.css`)
- `src/styles/studio.css` is the design layer and loads last: cards (`--card`, `--card-shadow[-open]`), borderless toolbar fills (`--fill*`), raised chips for selected/segmented states (`--raised`, `--raised-shadow`), filled fields (`--field*`), the primary sheen and the Export split divider (`--split-line`), spring motion (`--spring`). Every token has a light and a dark value.
- **Spacing:** Base 4px grid (`--s-0` to `--s-11`: 0, 2, 4, 6, 8, 12, 16, 20, 24, 32, 40, 48px).
- **Radii:** `--r-1: 4px` (chips/tags), `--r-2: 8px` (controls), `--r-3: 12px` (panels), `--r-4: 16px` (dialogs), `--r-pill: 9999px`.
- **Heights:** Controls 28/32/36px; every control inside a 46px workspace header is 32px with an 8px radius (the Editorial header's tools, AI chip, Sign in and Publish share one 96 px width); Panel Headers 40px.
- **Panels:** side-column `Panel`s are an accordion (opening one closes its siblings and scrolls it to the top; the open header carries an ink bar). Every launch starts with only Category (Graphics) / Organize (Editorial) open in the sidebar; open state lasts for the session only. The Graphics Inspector opts out (`accordion={false}`).
- **Typography:**
  - Load fonts before measuring canvas text (`document.fonts.ready`).
  - Bengali: `"Hind Siliguri"` (+2px line-height, `overflow-wrap: anywhere`).
  - English: `Inter`, `Oswald` (Banner Headings), `-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto`.
  - Tabular numerals for technical/financial figures.
- **Micro-Interactions:** Fast transitions (`cubic-bezier(0.16, 1, 0.3, 1)`), visible focus rings (2px ink with 2px offset), tooltips on icon-only controls.
- **Responsive Layout:** Gracefully adapt between 1366×768 laptops and 1920×1080+ desktops with collapsible sidebars.

---

## 9. Performance, Reliability, and Security

- **Performance:** Move heavy extraction and rendering to background workers. Eliminate unnecessary React re-renders during canvas drag or timeline scrubbing. Manage object URLs and listeners cleanly.
- **Reliability:** Autosave debounced to local project folder with atomic write (write temp + rename). Keep last 5 snapshots for crash recovery.
- **Security:**
  - Strict Electron context isolation and preload IPC validation.
  - Treat all extracted article HTML and external URLs as untrusted data.
  - Never put API secrets or Supabase service-role keys in renderer code.
  - No scripts executed from scraped pages.

---

## 10. Required Commands & Verification Standards

`npm run app` first runs `tools/ensure-deps.mjs`, which installs any package named in `package.json` but missing from `node_modules` — a `git pull` that adds a dependency otherwise fails the build with "Cannot find module".

Run and verify these checks before completing any task:

```bash
# 1. Typecheck & Production Build (Vite 8 + TS)
npm run build

# 2. Run All Unit Tests (Vitest, non-interactive)
npm test

# 3. Run Editorial Headless Playwright Suite
npm run test:editorial

# 4. Run Golden Banner Visual Regression Suite
npm run test:golden

# 5. Linting Check (Oxlint)
npm run lint

# 6. Local Development Server
npm run dev
```

### Headless & Cloud Testing Guidelines:
- Every browser-driven script in `tools/` launches through `tools/launch-browser.mjs`, which tries Edge, then Playwright's Chromium, then a locally installed Chromium under `PLAYWRIGHT_BROWSERS_PATH` — so the suites run on the Windows box and in Linux containers alike. `tools/electron-test.mjs` picks `electron.exe`/`electron` by platform; on Linux run it under `xvfb-run -a`.
- `npm run test:extract` (tools/extract-test.mjs) runs the article extractor against the hand-written pages in `tools/fixtures/` through the real renderer. Fixtures follow public conventions (schema.org JSON-LD, OpenGraph, `<article>` blocks, `__NEXT_DATA__`) and must never contain a publisher's real text or markup.
- `node tools/text-fit-audit.mjs` walks every workspace, panel, tab, dialog and menu with deliberately long newsroom content at 1280/1366/1600/1920 (`W=900,1024` for others; `SHOTS=dir` saves each state) and reports text that is cut with no ellipsis, spills out of its box, is lost in a clipped ancestor, or pushes the page sideways. Keep it at **0 text-fit problems**; every remaining ellipsis should be a deliberate one.
- The main window's minimum is **900 px** (a 1366 × 768 laptop at 150 % is 911 px). Headers give up space in order — labels to icons, redundant buttons whose actions live in the menus — and never push Export/Publish off the edge or hide the menus, sign-in or the AI chip.
- `npm run census` (tools/css-census.mjs) reports duplicate/undefined CSS custom properties and off-scale values; `--strict` fails on duplicates or undefined names.
- The Editorial Desk's "Web Article" preview (`src/editorial/SitePreview.tsx`) is the esbpowerline.com article page itself: markup ported from the website repo's `app/(public)/articles/[slug]/page.tsx`, rendered in an iframe with `src/editorial/site-preview.css`, which is **generated** from the site's `app/globals.css` by `SITE_REPO=../esbpowerline node tools/site-css.mjs` (needs the `esbpowerline/esbpowerline` checkout; runs the site's Tailwind 3.4 via npx). Regenerate it whenever the site's theme tokens or article styles change; never hand-edit it.
- Content Security Policy in `index.html` permits `connect-src 'self' ws: blob: data: https: http:`.

---

## 11. Rules for AI Coding Agents

1. **Read the project instructions first:** Read `CLAUDE.md`, relevant design notes, and package scripts.
2. **Inspect before assuming:** Verify file names, components, dependencies, scripts, and current behaviour in actual checkout.
3. **Protect working functionality:** Do not rewrite working subsystems because a cleaner architecture is theoretically attractive.
4. **Plan, then implement:** State intended scope, files, risks, and acceptance tests before substantial changes.
5. **No fake implementations:** Do not create dummy buttons, mock success states, or claim planned features are working.
6. **No silent data loss:** Protect drafts, scenes, timelines, project files, and user overrides.
7. **Preserve ESB identity:** Never redraw or distort `esb-logo.png` or `esb-avatar.png`.
8. **Protect factual integrity:** Never invent article details, facts, numbers, or attributions.
9. **Respect security boundaries:** No secrets in renderer, no bypassed IPC validation.
10. **Test what changed:** Run relevant checks and report exact commands, results, and known failures.
11. **Inspect results visually:** Exercise the workflow and inspect screenshots; compilation alone is insufficient.
12. **Be transparent:** Clearly separate completed work, partial implementation, known limitations, and next steps.

---

## 12. Required Format for AI Implementation Reports

After each meaningful task, report:
- **What Changed:** User-visible outcome, relevant files, and architectural impact.
- **Why:** Problem being solved and evidence supporting change.
- **Verification:** Exact commands run, pass/fail outcomes, manual workflows tested, and screenshots inspected.
- **Remaining Issues:** Known bugs, edge cases, incomplete requirements, and trade-offs.
- **Next Recommended Step:** One high-value next task, not an unfocused wishlist.
