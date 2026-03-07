#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';

function parseEnvLine(line) {
  const trimmed = String(line || '').trim();
  if (!trimmed || trimmed.startsWith('#')) return null;
  const idx = trimmed.indexOf('=');
  if (idx <= 0) return null;
  const key = trimmed.slice(0, idx).trim();
  if (!key) return null;
  let value = trimmed.slice(idx + 1).trim();
  if (
    (value.startsWith('"') && value.endsWith('"'))
    || (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1);
  }
  return { key, value };
}

export function loadLocalEnv(options = {}) {
  const cwd = options.cwd || process.cwd();
  const files = options.files || ['.env.local', '.env'];
  const loadedFrom = [];

  files.forEach((name) => {
    const full = path.join(cwd, name);
    if (!fs.existsSync(full)) return;
    const raw = fs.readFileSync(full, 'utf8');
    raw.split(/\r?\n/).forEach((line) => {
      const parsed = parseEnvLine(line);
      if (!parsed) return;
      if (process.env[parsed.key] === undefined) {
        process.env[parsed.key] = parsed.value;
      }
    });
    loadedFrom.push(name);
  });

  return loadedFrom;
}
