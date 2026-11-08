# ESB Studio — Security, Threat Modeling & Backend Architecture

> **Audited Targets**: Electron 45 Desktop, Capacitor 8 Mobile, Supabase Cloud  
> **Backend Reference**: Supabase PostgreSQL 17 (`sxgokpmrbgdndstygapc`, `ap-northeast-1`)  
> **Security Policy**: Zero Trust, Hardware-Backed Secret Storage, Strict RLS

---

## 1. Threat Modeling & Security Boundaries

The ESB Studio ecosystem manages high-value editorial credentials, publishing keys, and unpublished journalistic drafts. The threat model accounts for four primary attack vectors:

```
[Renderer / WebView: Untrusted Context]
          │
          ▼ (Strictly Validated IPC / Native Plugin Calls)
[Preload / Native Bridge: Boundary Guard]
          │
          ▼
[Main Process / Hardware Keystore: Trusted Context]
          │
          ▼ (Net Guard Domain Whitelist & TLS 1.3 Pinning)
[External Services & Supabase PostgreSQL]
```

### 1.1 Desktop Threat Boundaries
1. **Renderer Compromise**: If an arbitrary web page or malicious RSS content injected HTML, it cannot access the local filesystem or execute arbitrary code because `contextIsolation: true` and `nodeIntegration: false` are enforced in `electron/main.cjs`.
2. **Preload Script Vulnerability**: The preload script (`electron/preload.cjs`) only exposes an explicit list of typed invocations (`window.esb.*`). It never leaks `ipcRenderer.send` or raw event emitters to the DOM.
3. **Network Exfiltration**: `electron/net-guard.cjs` wraps `net.request` and Node HTTPS calls, intercepting outbound requests to ensure they target authorized domains (`*.supabase.co`, `graph.facebook.com`, `generativelanguage.googleapis.com`, `api.anthropic.com`, `api.openai.com`).
4. **Certificate Tampering**: Disabling TLS certificate validation (`rejectUnauthorized: false`) is strictly prohibited and caught by static test assertions.

### 1.2 Android Mobile Threat Boundaries
1. **WebView Isolation**: The Capacitor WebView is restricted to local assets (`capacitor://localhost`). External URLs are opened exclusively via native browser tabs (`Browser.open()`), never in the internal app webview.
2. **Android Keystore**: API keys and auth tokens are encrypted using AES-GCM-256 via Android's hardware-backed Keystore, preventing extraction even on rooted test devices.

---

## 2. Hardware-Backed Credential Ledger

Plaintext storage of API keys or access tokens in `localStorage`, session storage, or unencrypted configuration files is strictly forbidden.

### 2.1 Desktop Windows DPAPI (`secret-store.cjs`)
On Desktop, secrets are managed by `electron/secret-store.cjs` using Chromium's `safeStorage`:
- When available, Chromium encrypts the data using Windows DPAPI (`CryptProtectData`), which ties encryption to the current logged-in Windows user account.
- In memory, decrypted secrets are returned only on explicit demand to authorized main-process handlers (e.g., executing a signed AI request or Facebook dispatch), and never mirrored back to renderer `localStorage`.

### 2.2 Mobile Android Keystore
On Android, secrets are stored using Capacitor's secure storage plugin, storing private encryption keys in the Android Keystore hardware module (TEE/StrongBox).

---

## 3. Content Sanitization & Ingestion Security

ESB Studio ingests external news articles and HTML from national portals via [extract.ts](file:///C:/Users/hamim/esb-banner-studio/src/editorial/extract.ts):

1. **DOMPurify Sanitization**: All ingested HTML is parsed and sanitized through `DOMPurify.sanitize()` prior to TipTap editor insertion.
2. **Strip Dangerous Tags**: `<script>`, `<iframe>`, `<object>`, `<embed>`, `<form>`, `<link>`, and inline `style` tags are stripped unconditionally.
3. **SVG Vector Sanitization**: Uploaded SVG logos and banners are parsed as XML to ensure no embedded `<script>` or external `xlink:href` entities exist before canvas rasterization.

---

## 4. Supabase Cloud Backend & Database Contracts

The ecosystem is backed by Supabase PostgreSQL 17 (`sxgokpmrbgdndstygapc`).

### 4.1 Row Level Security (RLS) Enforcement
- **Universal RLS**: All 52 tables in the public schema have `rls_enabled: true`. Direct unauthenticated table access returns empty sets or permission errors.
- **Role Scopes**:
  - `anon`: Read-only access to published articles and active categories.
  - `authenticated`: Reporters can read and create their own drafts; senior editors can approve and update articles.
  - `service_role`: Reserved strictly for Supabase Edge Functions handling administrative tasks (e.g., email sequence queuing, automated RSS cron intake). Never embedded in client code.

### 4.2 Key Supabase Public Tables
| Table Name | RLS | Primary Purpose | Key Columns |
| :--- | :---: | :--- | :--- |
| `Article` | YES | News articles repository | `id`, `title`, `deck`, `body`, `category_id`, `status`, `author_id`, `created_at` |
| `Category` | YES | Editorial taxonomy | `id`, `slug`, `name_en`, `name_bn`, `accent_color`, `sort_order` |
| `profiles` | YES | Editorial staff accounts | `id`, `email`, `role`, `full_name`, `avatar_url` |
| `media_assets` | YES | Uploaded imagery & banners | `id`, `url`, `width`, `height`, `focal_point`, `uploaded_by` |
| `outreach_campaigns` | YES | Media syndicate campaigns | `id`, `title`, `status`, `template_id`, `created_by` |
| `outreach_sequences` | YES | Automated follow-up queues | `id`, `campaign_id`, `step_number`, `delay_hours`, `subject` |

---

## 5. Security Regression Checklist

Before any release or production update, the security suite must be executed:

```bash
# Verify net-guard network isolation & certificate tests
npm test -- tools/unit/net-guard-crash.test.ts

# Verify DPAPI safeStorage IPC secret ledger
npm test -- tools/unit/secret-store.test.ts

# Verify editorial DOMPurify extraction & XSS prevention
npm test -- tools/unit/editorial.test.ts
```
