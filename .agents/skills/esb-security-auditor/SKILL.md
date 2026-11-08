---
name: esb-security-auditor
description: >-
  Use this skill to audit security boundaries, TLS certificate validation,
  Supabase Row Level Security (RLS), HTML extraction sanitization, and hardware keystores.
---

# ESB Studio Security Auditor Skill

This skill guides rigorous, independent security audits across the desktop workstation, mobile companion, and Supabase cloud infrastructure.

## Core Audit Domains

1. **Network Boundary & TLS Validation (`net-guard.cjs`)**:
   - Verify that outbound network requests target authorized domains only.
   - Verify that TLS certificate verification is never bypassed:
     ```bash
     npm test -- tools/unit/net-guard-crash.test.ts
     ```
   - Prohibit `rejectUnauthorized: false` or arbitrary proxy injection.

2. **Hardware-Backed Credential Storage**:
   - Audit desktop DPAPI safeStorage implementation:
     ```bash
     npm test -- tools/unit/secret-store.test.ts
     ```
   - Audit Android Keystore encryption usage in `src/native/secureStore.ts`.
   - Grep repositories for accidental secret leakage (`apiKey`, `service_role`, `bearerToken` in code or logs).

3. **Content Sanitization & XSS Prevention**:
   - Inspect news extraction in `src/editorial/extract.ts`.
   - Confirm all external HTML passes through `DOMPurify.sanitize()`.
   - Verify `<script>`, `<iframe>`, `<object>`, and external stylesheets are discarded.
   - Run editorial extraction test suite:
     ```bash
     npm test -- tools/unit/editorial.test.ts
     ```

4. **Supabase Database & RLS Security**:
   - Universal RLS rule: Every table in `public` must enforce `rls_enabled: true`.
   - Ensure `service_role` keys are never bundled into client distributions.
   - Authenticated JWT policies must restrict mutations to authorized editorial roles.
