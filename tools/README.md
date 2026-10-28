# tools/

| Folder / file | What it is | How to run |
|---|---|---|
| `unit/` | Vitest unit tests (picked up by `npm test`) | `npm test` |
| `e2e/` | End-to-end runners: real Vite or Electron driven by Playwright | `npm run test:ui`, `test:editorial`, `test:video`, `test:extract`, `test:golden`, `test:electron` (Linux: `ESB_NO_SYNC=1 xvfb-run -a node tools/e2e/electron-test.mjs`) |
| `e2e/web-cases.json` | The nine extra web-banner golden cases | `node tools/e2e/golden-test.mjs "$(cat tools/e2e/web-cases.json)"` |
| `audit/` | Visual and quality sweeps that report findings rather than pass or fail: centring, text-fit, contrast, a11y, overflow, perf, CSS census | `npm run audit:center`, `audit:text-fit`, `audit:contrast`, `audit:a11y`, `census` |
| `golden/` | Reference banner PNGs. **Protected brand output: never redraw or re-encode.** | — |
| `fixtures/` | Synthetic test pages and media (see `fixtures/README.md`) | — |
| `launch-browser.mjs` | Shared Chromium launcher used by every runner | — |
| `site-css.mjs` | Pulls esbpowerline.com's article CSS for the site preview | — |
| `make-icon.mjs` | Builds `build/icon.*` from the logo | — |
| `ensure-deps.mjs` | `npm run app` pre-step: installs missing deps | — |
| `git-sync.mjs`, `auto-sync.ps1`, `auto-sync.vbs`, `create-startup-shortcut.vbs` | Windows auto-sync. **Keep these paths**: the installed Startup shortcut and `Launch ESB Studio.bat` point at them. | `npm run sync` |

Output from any runner goes to `tools/out/` (git-ignored).
