#!/usr/bin/env node

import { loadLocalEnv } from './load-local-env.mjs';

loadLocalEnv();

function getEnv(name) {
  return String(process.env[name] || '').trim();
}

function summarizeErrorBody(bodyText) {
  if (!bodyText) return '';
  try {
    const parsed = JSON.parse(bodyText);
    return parsed?.message || parsed?.error_description || parsed?.error || JSON.stringify(parsed);
  } catch {
    return bodyText.slice(0, 180);
  }
}

async function fetchWithBody(url, options = {}) {
  const res = await fetch(url, options);
  const body = await res.text();
  return { ok: res.ok, status: res.status, body };
}

const checks = [];
function addCheck(name, status, details) {
  checks.push({ name, status, details });
}

async function checkSupabaseAnon(url, anonKey) {
  const { ok, status, body } = await fetchWithBody(`${url}/auth/v1/settings`, {
    method: 'GET',
    headers: { apikey: anonKey },
  });
  if (ok) {
    addCheck('SUPABASE_ANON_KEY', 'PASS', 'Auth settings endpoint reachable.');
  } else {
    addCheck('SUPABASE_ANON_KEY', 'FAIL', `HTTP ${status}: ${summarizeErrorBody(body)}`);
  }
}

async function checkSupabaseServiceRole(url, serviceKey) {
  const { ok, status, body } = await fetchWithBody(`${url}/auth/v1/admin/users?page=1&per_page=1`, {
    method: 'GET',
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
    },
  });
  if (!ok) {
    addCheck('SUPABASE_SERVICE_ROLE_KEY', 'FAIL', `HTTP ${status}: ${summarizeErrorBody(body)}`);
    return;
  }
  const rest = await fetchWithBody(`${url}/rest/v1/profiles?select=id&limit=1`, {
    method: 'GET',
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
    },
  });
  if (rest.ok) {
    addCheck('SUPABASE_SERVICE_ROLE_KEY', 'PASS', 'Auth admin + REST access verified.');
  } else {
    addCheck('SUPABASE_SERVICE_ROLE_KEY', 'WARN', `Auth admin OK, REST check failed HTTP ${rest.status}: ${summarizeErrorBody(rest.body)}`);
  }
}

async function checkSupabaseSecretKey(url, secretKey) {
  if (!secretKey) {
    addCheck('SUPABASE_SECRET_KEY', 'WARN', 'Not set. Optional for current app flow.');
    return;
  }
  const { ok, status, body } = await fetchWithBody(`${url}/auth/v1/settings`, {
    method: 'GET',
    headers: { apikey: secretKey },
  });
  if (ok) {
    addCheck('SUPABASE_SECRET_KEY', 'PASS', 'Accepted by Supabase API.');
  } else {
    addCheck('SUPABASE_SECRET_KEY', 'WARN', `Could not verify via auth settings (HTTP ${status}: ${summarizeErrorBody(body)}).`);
  }
}

async function checkPaystackSecret(secretKey) {
  const { ok, status, body } = await fetchWithBody('https://api.paystack.co/bank?country=kenya', {
    method: 'GET',
    headers: { Authorization: `Bearer ${secretKey}` },
  });
  if (ok) {
    addCheck('PAYSTACK_SECRET_KEY', 'PASS', 'Paystack API reachable with secret key.');
  } else {
    addCheck('PAYSTACK_SECRET_KEY', 'FAIL', `HTTP ${status}: ${summarizeErrorBody(body)}`);
  }
}

function checkPaystackPublic(publicKey) {
  if (/^pk_(test|live)_[A-Za-z0-9]+$/.test(publicKey)) {
    addCheck('PAYSTACK_PUBLIC_KEY', 'PASS', 'Format is valid (client-side key).');
  } else {
    addCheck('PAYSTACK_PUBLIC_KEY', 'FAIL', 'Invalid format. Expected pk_test_* or pk_live_*.');
  }
}

async function checkResend(resendKey) {
  const { ok, status, body } = await fetchWithBody('https://api.resend.com/domains', {
    method: 'GET',
    headers: { Authorization: `Bearer ${resendKey}` },
  });
  if (ok) {
    addCheck('RESEND_API_KEY', 'PASS', 'Resend API key is valid.');
  } else {
    addCheck('RESEND_API_KEY', 'FAIL', `HTTP ${status}: ${summarizeErrorBody(body)}`);
  }
}

async function checkGoogle(clientId, clientSecret, redirectUri) {
  const idOk = /^[0-9]+-[A-Za-z0-9-]+\.apps\.googleusercontent\.com$/.test(clientId);
  if (!idOk) {
    addCheck('GOOGLE_CLIENT_ID', 'FAIL', 'Invalid OAuth client id format.');
    return;
  }

  const form = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: 'authorization_code',
    code: 'local-key-check',
    redirect_uri: redirectUri,
  });

  const { ok, status, body } = await fetchWithBody('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form.toString(),
  });

  if (ok) {
    addCheck('GOOGLE_CLIENT_SECRET', 'PASS', 'Token endpoint accepted credentials.');
    return;
  }

  const msg = summarizeErrorBody(body).toLowerCase();
  if (msg.includes('invalid_client')) {
    addCheck('GOOGLE_CLIENT_SECRET', 'FAIL', `Google rejected client credentials (HTTP ${status}).`);
    return;
  }

  if (msg.includes('invalid_grant') || msg.includes('redirect_uri_mismatch') || msg.includes('unauthorized_client')) {
    addCheck('GOOGLE_CLIENT_SECRET', 'PASS', `Credentials accepted, OAuth flow config needs browser verification (${msg}).`);
    return;
  }

  addCheck('GOOGLE_CLIENT_SECRET', 'WARN', `Could not fully verify (${status}: ${msg || 'unknown response'}).`);
}

