#!/usr/bin/env node

/**
 * Force-create/update core test users with deterministic roles.
 *
 * Required env:
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 */

import { loadLocalEnv } from './load-local-env.mjs';

loadLocalEnv();

const TARGET_USERS = [
  { email: 'client@test.com', password: 'Password123!', role: 'client', first_name: 'Client', last_name: 'User' },
  { email: 'admin@test.com', password: 'Password123!', role: 'admin', first_name: 'Admin', last_name: 'User' },
  { email: 'commissioner@test.com', password: 'Password123!', role: 'commissioner', first_name: 'Commissioner', last_name: 'User' },
  { email: 'developer@test.com', password: 'Password123!', role: 'developer', first_name: 'Developer', last_name: 'User' },
];

function requiredEnv(name) {
  const value = String(process.env[name] || '').trim();
  if (!value) throw new Error(`${name} is required`);
  return value.replace(/\/$/, '');
}

function headers(serviceKey, extra = {}) {
  return {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
    ...extra,
  };
}

async function fetchJson(url, options) {
  const response = await fetch(url, options);
  const text = await response.text();
  let body = {};
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = { raw: text };
    }
  }
  if (!response.ok) {
    const msg = body?.msg || body?.message || body?.error || body?.error_description || `HTTP ${response.status}`;
    throw new Error(msg);
  }
  return body;
}

async function listAuthUsers(baseUrl, serviceKey) {
  const usersByEmail = new Map();
  let page = 1;
  while (page <= 1000) {
    const data = await fetchJson(`${baseUrl}/auth/v1/admin/users?page=${page}&per_page=1000`, {
      method: 'GET',
      headers: headers(serviceKey),
    });
    const users = Array.isArray(data?.users) ? data.users : [];
    if (!users.length) break;
    users.forEach((user) => {
      if (user?.email) usersByEmail.set(String(user.email).toLowerCase(), user);
    });
    if (users.length < 1000) break;
    page += 1;
  }
  return usersByEmail;
}

async function createAuthUser(baseUrl, serviceKey, user) {
  return fetchJson(`${baseUrl}/auth/v1/admin/users`, {
    method: 'POST',
    headers: headers(serviceKey, { 'Content-Type': 'application/json' }),
    body: JSON.stringify({
      email: user.email,
      password: user.password,
      email_confirm: true,
      user_metadata: {
        first_name: user.first_name,
        last_name: user.last_name,
        role: user.role,
      },
    }),
  });
}

async function updateAuthUser(baseUrl, serviceKey, userId, user) {
  return fetchJson(`${baseUrl}/auth/v1/admin/users/${userId}`, {
    method: 'PUT',
    headers: headers(serviceKey, { 'Content-Type': 'application/json' }),
    body: JSON.stringify({
      password: user.password,
      email_confirm: true,
      user_metadata: {
        first_name: user.first_name,
        last_name: user.last_name,
        role: user.role,
      },
    }),
  });
}

async function upsertProfiles(baseUrl, serviceKey, profiles) {
  return fetchJson(`${baseUrl}/rest/v1/profiles?on_conflict=id`, {
    method: 'POST',
    headers: headers(serviceKey, {
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates,return=minimal',
    }),
    body: JSON.stringify(profiles),
  });
}

async function main() {
  const baseUrl = requiredEnv('SUPABASE_URL');
  const serviceKey = requiredEnv('SUPABASE_SERVICE_ROLE_KEY');
  const existing = await listAuthUsers(baseUrl, serviceKey);

  const profileRows = [];
  for (const target of TARGET_USERS) {
    const existingUser = existing.get(target.email.toLowerCase());
    if (existingUser?.id) {
      await updateAuthUser(baseUrl, serviceKey, existingUser.id, target);
      profileRows.push({
        id: existingUser.id,
        email: target.email,
        first_name: target.first_name,
        last_name: target.last_name,
        role: target.role,
        status: 'active',
        available_for_work: target.role === 'developer' || target.role === 'commissioner',
        updated_at: new Date().toISOString(),
      });
      console.log(`updated ${target.email} (${target.role})`);
    } else {
      const created = await createAuthUser(baseUrl, serviceKey, target);
      const userId = created?.user?.id || created?.id;
      if (!userId) throw new Error(`Failed to create ${target.email}`);
      profileRows.push({
        id: userId,
        email: target.email,
        first_name: target.first_name,
        last_name: target.last_name,
        role: target.role,
        status: 'active',
        available_for_work: target.role === 'developer' || target.role === 'commissioner',
        updated_at: new Date().toISOString(),
      });
      console.log(`created ${target.email} (${target.role})`);
    }
  }

  await upsertProfiles(baseUrl, serviceKey, profileRows);
  console.log('Forced users synced to auth + profiles.');
}

main().catch((error) => {
  console.error(`force-test-users failed: ${error?.message || error}`);
  process.exit(1);
});

