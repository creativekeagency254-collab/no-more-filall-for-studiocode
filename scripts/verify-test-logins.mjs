#!/usr/bin/env node

import { loadLocalEnv } from './load-local-env.mjs';

loadLocalEnv();

const baseUrl = String(process.env.SUPABASE_URL || '').trim().replace(/\/$/, '');
const anonKey = String(process.env.SUPABASE_ANON_KEY || '').trim();

if (!baseUrl || !anonKey) {
  console.error('Missing SUPABASE_URL or SUPABASE_ANON_KEY in .env.local/.env');
  process.exit(1);
}

const users = [
  ['client@test.com', 'Password123!'],
  ['admin@test.com', 'Password123!'],
  ['commissioner@test.com', 'Password123!'],
  ['developer@test.com', 'Password123!'],
];

let failed = 0;

for (const [email, password] of users) {
  try {
    const res = await fetch(`${baseUrl}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: {
        apikey: anonKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ email, password }),
    });
    const txt = await res.text();
    let body = {};
    try { body = JSON.parse(txt); } catch { body = { raw: txt }; }

    if (res.ok && body?.access_token) {
      console.log(`PASS  ${email}`);
    } else {
      failed += 1;
      const reason = body?.error_description || body?.msg || body?.error || txt.slice(0, 120);
      console.log(`FAIL  ${email}  (${res.status}) ${reason}`);
    }
  } catch (err) {
    failed += 1;
    console.log(`FAIL  ${email}  (network) ${String(err?.message || err)}`);
  }
}

if (failed > 0) {
  process.exit(1);
}
