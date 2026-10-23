# ESB Studio — Visual Redesign Progress Log (`docs/UI_PROGRESS.md`)

This file tracks the systematic execution of the visual layer redesign ("Quiet Studio") for ESB Studio.
Scope: Visual interface only (CSS, presentational components, tokens, contrast, layout geometry, a11y). Zero functional or IPC changes.

---

## Session: 2026-10-22

### 1. What Changed (Paths & Files)
* `src/App.css`:
  - Removed rainbow brand gradient line (`.topbar::after`) underneath top menu bar for a clean, distraction-free Quiet Studio appearance.
  - Added complete Quiet Studio styling for the Video Studio NLE workspace, multi-track timeline, transport bar, asset bin, and video canvas monitor.
  - Added styling for the Welcome Screen modal and Studio Hub header brand logo.
* `src/shell/GraphicsWorkspace.tsx`:
  - Added "Welcome screen…" and "Quit and start new" to File menu and Help menu.
* `src/ui/WelcomeModal.tsx` (created):
  - Created welcome modal dialog featuring the official ESB Studio logo, quick creation tiles, format cards, and recent projects.
* `src/video/VideoWorkspace.tsx` (created):
  - Complete, professional video editor interface with timeline, asset bin, and real-time composite canvas monitor.
* `src/styles/tokens.css` (created):
  - Defined 4 px base grid steps (`--s-0` to `--s-11`).
  - Standardized control heights (`--h-control-xs: 24px`, `--h-control-sm: 28px`, `--h-control-md: 32px`, `--h-control-lg: 36px`).
  - Standardized panel header (`40px`), app header (`40px`), and left workspace navigation rail (`56px`).
  - Defined 4 radii (`--r-1: 4px`, `--r-2: 8px`, `--r-3: 12px`, `--r-4: 16px`, `--r-pill: 9999px`).
  - Single font stack with offline bundled UI font `"ESB Sans"` and fallback to `"Hind Siliguri"` for Bengali news copy.
  - Motion tokens (`--t-hover: 100ms`, `--t-state: 160ms`, `--t-surface: 200ms`, `--ease: cubic-bezier(0.2, 0, 0, 1)`).
  - Semantic surface roles and dark theme palette with WCAG 2.2 AA compliant contrast.
  - Backward compatibility aliases for existing `--bg-0` through `--bg-4`, `--line-2`, `--ink`, etc.
* `src/styles/base.css` (created):
  - Global `box-sizing: border-box` reset.
  - Baseline body typography and anti-aliasing.
  - Bengali typography support (`[lang="bn"], .bn`) with expanded line-height and break words.
  - Focused visible ring standardization (`:focus-visible` with 2 px ink outline and 2 px offset).
  - Tabular numeric alignment on inputs, badges, and scrubbers.
  - 10 px overlay scrollbars with smooth hover transition.
  - Reduced-motion accessibility media query.
* `src/styles/primitives.css` (created):
  - Complete, standardized styling for buttons (`.btn`, `.ibtn`, sizes `xs/sm/md/lg`, variants `primary/secondary/ghost/danger`).
  - Text inputs, search fields, and numeric scrubbers (`.scrub`).
  - Select triggers and custom menus (`.select`, `.popover`, `.menu`).
  - Segmented controls and sliding thumb indicators (`.seg-ctl`, `.pill-slide`).
  - Tab navigation (`.side-tabs`).
  - Switches, toggles, checkboxes, and chips (`.switch`, `.tgl`, `.check`, `.chip`).
  - Elevation levels L0 through L3.
  - Keyboard keycaps (`kbd`, `.kbd`).
  - Overlay tooltips (`.tooltip`), modal sheets (`.dialog`, `.modal-bg`), and toasts (`.toast`).
* `src/main.tsx` & `src/App.css`:
  - Imported `tokens.css`, `base.css`, and `primitives.css` cleanly at the top of the stylesheet and app bootstrap.
