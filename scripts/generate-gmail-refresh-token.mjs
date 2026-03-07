#!/usr/bin/env node

/**
 * Generate and exchange a Gmail OAuth refresh token for Supabase email sending.
 *
 * Step 1: run without --code to print consent URL.
 * Step 2: after Google redirects to redirect_uri?code=..., run with --code "<code>".
 *
 * Optional:
 *   --set-supabase        push secrets directly via Supabase CLI
 *   --project-ref <ref>   required when using --set-supabase if config not detected
 *   --sender <email>      override GOOGLE_SENDER_EMAIL
 *   --redirect-uri <uri>  override redirect URI
 */

import { spawnSync } from 'node:child_process';
import { loadLocalEnv } from './load-local-env.mjs';

loadLocalEnv();

const args = process.argv.slice(2);

function argValue(name, fallback = '') {
  const idx = args.indexOf(name);
  if (idx >= 0 && idx < args.length - 1) return String(args[idx + 1] || '').trim();
  return fallback;
}

function hasArg(name) {
  return args.includes(name);
}

function requiredEnv(...keys) {
  for (const key of keys) {
    const value = String(process.env[key] || '').trim();
    if (value) return value;
  }
  throw new Error(`Missing required env. Tried: ${keys.join(', ')}`);
}

function asSenderEmail() {
  return argValue('--sender')
    || String(process.env.GOOGLE_SENDER_EMAIL || '').trim()
    || String(process.env.GMAIL_SENDER_EMAIL || '').trim()
    || '';
}

const clientId = requiredEnv('GOOGLE_CLIENT_ID', 'GMAIL_CLIENT_ID');
const clientSecret = requiredEnv('GOOGLE_CLIENT_SECRET', 'GMAIL_CLIENT_SECRET');
const redirectUri = argValue('--redirect-uri')
  || String(process.env.GOOGLE_OAUTH_REDIRECT_URI || '').trim()
  || 'http://localhost:3000/oauth2/callback';
const senderEmail = asSenderEmail();

const authCode = argValue('--code');
const setSupabase = hasArg('--set-supabase');
const projectRef = argValue('--project-ref')
  || String(process.env.SUPABASE_PROJECT_REF || '').trim()
  || String(process.env.NEXT_PUBLIC_SUPABASE_URL || '').trim().match(/https:\/\/([^.]+)\.supabase\.co/)?.[1]
  || '';

const scopes = [
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/userinfo.email',
];

function buildConsentUrl() {
  const qs = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    access_type: 'offline',
    prompt: 'consent',
    scope: scopes.join(' '),
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${qs.toString()}`;
}

async function exchangeCodeForTokens(code) {
  const form = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    code,
    grant_type: 'authorization_code',
    redirect_uri: redirectUri,
  });
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form.toString(),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message = body?.error_description || body?.error || `Google token exchange failed (${res.status})`;
    throw new Error(message);
  }
  return body;
}

function printManualSupabaseCommands(refreshToken) {
  const senderValue = senderEmail || '<your-sender-email@gmail.com>';
  console.log('\nRun these commands:');
  console.log(`npx supabase secrets set GOOGLE_CLIENT_ID="${clientId}"`);
  console.log(`npx supabase secrets set GOOGLE_CLIENT_SECRET="${clientSecret}"`);
  console.log(`npx supabase secrets set GOOGLE_REFRESH_TOKEN="${refreshToken}"`);
  console.log(`npx supabase secrets set GOOGLE_SENDER_EMAIL="${senderValue}"`);
  console.log('npx supabase functions deploy send-invoice');
  console.log('npx supabase functions deploy send_gmail');
}

function setSecretsViaCli(refreshToken) {
  if (!projectRef) {
    throw new Error('Missing Supabase project ref. Use --project-ref <ref> with --set-supabase.');
  }
  const senderValue = senderEmail || '';
  if (!senderValue) {
    throw new Error('Missing sender email. Set GOOGLE_SENDER_EMAIL or pass --sender <email>.');
  }

  const argsList = [
    'supabase',
    'secrets',
    'set',
    `GOOGLE_CLIENT_ID=${clientId}`,
    `GOOGLE_CLIENT_SECRET=${clientSecret}`,
    `GOOGLE_REFRESH_TOKEN=${refreshToken}`,
    `GOOGLE_SENDER_EMAIL=${senderValue}`,
    '--project-ref',
    projectRef,
  ];

  const run = spawnSync('npx', argsList, { stdio: 'inherit', shell: true });
  if (run.status !== 0) {
    throw new Error('supabase secrets set failed');
  }

  const deploySendInvoice = spawnSync('npx', ['supabase', 'functions', 'deploy', 'send-invoice', '--project-ref', projectRef], { stdio: 'inherit', shell: true });
  if (deploySendInvoice.status !== 0) throw new Error('deploy send-invoice failed');

  const deploySendGmail = spawnSync('npx', ['supabase', 'functions', 'deploy', 'send_gmail', '--project-ref', projectRef], { stdio: 'inherit', shell: true });
  if (deploySendGmail.status !== 0) throw new Error('deploy send_gmail failed');
}

async function main() {
  if (!authCode) {
    const url = buildConsentUrl();
    console.log('Open this URL in your browser and complete consent:');
    console.log(url);
    console.log('\nAfter consent, copy the `code` query parameter from the redirect URL and run:');
    console.log('npm run gmail:refresh -- --code "<paste-code-here>"');
    console.log('\nIf needed, include your redirect URI:');
    console.log('npm run gmail:refresh -- --redirect-uri "http://localhost:3000/oauth2/callback" --code "<paste-code>"');
    return;
  }

  const token = await exchangeCodeForTokens(authCode);
  const refreshToken = String(token.refresh_token || '').trim();
  const accessToken = String(token.access_token || '').trim();

  if (!refreshToken) {
    console.log('Google returned no refresh_token.');
    console.log('Retry consent and ensure: prompt=consent + access_type=offline + same redirect URI as authorized.');
    if (accessToken) console.log('Access token was returned, but not refresh token.');
    process.exit(1);
  }

  console.log('New Gmail refresh token acquired successfully.');
  if (setSupabase) {
    setSecretsViaCli(refreshToken);
    console.log(`Supabase secrets updated and functions redeployed${projectRef ? ` for ${projectRef}` : ''}.`);
  } else {
    printManualSupabaseCommands(refreshToken);
  }
}

main().catch((error) => {
  console.error(`Gmail refresh-token flow failed: ${error?.message || error}`);
  process.exit(1);
});

