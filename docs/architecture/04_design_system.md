# ESB Studio — Design System, Typography & Layout Geometry

> **Scope**: Cross-Platform Design Specifications  
> **Target Products**: Desktop Workstation (`esb-banner-studio`) & Android Companion (`esb-studio-phone`)  
> **Brand**: ESB Power Line  
> **Core Aesthetic**: Professional Journalism, Neutral Graphite, Zero "AI-Slop"

---

## 1. Visual Philosophy & Anti-AI-Slop Directives

The ESB Studio design system is engineered for newsroom focus, speed, and precision. It categorically bans generic "AI generated" UI patterns:

1. **No Gratuitous Gradients**: Gradients are forbidden on cards, panels, and borders. Use clean flat surfaces with subtle 1px border separation (`rgba(255, 255, 255, 0.08)` or `#2D3748`).
2. **No Neon Glows or Blurred Backdrops**: Neon glow drop-shadows create visual fatigue during 8-hour reporting shifts. Shadows are reserved strictly for floating menus (`box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4)`).
3. **No Excessive Rounded Corners**: Desktop controls use crisp radii: `--radius-xs: 2px`, `--radius-sm: 4px`, `--radius-md: 6px`. Mobile controls use ergonomic One UI rounded pill radii (`--radius-pill: 9999px`) only for interactive chips and primary action sheets.
4. **Quiet Chrome, Loud Content**: The workstation chrome remains neutral graphite. The news content, photography, and banner graphics are the sole focal points.

---

## 2. The 4-Pixel Geometry Scale

All spacing, padding, margins, heights, and layout dimensions adhere to the 4px baseline token system defined in [tokens.css](file:///C:/Users/hamim/esb-banner-studio/src/styles/tokens.css):

| Token | Dimension | Typical Usage |
| :--- | :--- | :--- |
| `--s-0` | `0px` | Explicit zero reset |
| `--s-1` | `4px` | Micro gaps between icon and label, badge internal padding |
| `--s-2` | `8px` | Compact button horizontal padding, list item vertical gaps |
| `--s-3` | `12px` | Standard input vertical padding, control group spacing |
| `--s-4` | `16px` | Container padding, card interior margins, toolbar height offsets |
| `--s-5` | `20px` | Panel headers, section dividers |
| `--s-6` | `24px` | Workspace gutters, editorial desk margins |
| `--s-7` | `28px` | Major section separation |
| `--s-8` | `32px` | Standard button height (Desktop), compact rail width offsets |
| `--s-9` | `36px` | Medium button height |
| `--s-10` | `40px` | Prominent CTA button height (Desktop) |
| `--s-11` | `48px` | Primary mobile touch targets, header bar height |

---

## 3. Strict Typography Standards

Typography in ESB Studio serves both English and Bengali readers. Bengali requires special font metrics due to matras, conjuncts, and ascenders/descenders.

### 3.1 Font Stack Hierarchy
- **Bengali Editorial & Banners**: **Hind Siliguri** (Google Fonts / local fallback).
  - **MANDATORY**: Line-height must **never drop below 1.6** for Bengali body or 1.35 for display headlines. Anything tighter causes conjunct glyphs (যুক্তাক্ষর) and vowel signs (হ্রস্ব-ই কার, দীর্ঘ-উ কার) to collide or clip.
  - OpenType shaping: `font-feature-settings: "kern" 1, "liga" 1;`.
- **English UI Chrome & Copy**: **Inter** (Primary UI), **Space Grotesk** (Data metrics, character counts, status slugs), **Source Serif 4** (Long-form editorial body read mode).

### 3.2 Typography Scale
```css
/* Typography Scale */
--text-xs:   11px; line-height: 14px;  /* Timestamps, metadata, keyboard shortcuts */
--text-sm:   13px; line-height: 18px;  /* Secondary descriptions, table rows */
--text-base: 14px; line-height: 20px;  /* Standard UI controls, inputs, body text */
--text-md:   16px; line-height: 24px;  /* Prominent labels, modal titles */
--text-lg:   18px; line-height: 26px;  /* Section headings */
--text-xl:   22px; line-height: 30px;  /* Article titles in review */
--text-2xl:  28px; line-height: 36px;  /* Banner canvas headlines (display) */
```

---

## 4. Component Standards & Geometry Constraints

### 4.1 Buttons & Touch Targets
- **Desktop**:
  - Compact: `height: 32px; padding: 0 12px; font-size: 13px; border-radius: 4px;`
  - Prominent: `height: 40px; padding: 0 16px; font-size: 14px; border-radius: 6px;`
- **Android Mobile**:
  - Standard touch target: `min-height: 44px; min-width: 44px; padding: 0 16px;`
  - Primary bottom CTA: `height: 48px; border-radius: 24px; width: 100%;`

### 4.2 Text Truncation & Optical Balance
- **Headline Rules**: Never apply `overflow: hidden; text-overflow: ellipsis; white-space: nowrap;` to news article headlines or banner headlines. Editorial headlines must wrap cleanly or trigger character-budget warnings.
- **Optical Centering**: Icons within buttons must be vertically and horizontally centered with optical compensation. When an icon accompanies a label, use `gap: var(--s-1);` and `display: inline-flex; align-items: center; justify-content: center;`.
- **Contrast**: All interactive states and category pills must pass **WCAG AA contrast (minimum 4.5:1)** against their background surfaces in both Dark and Light themes.
