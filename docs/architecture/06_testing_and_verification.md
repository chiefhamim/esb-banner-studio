# ESB Studio — Testing, Auditing & Verification Pipeline

> **Scope**: Dual-Platform Verification Framework  
> **Testing Stacks**: Vitest, Playwright Core, Custom Geometry Audits, Pixelmatch Visual Regression  
> **Verification Invariant**: Honest reporting only — never mark an item verified without terminal execution output.

---

## 1. Multi-Tier Verification Hierarchy

Quality engineering in ESB Studio follows a strict 4-tier pipeline designed for rapid feedback and regression prevention:

```
[ Tier 1: Static Analysis ]  ──> oxlint (instant static syntax & rule checks)
            │
[ Tier 2: Type Integrity ]   ──> tsc -b (TypeScript build & strict interface validation)
            │
[ Tier 3: Unit & Logic ]     ──> vitest (store mutations, sanitization, crypto, network)
            │
[ Tier 4: UI & Regression ]  ──> Layout geometry, optical fit audits & golden canvas diffs
```

---

## 2. Desktop Test Execution Matrix

All desktop verification scripts are located in `C:\Users\hamim\esb-banner-studio`:

### 2.1 Fast Local Commands
| Command | Primary Tool | Description | Target Files |
| :--- | :--- | :--- | :--- |
| `npm run lint` | `oxlint` | High-speed static analysis for errors & styling | `src/`, `tools/`, `electron/` |
| `npm test` | `vitest run` | Unit test execution in node environment | `tools/unit/*.test.ts` |
| `npm run build` | `tsc -b && vite build` | Strict compiler build and production bundle | Entire project |

### 2.2 Visual & Geometry Audits
| Command | Runner | Purpose & Acceptance Criteria |
| :--- | :--- | :--- |
| `npm run audit:text-fit` | `tools/audit/text-fit-audit.mjs` | Audits buttons, pills, tabs across 900px, 1280px, 1920px viewports to ensure zero text clipping. |
| `npm run audit:center` | `tools/audit/center-audit.mjs` | Measures optical centering of icons within button hitboxes; flags sub-pixel drift > 0.5px. |
| `npm run audit:contrast` | `tools/audit/contrast-audit.mjs` | WCAG AA 4.5:1 contrast check across all color categories and states. |
| `npm run census` | `tools/audit/census.mjs` | Flags undeclared raw hex colors or arbitrary pixel margins bypassing `tokens.css`. |
| `npm run test:golden` | `tools/e2e/golden-test.mjs` | Pixelmatch 2D canvas banner comparison against golden master renders. |

### 2.3 Browser Testing Harness (`tools/launch-browser.mjs`)
When running Playwright tests in Windows environments where standard Google Chrome may not be located at `%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe`, the test harness uses [tools/launch-browser.mjs](file:///C:/Users/hamim/esb-banner-studio/tools/launch-browser.mjs) to automatically locate:
1. Microsoft Edge (`C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe`)
2. Local Chromium binaries
3. Custom configured executable paths

---

## 3. Android Mobile Test Matrix

Mobile companion verification scripts are located in `C:\Users\hamim\esb-studio-phone`:

```bash
cd C:\Users\hamim\esb-studio-phone

# 1. Oxlint static inspection
npm run lint

# 2. Vitest unit tests (Store logic, Safe Area calculations, Source feeds)
npm test

# 3. TypeScript strict build
npm run build
```

---

## 4. Test Isolation & Mocking Best Practices

To avoid flaky or environment-dependent test failures, all tests must observe the following rules:

1. **Zustand Store Cleanup**: In Vitest, each test suite must reset stores to their initial state in `beforeEach()` or `afterEach()`.
   ```ts
   import { beforeEach } from 'vitest';
   import { useEditorialStore } from '../../src/editorial/editorialStore';

   beforeEach(() => {
     useEditorialStore.setState({
       article: { title: '', deck: '', body: '', category: 'national' },
       isDirty: false,
     });
   });
   ```
2. **IPC Bridge Mocking**: Tests touching `window.esb` must provide a mock object in global scope.
3. **Network Mocks**: Unit tests must never make unmocked live network requests to external APIs or production Supabase endpoints. Use Vitest's `vi.fn()` or Mock Service Worker (MSW).
4. **Timeouts**: Test suites should default to a 5000ms timeout. Heavy integration or golden canvas diffing tests may use up to 15000ms.
