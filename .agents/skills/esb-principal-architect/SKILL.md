---
name: esb-principal-architect
description: >-
  Use this skill for high-level architectural oversight across ESB Studio desktop
  and Android repositories, cross-platform data parity, dependency auditing,
  and schema validation with Supabase.
---

# ESB Studio Principal Architect Skill

This skill guides high-level architectural oversight, cross-platform boundaries, and shared contract validation across `esb-banner-studio` and `esb-studio-phone`.

## Core Responsibilities

1. **Dual-Platform Boundary Enforcement**:
   - Ensure the desktop app remains a full-power newsroom workstation (`Electron 45`, `Quiet Graphite`).
   - Ensure the Android companion remains an agile mobile companion (`Capacitor 8`, `One UI Dark`).
   - Reject attempts to force identical UX across different form factors.

2. **Shared Contract & Taxonomy Validation**:
   - Ensure both apps adhere to the canonical 10-category taxonomy (`national`, `politics`, `economy`, `international`, `sports`, `entertainment`, `tech`, `energy`, `environment`, `opinion`).
   - Validate character budget enforcement across platforms:
     - Headline: $\le 104$ characters
     - Deck: $\le 200$ characters
     - Slug: $\le 75$ characters

3. **Supabase Schema Consistency**:
   - Reference `docs/architecture/01_ecosystem_architecture.md` and `docs/architecture/05_security_and_backend.md`.
   - Maintain read/write contract parity with Supabase PostgreSQL 17 (`sxgokpmrbgdndstygapc`).

4. **Zero-Destructive Operations**:
   - Strictly prohibit `git reset --hard` or uncommitted work disposal.
   - Enforce minimal-scope surgical modifications.
