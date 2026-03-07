#!/usr/bin/env node

import { loadLocalEnv } from './load-local-env.mjs';

loadLocalEnv();

const env = process.env;
const baseUrl = String(env.SUPABASE_URL || '').trim().replace(/\/$/, '');
const anon = String(env.SUPABASE_ANON_KEY || '').trim();
const service = String(env.SUPABASE_SERVICE_ROLE_KEY || '').trim();

const checks = [];
const fail = [];

function log(status, name, detail) {
  checks.push({ status, name, detail });
  if (status === 'FAIL') fail.push(name);
}

async function requestJson(url, options) {
  const res = await fetch(url, options);
  const text = await res.text();
  let body = {};
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { raw: text };
  }
  return { ok: res.ok, status: res.status, body, raw: text };
}

function required(name, value) {
  if (!String(value || '').trim()) {
    log('FAIL', name, 'Missing');
    return false;
  }
  log('PASS', name, 'Present');
  return true;
}

async function checkCoreAuth() {
  const settings = await requestJson(`${baseUrl}/auth/v1/settings`, {
    method: 'GET',
    headers: { apikey: anon },
  });
  if (settings.ok) log('PASS', 'supabase_auth_settings', 'Reachable with anon key');
  else log('FAIL', 'supabase_auth_settings', `HTTP ${settings.status}`);

  const users = await requestJson(`${baseUrl}/auth/v1/admin/users?page=1&per_page=1`, {
    method: 'GET',
    headers: {
      apikey: service,
      Authorization: `Bearer ${service}`,
    },
  });
  if (users.ok) log('PASS', 'supabase_auth_admin', 'Reachable with service role');
  else log('FAIL', 'supabase_auth_admin', `HTTP ${users.status}`);
}

async function checkTable(tableName) {
  const r = await requestJson(`${baseUrl}/rest/v1/${tableName}?select=*&limit=1`, {
    method: 'GET',
    headers: {
      apikey: service,
      Authorization: `Bearer ${service}`,
    },
  });
  if (r.ok) log('PASS', `table:${tableName}`, 'Readable');
  else log('FAIL', `table:${tableName}`, `HTTP ${r.status} ${r.body?.message || r.body?.hint || ''}`.trim());
}

async function checkRoleLogin(email, password, expectedRole) {
  const res = await requestJson(`${baseUrl}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: {
      apikey: anon,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok || !res.body?.access_token) {
    log('FAIL', `login:${email}`, `HTTP ${res.status} ${res.body?.error_description || res.body?.msg || res.body?.error || ''}`.trim());
    return;
  }

  const profile = await requestJson(`${baseUrl}/rest/v1/profiles?select=role&id=eq.${res.body.user.id}&limit=1`, {
    method: 'GET',
    headers: {
      apikey: service,
      Authorization: `Bearer ${service}`,
    },
  });
  const dbRole = Array.isArray(profile.body) && profile.body[0] ? profile.body[0].role : null;
  if (dbRole === expectedRole) log('PASS', `role:${email}`, `${dbRole}`);
  else log('FAIL', `role:${email}`, `Expected ${expectedRole}, got ${dbRole || 'null'}`);
}

async function checkProviderEndpoints() {
  const paystack = await requestJson('https://api.paystack.co/bank?country=kenya', {
    method: 'GET',
    headers: { Authorization: `Bearer ${env.PAYSTACK_SECRET_KEY || ''}` },
  });
  if (paystack.ok) log('PASS', 'paystack_secret', 'Paystack key valid');
  else log('FAIL', 'paystack_secret', `HTTP ${paystack.status}`);

  const resend = await requestJson('https://api.resend.com/domains', {
    method: 'GET',
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY || ''}` },
  });
  if (resend.ok) log('PASS', 'resend_key', 'Resend key valid');
  else log('FAIL', 'resend_key', `HTTP ${resend.status}`);
}

async function main() {
  const requiredKeys = [
    ['SUPABASE_URL', env.SUPABASE_URL],
    ['SUPABASE_ANON_KEY', env.SUPABASE_ANON_KEY],
    ['SUPABASE_SERVICE_ROLE_KEY', env.SUPABASE_SERVICE_ROLE_KEY],
    ['PAYSTACK_SECRET_KEY', env.PAYSTACK_SECRET_KEY],
    ['PAYSTACK_PUBLIC_KEY', env.PAYSTACK_PUBLIC_KEY],
    ['RESEND_API_KEY', env.RESEND_API_KEY],
    ['GOOGLE_CLIENT_ID', env.GOOGLE_CLIENT_ID],
    ['GOOGLE_CLIENT_SECRET', env.GOOGLE_CLIENT_SECRET],
    ['APP_URL', env.APP_URL],
  ];
  requiredKeys.forEach(([k, v]) => required(k, v));

  if (!baseUrl || !anon || !service) {
    console.log('Critical env missing; aborting remote checks.');
    process.exit(1);
  }

  await checkCoreAuth();
  await checkProviderEndpoints();

  const requiredTables = [
    'profiles',
    'projects',
    'invoices',
    'wallets',
    'wallet_topups',
    'financial_transactions',
    'payment_webhook_events',
    'notifications',
  ];
  for (const t of requiredTables) {
    await checkTable(t);
  }

  await checkRoleLogin('client@test.com', 'Password123!', 'client');
  await checkRoleLogin('admin@test.com', 'Password123!', 'admin');
  await checkRoleLogin('commissioner@test.com', 'Password123!', 'commissioner');
  await checkRoleLogin('developer@test.com', 'Password123!', 'developer');

  const width = Math.max(...checks.map(c => c.name.length), 14);
  checks.forEach((c) => {
    console.log(`${c.status.padEnd(4)}  ${c.name.padEnd(width)}  ${c.detail}`);
  });

  const passCount = checks.filter(c => c.status === 'PASS').length;
  const failCount = checks.filter(c => c.status === 'FAIL').length;
  console.log(`\nSummary: PASS=${passCount} FAIL=${failCount}`);
  if (fail.some(name => name.startsWith('table:'))) {
    console.log('\nAction required: finance migrations are missing on the remote Supabase project.');
    console.log('Apply these SQL files in Supabase SQL Editor, in order:');
    console.log('1) supabase/migrations/20260224213000_finance_workflow_core.sql');
    console.log('2) supabase/migrations/20260224220000_payment_reconciliation.sql');
    console.log('3) supabase/migrations/20260226010000_client_admin_reliability_patch.sql');
    console.log('4) supabase/migrations/20260226020000_topups_compat_view.sql');
    console.log('Then rerun: npm run audit:fullstack');
  }
  if (fail.length) process.exit(1);
}

main().catch((e) => {
  console.error(`Audit failed: ${e?.message || e}`);
  process.exit(1);
});
