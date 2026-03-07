#!/usr/bin/env node

/**
 * Track and optionally reconcile Paystack references against Supabase records.
 *
 * Usage:
 *   node scripts/reconcile-paystack.mjs
 *   node scripts/reconcile-paystack.mjs --limit 200
 *   node scripts/reconcile-paystack.mjs --reference PSK_REF
 *   node scripts/reconcile-paystack.mjs --apply
 */

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

function toNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function required(name) {
  const value = String(process.env[name] || '').trim();
  if (!value) throw new Error(`${name} is required`);
  return value.replace(/\/$/, '');
}

const SUPABASE_URL = required('SUPABASE_URL');
const SUPABASE_SERVICE_ROLE_KEY = required('SUPABASE_SERVICE_ROLE_KEY');
const PAYSTACK_SECRET_KEY = required('PAYSTACK_SECRET_KEY');

const APPLY = hasArg('--apply');
const LIMIT = Math.max(1, Math.min(500, toNumber(argValue('--limit', '120'), 120)));
const ONLY_REFERENCE = argValue('--reference', '');

function serviceHeaders(extra = {}) {
  return {
    apikey: SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    ...extra,
  };
}

async function parseJsonResponse(res) {
  const text = await res.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

function formatErrorBody(body) {
  if (!body) return '';
  if (typeof body === 'string') return body;
  return body.message || body.error_description || body.error || JSON.stringify(body);
}

async function supabaseGet(table, queryParams) {
  const qs = new URLSearchParams(queryParams);
  const url = `${SUPABASE_URL}/rest/v1/${table}?${qs.toString()}`;
  const res = await fetch(url, {
    method: 'GET',
    headers: serviceHeaders(),
  });
  const body = await parseJsonResponse(res);
  if (!res.ok) {
    throw new Error(`Supabase GET ${table} failed (${res.status}): ${formatErrorBody(body)}`);
  }
  return Array.isArray(body) ? body : [];
}

async function supabasePatch(table, filters, patch) {
  const qs = new URLSearchParams(filters);
  const url = `${SUPABASE_URL}/rest/v1/${table}?${qs.toString()}`;
  const res = await fetch(url, {
    method: 'PATCH',
    headers: serviceHeaders({
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    }),
    body: JSON.stringify(patch),
  });
  const body = await parseJsonResponse(res);
  if (!res.ok) {
    throw new Error(`Supabase PATCH ${table} failed (${res.status}): ${formatErrorBody(body)}`);
  }
  return body;
}

async function verifyPaystack(reference) {
  const res = await fetch(`https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`,
    },
  });
  const body = await parseJsonResponse(res);
  if (!res.ok || !body?.status) {
    return {
      ok: false,
      error: `Paystack verify failed (${res.status}): ${formatErrorBody(body)}`,
      data: null,
    };
  }
  return { ok: true, error: null, data: body?.data || null };
}

function normalizePaystackStatus(status) {
  const s = String(status || '').toLowerCase();
  if (s === 'success') return 'paid';
  if (s === 'failed' || s === 'abandoned') return 'failed';
  return 'pending';
}

function roughlyEqualMoney(a, b) {
  return Math.abs(Number(a || 0) - Number(b || 0)) < 0.01;
}

async function fetchInvoices() {
  const baseQuery = {
    select: 'id,amount,currency,status,paystack_reference,paid_at,updated_at,project_id,description,created_at',
    order: 'created_at.desc',
    limit: String(LIMIT),
  };
  if (ONLY_REFERENCE) {
    baseQuery.paystack_reference = `eq.${ONLY_REFERENCE}`;
  } else {
    baseQuery.paystack_reference = 'not.is.null';
  }
  return supabaseGet('invoices', baseQuery);
}

async function fetchTopups() {
  const baseQuery = {
    select: 'id,user_id,amount,status,paystack_reference,completed_at,created_at,provider',
    order: 'created_at.desc',
    limit: String(LIMIT),
  };
  if (ONLY_REFERENCE) {
    baseQuery.paystack_reference = `eq.${ONLY_REFERENCE}`;
  } else {
    baseQuery.paystack_reference = 'not.is.null';
  }
  return supabaseGet('wallet_topups', baseQuery);
}

async function patchLedgerForInvoice(invoiceId, status, reference, verifiedAmount) {
  try {
    await supabasePatch('financial_transactions', {
      invoice_id: `eq.${invoiceId}`,
    }, {
      status,
      metadata: {
        paystack_reference: reference,
        verified_amount_ksh: verifiedAmount,
        verified_at: new Date().toISOString(),
      },
    });
  } catch {
    // Ignore ledger patch errors so primary record reconciliation can continue.
  }
}

async function patchLedgerForTopup(topupId, status, reference, verifiedAmount) {
  try {
    await supabasePatch('financial_transactions', {
      topup_id: `eq.${topupId}`,
    }, {
      status,
      metadata: {
        paystack_reference: reference,
        verified_amount_ksh: verifiedAmount,
        verified_at: new Date().toISOString(),
      },
    });
  } catch {
    // Ignore ledger patch errors so primary record reconciliation can continue.
  }
}

function printRow(row) {
  const parts = [
    row.type.padEnd(7),
    row.reference.padEnd(16),
    String(row.localStatus).padEnd(8),
    String(row.paystackStatus).padEnd(8),
    `local=${row.localAmount.toFixed(2)}`,
    `paystack=${row.paystackAmount.toFixed(2)}`,
  ];
  if (!row.amountMatch) parts.push('amount_mismatch');
  if (!row.ok) parts.push(`error=${row.error}`);
  console.log(parts.join('  '));
}

