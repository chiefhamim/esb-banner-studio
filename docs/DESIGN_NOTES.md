# ESB Studio — Design Notes & Visual Specifications

This document defines the single source of truth for the visual layer of ESB Studio.

---

## 1. Design Intent & Language

* **Language**: Quiet Studio (Neutral graphite chrome, ink single accent, Inter typography, 4px geometry).
* **Five Principles**:
  1. **Quiet**: The chrome recedes; the user's news banner, article, or video is the hero.
  2. **Exact**: 4 px base grid, 4 radii, 6 type steps, zero arbitrary offsets.
  3. **Dense but calm**: Professional workstation information density with generous hit targets (≥ 28×28).
  4. **Fast**: State feedback within 16 ms, surface transitions ≤ 200 ms, zero layout thrash.
  5. **Credible**: Editorial newsroom authority; no decorative gradients, glows, or synthetic slop.

---

## 2. Token Architecture (`src/styles/tokens.css`)

### Spacing & Grid (4 px base)
Only the following spacing steps are permitted:
```css
--s-0: 0px;
--s-1: 2px;
--s-2: 4px;
--s-3: 6px;   /* Only allowed half-step: label to control gap */
--s-4: 8px;
--s-5: 12px;
--s-6: 16px;
--s-7: 20px;
--s-8: 24px;
--s-9: 32px;
--s-10: 40px;
--s-11: 48px;
```

### Component Heights & Widths
* **Control Heights**: 24 (inline table), 28 (compact/tabs), 32 (standard input/button), 36 (toolbar/header buttons).
* **Row Heights**: 36 px (standard table/list rows), 28 px (compact rows).
* **Panel Headers**: 40 px.
* **App Header**: 40 px (compatible with Windows 11 title bar caption overlay).
* **Workspace Rail**: 56 px wide (20 px icon in 36 px square + 11 px label).

### Corner Radii
* `4 px` (`--r-1`): Key caps, chips, tags inside dense rows, inner handles.
* `8 px` (`--r-2`): Controls (buttons, inputs, select triggers, cards).
* `12 px` (`--r-3`): Panels, popovers, menus, context cards.
* `16 px` (`--r-4`): Dialogs, modal surfaces, floating preview windows.
* `9999 px` (`--r-pill`): Status pills, editorial category tags only.
* *Rule*: Nested radius = outer − padding (inner never exceeds outer).

### Typography Scale
Font stack: `Inter, "Hind Siliguri", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`.
* `11 px / 16 px` (`--t-caption`): Captions, overline, key caps (`letter-spacing: +0.06em`, weight 600).
* `12 px / 16 px` (`--t-secondary`): Secondary hints, field labels, metadata (weight 400/500).
* `13 px / 20 px` (`--t-body`): Body text, buttons, controls, panel titles (weight 400/500/600).
* `15 px / 20 px` (`--t-title`): Headings, item names, popover titles (weight 600).
* `18 px / 24 px` (`--t-dialog`): Dialog titles, section headers (`letter-spacing: -0.01em`, weight 700).
* `24 px / 28 px` (`--t-hero`): Home dashboard title only (weight 700).
* *Bengali text*: Automatically receives +2 px line-height and `overflow-wrap: anywhere`.

### Semantic Color Roles
* `--surface-app`: Base window surface (`#e9e9eb` light / `#0d0d0f` dark).
* `--surface-panel`: Sidebar, dock, and panel backgrounds (`#ffffff` light / `#161619` dark).
* `--surface-raised`: Popovers, floating bars, active rail tiles (`#ffffff` light / `#1e1e23` dark).
* `--surface-sunken`: Inputs, code areas, scroll tracks (`#f6f6f7` light / `#111114` dark).
* `--border-subtle`: Hairline dividers between panels (`#ececef` light / `#232328` dark).
* `--border-default`: Control boundaries (`#dcdce0` light / `#2e2e35` dark).
* `--border-strong`: Active/focused borders (`#c3c3ca` light / `#44444e` dark).
* `--text-primary`: Primary headings, values, labels (`#18181b` light / `#f4f4f5` dark).
* `--text-secondary`: Secondary hints, table subtitles (`#52525b` light / `#a1a1aa` dark).
* `--text-tertiary`: Inactive tags, placeholders (`#686872` light / `#71717a` dark).
* `--text-disabled`: 50% opacity text.
* `--accent`: Ink (`#18181b` light / `#ffffff` dark).
* `--on-accent`: Foreground on ink (`#ffffff` light / `#18181b` dark).
* `--focus-ring`: 2 px ink ring with 2 px offset.
* `--danger`: `#b42318` (warnings and errors).
* `--warning`: `#9a5b00` (discrepancy and review tags).
* `--success`: `#1f7a45` (verified facts, successful exports).

### Elevation
* **L0**: App background (flat).
* **L1**: Panels (flat with 1 px `--border-subtle`).
* **L2**: Menus, popovers, floating preview (`0 12px 32px rgb(0 0 0 / .14), 0 2px 6px rgb(0 0 0 / .06)` + 1 px border).
* **L3**: Dialogs (`0 16px 40px rgb(0 0 0 / .22), 0 3px 8px rgb(0 0 0 / .08)` + scrim `rgba(24, 24, 27, 0.42)`).

---

## 3. Component States & Standards

1. **Button**:
   - `primary`: ink fill, `--on-accent` text.
   - `secondary`: `--surface-raised` fill, 1 px `--border-default`.
   - `subtle`: transparent fill, hover `--ink-soft`.
   - `danger`: secondary border, `--danger` text.
   - Heights: 28, 32, 36.
   - States: rest · hover (+4% ink overlay) · pressed (+8% ink overlay) · focus-visible (2 px ring) · disabled (50% opacity, `aria-disabled="true"`).
2. **Input & Numeric Scrub**:
   - Height 32 px, radius 8 px, `--surface-sunken`, 1 px `--border-default`.
   - Focus: `--border-strong` + 2 px `--ink-ring`.
   - Scrub: drag on label scrubs value, double click resets, arrow keys nudge ±1 (Shift ±10, Alt ±0.1).
3. **Switch & Segmented Control**:
   - Switch: 28×16 px, ink track when on, thumb 12 px with 2 px offset.
   - Segmented: 28 px high, 4 px inset pill track, raised active segment.
4. **Tooltips**:
   - 500 ms hover delay, 100 ms fade-in, offset 6 px, max width 240 px.
   - Format: "[Action description]  [Key cap]".
5. **Scrollbars**:
   - 10 px overlay thumb, radius 4 px, semi-transparent `--border-strong`, fully visible on hover.

---

## 4. Copy Rules
* Sentence case everywhere.
* ≤ 3 words for button labels ("Export banner", "Restore session").
* No exclamation marks or conversational filler ("Please", "Let's").
* Dates: `22 Oct 2026`.
* Numbers: tabular (`font-variant-numeric: tabular-nums`).
