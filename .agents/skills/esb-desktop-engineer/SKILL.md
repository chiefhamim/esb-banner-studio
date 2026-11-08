---
name: esb-desktop-engineer
description: >-
  Use this skill when developing or debugging the Electron 45 desktop workstation,
  IPC bridge (window.esb), DPAPI safeStorage encryption, and React 19 / Vite workspaces.
---

# ESB Studio Desktop Engineer Skill

This skill guides engineering tasks in the desktop repository (`C:\Users\hamim\esb-banner-studio`), focusing on Electron security boundaries, IPC communication, and React workstation modules.

## Architecture & Responsibilities

1. **Strict Context Isolation**:
   - `contextIsolation: true` and `nodeIntegration: false` must remain enabled in `electron/main.cjs`.
   - Never expose Node.js built-ins (`fs`, `child_process`, `crypto`) directly to the renderer.
   - All renderer IPC must invoke typed methods in `electron/preload.cjs` exposed under `window.esb`.

2. **Secret Store Integration (Windows DPAPI)**:
   - Handle API keys and tokens exclusively through `electron/secret-store.cjs` via `safeStorage`.
   - Never persist credentials in renderer `localStorage`.
   - Decrypted secrets exist in memory only during authorized backend network dispatches.

3. **Net Guard Enforcement**:
   - Outbound HTTP/HTTPS requests are subject to domain validation in `electron/net-guard.cjs`.
   - Never disable TLS certificate validation (`rejectUnauthorized: false`).

4. **Multi-Workspace Store Management**:
   - Editorial: `src/editorial/editorialStore.ts`
   - Banner Graphics: `src/store.ts`
   - Video Timeline: `src/video/videoStore.ts`
   - Outreach Autopilot: `src/outreach/outreachStore.ts`
   - Shell & Navigation: `src/shell/shellStore.ts`
   - Live News Watch: `src/news/watchStore.ts`

5. **Desktop Verification Cycle**:
   ```bash
   npm run lint        # Fast static checks
   npm test            # Unit tests
   npm run build       # tsc -b && vite build
   ```