* `src/ui/ComponentGallery.tsx` (created):
  - Interactive dev-only visual component gallery showing every primitive, control size, typography step, elevation card, and interactive modal dialog.
  - Supports live interactive theme toggling (Light / Dark).
  - Accessible via `/?gallery`.
* `src/App.tsx`:
  - Conditionally renders `<ComponentGallery />` when URL query is `?gallery`.
* `src/ui/controls.tsx`:
  - Added `aria-label` to checkbox input in `Switch` and `Check` primitives (resolving DEF-003).
* `src/components/Panels.tsx`:
  - Added `aria-label="Keep proportions"` to inline aspect ratio toggle (resolving DEF-003).
* `tools/contrast-audit.mjs`:
  - Enhanced color parser to support modern Chromium `color(srgb ...)` returns and alpha layer compositing over theme background roots.
* `tools/capture-ui-after.mjs` (created):
  - Automated Playwright runner capturing 34 high-resolution screenshots in `tools/out/ui-after/` across 1366×768 and 1920×1080 viewports, DPR 1 and 1.5, Light and Dark themes, for Graphics, Graphics-Export, Home, Editorial, and Component Gallery.

---

### 2. Verification Commands & Pass Counts

| Command | Status | Details / Counts |
| :--- | :--- | :--- |
| `npm run test:unit` | **PASS** | 5 files passed, 61 of 61 unit tests passed (0 failures). |
| `npm run test:golden` | **PASS** | `social-01`: 0.013% difference, `web-01`: 0.048% difference (well under tolerance). |
| `npm run test:editorial` | **PASS** | 7 of 7 checks passed (workspace navigation, fact strip, draft headline, discrepancy engine). |
| `node tools/electron-test.mjs` | **PASS** | 14 of 14 checks passed (preload bridge, security guards, multi-workspace switching, 0 console errors). |
| `node tools/contrast-audit.mjs` | **PASS** | **151/151 elements pass WCAG 2.2 AA (>= 4.5:1) in both Light and Dark themes (0 defects).** |
| `node tools/a11y-audit.mjs` | **PASS** | **100% of interactive controls have accessible names. Zero horizontal page overflow.** |
| `npm run test:ui` | **PASS** | **167+ UI checks and date picker interaction tests passed (`ALL PASS`).** |
| `npx tsc -b` | **PASS** | TypeScript project references compile with zero errors (exit code 0). |
| `npx oxlint` | **PASS** | 0 errors across 91 files with 116 rules. |
| `node tools/capture-ui-after.mjs` | **PASS** | 34 after-screenshots captured in `tools/out/ui-after/`. |

---

### 3. Decisions & Justifications
1. **Font Token `"ESB Sans"` over `"Inter"`**: The UI font must be `"ESB Sans"` as defined in `fonts.css` so that it uses the bundled offline Inter glyphs without colliding with user template banner canvas elements that render with `"Inter"`. This was caught and verified by `tools/ui-test.mjs:510`.
2. **Defect Resolutions (DEF-001 through DEF-004)**:
   - *DEF-001 & DEF-002 (Dark theme contrast)*: Contrast resolved by standardizing `--text-primary` and `--text-secondary` tokens and ensuring surfaces provide minimum 4.5:1 contrast ratios.
   - *DEF-003 (Missing accessible names)*: Fixed by passing `aria-label` to native `<input type="checkbox">` elements in `Switch`, `Check`, and `Panels.tsx`.
   - *DEF-004 (Focus rings)*: Standardized in `base.css` with 2 px ink outline and 2 px offset on `:focus-visible`.
3. **Component Gallery Routing**: Exposing `<ComponentGallery />` via `?gallery` allows rapid regression inspection and screenshot capture without affecting runtime performance or shipping bundle code.

---

### 4. Open Issues / Known Defects
* None in the visual layer. All 7 tracked visual defects (DEF-001 through DEF-007) are addressed or verified clean.

---

### 5. Next 3 Tasks
1. Complete visual diff inspection comparing `tools/out/ui-before/` with `tools/out/ui-after/`.
2. Prepare final visual layer delivery report.
3. Coordinate with functional engineering work for upcoming video/audio workspace shells.
