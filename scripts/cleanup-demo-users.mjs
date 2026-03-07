#!/usr/bin/env node

/**
 * Deletes known demo/test users from Supabase Auth.
 *
 * Required env:
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 */

import { loadLocalEnv } from './load-local-env.mjs';

loadLocalEnv();

const KEEP_EMAILS = new Set([
  'client@test.com',
  'admin@test.com',
  'commissioner@test.com',
  'developer@test.com',
]);

function requiredEnv(name) {
  const value = String(process.env[name] || '').trim();
  if (!value) throw new Error(`${name} is required`);
  return value.replace(/\/$/, '');
}

function headers(serviceKey) {
  return {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
  };
}

function isDemoEmail(emailRaw) {
  const email = String(emailRaw || '').trim().toLowerCase();
  if (!email) return false;
  if (KEEP_EMAILS.has(email)) return false;
  return (
    email.endsWith('@seed.escrowmkt.local')
    || email.endsWith('@seed.codestudio.ke')
    || email.endsWith('@example.com')
    || email.endsWith('@example.org')
    || email.endsWith('@test.com')
  );
}

async function fetchJson(url, options) {
  const response = await fetch(url, options);
  const text = await response.text();
  let body = {};
  if (text) {
    try { body = JSON.parse(text); } catch { body = { raw: text }; }
  }
  if (!response.ok) {
    const message = body?.msg || body?.message || body?.error || `HTTP ${response.status}`;
    throw new Error(message);
  }
  return body;
}

async function listAuthUsers(baseUrl, serviceKey) {
  const all = [];
  let page = 1;
  while (page <= 1000) {
    const data = await fetchJson(`${baseUrl}/auth/v1/admin/users?page=${page}&per_page=1000`, {
      method: 'GET',
      headers: headers(serviceKey),
    });
    const users = Array.isArray(data?.users) ? data.users : [];
    if (!users.length) break;
    all.push(...users);
    if (users.length < 1000) break;
    page += 1;
  }
  return all;
}

async function deleteAuthUser(baseUrl, serviceKey, userId) {
  await fetchJson(`${baseUrl}/auth/v1/admin/users/${userId}`, {
    method: 'DELETE',
    headers: headers(serviceKey),
  });
}

async function main() {
  const baseUrl = requiredEnv('SUPABASE_URL');
  const serviceKey = requiredEnv('SUPABASE_SERVICE_ROLE_KEY');

  const users = await listAuthUsers(baseUrl, serviceKey);
  const targets = users.filter(user => isDemoEmail(user?.email));
  console.log(`Demo users found: ${targets.length}`);
  if (!targets.length) {
    console.log('No demo/test users to delete.');
    return;
  }

  let deleted = 0;
  for (const user of targets) {
    await deleteAuthUser(baseUrl, serviceKey, user.id);
    deleted += 1;
    if (deleted % 50 === 0 || deleted === targets.length) {
      console.log(`Deleted ${deleted}/${targets.length} demo users...`);
    }
  }

  console.log(`Cleanup complete. Deleted ${deleted} demo users.`);
}

main().catch((error) => {
  console.error(`cleanup-demo-users failed: ${error?.message || error}`);
  process.exit(1);
});
