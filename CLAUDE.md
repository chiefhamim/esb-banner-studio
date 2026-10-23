# CLAUDE.md — ESB PowerLine Studio: Master Cloud & Engineering Guide

> **Document Type:** Master Product Brief, Engineering Charter & Claude Cloud Instructions  
> **Product:** ESB Studio  
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
- **Workspace switcher:** Editorial, Graphics, Video (`src/shell/WorkspaceRail.tsx`).
- **Project control:** current project/story, save state, recent projects and project actions.
- **Global command/search palette:** search commands, actions, projects and assets; show relevant keyboard shortcuts.
- **Contextual toolbar:** controls relevant to the current workspace and selection.
- **Status area:** save/sync status, background jobs, export progress and actionable errors.
- **Inspector:** context-sensitive properties, not a permanently crowded wall of controls.

### Workspace 1 — Editorial (`src/editorial/`)
Purpose: turn source material into an accurate, publication-ready story.
- **Source panel:** original article, source URL, publisher, extraction status, source image, captions and credits (Hind Siliguri font).
- **Story editor:** headline (≤104 chars), standfirst/deck (≤200 chars), body (68ch measure), tags, category, author, slug (≤80 chars) and publication metadata.
- **Verification/inspector panel:** figures, dates, entities, source attribution, unresolved checks and publication readiness.
- **Graphics companion (`GraphicsRail.tsx`):** live preview of linked visual assets (Banner 4:5, Web Article, Facebook 1200×630).

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

---

## 8. Design System and Interaction Details

### Token System (`src/styles/tokens.css`, `primitives.css`, `base.css`)
- **Spacing:** Base 4px grid (`--s-0` to `--s-11`: 0, 2, 4, 6, 8, 12, 16, 20, 24, 32, 40, 48px).
- **Radii:** `--r-1: 4px` (chips/tags), `--r-2: 8px` (controls), `--r-3: 12px` (panels), `--r-4: 16px` (dialogs), `--r-pill: 9999px`.
- **Heights:** Controls 28/32/36px; Panel Headers 40px; Workspace Rail 56px wide.
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
