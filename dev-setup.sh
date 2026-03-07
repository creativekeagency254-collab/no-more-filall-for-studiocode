#!/usr/bin/env bash
set -uo pipefail

cd "$(dirname "$0")"

echo "== Install deps =="
npm install

echo "== Key checks =="
npm run test:keys

echo "== Full-stack audit =="
if ! npm run audit:fullstack; then
  echo "WARN: Full-stack audit failed. This usually means remote DB migrations are missing."
  echo "WARN: Localhost will still start so you can continue frontend/login testing."
fi

echo "== Sync role test users =="
if ! npm run force:test-users; then
  echo "WARN: Could not force-sync test users. Existing users may still work."
fi

echo "== Start localhost =="
npm run dev
