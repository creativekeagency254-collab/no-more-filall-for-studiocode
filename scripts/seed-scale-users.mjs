#!/usr/bin/env node

import { randomBytes } from 'node:crypto';
import { loadLocalEnv } from './load-local-env.mjs';

loadLocalEnv();

/**
 * Seed large user populations for CODE STUDIO ke.
 *
 * Usage examples:
 *   node scripts/seed-scale-users.mjs
 *   node scripts/seed-scale-users.mjs --clients 1500 --developers 250 --commissioners 120 --admins 8
 *   node scripts/seed-scale-users.mjs --prefix production --password 'StrongPassword123!' --concurrency 6
 *
 * Required environment variables:
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 */

const DEFAULTS = {
  clients: 1000,
  developers: 200,
  commissioners: 80,
  admins: 5,
  prefix: 'codestudio',
  domain: 'codestudio.ke',
  password: '',
  concurrency: 5,
  dryRun: false,
};

const VALID_ROLES = ['client', 'developer', 'commissioner', 'admin'];
const ROLE_LABEL = {
  client: 'Client',
  developer: 'Developer',
  commissioner: 'Commissioner',
  admin: 'Admin',
};

function parseArgs(argv) {
  const cfg = { ...DEFAULTS };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (arg === '--clients' && next) { cfg.clients = Number(next); i += 1; continue; }
    if (arg === '--developers' && next) { cfg.developers = Number(next); i += 1; continue; }
    if (arg === '--commissioners' && next) { cfg.commissioners = Number(next); i += 1; continue; }
    if (arg === '--admins' && next) { cfg.admins = Number(next); i += 1; continue; }
    if (arg === '--prefix' && next) { cfg.prefix = String(next).trim().toLowerCase(); i += 1; continue; }
    if (arg === '--domain' && next) { cfg.domain = String(next).trim().toLowerCase(); i += 1; continue; }
    if (arg === '--password' && next) { cfg.password = String(next); i += 1; continue; }
    if (arg === '--concurrency' && next) { cfg.concurrency = Math.max(1, Number(next)); i += 1; continue; }
    if (arg === '--dry-run') { cfg.dryRun = true; continue; }
    if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    }
  }

  if (!cfg.prefix || !/^[a-z0-9._-]+$/.test(cfg.prefix)) {
    throw new Error('`--prefix` must contain only lowercase letters, numbers, dot, underscore, or hyphen.');
  }
  if (!cfg.domain || !/^[a-z0-9.-]+\.[a-z]{2,}$/.test(cfg.domain)) {
    throw new Error('`--domain` must be a valid lowercase domain like example.com');
  }
  for (const key of ['clients', 'developers', 'commissioners', 'admins']) {
    if (!Number.isFinite(cfg[key]) || cfg[key] < 0 || Math.floor(cfg[key]) !== cfg[key]) {
      throw new Error(`\`${key}\` must be a non-negative integer.`);
    }
  }
  if (!Number.isFinite(cfg.concurrency) || cfg.concurrency < 1) {
    throw new Error('`--concurrency` must be >= 1.');
  }
  return cfg;
}

function printHelp() {
  console.log(`
Seed large user populations into Supabase Auth + profiles.

Flags:
  --clients <n>         Number of clients (default: ${DEFAULTS.clients})
  --developers <n>      Number of developers (default: ${DEFAULTS.developers})
  --commissioners <n>   Number of commissioners (default: ${DEFAULTS.commissioners})
  --admins <n>          Number of admins (default: ${DEFAULTS.admins})
  --prefix <value>      Email prefix namespace (default: ${DEFAULTS.prefix})
  --domain <value>      Email domain for generated users (default: ${DEFAULTS.domain})
  --password <value>    Password for all created users (optional)
  --concurrency <n>     Parallel user creation workers (default: ${DEFAULTS.concurrency})
  --dry-run             Print planned users only, do not write anything
  --help, -h            Show this help

Required env:
  SUPABASE_URL
  SUPABASE_SERVICE_ROLE_KEY
Optional env:
  SEED_PASSWORD
`);
}

