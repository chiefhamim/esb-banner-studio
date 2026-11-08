# ESB Studio — Ecosystem Architecture & Shared Contracts

> **Version**: 2.0.0  
> **Status**: Living Architectural Specification  
> **Ecosystem Repositories**:
> - Desktop: `C:\Users\hamim\esb-banner-studio` (Electron 45, React 19, Vite 8)
> - Android Companion: `C:\Users\hamim\esb-studio-phone` (Capacitor 8, React 19, Vite 8)
> - Database & Cloud: Supabase PostgreSQL 17 (`sxgokpmrbgdndstygapc`, `ap-northeast-1`)

---

## 1. Architectural Philosophy: Dual-Platform Cohesion Without Forced Homogeneity

The ESB Studio ecosystem powers the digital newsroom operations for **ESB PowerLine** (`esbpowerline.com`). The ecosystem purposefully rejects the flawed "one-size-fits-all" cross-platform UI antipattern. Instead, it implements **dual-platform cohesion**:

| Dimension | Desktop (`esb-banner-studio`) | Android Companion (`esb-studio-phone`) |
| :--- | :--- | :--- |
| **Primary Role** | Full-power newsroom workstation | Agile mobile field companion |
| **Operating Context** | Multi-monitor, keyboard & mouse, high bandwidth | Single-screen, one-handed touch, mobile network |
| **Design Language** | **Quiet Graphite** (dense, high-information, 4px grid) | **One UI Dark** (ergonomic viewing top / action bottom) |
| **Core Workspaces** | Editorial, Graphics Canvas, Video Timeline, Outreach | Breaking News Intake, Quick Banner, Editorial Desk |
| **Primary Input** | Symmetrical keyboard shortcuts, precision cursor, drag-and-drop | Capacitive touch, swipe gestures, virtual keyboard, S Pen |
| **Runtime Shell** | Electron 45 + Node.js IPC | Capacitor 8 + Android WebView (Chromium) |

Both applications represent the same organization, speak the same editorial language, and sync against the same Supabase database, while respecting their native form factors.

---

## 2. Shared Data Contracts & Category Taxonomy

### 2.1 Editorial Categories (10 Protected Domains)
Both platforms strictly adhere to the unified 10-category taxonomy. Each category possesses a canonical slug, English display name, Bengali display name, and semantic brand accent:

| Category Slug | English Label | Bengali Label (Hind Siliguri) | Accent Token | Hex |
| :--- | :--- | :--- | :--- | :--- |
| `national` | National | জাতীয় | `--cat-national` | `#E02424` |
| `politics` | Politics | রাজনীতি | `--cat-politics` | `#0E9F6E` |
| `economy` | Economy | অর্থনীতি | `--cat-economy` | `#3F83F8` |
| `international`| International | আন্তর্জাতিক | `--cat-international` | `#9061F9` |
| `sports` | Sports | খেলাধুলা | `--cat-sports` | `#F59E0B` |
| `entertainment`| Entertainment | বিনোদন | `--cat-entertainment` | `#EC4899` |
| `tech` | Technology | তথ্যপ্রযুক্তি | `--cat-tech` | `#06B6D4` |
| `energy` | Power & Energy | বিদ্যুৎ ও জ্বালানি | `--cat-energy` | `#F97316` |
| `environment` | Climate & Env | পরিবেশ ও জলবায়ু | `--cat-environment` | `#10B981` |
| `opinion` | Opinion | মতামত | `--cat-opinion` | `#6366F1` |

### 2.2 Editorial Constraints & Character Budgets
To guarantee optical balance on social feeds and printed news assets, both platforms enforce strict character constraints:
- **Headline**: $\le 104$ characters (Bengali or English). Truncation is forbidden; layout must accommodate full character budget.
- **Deck / Subhead**: $\le 200$ characters.
- **Category Tag**: $\le 25$ characters.
- **Slug / URL Identifier**: $\le 75$ characters (kebab-case alphanumeric).
- **Photo Caption / Credit**: $\le 120$ characters.

---

## 3. Database & Backend Architecture (Supabase)

The ecosystem connects to a hosted PostgreSQL 17 instance on Supabase (`sxgokpmrbgdndstygapc`).

### 3.1 Table Hierarchy & Row Level Security (RLS)
All 52 tables in the public schema enforce `rls_enabled: true`. Key data models include:
- `public.Article`: News articles, workflow state (`draft`, `in_review`, `approved`, `published`), Bengali content, tags, author references.
- `public.Category`: Category metadata, sort orders, active states.
- `public.profiles`: Verified editorial staff, role assignments (`editor_in_chief`, `senior_reporter`, `graphics_editor`, `contributor`).
- `public.outreach_campaigns`, `public.outreach_prospects`, `public.outreach_sequences`: Direct media outreach and journalist syndicate ledger.
- `public.media_assets`: Uploaded graphics, high-resolution photographs, CDN links, dimensions, optical focal points.

### 3.2 Offline-First Sync Semantics
1. **Local Authoring**: Edits to drafts occur synchronously in Zustand state stores and persist immediately to IndexedDB/LocalStorage.
2. **Optimistic Mutation**: State updates update the UI immediately; network synchronization to Supabase occurs asynchronously.
3. **Conflict Resolution**:
   - `draft` state: Last-write-wins (LWW) based on `updated_at` timestamp.
   - `published` / `approved` state: Locked against automatic overwrite; conflict triggers an editorial diff dialogue.
4. **Credential Isolation**: Client applications communicate using anonymous public keys combined with authenticated user JWTs. Administrative functions execute exclusively through Supabase Edge Functions with `service_role` security boundaries.

---

## 4. Multi-Agent Collaboration Protocol

Autonomous agents operating on this ecosystem must follow the multi-role coordination protocol:
- **Desktop Agent**: Confined to `C:\Users\hamim\esb-banner-studio`.
- **Android Agent**: Confined to `C:\Users\hamim\esb-studio-phone`.
- **Shared Rule**: Never edit the other platform's repository directly without an explicit cross-platform issue or sync requirement.
- **Zero-Loss Guarantee**: Working tree modifications in either repository are treated as protected user intellectual property and must never be reset or discarded.