function checkDbUrl(dbUrl) {
  if (!dbUrl) {
    addCheck('SUPABASE_DB_URL', 'WARN', 'Not set.');
    return;
  }
  if (dbUrl.includes('[YOUR-PASSWORD]')) {
    addCheck('SUPABASE_DB_URL', 'WARN', 'Contains placeholder password; direct DB tools will not connect.');
    return;
  }
  if (!dbUrl.startsWith('postgresql://')) {
    addCheck('SUPABASE_DB_URL', 'FAIL', 'Must start with postgresql://');
    return;
  }
  addCheck('SUPABASE_DB_URL', 'PASS', 'Looks configured.');
}

function checkAppUrl(appUrl) {
  if (appUrl === 'http://localhost:3000') {
    addCheck('APP_URL', 'PASS', 'Configured for localhost.');
  } else {
    addCheck('APP_URL', 'WARN', `Current value is ${appUrl || '(empty)'}, expected http://localhost:3000 for local test mode.`);
  }
}

async function main() {
  const SUPABASE_URL = getEnv('SUPABASE_URL');
  const SUPABASE_ANON_KEY = getEnv('SUPABASE_ANON_KEY');
  const SUPABASE_SERVICE_ROLE_KEY = getEnv('SUPABASE_SERVICE_ROLE_KEY');
  const SUPABASE_SECRET_KEY = getEnv('SUPABASE_SECRET_KEY');
  const SUPABASE_DB_URL = getEnv('SUPABASE_DB_URL');
  const PAYSTACK_PUBLIC_KEY = getEnv('PAYSTACK_PUBLIC_KEY');
  const PAYSTACK_SECRET_KEY = getEnv('PAYSTACK_SECRET_KEY');
  const RESEND_API_KEY = getEnv('RESEND_API_KEY');
  const GOOGLE_CLIENT_ID = getEnv('GOOGLE_CLIENT_ID');
  const GOOGLE_CLIENT_SECRET = getEnv('GOOGLE_CLIENT_SECRET');
  const APP_URL = getEnv('APP_URL');

  const required = [
    ['SUPABASE_URL', SUPABASE_URL],
    ['SUPABASE_ANON_KEY', SUPABASE_ANON_KEY],
    ['SUPABASE_SERVICE_ROLE_KEY', SUPABASE_SERVICE_ROLE_KEY],
    ['PAYSTACK_PUBLIC_KEY', PAYSTACK_PUBLIC_KEY],
    ['PAYSTACK_SECRET_KEY', PAYSTACK_SECRET_KEY],
    ['RESEND_API_KEY', RESEND_API_KEY],
    ['GOOGLE_CLIENT_ID', GOOGLE_CLIENT_ID],
    ['GOOGLE_CLIENT_SECRET', GOOGLE_CLIENT_SECRET],
    ['APP_URL', APP_URL],
  ];

  const missing = required.filter(([, value]) => !value).map(([name]) => name);
  if (missing.length) {
    console.error(`Missing required env keys: ${missing.join(', ')}`);
    process.exit(1);
  }

  await checkSupabaseAnon(SUPABASE_URL, SUPABASE_ANON_KEY);
  await checkSupabaseServiceRole(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  await checkSupabaseSecretKey(SUPABASE_URL, SUPABASE_SECRET_KEY);
  checkDbUrl(SUPABASE_DB_URL);

  checkPaystackPublic(PAYSTACK_PUBLIC_KEY);
  await checkPaystackSecret(PAYSTACK_SECRET_KEY);

  await checkResend(RESEND_API_KEY);
  await checkGoogle(GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, `${APP_URL.replace(/\/$/, '')}/landing_page.html`);
  checkAppUrl(APP_URL);

  const nameWidth = Math.max(...checks.map(c => c.name.length), 14);
  let failCount = 0;
  let warnCount = 0;
  checks.forEach((c) => {
    if (c.status === 'FAIL') failCount += 1;
    if (c.status === 'WARN') warnCount += 1;
    console.log(`${c.status.padEnd(4)}  ${c.name.padEnd(nameWidth)}  ${c.details}`);
  });

  console.log('\nSummary:');
  console.log(`- PASS: ${checks.filter(c => c.status === 'PASS').length}`);
  console.log(`- WARN: ${warnCount}`);
  console.log(`- FAIL: ${failCount}`);

  if (failCount > 0) process.exit(1);
}

main().catch((error) => {
  console.error(`Key test failed: ${error?.message || error}`);
  process.exit(1);
});

