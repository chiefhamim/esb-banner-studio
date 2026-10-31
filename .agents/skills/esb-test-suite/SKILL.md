---
name: esb-test-suite
description: >-
  Use this skill to run and verify ESB Studio tests, including unit tests (Vitest),
  linter (oxlint), TypeScript build, and Playwright E2E/golden banner regression tests.
---

# ESB Studio Test Suite

Run these verification commands after making changes to the codebase.

## 1. Quick Unit & Lint Check
```bash
# Linter (instant)
npm run lint

# Vitest unit tests
npm test
```

## 2. Production Typecheck & Build
```bash
npm run build
```

## 3. Visual & End-to-End Regression Tests
```bash
# Banner canvas golden render test (pixelmatch visual diffs)
npm run test:golden

# Editorial desk Playwright tests
npm run test:editorial

# Video timeline & export tests
npm run test:video

# Full UI & date picker suites
npm run test:ui
```
