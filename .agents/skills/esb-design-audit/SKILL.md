---
name: esb-design-audit
description: >-
  Use this skill when auditing UI geometry, design tokens, optical centering,
  label clipping, or accessibility contrast in ESB Studio.
---

# ESB Studio Design & Layout Audits

Use these tools to ensure the desktop UI adheres to the 4px token system, avoids text clipping across responsive scales (900px, 1280px, 1920px), and passes accessibility checks.

## Available Audits

1. **Optical Centering Audit**:
   Verifies that icon + label boxes align within their padding containers without sub-pixel drift.
   ```bash
   npm run audit:center
   ```

2. **Text-Fit & Truncation Audit**:
   Measures buttons, pills, tabs, and menu options across themes to detect any overflow or accidental `...` truncation.
   ```bash
   npm run audit:text-fit
   ```

3. **Contrast Audit**:
   Checks WCAG AA contrast (minimum 4.5:1) for all interactive states and categories in both light and dark themes.
   ```bash
   npm run audit:contrast
   ```

4. **Accessibility (A11y) Audit**:
   Scans for missing labels, keyboard focus traps, and aria roles.
   ```bash
   npm run audit:a11y
   ```

5. **CSS Census**:
   Audits token compliance and flags undeclared raw hex or pixel values.
   ```bash
   npm run census
   ```
