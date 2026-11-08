---
name: esb-design-specialist
description: >-
  Use this skill for UI/UX audits, typography compliance (Bengali Hind Siliguri 1.6 line-height),
  Quiet Graphite design tokens, One UI mobile ergonomics, and touch hitbox validation.
---

# ESB Studio Design Systems Specialist Skill

Use this skill to inspect, audit, and maintain visual hierarchy, layout geometry, typography, and ergonomics across both desktop and mobile platforms.

## Key Design System Directives

1. **Bengali Typography Rule (Non-Negotiable)**:
   - Font family: **Hind Siliguri**.
   - Line-height: **Must be $\ge 1.6$** for body text and $\ge 1.35$ for headlines.
   - OpenType ligatures: `font-feature-settings: "kern" 1, "liga" 1;`.
   - Never allow tight line-heights that clip Bengali vowel signs (হ্রস্ব-ই কার, দীর্ঘ-উ কার) or conjuncts (যুক্তাক্ষর).

2. **Quiet Graphite (Desktop)**:
   - Dark, neutral graphite surfaces with high-information density.
   - No generic AI-dashboard gradients, neon border glows, or excessive card nesting.
   - Adhere to the 4px baseline geometry token scale (`--s-0` to `--s-11` in `src/styles/tokens.css`).

3. **One UI Ergonomics (Android Companion)**:
   - Target device: Samsung Galaxy S25 Ultra (~412 dp logical width).
   - Viewing zone: Top 35% (headers, passive status).
   - Interaction zone: Bottom 65% (action buttons, sheets, inputs).
   - Safe areas: Obey `--sat` (top) and `--sab` (bottom) injected by `systemBars.ts`.
   - Minimum touch target: **44x44 dp** for all interactive elements.

4. **Design Audit Commands (Desktop)**:
   ```bash
   npm run audit:text-fit   # Checks for accidental ellipsis or overflow
   npm run audit:center     # Optical centering of icons and text
   npm run audit:contrast   # WCAG AA 4.5:1 contrast check
   npm run census           # Flags undeclared raw hex or pixel values
   ```
