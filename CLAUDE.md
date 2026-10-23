# CLAUDE.md — ESB PowerLine Studio: Master Cloud & Execution Guide

> **Product**: ESB Studio (`esbpowerline.com`)  
> **Mission**: A professional newsroom workstation combining an **Editorial Story Desk** and a **Graphics Banner Studio** for energy sector journalism. Takes a single Bengali news link and transforms it into a production-ready, fact-verified English news story with coordinated, broadcast-grade visual banners in one unified workflow.  
> **Aesthetic Standard**: **Mac-Level Craftsmanship** — Quiet Studio, neutral graphite chrome, single ink accent, 4px geometrical grid, 60fps buttery micro-interactions, zero AI slop, zero boilerplate forms.

---

## ⚡ ULTRAMAX MASTER EXECUTION DIRECTIVE
*(Copy and run this single prompt with `claude --cloud "..."` or pass to Claude Code locally to execute the end-to-end evolution of ESB Studio)*

```text
You are acting as the Principal Software Architect and World-Class Product Designer (Apple / Linear / Mac-grade craftsmanship) for ESB PowerLine Studio.

Your objective is to elevate this application into an extraordinary, Mac-level newsroom suite where Editorial and Graphics work in seamless, harmonic cohesion. The studio must deliver a zero-friction "One Link Paste to Production-Ready English Story + Broadcast Graphics" experience that feels handcrafted with deep love, care, and mathematical precision.

Read CLAUDE.md, docs/SPEC.md, and docs/DESIGN_NOTES.md thoroughly. Execute this transformation in disciplined, verified phases:

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

## 1. Design Philosophy: The "Quiet Studio" (Non-AI Slop)

The app rejects generic, synthetic dashboards. It is built for professional energy journalists who need speed, clarity, and authority.

### Core Visual Principles:
1. **Quiet**: The chrome recedes; the news banner, story, and photo are the heroes.
2. **Exact**: 4px base grid, 4 radii (4px, 8px, 12px, 16px), 6 type steps, zero arbitrary CSS offsets.
3. **Dense but Calm**: Information density with comfortable click targets (≥ 28×28px).
4. **Fast**: State feedback within 16ms, transitions ≤ 200ms using `cubic-bezier(0.16, 1, 0.3, 1)`. Zero layout thrashing.
5. **Credible**: Editorial newsroom authority. No unnecessary neon glows, synthetic gradients, or fake progress bars.

### Design Tokens (`src/styles/tokens.css`):
- **Spacing Scale**: `--s-0: 0px`, `--s-1: 2px`, `--s-2: 4px`, `--s-3: 6px`, `--s-4: 8px`, `--s-5: 12px`, `--s-6: 16px`, `--s-7: 20px`, `--s-8: 24px`, `--s-9: 32px`, `--s-10: 40px`, `--s-11: 48px`.
- **Radii**: `--r-1: 4px` (chips/tags), `--r-2: 8px` (controls/buttons), `--r-3: 12px` (panels/cards), `--r-4: 16px` (modals/dialogs), `--r-pill: 9999px` (status tags).
- **Control Heights**: 24px (compact table), 28px (tabs/chips), 32px (standard buttons/inputs), 36px (toolbar headers).
- **Typography**: 
  - English: `Inter`, `Oswald` (Banner Headings), `-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto`.
  - Bengali: `"Hind Siliguri"` with +2px line-height and `overflow-wrap: anywhere`.

---

## 2. Architecture & File Structure

```
C:\Users\hamim\esb-banner-studio/
├── CLAUDE.md                    # This master execution & cloud guide
├── src/
│   ├── editorial/               # NEWSROOM EDITORIAL DESK
│   │   ├── EditorialWorkspace.tsx # 3-column document workspace (Reader, Story, Rail)
│   │   ├── GraphicsRail.tsx     # Companion rail (Banner, Web, FB previews, sector picker)
│   │   ├── editorialStore.ts    # Zustand store for newsroom drafts, facts, and intake
│   │   ├── extract.ts           # Offline DOMParser & regex cleaner (anti-noise/addresses)
│   │   ├── translator.ts        # Newsroom translation engine (preserves numbers/MW/Tk)
│   │   ├── facts.ts             # Capacity, currency, entity extraction & inline match
│   │   ├── bannerLink.ts        # 2-way sync bridge between Editorial & Graphics
│   │   └── siteApi.ts           # Supabase REST publisher (public.Article)
│   ├── components/              # GRAPHICS STUDIO & CANVAS ENGINE
│   │   ├── Stage.tsx            # Multi-layer canvas editor (snapping, rulers, overlays)
│   │   ├── Panels.tsx           # Story, Photos, Inspector, Layers dock
│   │   ├── PreviewPanel.tsx     # 2D Canvas render engine & Facebook mock preview
│   │   └── FormatPicker.tsx     # Aspect ratio switcher (4:5, 1:1, 16:9, etc.)
│   ├── core/                    # CORE RENDERING & TOKENS
│   │   ├── tokens.ts            # Category colors (01–08), formats, defaults
│   │   ├── render.ts            # High-res Canvas 2D scene renderer
│   │   ├── templates.ts         # Template builder functions
│   │   └── newsroom.ts          # Newsroom helper algorithms & caption generators
│   ├── shell/                   # WORKSPACE SHELL
│   │   ├── WorkspaceRail.tsx    # 56px left navigation rail (Editorial, Graphics, Video)
│   │   └── shellStore.ts        # Active workspace & shell state
│   └── styles/                  # DESIGN SYSTEM STYLES
│       ├── tokens.css           # 4px geometry, radii, semantic colors
│       ├── primitives.css       # Buttons, inputs, chips, switches
│       └── base.css             # Base reset and typography
├── tools/                       # AUTOMATED TEST SUITES
│   ├── editorial-test.mjs       # Headless Playwright E2E suite for Editorial Desk
│   ├── golden-test.mjs          # Visual regression pixelmatch suite for Graphics
│   └── unit/                    # Vitest test specs (security, extract, video, project)
```

---

## 3. Newsroom Editorial Constraints & Guardrails

1. **Character Budgets**:
   - **Headline**: Max **104 characters**. Must be strong, active voice journalistic English.
   - **Standfirst / Deck**: Max **200 characters**. Contextualizes the headline.
   - **URL Slug**: Max **80 characters** (lowercase alphanumeric, hyphen-delimited).
2. **Fact Verification Engine**:
   - Entities, megawatts (MW), million cubic feet (MMCFD), currencies (Tk, Crore, Billion), dates, and ministries are extracted from Bengali source.
   - Matches in the English story body receive `.fact-verified` (green underline).
   - Discrepancies receive `.fact-unverified` (amber underline).
   - Clicking a chip in the source reader smooth-scrolls and highlights its match in the story body.
3. **Noise Exclusion in Scraper**:
   - Discards publisher branding (e.g., Bonik Barta tagline, Daily Star promos).
   - Discards print/web footers, social share text, and office addresses (e.g., Karwan Bazar, BDBL Bhaban, Kazi Nazrul Islam Avenue, Dhaka-1215).
4. **Publishing Pre-Flight Gates**:
   - `Publish Live to CMS` is strictly locked until all checklist criteria are met:
     - [ ] Numbers, capacities, and currencies verified against Bengali source.
     - [ ] Institutional names and ministries verified.
     - [ ] Source credit and photo attribution preserved.

---

## 4. Protected Brand Assets (Never Redraw or Overwrite)
- `src/assets/images/esb-logo.png`
- `src/assets/images/esb-avatar.png`
- `build/icon.png` and `build/icon.ico`
- `public/favicon.svg`
- `tools/golden/*.png` (Golden visual baselines)

---

## 5. Development, Build & Testing Commands

Always run and verify these commands before completing any task:

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
- Tests in `tools/` automatically detect environment capabilities and fall back from `msedge` to headless `chromium` when running on Linux containers.
- Content Security Policy in `index.html` permits `connect-src 'self' ws: blob: data: https: http:`.