function resolveSeedPassword(cfg) {
  const argPassword = String(cfg.password || '').trim();
  if (argPassword) {
    return { value: argPassword, source: '--password' };
  }

  const envPassword = String(process.env.SEED_PASSWORD || '').trim();
  if (envPassword) {
    return { value: envPassword, source: 'SEED_PASSWORD' };
  }

  // Keep generated passwords deterministic enough to copy and reuse after one run.
  const generated = `Seed!${randomBytes(16).toString('hex')}Aa1`;
  return { value: generated, source: 'generated' };
}

function buildSeedUsers(cfg) {
  const users = [];
  let order = 1;
  const plan = [
    ['client', cfg.clients],
    ['developer', cfg.developers],
    ['commissioner', cfg.commissioners],
    ['admin', cfg.admins],
  ];

  for (const [role, count] of plan) {
    for (let i = 1; i <= count; i += 1) {
      const padded = String(i).padStart(5, '0');
      const email = `${cfg.prefix}.${role}.${padded}@${cfg.domain}`;
      const firstName = ROLE_LABEL[role];
      const lastName = `User ${padded}`;
      users.push({
        order,
        role,
        email,
        first_name: firstName,
        last_name: lastName,
      });
      order += 1;
    }
  }

  return users;
}

function buildHeaders(serviceKey, extra = {}) {
  return {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
    ...extra,
  };
}

async function fetchJsonWithRetry(url, options, retries = 4) {
  let lastErr = null;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const res = await fetch(url, options);
      const text = await res.text();
      let body = null;
      if (text) {
        try { body = JSON.parse(text); } catch { body = { raw: text }; }
      }
      if (res.ok) return body;

      const retryable = res.status === 429 || res.status >= 500;
      if (retryable && attempt < retries) {
        await sleep(350 * (attempt + 1));
        continue;
      }

      const msg = body?.msg || body?.message || body?.error_description || body?.error || `HTTP ${res.status}`;
      throw new Error(msg);
    } catch (err) {
      lastErr = err;
      if (attempt >= retries) break;
      await sleep(350 * (attempt + 1));
    }
  }
  throw lastErr || new Error('Request failed');
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function listAuthUsers(baseUrl, serviceKey) {
  const byEmail = new Map();
  let page = 1;
  while (page <= 1000) {
    const url = `${baseUrl}/auth/v1/admin/users?page=${page}&per_page=1000`;
    const body = await fetchJsonWithRetry(url, {
      method: 'GET',
      headers: buildHeaders(serviceKey),
    });
    const users = Array.isArray(body?.users) ? body.users : [];
    if (!users.length) break;
    for (const u of users) {
      if (u?.email) byEmail.set(String(u.email).toLowerCase(), u);
    }
    if (users.length < 1000) break;
    page += 1;
  }
  return byEmail;
}

async function createAuthUser(baseUrl, serviceKey, seedUser, password) {
  const url = `${baseUrl}/auth/v1/admin/users`;
  const payload = {
    email: seedUser.email,
    password,
    email_confirm: true,
    user_metadata: {
      first_name: seedUser.first_name,
      last_name: seedUser.last_name,
      role: seedUser.role,
    },
  };
  const body = await fetchJsonWithRetry(url, {
    method: 'POST',
    headers: buildHeaders(serviceKey, { 'Content-Type': 'application/json' }),
    body: JSON.stringify(payload),
  });
  return body?.user || body;
}

async function updateAuthMetadata(baseUrl, serviceKey, userId, seedUser) {
  const url = `${baseUrl}/auth/v1/admin/users/${userId}`;
  const payload = {
    user_metadata: {
      first_name: seedUser.first_name,
      last_name: seedUser.last_name,
      role: seedUser.role,
    },
  };
  await fetchJsonWithRetry(url, {
    method: 'PUT',
    headers: buildHeaders(serviceKey, { 'Content-Type': 'application/json' }),
    body: JSON.stringify(payload),
  });
}

async function upsertProfiles(baseUrl, serviceKey, profileRows) {
  const chunkSize = 500;
  for (let i = 0; i < profileRows.length; i += chunkSize) {
    const chunk = profileRows.slice(i, i + chunkSize);
    const url = `${baseUrl}/rest/v1/profiles?on_conflict=id`;
    await fetchJsonWithRetry(url, {
      method: 'POST',
      headers: buildHeaders(serviceKey, {
        'Content-Type': 'application/json',
        Prefer: 'resolution=merge-duplicates,return=minimal',
      }),
      body: JSON.stringify(chunk),
    });
  }
}

