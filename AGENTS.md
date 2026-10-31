# ESB AI Studio — AGY Engineering Charter & Rules

> **Product**: ESB AI Studio (Desktop-first Windows Electron newsroom workstation)  
> **Organisation**: ESB PowerLine (`esbpowerline.com`)  
> **Repository**: `esb-banner-studio`  
> **Stack**: Electron 45, Vite 8, React 19.3, TypeScript ~6.0.3, Zustand 5, HTML Canvas 2D, Vitest, Playwright  
> **Full Specification Reference**: For exhaustive historical notes and design decisions, see [CLAUDE.md](file:///C:/Users/User/esb-banner-studio/CLAUDE.md).

---

## 1. Architectural Architecture & Stores

ESB Studio runs on a unified shell with four core workspaces:
1. **Editorial (`src/editorial/`)**: News source intake, extraction, translation, fact-checking, rich document editing (TipTap), and CMS publishing.
   - Primary Store: `src/editorial/editorialStore.ts`
2. **Graphics (`src/components/`, `src/core/`)**: High-fidelity news banner creation, visual layout engine, canvas rendering, optical text tuning, and 2x export.
   - Primary Store: `src/store.ts`
3. **Video (`src/video/`)**: Timeline-based video editor, captions, motion graphics, and audio sync.
   - Primary Store: `src/video/videoStore.ts`
4. **Outreach (`src/outreach/`)**: Journalists' targeted campaign and direct email dispatch with local SMTP/IMAP ledger.
   - Primary Store: `src/outreach/outreachStore.ts`
5. **Global Workspace Shell (`src/shell/`)**: Workspace switcher, appearance tokens, notifications, and navigation.
   - Primary Store: `src/shell/shellStore.ts`

---

## 2. Design Principles & Anti-AI-Slop Directives

1. **Quiet Graphite Visuals**:
   - Neutral graphite application chrome; content and canvas remain the visual focus.
   - No generic AI-dashboard cards, gratuitous gradients, neon glows, or oversized rounded containers.
   - Use the 4px base geometry scale (`--s-0` through `--s-11` in `src/styles/tokens.css`).
2. **Strict Typography**:
   - Bengali text: **Hind Siliguri** with 1.6 line-height. Ensure OpenType shaping.
   - English copy: **Inter**, **Space Grotesk**, or **Source Serif 4**.
3. **Accuracy Before Automation**:
   - Never invent quotes, dates, metrics (MW, MMCFD, Tk, Crore), or proper names.
   - Character budgets: Headline ≤ 104 chars, Deck ≤ 200 chars, Slug ≤ 75 chars.
   - AI suggestions are drafts until reviewed by the journalist.
4. **Two-Way Sync**:
   - Changes to the headline, category, or photo in Editorial immediately update the Graphics banner and preview rails.

---

## 3. Mandatory Verification Commands

Before reporting any coding task complete or committing changes, you **MUST** run:
```bash
npm run lint          # oxlint checks
npm test              # vitest unit test suite
npm run build         # tsc -b && vite build
```

When changing UI geometry, canvas rendering, or editorial workflows, also run:
```bash
node tools/e2e/golden-test.mjs       # Visual regression & canvas banner golden tests
node tools/e2e/editorial-test.mjs    # Playwright E2E editorial desk tests
node tools/audit/text-fit-audit.mjs  # Label fit and truncation audits
node tools/audit/center-audit.mjs    # Pixel-level control alignment
```

Never declare a task finished with failing tests or unverified build errors.
