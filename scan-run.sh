#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

echo "== Phase 1 discovery =="
node scripts/deep-scan-phase1.mjs

echo "== Phase 3 to 9 deep scan/remediation =="
node scripts/deep-scan-phase3to9.mjs

echo "== Completed =="
echo "Artifacts:"
echo " - db_inventory.json"
echo " - checks_list.csv"
echo " - phase3_results.csv"
echo " - SCAN_REPORT.md"
echo " - ISSUE_LIST.md"
echo " - QA_MVP_REPORT.md"
