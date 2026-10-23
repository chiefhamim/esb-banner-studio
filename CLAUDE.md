# CLAUDE.md — ESB Banner Studio & Editorial Desk

## 1. Project Overview
ESB Studio is a specialized newsroom application combining an **Editorial Story Desk** and a **Graphics Banner Studio** for *ESB PowerLine* (`esbpowerline.com`).
- **Framework**: React 19 + TypeScript (Strict) + Vite 8
- **State**: Zustand (separate stores for Graphics canvas `useStore`, Editorial Desk `useEditorialStore`, and Shell `useShellStore`)
- **Backend / CMS**: Supabase REST API (`public.Article`, `public.Category`) with fallback to Next.js CMS endpoints
- **Test Frameworks**: Vitest (Unit tests) + Playwright (Headless End-to-End verification)

---

## 2. Common Commands

```bash
# Install dependencies
npm install

# Production Build (TypeScript type-check + Vite build)
npm run build

# Run Unit Tests (Vitest, non-interactive)
npm test
# or
npm run test:unit

# Run Editorial End-to-End Playwright Test Suite
npm run test:editorial

# Linting
npm run lint

# Local Development Server
npm run dev
```

---

## 3. Key Architecture & Directories

- `src/editorial/`:
  - `EditorialWorkspace.tsx`: Main newsroom desk layout. 3-column architecture (Left: Bengali Hind Siliguri Source Reader; Center: Story Document with unboxed headline, deck, 68ch body, inline fact verification; Right: Companion Preview Rail). Includes empty-state intake launcher card.
  - `GraphicsRail.tsx`: Right companion rail with multi-channel preview tabs (`Banner 4:5`, `Web Article`, `Facebook`), sector desk picker (01–08), photo selector, caption sync, and 1-click export actions.
  - `extract.ts`: Offline DOMParser & regex-based article extractor. Filters out site self-promotion (e.g. Bonik Barta tagline), print footers, and office addresses (e.g. Karwan Bazar, BDBL Bhaban, Dhaka-1215).
  - `translator.ts`: Parallel newsroom translation engine (Gemini 2.5 Flash with Neural GTX fallback). Enforces character budgets.
  - `facts.ts`: Entity, capacity (MW/MMCFD), and currency extraction engine for inline fact verification.
  - `siteApi.ts`: Supabase direct PostgreSQL insert pipeline (`public.Article`) with author CUID and sector CUID mappings.
  - `bannerLink.ts`: Live bidirectional synchronization between Editorial draft and Graphics banner store.
- `src/components/`:
  - `PreviewPanel.tsx`: `BannerCanvas` (2D Canvas render engine) and `FacebookMock`.
  - `FormatPicker.tsx`: Aspect ratio selector (4:5, 1:1, 16:9, etc.).
- `src/core/`:
  - `tokens.ts`: Color tokens, category definitions (`CATEGORIES`), aspect ratios (`FORMATS`).
  - `newsroom.ts`: Newsroom presets, caption generators, highlight detectors.
- `tools/`:
  - `tools/editorial-test.mjs`: Complete Playwright E2E suite testing intake, translation, Trucent line breaks, live link, previews, and pre-flight publishing.
  - `tools/unit/`: Vitest test suites for security, editorial extraction, templates, and video.

---

## 4. Newsroom Constraints & Editorial Guardrails

1. **Character Budgets**:
   - **Headline**: Maximum 104 characters.
   - **Deck / Standfirst**: Maximum 200 characters.
   - **URL Slug**: Maximum 80 characters (lowercase alphanumeric with hyphens).
2. **Fact Verification Engine**:
   - Figures verified against source Bengali text are highlighted inline with a green underline (`.fact-verified`).
   - Discrepancies receive an amber wavy underline (`.fact-unverified`).
   - Clicking a fact chip in the source reader scrolls directly to its body match.
3. **Publishing Pre-Flight Gates**:
   - `Publish Live to CMS` is strictly disabled until all three pre-flight checklist items are ticked:
     1. Numbers, capacities, and currencies verified.
     2. Institutional names and ministries verified.
     3. Source credit and photo attribution preserved.
4. **Cloud / Headless Testing**:
   - Tests in `tools/` automatically detect environment capabilities and fall back from `msedge` to headless `chromium` when running on Linux containers.
   - Browser Content Security Policy in `index.html` allows `connect-src 'self' ws: blob: data: https: http:`.
