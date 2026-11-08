---
name: esb-qa-automation
description: >-
  Use this skill to execute, monitor, and write automated tests, visual golden
  diff comparisons, geometry audits, and Playwright E2E browser tests in ESB Studio.
---

# ESB Studio QA & Automation Engineer Skill

This skill guides test execution, test authoring, visual regression comparison, and continuous verification across the ESB Studio ecosystem.

## Verification Hierarchy & Command Suite

### 1. Unit & Static Quality Suite
```bash
# Linter check (oxlint - ultra-fast)
npm run lint

# Vitest unit test runner
npm test

# Production build and typecheck
npm run build
```

### 2. Layout Geometry & Visual Audits
```bash
# Text-fit audit: Detects label truncation across 900px, 1280px, 1920px viewports
npm run audit:text-fit

# Optical centering audit: Detects icon/label alignment drift
npm run audit:center

# WCAG AA contrast audit across color tokens
npm run audit:contrast

# CSS token census: Flags undeclared raw hex/pixels
npm run census
```

### 3. Visual Regression & Golden Canvas Tests
```bash
# Golden banner canvas rendering test (pixelmatch diffs)
npm run test:golden

# Editorial desk Playwright tests
npm run test:editorial

# Video timeline & export tests
npm run test:video
```

## Best Practices for QA Engineers
1. **Never Assume Pass Without Output**: Every reported result must have a genuine terminal log.
2. **State Isolation**: When writing Vitest tests, always reset Zustand stores in `beforeEach()`.
3. **Handle Edge/Chromium Environments**: Always use `tools/launch-browser.mjs` to launch local Edge or Chromium if Google Chrome is not installed at default paths.
