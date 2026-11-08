---
name: esb-android-engineer
description: >-
  Use this skill when developing or debugging the Android companion app,
  Capacitor 8 native bridge, edge-to-edge system bar insets, and One UI mobile layout.
---

# ESB Studio Android Engineer Skill

This skill guides engineering tasks in the Android companion repository (`C:\Users\hamim\esb-studio-phone`), focusing on Capacitor 8, system bar insets, touch ergonomics, and mobile state.

## Architecture & Responsibilities

1. **Edge-to-Edge System Bars (`systemBars.ts`)**:
   - Modern Android requires edge-to-edge rendering.
   - Always verify that the top and bottom containers consume `--sat` and `--sab` CSS custom properties:
     ```css
     padding-top: max(var(--sat, 24px), env(safe-area-inset-top, 24px));
     padding-bottom: max(var(--sab, 16px), env(safe-area-inset-bottom, 16px));
     ```
   - Never hardcode 0px or static padding for status bars or navigation bars.

2. **Touch Targets & One UI Ergonomics**:
   - Minimum hitbox: **44x44 dp** (`min-height: 44px; min-width: 44px;`).
   - S25 Ultra profile: Design for 412 dp logical width at 120 Hz.
   - Primary thumb zone: Bottom 65% of viewport for interactive controls.

3. **Android Keystore Secure Storage**:
   - Access tokens and keys must be stored through Capacitor Secure Storage (backed by Android Keystore with AES-GCM-256).
   - Never write credentials to unencrypted `localStorage`.

4. **Native Sync & Verification**:
   ```bash
   cd C:\Users\hamim\esb-studio-phone
   npm run lint        # Fast static analysis
   npm test            # Unit tests
   npm run build       # tsc -b && vite build
   npx cap sync android # Sync web assets to Android Studio project
   ```
