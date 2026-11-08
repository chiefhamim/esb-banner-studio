---
name: esb-editorial-engineer
description: >-
  Use this skill for news intake, Bengali text normalization, character budgets,
  TipTap rich text workflows, AI drafting guardrails, and CMS publishing in ESB Studio.
---

# ESB Studio Editorial & Creative Workflow Engineer Skill

This skill guides the implementation, auditing, and maintenance of the journalistic workflow, Bengali language normalization, and news publication pipelines.

## Editorial Standards & Directives

1. **Strict Character Budgets**:
   - **Headline**: $\le 104$ characters. Must never be clipped or truncated; must wrap cleanly on banners.
   - **Deck / Subhead**: $\le 200$ characters.
   - **Category Tag**: $\le 25$ characters.
   - **Slug / URL**: $\le 75$ characters.

2. **Bengali Text Normalization**:
   - Normalize all ingested text via `str.normalize('NFC')` to avoid fragmented glyphs.
   - Use Dari (`।` - `U+0964`) for Bengali full stops, not English periods (`.`).
   - Maintain a minimum line-height of **1.6** in all rich text containers to prevent conjunct clipping.

3. **Human-in-the-Loop AI Guardrails**:
   - AI generates drafts, alternatives, and translations; AI NEVER publishes directly.
   - Never invent numbers, quotes, megawatts (MW), MMCFD, or proper names.
   - Every publish action requires explicit journalist confirmation.

4. **Two-Way Synchronization**:
   - Changes in `src/editorial/editorialStore.ts` must propagate automatically to `src/store.ts` for instant banner layout updates.

5. **Editorial Verification Suite**:
   ```bash
   npm test -- tools/unit/editorial.test.ts
   ```