async function runPool(items, workerLimit, workerFn) {
  const queue = [...items];
  const out = [];
  const workers = Array.from({ length: workerLimit }, async () => {
    while (queue.length) {
      const item = queue.shift();
      if (!item) continue;
      const result = await workerFn(item);
      out.push(result);
    }
  });
  await Promise.all(workers);
  return out;
}

async function main() {
  const cfg = parseArgs(process.argv.slice(2));
  const SUPABASE_URL = String(process.env.SUPABASE_URL || '').trim().replace(/\/$/, '');
  const SERVICE_KEY = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();

  if (!SUPABASE_URL || !SERVICE_KEY) {
    throw new Error('Missing required env vars: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY');
  }

  const seedUsers = buildSeedUsers(cfg);
  const totals = {
    total: seedUsers.length,
    client: cfg.clients,
    developer: cfg.developers,
    commissioner: cfg.commissioners,
    admin: cfg.admins,
  };

  console.log(`Preparing seed for ${totals.total} users`);
  console.log(`Role mix: clients=${totals.client}, developers=${totals.developer}, commissioners=${totals.commissioner}, admins=${totals.admin}`);
  console.log(`Email pattern: ${cfg.prefix}.<role>.<#####>@${cfg.domain}`);

  if (cfg.dryRun) {
    console.log('Dry-run enabled. No changes will be written.');
    console.log('First 10 planned users:');
    seedUsers.slice(0, 10).forEach(u => {
      console.log(`- ${u.role.padEnd(12)} ${u.email}`);
    });
    return;
  }

  const existingByEmail = await listAuthUsers(SUPABASE_URL, SERVICE_KEY);
  console.log(`Existing auth users indexed: ${existingByEmail.size}`);
  const seedPassword = resolveSeedPassword(cfg);
  console.log(`Password source: ${seedPassword.source}`);

  let created = 0;
  let existing = 0;
  const profileRows = [];
  const errors = [];
  let processed = 0;

  await runPool(seedUsers, cfg.concurrency, async (seedUser) => {
    try {
      const normalizedEmail = seedUser.email.toLowerCase();
      let authUser = existingByEmail.get(normalizedEmail);
      if (!authUser) {
        authUser = await createAuthUser(SUPABASE_URL, SERVICE_KEY, seedUser, seedPassword.value);
        created += 1;
      } else {
        existing += 1;
        await updateAuthMetadata(SUPABASE_URL, SERVICE_KEY, authUser.id, seedUser);
      }

      profileRows.push({
        id: authUser.id,
        email: seedUser.email,
        first_name: seedUser.first_name,
        last_name: seedUser.last_name,
        role: VALID_ROLES.includes(seedUser.role) ? seedUser.role : 'client',
        status: 'active',
        available_for_work: seedUser.role === 'developer' || seedUser.role === 'commissioner',
        updated_at: new Date().toISOString(),
      });
    } catch (err) {
      errors.push({ email: seedUser.email, error: String(err?.message || err) });
    } finally {
      processed += 1;
      if (processed % 100 === 0 || processed === seedUsers.length) {
        console.log(`Processed ${processed}/${seedUsers.length} users...`);
      }
    }
  });

  if (profileRows.length) {
    await upsertProfiles(SUPABASE_URL, SERVICE_KEY, profileRows);
  }

  console.log('Seed completed.');
  console.log(`Created: ${created}`);
  console.log(`Already existed: ${existing}`);
  console.log(`Profiles upserted: ${profileRows.length}`);
  if (errors.length) {
    console.log(`Errors: ${errors.length}`);
    errors.slice(0, 20).forEach(e => console.log(`- ${e.email}: ${e.error}`));
    if (errors.length > 20) {
      console.log(`...and ${errors.length - 20} more`);
    }
    process.exitCode = 1;
  } else {
    console.log(`Password used for new users: ${seedPassword.value}`);
  }
}

main().catch(err => {
  console.error(`Seeding failed: ${err?.message || err}`);
  process.exit(1);
});

