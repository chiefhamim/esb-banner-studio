# tools/

| Folder / file | What it is | How to run |
|---|---|---|
| `unit/` | Vitest unit tests (61 test files, 557 tests, picked up by `npm test`) | `npm test` |
| `e2e/` | End-to-end runners: real Vite or Electron driven by Playwright | `npm run test:ui`, `test:editorial`, `test:video`, `test:extract`, `test:golden`, `test:electron` (Linux: `ESB_NO_SYNC=1 xvfb-run -a node tools/e2e/electron-test.mjs`) |
| `e2e/outreach-soak.mjs` | Phase 7.1 Soak Test: 5,000-message dry-run simulation across days (zero duplicates, <100MB RAM, <500ms pause) | `node tools/e2e/outreach-soak.mjs` |
| `e2e/outreach-crash.mjs` | Phase 7.2 Crash Recovery Test: 200-msg run mid-kill auto-resume & clean quit state preservation | `node tools/e2e/outreach-crash.mjs` |
| `e2e/web-cases.json` | The nine extra web-banner golden cases | `node tools/e2e/golden-test.mjs "$(cat tools/e2e/web-cases.json)"` |
| `audit/` | Visual and quality sweeps that report findings rather than pass or fail: centring, text-fit, contrast, a11y, overflow, perf, CSS census | `npm run audit:center`, `audit:text-fit`, `audit:contrast`, `audit:a11y`, `census` |
| `audit/capture-visual-suite.mjs` | Multi-theme & multi-workspace visual screenshot capture across all 4 production desks | `node tools/audit/capture-visual-suite.mjs [before\|after]` |
| `audit/stitch-comparisons.mjs` | Stitches before & after PNGs side-by-side with hairline divider | `node tools/audit/stitch-comparisons.mjs` |
| `audit/generate-pdf-report.mjs` | Generates high-fidelity A3 landscape presentation PDF with side-by-side visual comparisons | `node tools/audit/generate-pdf-report.mjs` |
| `golden/` | Reference banner PNGs. **Protected brand output: never redraw or re-encode.** | — |
| `fixtures/` | Synthetic test pages and media (see `fixtures/README.md`) | — |
| `launch-browser.mjs` | Shared Chromium launcher used by every runner | — |
| `site-css.mjs` | Pulls esbpowerline.com's article CSS for the site preview | — |
| `make-icon.mjs` | Builds `build/icon.*` from the logo | — |
| `ensure-deps.mjs` | `npm run app` pre-step: installs missing deps | — |
| `git-sync.mjs`, `auto-sync.ps1`, `auto-sync.vbs`, `create-startup-shortcut.vbs` | Windows auto-sync. **Keep these paths**: the installed Startup shortcut and `Launch ESB Studio.bat` point at them. | `npm run sync` |

Output from any runner goes to `tools/out/` (git-ignored).
