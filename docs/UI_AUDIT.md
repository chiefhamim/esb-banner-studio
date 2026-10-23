# ESB Studio — Visual & UI Design Audit

This audit documents the visual baseline captured before visual refactoring on 2026-10-22.
Screenshots stored in `tools/out/ui-before/` across 32 combinations (1366×768, 1920×1080, DPR 1 & 1.5, Light & Dark themes for Home, Graphics, Graphics Export, and Editorial Desk).

---

## 1. Measured Token Defects (from `tools/audit-ui.mjs`)

| Category | Allowed Token Scale | Measured Off-Scale Values | Occurrences / Impact |
| :--- | :--- | :--- | :--- |
| **Corner Radius** | `0 · 4 · 8 · 12 · 16 · 9999` | `6px` (3×), `2px` (2×), `50%` (1×) | Non-standard 6px and 2px radii in card tabs and tags (`App.css:1438`, `1528`). |
| **Paddings** | `0 · 2 · 4 · 6 · 8 · 12 · 16 · 20 · 24 · 32 · 40 · 48` | `3px` (1×), `5px` (1×), `10px` (4×), `14px` (2×) | Off-grid paddings in URL importer, tag chips, and preview trays (`App.css:1437`, `1536`). |
| **Gaps** | `2 · 4 · 6 · 8 · 12 · 16 · 20 · 24 · 32 · 40 · 48` | `7px` (1×) | Off-grid 7px flex gap in custom layer rows. |
| **Font Weights** | `400 · 500 · 600` (700 banner-only) | `700` in UI chrome (`ct-tab.on`, `asp-tag`) | Bold 700 used on active tab labels instead of weight 600. |
| **Colours & Backgrounds**| Semantic neutrals + Ink | 29 distinct background values including raw hexes (`#dc2828`, `#1e3a8a`, `#15803d`, etc.) | Off-palette raw hexes scattered throughout `App.css` instead of semantic surface tokens. |

---

## 2. Accessibility & Contrast Defects (from `tools/contrast-audit.mjs` & `tools/a11y-audit.mjs`)

1. **DEF-001 (Dark Theme Contrast):**
   - *Element*: `.dpc-label` ("Drag to Post" chip text)
   - *Contrast*: 2.56:1 against dark surface.
   - *Fix*: Use `--text-primary` or `--text-secondary` (≥ 4.5:1).
2. **DEF-002 (Dark Theme Tab Contrast):**
   - *Element*: Inactive tab buttons in `.side-tabs` (`Photos`)
   - *Contrast*: 2.56:1 against sunken tab container.
   - *Fix*: Increase contrast of inactive tab text to `--text-secondary` (`#a1a1aa` / `#d4d4d8`).
3. **DEF-003 (Missing Accessible Names):**
   - *Element*: `<input type="checkbox">` in dock element toggle rows.
   - *Defect*: No `aria-label` or associated `<label>`.
   - *Fix*: Add `aria-label={el.name + " visibility"}`.
4. **DEF-004 (Focus Visible Rings):**
   - *Element*: Native buttons and segmented controls show default browser outline on click.
   - *Fix*: Standardise `:focus-visible` with 2px ink ring and 2px offset; suppress `:focus:not(:focus-visible)`.

---

## 3. Layout & Geometry Inconsistencies

1. **DEF-005 (Header Heights):**
   - Shell header is currently 52px in `.topbar`, while workspace spec requires 40px aligned bar.
   - Panel headers vary between 36px and 40px.
2. **DEF-006 (Workspace Rail Visual Density):**
   - Active state rail button uses 40×40 with 9px label; needs strict 56px width rail with 20px icon in 36px square + 11px label, 2px ink indicator on left edge.
3. **DEF-007 (Splitter Grab Area):**
   - Splitters currently have inconsistent hover indicators across panels.

---

## 4. Handoff List ("Needs Functional Change" - Out of Scope)

The following items require main process IPC or functional engine changes, which are explicitly out of scope for this visual pass:
1. **Windows 11 Custom Title Bar Overlay (`titleBarStyle: 'hidden'` + `titleBarOverlay`):** Requires Electron main process window options in `electron/main.cjs`. Styled to support both native and overlay frames gracefully.
2. **Command Palette (`Ctrl+K`) Functional Engine:** Visual spec designed and styled; full action registry execution belongs to shell functional layer.
