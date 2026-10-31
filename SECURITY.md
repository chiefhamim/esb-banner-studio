# Security notes for ESB AI Studio

This repository is **public**. Treat every committed byte as world-readable.

## What is in the repo on purpose

- **`src/editorial/siteApi.ts` contains a Supabase key.** It is the project's *anon* key (decoded payload:
  `role: "anon"`, `ref: sxgokpmrbgdndstygapc`, expires 2036-06). An anon key is public by design — every
  visitor's browser receives it from the website — and is safe **only if Row Level Security is airtight on
  every table the CMS touches** (`Article`, `profiles`, the media buckets, and anything the site reads
  anonymously). Without RLS, an anon key allows reads and writes it should not.

  **NOT VERIFIED — the maintainer must check RLS policies in the Supabase dashboard for every table and
  bucket the app reads or writes, or rotate the key.** This cannot be verified from this repository without
  project credentials, and no rotation was performed by the overnight build.

- The site's public base URL and Graph API host names. Nothing else that identifies an account.

## What must never be committed

- API keys for AI providers (Gemini, Anthropic, OpenAI, OpenRouter), the Facebook Page access token, the
  esbpowerline.com staff session, SMTP/IMAP app passwords. These live only in the app's own storage: the AI
  keys, Page token and site session in `localStorage` under `esb-banner-studio/*`; the mail app password
  encrypted by the main process with `safeStorage` (DPAPI) in the userData folder. The Outreach ledger, event
  log and campaign data stay in userData as well.
- `.env*` files, `release-*/`, `dist/`, `tools/out/`, `node_modules/`, and bulky artifacts (see `.gitignore`).

## History scan (2026-11-01)

A full-history scan (245 commits, patterns for Anthropic/OpenAI/Google/GitHub/Slack/Meta tokens, JWTs,
private keys and app-password assignments; redacted log at `artifacts/overnight/secret-scan.log`) found
two matches: the anon-key JWT above and a base64 PNG data URL in a test fixture (a false positive). No
`.env`, ledger, event-log or credential file was ever added. Staff e-mail addresses that were once in the
source are keyed by SHA-256 since 2026-10-28 (CLAUDE.md §9); the plain addresses remain in history from
before that date and are not secrets, but they are personal data.

## Reporting

Report a security concern privately to the maintainer (GitHub profile `chiefhamim`) rather than in a public
issue. Please include the file and commit, and do not include any real credential in the report.
