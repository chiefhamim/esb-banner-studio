# ESB Studio Phone — Android Architecture & Mobile Ergonomics Specification

> **Repository**: `C:\Users\hamim\esb-studio-phone`  
> **Runtime**: Capacitor 8, Android 15/16 WebView (Chromium)  
> **Frontend**: React 19.3, Vite 8, TypeScript ~6.0.3, Zustand 5  
> **Target Device**: Samsung Galaxy S25 Ultra (~412 dp logical width, 120 Hz AMOLED, S Pen, DeX landscape)

---

## 1. Mobile Design Philosophy: One UI Ergonomics

The mobile companion is designed strictly from a **mobile-first, thumb-driven ergonomic model** inspired by Samsung One UI:

```
+------------------------------------------+
|  STATUS BAR INSET (--sat)                |
+------------------------------------------+
|                                          |
|         VIEWING ZONE (Top ~35%)          |
|  - Large Header & Screen Title           |
|  - High-Level Status & Category Pill     |
|  - Passive Information Display           |
|                                          |
+------------------------------------------+
|                                          |
|       INTERACTION ZONE (Bottom ~65%)     |
|  - Form Fields & Text Inputs             |
|  - Thumb-Reachable Action Buttons        |
|  - Sheet Dialogs & Gesture Trays         |
|  - Primary CTA (Publish / Export)        |
|                                          |
+------------------------------------------+
|  BOTTOM NAV / ACTION BAR                 |
+------------------------------------------+
|  NAVIGATION BAR INSET (--sab)            |
+------------------------------------------+
```

### 1.1 Touch Ergonomics Rules
1. **Minimum Hitbox**: All clickable buttons, pills, tabs, and list rows must have a minimum bounding box of **44x44 dp** (or `min-height: 44px; min-width: 44px;`).
2. **Thumb Comfort Zone**: Primary destructive or definitive actions (e.g., "Publish Story", "Dispatch Banner") must reside in the lower 60% of the display viewport.
3. **One Job Per Screen**: Avoid cluttered multi-pane desktop layouts. Dedicated modal sheets handle discrete workflows (e.g., source selector, photo cropper).

---

## 2. Safe Area & Edge-to-Edge System Bar Handling

Modern Android (Android 15+) enforces edge-to-edge rendering by default. `esb-studio-phone` dynamically computes system bar insets in [src/native/systemBars.ts](file:///C:/Users/hamim/esb-studio-phone/src/native/systemBars.ts) and injects them as CSS custom properties into `:root`:

| CSS Custom Property | Native Source | Description |
| :--- | :--- | :--- |
| `--sat` | `WindowInsets.getInsets(statusBars()).top` | Top status bar inset (camera punch-hole) |
| `--sab` | `WindowInsets.getInsets(navigationBars()).bottom` | Bottom navigation bar inset (gesture pill or 3-button bar) |
| `--sal` | `WindowInsets.getInsets(displayCutout()).left` | Left cutout inset (landscape mode) |
| `--sar` | `WindowInsets.getInsets(displayCutout()).right` | Right cutout inset (landscape mode) |

### 2.1 Safe Area Implementation Standard
```css
/* Container padding example adhering to Android Edge-to-Edge */
.mobile-app-shell {
  padding-top: max(var(--sat, 24px), env(safe-area-inset-top, 24px));
  padding-bottom: max(var(--sab, 16px), env(safe-area-inset-bottom, 16px));
  padding-left: max(var(--sal, 0px), env(safe-area-inset-left, 0px));
  padding-right: max(var(--sar, 0px), env(safe-area-inset-right, 0px));
  box-sizing: border-box;
}
```

---

## 3. Directory Layout & Key Modules

```
C:\Users\hamim\esb-studio-phone\
├── android/                    # Capacitor Android Studio Project
│   ├── app/                    # Native Android application module
│   │   └── src/main/AndroidManifest.xml
│   └── build.gradle            # Native Gradle build scripts
├── src/                        # React 19 Mobile Application
│   ├── mobile/                 # Mobile UI Components & Views
│   │   ├── MobileApp.tsx       # Root mobile layout container
│   │   ├── design.css          # Mobile tokens & One UI typography
│   │   ├── grid.css            # Responsive layout & safe area definitions
│   │   ├── watch/              # Breaking News Intake & Feeds
│   │   │   ├── WatchDesk.tsx   # Live source monitor for mobile
│   │   │   ├── watchStore.ts   # Mobile news feed store
│   │   │   └── ewSources.ts    # Energy & national news sources
│   │   └── editor/             # Rapid Article & Banner Dispatch
│   ├── native/                 # Capacitor Native Bridge Adapters
│   │   ├── systemBars.ts       # Edge-to-edge window inset listener
│   │   ├── haptics.ts          # Tactile feedback for actions
│   │   └── secureStore.ts      # Android Keystore encrypted storage
│   └── main.tsx                # React mount entry point
├── docs/                       # Device specifications & engineering plans
│   ├── DEVICE.md               # S25 Ultra hardware profile & metrics
│   └── PLAN.md                 # Mobile companion roadmap
└── package.json                # Scripts & dependencies
```

---

## 4. Mobile Hardware Integrations & Lifecycle

1. **Android Keystore Encryption**:
   - Secrets (Supabase user tokens, AI session tokens) are stored via Capacitor Secure Storage, encrypted under AES-GCM-256 with keys managed inside the hardware-backed Android Keystore.
2. **Haptic Feedback**:
   - Heavy impacts (e.g., long-press, article published, banner exported) trigger `Haptics.impact({ style: ImpactStyle.Medium })`.
   - Subtle ticks trigger `Haptics.selectionChanged()` on tab switches.
3. **Background Lifecycle**:
   - `App.addListener('appStateChange')` saves active drafts to local disk when the app transitions to the background.
   - Resuming automatically queries Supabase for new breaking alerts published while backgrounded.

---

## 5. Verification Commands

Mobile companion changes must satisfy strict verification before committing:

```bash
cd C:\Users\hamim\esb-studio-phone
npm run lint          # oxlint static checks
npm test              # vitest unit tests
npm run build         # tsc -b && vite build
```
