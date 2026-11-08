# ESB Studio — Development, Contribution & Release Guide

> **Ecosystem Repositories**:
> - Desktop: `C:\Users\hamim\esb-banner-studio`
> - Android Companion: `C:\Users\hamim\esb-studio-phone`  
> **Target Audience**: Human Engineers & Autonomous Coding Agents

---

## 1. Golden Rules of Development & Contribution

1. **Protect Pre-Existing Work**:
   - Working tree modifications and untracked files are protected user assets.
   - **NEVER** run `git reset --hard`, `git clean -fd`, `git checkout .`, or force checkout commands.
   - If an uncommitted file requires modification, inspect it carefully and make the minimal surgical change.
2. **Preserve Architectural Parity**:
   - The desktop workstation and Android companion are peer products with distinct form factors.
   - Never copy desktop UI patterns verbatim to mobile (or vice-versa). Respect **Quiet Graphite** for desktop and **One UI Dark** for mobile.
3. **No Phantom Verifications**:
   - Never declare a build or test passing without actual execution output.
   - If an environmental tool is unavailable (e.g., Playwright MCP path discrepancy), document the restriction honestly.
4. **Zero Plaintext Secrets**:
   - Never commit `.env` files, Supabase service keys, or private API tokens.
   - All runtime credentials must route through the DPAPI secret store (Desktop) or Android Keystore (Mobile).

---

## 2. Local Development Setup

### 2.1 Desktop Workstation (`esb-banner-studio`)
```bash
cd C:\Users\hamim\esb-banner-studio

# Install dependencies (only if node_modules is missing)
npm install

# Start Vite dev server + Electron main process
npm run dev

# Fast static checks
npm run lint

# Run Vitest unit tests
npm test

# Full production TypeScript & bundle build
npm run build
```

### 2.2 Android Companion (`esb-studio-phone`)
```bash
cd C:\Users\hamim\esb-studio-phone

# Install dependencies (only if node_modules is missing)
npm install

# Start Vite mobile dev server
npm run dev

# Run Vitest unit tests
npm test

# Production build and sync to Capacitor Android project
npm run build
npx cap sync android
```

---

## 3. Code Standards & Patterns

### 3.1 TypeScript Strictness
- `noImplicitAny: true`, `strictNullChecks: true`.
- Avoid `as any` type assertions. Use explicit interfaces or narrowing guards.
- Shared domain types (Articles, Categories, Users) should adhere to schemas defined in `src/esb.d.ts`.

### 3.2 Zustand State Mutations
- Never mutate Zustand state directly. Always use functional updates or immutable spread patterns:
  ```ts
  // Correct
  set((state) => ({
    articles: state.articles.map((a) => (a.id === id ? { ...a, ...update } : a)),
  }));
  ```

### 3.3 CSS & Design Tokens
- Never write hardcoded hex values (`#ffffff`, `#1a1a1a`) or arbitrary pixel values (`padding: 13px`) in CSS modules.
- Always use the semantic token scale: `var(--bg-canvas)`, `var(--text-primary)`, `var(--s-3)`, `var(--radius-sm)`.

---

## 4. Pre-Commit Verification Checklist

Before proposing any commit or reporting task completion, run this checklist:

- [ ] **Linter**: `npm run lint` exits cleanly with zero errors.
- [ ] **Tests**: `npm test` passes all unit tests without unhandled rejections.
- [ ] **Build**: `npm run build` compiles with `tsc -b` and bundles without warnings.
- [ ] **UI Geometry** (if UI files touched): `npm run audit:text-fit` and `npm run audit:center` pass.
- [ ] **Git Working Tree**: Run `git status` to verify only the intended files were modified.

---

## 5. Production Packaging & Release

### 5.1 Desktop Packaging (Windows)
```bash
cd C:\Users\hamim\esb-banner-studio
npm run build
# Packages installer into dist/ via electron-builder
npm run package:win
```

### 5.2 Android Release (Capacitor / Android Studio)
```bash
cd C:\Users\hamim\esb-studio-phone
npm run build
npx cap sync android
# Build release APK or AAB via Gradle
cd android
./gradlew assembleRelease
```
