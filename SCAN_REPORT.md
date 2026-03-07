# SCAN_REPORT

Generated: 2026-02-26T12:51:06.722Z

## Scope
- Phase 3 to Phase 9 non-destructive deep scan
- Source checks: `checks_list.csv` (2000 checks)
- Result file: `phase3_results.csv`

## Check Summary
- PASS: 417
- FAIL: 32
- WARN: 1551
- Total: 2000

## Runtime Probes
- Login role checks passed: 4/4
- audit:fullstack -> PASS=25 FAIL=0
- Invoice pipeline probe: PASS
- Profile-write probe: PASS
- Initiate-topup probe: PASS

## App Surface Coverage
- Pages: 9
- Dashboards: 4
- API Endpoints: 31
- Edge functions (local): 8
- Edge functions (remote): 11
- Tables/views inventoried: 25

## Auto-Remediation Applied
- Deployed missing edge functions to remote:
  - `profile-write`
  - `initiate-topup`
- Generated safe idempotent SQL fixes:
  - [AUTO_FIXES/20260225_safe_indexes.sql](C:\Users\user\Downloads\project-bolt-github-epghme6b\project\AUTO_FIXES\20260225_safe_indexes.sql)

## Phase Limitations
- Live pg_catalog introspection via Supabase inspect/db dump is limited by current pooler auth circuit-breaker.
- RLS policy correctness for all 2000 checks is partially heuristic unless DB-level introspection is re-enabled.

## Artifacts
- [db_inventory.json](C:\Users\user\Downloads\project-bolt-github-epghme6b\project\db_inventory.json)
- [checks_list.csv](C:\Users\user\Downloads\project-bolt-github-epghme6b\project\checks_list.csv)
- [phase3_results.csv](C:\Users\user\Downloads\project-bolt-github-epghme6b\project\phase3_results.csv)
- [scan_phase3_results.json](C:\Users\user\Downloads\project-bolt-github-epghme6b\project\scan_phase3_results.json)
- [ISSUE_LIST.md](C:\Users\user\Downloads\project-bolt-github-epghme6b\project\ISSUE_LIST.md)
- [QA_MVP_REPORT.md](C:\Users\user\Downloads\project-bolt-github-epghme6b\project\QA_MVP_REPORT.md)
