# ISSUE_LIST
Generated: 2026-02-26T12:51:06.726Z

## P0
### Secret-Like Values Present In Local Files
- Details: Pattern scan found likely secrets in env/docs/source files.
- Remediation: Rotate exposed credentials and keep real keys only in secret managers. Replace local files with placeholders before sharing/repo sync.
- Evidence:
  - .env -> paystack_live_secret (1)
  - .env -> paystack_live_public (1)
  - .env -> supabase_secret_key (1)
  - .env -> resend_key (1)
  - .env.local -> paystack_live_secret (1)

## P1
- None

## P2
### Live pg_catalog Introspection Limited
- Details: Supabase inspect/db dump commands are blocked by auth circuit-breaker in current CLI session.
- Remediation: Set SUPABASE_DB_PASSWORD and rerun inspect/db dump commands to enrich index/trigger/constraint runtime evidence.