async function reconcileInvoices(rows) {
  const results = [];
  for (const row of rows) {
    const reference = String(row.paystack_reference || '').trim();
    if (!reference) continue;
    const localAmount = toNumber(row.amount, 0);
    const localStatus = String(row.status || '').toLowerCase();

    const verified = await verifyPaystack(reference);
    if (!verified.ok) {
      results.push({
        type: 'invoice',
        id: row.id,
        reference,
        ok: false,
        error: verified.error,
        localStatus,
        paystackStatus: 'unknown',
        localAmount,
        paystackAmount: 0,
        amountMatch: false,
      });
      continue;
    }

    const paystackRawStatus = String(verified.data?.status || '').toLowerCase();
    const paystackStatus = normalizePaystackStatus(paystackRawStatus);
    const paystackAmount = Math.round((toNumber(verified.data?.amount, 0) / 100) * 100) / 100;
    const amountMatch = roughlyEqualMoney(localAmount, paystackAmount) || paystackAmount === 0;

    if (APPLY) {
      if (paystackStatus === 'paid' && localStatus !== 'paid') {
        await supabasePatch('invoices', { id: `eq.${row.id}` }, {
          status: 'paid',
          paid_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        });
        await patchLedgerForInvoice(row.id, 'paid', reference, paystackAmount);
      } else if (paystackStatus === 'failed' && localStatus !== 'failed') {
        await supabasePatch('invoices', { id: `eq.${row.id}` }, {
          status: 'failed',
          updated_at: new Date().toISOString(),
        });
        await patchLedgerForInvoice(row.id, 'failed', reference, paystackAmount);
      }
    }

    results.push({
      type: 'invoice',
      id: row.id,
      reference,
      ok: true,
      error: null,
      localStatus,
      paystackStatus,
      localAmount,
      paystackAmount,
      amountMatch,
    });
  }
  return results;
}

async function reconcileTopups(rows) {
  const results = [];
  for (const row of rows) {
    const reference = String(row.paystack_reference || '').trim();
    if (!reference) continue;
    const localAmount = toNumber(row.amount, 0);
    const localStatus = String(row.status || '').toLowerCase();

    const verified = await verifyPaystack(reference);
    if (!verified.ok) {
      results.push({
        type: 'topup',
        id: row.id,
        reference,
        ok: false,
        error: verified.error,
        localStatus,
        paystackStatus: 'unknown',
        localAmount,
        paystackAmount: 0,
        amountMatch: false,
      });
      continue;
    }

    const paystackRawStatus = String(verified.data?.status || '').toLowerCase();
    const paystackStatus = normalizePaystackStatus(paystackRawStatus);
    const paystackAmount = Math.round((toNumber(verified.data?.amount, 0) / 100) * 100) / 100;
    const amountMatch = roughlyEqualMoney(localAmount, paystackAmount) || paystackAmount === 0;

    if (APPLY) {
      if (paystackStatus === 'paid' && localStatus !== 'paid') {
        await supabasePatch('wallet_topups', { id: `eq.${row.id}` }, {
          status: 'paid',
          completed_at: new Date().toISOString(),
        });
        await patchLedgerForTopup(row.id, 'paid', reference, paystackAmount);
      } else if (paystackStatus === 'failed' && localStatus !== 'failed') {
        await supabasePatch('wallet_topups', { id: `eq.${row.id}` }, {
          status: 'failed',
        });
        await patchLedgerForTopup(row.id, 'failed', reference, paystackAmount);
      }
    }

    results.push({
      type: 'topup',
      id: row.id,
      reference,
      ok: true,
      error: null,
      localStatus,
      paystackStatus,
      localAmount,
      paystackAmount,
      amountMatch,
    });
  }
  return results;
}

function summarize(results) {
  const total = results.length;
  const failures = results.filter((r) => !r.ok).length;
  const mismatches = results.filter((r) => r.ok && !r.amountMatch).length;
  const pendingVsPaidDiff = results.filter((r) => r.ok && r.localStatus !== r.paystackStatus).length;
  const localTotal = results.reduce((acc, r) => acc + toNumber(r.localAmount, 0), 0);
  const paystackTotal = results.reduce((acc, r) => acc + toNumber(r.paystackAmount, 0), 0);

  console.log('\nSummary');
  console.log(`- records checked: ${total}`);
  console.log(`- verify errors: ${failures}`);
  console.log(`- status mismatches: ${pendingVsPaidDiff}`);
  console.log(`- amount mismatches: ${mismatches}`);
  console.log(`- local total KES: ${localTotal.toFixed(2)}`);
  console.log(`- paystack total KES: ${paystackTotal.toFixed(2)}`);
  console.log(`- delta KES: ${(paystackTotal - localTotal).toFixed(2)}`);
  if (APPLY) console.log('- apply mode: ON (status updates were written)');
  else console.log('- apply mode: OFF (read-only check)');
}

async function main() {
  console.log(`Paystack reconciliation starting (limit=${LIMIT}, apply=${APPLY ? 'yes' : 'no'}${ONLY_REFERENCE ? `, reference=${ONLY_REFERENCE}` : ''})`);
  const [invoices, topups] = await Promise.all([fetchInvoices(), fetchTopups()]);
  const [invoiceResults, topupResults] = await Promise.all([
    reconcileInvoices(invoices),
    reconcileTopups(topups),
  ]);

  const all = [...invoiceResults, ...topupResults];
  if (!all.length) {
    console.log('No records found with Paystack references.');
    return;
  }

  console.log('\nType     Reference         Local     Paystack  Amounts');
  console.log('--------------------------------------------------------------------------');
  all.forEach(printRow);
  summarize(all);
}

main().catch((error) => {
  console.error(`Paystack reconciliation failed: ${error?.message || error}`);
  process.exit(1);
});
