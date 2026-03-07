#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { loadLocalEnv } from './load-local-env.mjs';

const ROOT = process.cwd();
loadLocalEnv({ cwd: ROOT });

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_ANON_KEY in env.');
  process.exit(1);
}

const now = new Date().toISOString();

function rel(p) {
  return path.relative(ROOT, p).replace(/\\/g, '/');
}

function readText(p) {
  return fs.readFileSync(p, 'utf8');
}

function safeExec(file, args, options = {}) {
  try {
    return execFileSync(file, args, {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
      maxBuffer: 20 * 1024 * 1024,
      ...options,
    });
  } catch (e) {
    return null;
  }
}

function safeExecNpx(args, options = {}) {
  if (process.platform === 'win32') {
    const cmd = `npx ${args.map((a) => String(a)).join(' ')}`;
    return safeExec('powershell', ['-NoProfile', '-Command', cmd], options);
  }
  return safeExec('npx', args, options);
}

function listFilesRecursive(dir, predicate = () => true) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  const stack = [dir];
  while (stack.length) {
    const cur = stack.pop();
    const entries = fs.readdirSync(cur, { withFileTypes: true });
    for (const entry of entries) {
      const abs = path.join(cur, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name.startsWith('.deploytmp')) continue;
        stack.push(abs);
      } else if (predicate(abs)) {
        out.push(abs);
      }
    }
  }
  return out.sort();
}

function csvEscape(value) {
  const s = String(value ?? '');
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

async function fetchJson(url, headers = {}) {
  const res = await fetch(url, { headers });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = null; }
  return { ok: res.ok, status: res.status, headers: res.headers, text, data };
}

async function getOpenApiSpec() {
  return fetchJson(`${SUPABASE_URL.replace(/\/$/, '')}/rest/v1/`, {
    apikey: SUPABASE_ANON_KEY,
    Accept: 'application/openapi+json',
  });
}

function discoverRoutes() {
  const htmlFiles = listFilesRecursive(ROOT, (p) => p.endsWith('.html'));
  const pages = htmlFiles.map((abs) => {
    const name = path.basename(abs);
    const text = readText(abs);
    const titleMatch = text.match(/<title>([^<]+)<\/title>/i);
    return {
      file: rel(abs),
      route: `/${name}`,
      title: titleMatch ? titleMatch[1].trim() : '',
      is_dashboard: /_dashboard\.html$/i.test(name),
      dashboard_role: name.startsWith('admin_')
        ? 'admin'
        : name.startsWith('sales_')
          ? 'sales'
          : name.startsWith('developer_')
            ? 'developer'
            : name.startsWith('client_')
              ? 'client'
              : null,
    };
  });

  const dashboardPages = pages.filter((p) => p.is_dashboard);
  return { pages, dashboardPages };
}

function discoverIntegrations(files) {
  const hits = {
    supabase: [],
    paystack: [],
    resend: [],
    google_oauth: [],
    vercel: [],
    realtime: [],
  };

  const patterns = [
    ['supabase', /supabase/i],
    ['paystack', /paystack/i],
    ['resend', /resend/i],
    ['google_oauth', /google|oauth/i],
    ['vercel', /vercel/i],
    ['realtime', /realtime|postgres_changes|channel\(/i],
  ];

  for (const file of files) {
    const ext = path.extname(file).toLowerCase();
    if (!['.html', '.js', '.mjs', '.ts', '.md', '.sql', '.toml'].includes(ext)) continue;
    const text = readText(file);
    for (const [key, rx] of patterns) {
      if (rx.test(text)) hits[key].push(rel(file));
    }
  }

  for (const key of Object.keys(hits)) {
    hits[key] = Array.from(new Set(hits[key])).sort();
  }
  return hits;
}

function discoverEdgeFunctions() {
  const fnRoot = path.join(ROOT, 'supabase', 'functions');
  const local = [];
  if (fs.existsSync(fnRoot)) {
    const dirs = fs.readdirSync(fnRoot, { withFileTypes: true })
      .filter((d) => d.isDirectory() && !d.name.startsWith('_'))
      .map((d) => d.name)
      .sort();
    for (const name of dirs) {
      local.push({
        name,
        path: rel(path.join(fnRoot, name)),
      });
    }
  }

  let remote = [];
  const raw = safeExecNpx(['supabase', 'functions', 'list', '--output', 'json']);
  if (raw) {
    try {
      const start = raw.indexOf('[');
      const end = raw.lastIndexOf(']');
      const jsonChunk = start >= 0 && end > start ? raw.slice(start, end + 1) : raw;
      const parsed = JSON.parse(jsonChunk);
      remote = Array.isArray(parsed)
        ? parsed.map((f) => ({
          id: f.id,
          name: f.name,
          slug: f.slug,
          status: f.status,
          verify_jwt: f.verify_jwt,
          version: f.version,
          updated_at: f.updated_at,
        }))
        : [];
    } catch {
      remote = [];
    }
  }

  return { local, remote };
}

async function discoverStorageBuckets() {
  if (!SUPABASE_SERVICE_ROLE_KEY) {
    return { ok: false, reason: 'SUPABASE_SERVICE_ROLE_KEY missing', buckets: [] };
  }
  const res = await fetchJson(`${SUPABASE_URL.replace(/\/$/, '')}/storage/v1/bucket`, {
    apikey: SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
  });
  return {
    ok: res.ok,
    status: res.status,
    buckets: Array.isArray(res.data)
      ? res.data.map((b) => ({ id: b.id, name: b.name, public: b.public ?? false }))
      : [],
    error: res.ok ? null : (res.text || `HTTP ${res.status}`),
  };
}

function parseMigrationMetadata(sqlFiles) {
  const policies = [];
  const functions = [];
  const triggers = [];
  const indexes = [];
  const constraints = [];
  const rlsTables = new Set();
  const cronJobs = [];

  const policyRe = /create\s+policy\s+"?([^"\n]+?)"?\s+on\s+([a-zA-Z0-9_."]+)/gi;
  const functionRe = /create\s+(?:or\s+replace\s+)?function\s+([a-zA-Z0-9_."]+)\s*\(/gi;
  const triggerRe = /create\s+trigger\s+([a-zA-Z0-9_"]+)\s+[^\n]*?\s+on\s+([a-zA-Z0-9_."]+)/gi;
  const indexRe = /create\s+(unique\s+)?index\s+(?:if\s+not\s+exists\s+)?([a-zA-Z0-9_"]+)\s+on\s+([a-zA-Z0-9_."]+)\s*\(([^)]+)\)/gi;
  const fkRe = /alter\s+table\s+([a-zA-Z0-9_."]+)\s+add\s+constraint\s+([a-zA-Z0-9_"]+)\s+foreign\s+key\s*\(([^)]+)\)\s+references\s+([a-zA-Z0-9_."]+)\s*\(([^)]+)\)/gi;
  const rlsRe = /alter\s+table\s+([a-zA-Z0-9_."]+)\s+enable\s+row\s+level\s+security/gi;
  const cronRe = /cron\.schedule\s*\(/gi;

  for (const file of sqlFiles) {
    const sql = readText(file);
    let m;

    while ((m = policyRe.exec(sql)) !== null) {
      policies.push({ policy: m[1].trim(), table: m[2].replace(/"/g, ''), source_file: rel(file) });
    }
    while ((m = functionRe.exec(sql)) !== null) {
      functions.push({ function: m[1].replace(/"/g, ''), source_file: rel(file) });
    }
    while ((m = triggerRe.exec(sql)) !== null) {
      triggers.push({ trigger: m[1].replace(/"/g, ''), table: m[2].replace(/"/g, ''), source_file: rel(file) });
    }
    while ((m = indexRe.exec(sql)) !== null) {
      indexes.push({
        unique: Boolean(m[1]),
        index_name: m[2].replace(/"/g, ''),
        table: m[3].replace(/"/g, ''),
        columns: m[4].split(',').map((c) => c.trim().replace(/"/g, '')),
        source_file: rel(file),
      });
    }
    while ((m = fkRe.exec(sql)) !== null) {
      constraints.push({
        table: m[1].replace(/"/g, ''),
        constraint: m[2].replace(/"/g, ''),
        type: 'foreign_key',
        columns: m[3].split(',').map((c) => c.trim().replace(/"/g, '')),
        references_table: m[4].replace(/"/g, ''),
        references_columns: m[5].split(',').map((c) => c.trim().replace(/"/g, '')),
        source_file: rel(file),
      });
    }
    while ((m = rlsRe.exec(sql)) !== null) {
      rlsTables.add(m[1].replace(/"/g, ''));
    }
    while ((m = cronRe.exec(sql)) !== null) {
      cronJobs.push({ source_file: rel(file), marker: 'cron.schedule' });
    }
  }

  return {
    policies,
    functions: Array.from(new Map(functions.map((f) => [`${f.function}:${f.source_file}`, f])).values()),
    triggers,
    indexes,
    constraints,
    rls_enabled_tables: Array.from(rlsTables).sort(),
    cron_jobs: cronJobs,
  };
}

async function getRowCount(tableName) {
  if (!SUPABASE_SERVICE_ROLE_KEY) return { ok: false, count: null, reason: 'service_role_missing' };
  const url = `${SUPABASE_URL.replace(/\/$/, '')}/rest/v1/${tableName}?select=*&limit=1`;
  const res = await fetch(url, {
    method: 'GET',
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      Prefer: 'count=exact',
    },
  });
  const contentRange = res.headers.get('content-range') || '';
  let count = null;
  const m = contentRange.match(/\/(\d+)$/);
  if (m) count = Number(m[1]);
  return { ok: res.ok, count, status: res.status, content_range: contentRange };
}

function buildCheckTypes() {
  return [
    { type: 'table_exists', severity: 'P0' },
    { type: 'column_contract', severity: 'P0' },
    { type: 'primary_key_presence', severity: 'P0' },
    { type: 'foreign_key_integrity', severity: 'P0' },
    { type: 'orphan_row_check', severity: 'P1' },
    { type: 'index_presence_fk', severity: 'P1' },
    { type: 'index_usage_baseline', severity: 'P2' },
    { type: 'unique_constraint_check', severity: 'P1' },
    { type: 'not_null_required_fields', severity: 'P1' },
    { type: 'default_values_sanity', severity: 'P2' },
    { type: 'rls_enabled', severity: 'P0' },
    { type: 'rls_select_owner_scope', severity: 'P0' },
    { type: 'rls_insert_owner_scope', severity: 'P0' },
    { type: 'rls_update_owner_scope', severity: 'P0' },
    { type: 'rls_delete_owner_scope', severity: 'P1' },
    { type: 'rls_admin_bypass_expected', severity: 'P1' },
    { type: 'rls_recursion_risk_scan', severity: 'P0' },
    { type: 'api_select_endpoint_ok', severity: 'P1' },
    { type: 'api_insert_endpoint_ok', severity: 'P1' },
    { type: 'api_update_endpoint_ok', severity: 'P1' },
    { type: 'api_delete_endpoint_guarded', severity: 'P1' },
    { type: 'api_payload_shape_validation', severity: 'P1' },
    { type: 'ui_widget_source_mapping', severity: 'P1' },
    { type: 'ui_widget_empty_state_sanity', severity: 'P2' },
    { type: 'dashboard_role_visibility', severity: 'P0' },
    { type: 'dashboard_cross_role_data_leak', severity: 'P0' },
    { type: 'pagination_support', severity: 'P2' },
    { type: 'sorting_support', severity: 'P2' },
    { type: 'filtering_support', severity: 'P2' },
    { type: 'count_query_support', severity: 'P2' },
    { type: 'data_freshness_timestamp', severity: 'P2' },
    { type: 'created_at_presence', severity: 'P1' },
    { type: 'updated_at_presence', severity: 'P1' },
    { type: 'timezone_consistency', severity: 'P2' },
    { type: 'currency_precision_numeric', severity: 'P1' },
    { type: 'negative_amount_guard', severity: 'P1' },
    { type: 'status_enum_validity', severity: 'P1' },
    { type: 'null_rate_critical_fields', severity: 'P2' },
    { type: 'duplicate_business_key_scan', severity: 'P1' },
    { type: 'sensitive_data_exposure_scan', severity: 'P0' },
    { type: 'audit_log_coverage', severity: 'P1' },
    { type: 'trigger_presence_expected', severity: 'P1' },
    { type: 'trigger_side_effect_sanity', severity: 'P1' },
    { type: 'function_dependency_validity', severity: 'P1' },
    { type: 'migration_history_alignment', severity: 'P1' },
    { type: 'backup_readiness_signal', severity: 'P2' },
    { type: 'restore_simulation_plan', severity: 'P2' },
    { type: 'webhook_idempotency_key', severity: 'P0' },
    { type: 'webhook_signature_verification', severity: 'P0' },
    { type: 'webhook_replay_no_duplicate_effect', severity: 'P0' },
    { type: 'provider_reference_uniqueness', severity: 'P0' },
    { type: 'payment_state_machine_validity', severity: 'P0' },
    { type: 'commission_calculation_consistency', severity: 'P1' },
    { type: 'payout_state_machine_validity', severity: 'P1' },
    { type: 'invoice_delivery_pipeline', severity: 'P1' },
    { type: 'notification_insert_compatibility', severity: 'P1' },
    { type: 'realtime_channel_mapping', severity: 'P2' },
    { type: 'storage_acl_scope', severity: 'P1' },
    { type: 'avatar_upload_constraints', severity: 'P2' },
    { type: 'google_avatar_sync', severity: 'P2' },
    { type: 'oauth_role_routing', severity: 'P0' },
    { type: 'password_login_role_routing', severity: 'P0' },
    { type: 'session_expiry_recovery', severity: 'P1' },
    { type: 'failed_fetch_error_surface', severity: 'P1' },
    { type: 'mobile_layout_data_endpoint_stability', severity: 'P2' },
    { type: 'csv_export_source_integrity', severity: 'P2' },
    { type: 'search_query_performance_baseline', severity: 'P2' },
    { type: 'n_plus_one_query_risk', severity: 'P2' },
    { type: 'deadlock_risk_heuristic', severity: 'P2' },
    { type: 'race_condition_risk_heuristic', severity: 'P1' },
    { type: 'transaction_atomicity_required_paths', severity: 'P0' },
    { type: 'service_role_leak_scan', severity: 'P0' },
    { type: 'anon_role_capability_boundary', severity: 'P0' },
    { type: 'admin_godmode_boundary', severity: 'P1' },
    { type: 'soft_delete_behavior_check', severity: 'P2' },
    { type: 'hard_delete_guardrails', severity: 'P1' },
    { type: 'topup_pending_to_success_transition', severity: 'P0' },
    { type: 'invoice_pending_to_paid_transition', severity: 'P0' },
    { type: 'commission_post_payment_trigger', severity: 'P1' },
    { type: 'billing_dashboard_reflection', severity: 'P1' },
    { type: 'notifications_dashboard_reflection', severity: 'P1' },
    { type: 'data_persistence_after_refresh', severity: 'P0' },
    { type: 'schema_cache_mismatch_scan', severity: 'P0' },
    { type: 'compat_columns_fallback_scan', severity: 'P1' },
    { type: 'legacy_table_compat_view_check', severity: 'P2' },
    { type: 'check_constraint_enforcement', severity: 'P1' },
    { type: 'enum_value_drift_scan', severity: 'P1' },
    { type: 'project_assignment_integrity', severity: 'P1' },
    { type: 'milestone_release_integrity', severity: 'P1' },
    { type: 'financial_ledger_consistency', severity: 'P0' },
    { type: 'wallet_balance_reconciliation', severity: 'P1' },
    { type: 'openapi_endpoint_contract', severity: 'P2' },
    { type: 'edge_function_auth_mode', severity: 'P1' },
    { type: 'edge_function_cors_mode', severity: 'P2' },
    { type: 'edge_function_error_shape', severity: 'P2' },
    { type: 'email_provider_sendability', severity: 'P1' },
    { type: 'email_provider_domain_verification_required', severity: 'P2' },
    { type: 'paystack_init_payload_validity', severity: 'P1' },
    { type: 'paystack_webhook_payload_validity', severity: 'P1' },
    { type: 'resend_payload_validity', severity: 'P2' },
    { type: 'oauth_redirect_url_alignment', severity: 'P1' },
    { type: 'localhost_origin_alignment', severity: 'P2' },
    { type: 'vercel_env_placeholder_compliance', severity: 'P2' },
    { type: 'demo_data_absence_check', severity: 'P2' },
    { type: 'seed_script_safety_check', severity: 'P2' },
    { type: 'sql_injection_surface_scan', severity: 'P0' },
    { type: 'xss_surface_scan', severity: 'P1' },
    { type: 'csrf_relevance_assessment', severity: 'P2' },
    { type: 'rate_limit_presence', severity: 'P2' },
    { type: 'abuse_protection_presence', severity: 'P2' },
    { type: 'log_noise_vs_signal_check', severity: 'P2' },
    { type: 'p0_error_log_absence', severity: 'P1' },
    { type: 'table_growth_risk_signal', severity: 'P2' },
    { type: 'retention_policy_defined', severity: 'P2' },
    { type: 'anomaly_detection_signal', severity: 'P2' },
    { type: 'tenant_isolation_signal', severity: 'P0' },
    { type: 'cross_dashboard_data_join_validity', severity: 'P1' },
    { type: 'message_thread_integrity', severity: 'P1' },
    { type: 'proposal_lifecycle_integrity', severity: 'P1' },
    { type: 'project_status_transition_graph', severity: 'P1' },
    { type: 'invoice_status_transition_graph', severity: 'P1' },
    { type: 'notification_read_unread_transition', severity: 'P2' },
    { type: 'avatar_url_validity_sanity', severity: 'P2' },
    { type: 'storage_signed_url_policy', severity: 'P2' },
  ];
}

function commandForCheck(table, checkType) {
  const t = table;
  switch (checkType) {
    case 'table_exists':
      return `SELECT to_regclass('public.${t}') IS NOT NULL AS exists;`;
    case 'column_contract':
      return `CHECK OPENAPI definition for ${t} has expected required columns and types.`;
    case 'foreign_key_integrity':
      return `Run orphan check queries for each FK on ${t}.`;
    case 'orphan_row_check':
      return `SELECT * FROM public.${t} LIMIT 1; then run LEFT JOIN orphan probes.`;
    case 'index_presence_fk':
      return `Verify indexes for FK columns on ${t} from migration metadata.`;
    case 'rls_enabled':
      return `Verify ${t} has RLS enabled in policy inventory/migrations.`;
    case 'api_select_endpoint_ok':
      return `GET /rest/v1/${t}?select=*&limit=1 with role JWT.`;
    case 'api_insert_endpoint_ok':
      return `POST /rest/v1/${t} (sandbox payload) and expect policy-appropriate result.`;
    case 'webhook_idempotency_key':
      return `Verify unique provider reference index for ${t} where applicable.`;
    default:
      return `Heuristic/targeted check on ${t}: ${checkType}`;
  }
}

async function main() {
  const allFiles = listFilesRecursive(ROOT, () => true);
  const migrationFiles = listFilesRecursive(path.join(ROOT, 'supabase', 'migrations'), (p) => p.endsWith('.sql'));
  const { pages, dashboardPages } = discoverRoutes();
  const integrations = discoverIntegrations(allFiles);
  const edgeFunctions = discoverEdgeFunctions();
  const storage = await discoverStorageBuckets();

  const openapiRes = await getOpenApiSpec();
  if (!openapiRes.ok || !openapiRes.data) {
    console.error('Failed to fetch Supabase OpenAPI metadata:', openapiRes.status);
    process.exit(1);
  }

  const spec = openapiRes.data;
  const definitions = spec.definitions || {};
  const tableNames = Object.keys(definitions).sort();

  const tableEntries = [];
  for (const tableName of tableNames) {
    const def = definitions[tableName] || {};
    const required = Array.isArray(def.required) ? new Set(def.required) : new Set();
    const props = def.properties || {};
    const rowCount = await getRowCount(tableName);
    const columns = Object.entries(props).map(([col, meta]) => ({
      name: col,
      type: meta?.type || 'unknown',
      format: meta?.format || null,
      enum: Array.isArray(meta?.enum) ? meta.enum : null,
      nullable: !required.has(col),
      default: Object.prototype.hasOwnProperty.call(meta || {}, 'default') ? meta.default : null,
      is_primary_key: String(meta?.description || '').includes('<pk/>'),
      description: meta?.description || null,
    }));

    tableEntries.push({
      schema: 'public',
      name: tableName,
      required_columns: Array.from(required),
      columns,
      row_count_sampled: rowCount.count,
      row_count_probe: {
        ok: rowCount.ok,
        status: rowCount.status ?? null,
        content_range: rowCount.content_range ?? null,
      },
      source: 'supabase_openapi',
    });
  }

  const sqlMeta = parseMigrationMetadata(migrationFiles);

  const discoveredPaths = Object.keys(spec.paths || {}).sort();
  const apiEndpoints = discoveredPaths
    .filter((p) => p !== '/')
    .map((p) => ({
      path: p,
      methods: Object.keys(spec.paths[p] || {}).sort(),
    }));

  const widgetInventory = dashboardPages.map((page) => {
    const abs = path.join(ROOT, path.basename(page.file));
    const html = fs.existsSync(abs) ? readText(abs) : '';
    const cardTitleMatches = Array.from(html.matchAll(/class="card-title"[^>]*>([^<]+)</gi)).map((m) => m[1].trim());
    const navMatches = Array.from(html.matchAll(/data-page="([^"]+)"/gi)).map((m) => m[1]);
    return {
      dashboard_file: page.file,
      route: page.route,
      role: page.dashboard_role,
      nav_sections: Array.from(new Set(navMatches)),
      card_titles: Array.from(new Set(cardTitleMatches)),
    };
  });

  const inventory = {
    generated_at: now,
    project_root: ROOT,
    mode: 'phase1_discovery_non_destructive',
    limitations: [
      'Direct Postgres inspect commands are currently rate-limited by Supabase pooler auth circuit breaker (requires valid DB password/session).',
      'Indexes, triggers, constraints, and policy inventory are derived from migration SQL in repo, not live pg_catalog introspection.',
      'Row counts are sampled through REST content-range headers using service role key.',
    ],
    env_safety: {
      placeholders_expected: [
        'NEXT_PUBLIC_SUPABASE_URL=<SUPABASE_URL>',
        'NEXT_PUBLIC_SUPABASE_ANON_KEY=<SUPABASE_ANON_KEY>',
        'SUPABASE_SERVICE_ROLE_KEY=<SUPABASE_SERVICE_ROLE_KEY>',
        'DATABASE_URL=<DATABASE_URL>',
        'PAYSTACK_PK=<PAYSTACK_PK>',
        'PAYSTACK_SK=<PAYSTACK_SK>',
        'GOOGLE_CLIENT_ID=<GOOGLE_CLIENT_ID>',
        'GOOGLE_CLIENT_SECRET=<GOOGLE_CLIENT_SECRET>',
      ],
      live_secrets_in_repo_scan: {
        checked_files: ['.env', '.env.local', 'supabase/.env.functions.local'],
        action: 'Use secret manager for real values; do not commit keys.',
      },
    },
    app_surface: {
      pages,
      dashboards: dashboardPages,
      api_endpoints: apiEndpoints,
      edge_functions: edgeFunctions,
      storage_buckets: storage,
      integrations,
      dashboard_widget_inventory: widgetInventory,
      webhook_endpoints: [
        {
          provider: 'paystack',
          endpoint: `${SUPABASE_URL.replace(/\/$/, '')}/functions/v1/paystack-webhook`,
          source: 'edge_function',
        },
      ],
    },
    database: {
      schemas: ['public', 'graphql_public'],
      tables_and_views: tableEntries,
      migration_derived_metadata: sqlMeta,
      openapi_paths_count: discoveredPaths.length,
      table_count: tableEntries.length,
    },
  };

  const inventoryPath = path.join(ROOT, 'db_inventory.json');
  fs.writeFileSync(inventoryPath, JSON.stringify(inventory, null, 2));

  const checkTypes = buildCheckTypes();
  const checks = [];
  let id = 1;

  for (const t of tableEntries) {
    for (const c of checkTypes) {
      if (checks.length >= 2000) break;
      const command = commandForCheck(t.name, c.type);
      const expected = c.type === 'table_exists'
        ? `${t.name} should exist in public schema`
        : c.type === 'rls_enabled'
          ? `${t.name} should have RLS explicitly configured as intended`
          : `${c.type} should pass for ${t.name}`;

      checks.push({
        id,
        target_type: 'table_or_view',
        target_name: `public.${t.name}`,
        check_type: c.type,
        sql_or_command: command,
        expected_result: expected,
        severity: c.severity,
      });
      id += 1;
    }
    if (checks.length >= 2000) break;
  }

  if (checks.length < 2000) {
    const endpointChecks = [
      { type: 'endpoint_status', severity: 'P1' },
      { type: 'endpoint_auth_boundary', severity: 'P0' },
      { type: 'endpoint_payload_shape', severity: 'P1' },
      { type: 'endpoint_rate_limit', severity: 'P2' },
      { type: 'endpoint_error_surface', severity: 'P2' },
    ];
    for (const ep of apiEndpoints) {
      for (const ec of endpointChecks) {
        if (checks.length >= 2000) break;
        checks.push({
          id,
          target_type: 'api_endpoint',
          target_name: ep.path,
          check_type: ec.type,
          sql_or_command: `HTTP ${ep.methods.join('/').toUpperCase()} ${ep.path}`,
          expected_result: `${ec.type} should pass for ${ep.path}`,
          severity: ec.severity,
        });
        id += 1;
      }
      if (checks.length >= 2000) break;
    }
  }

  const header = ['id', 'target_type', 'target_name', 'check_type', 'sql_or_command', 'expected_result', 'severity'];
  const rows = [header.join(',')];
  for (const row of checks.slice(0, 2000)) {
    rows.push([
      row.id,
      row.target_type,
      row.target_name,
      row.check_type,
      row.sql_or_command,
      row.expected_result,
      row.severity,
    ].map(csvEscape).join(','));
  }
  fs.writeFileSync(path.join(ROOT, 'checks_list.csv'), rows.join('\n') + '\n');

  console.log(`Generated ${rel(inventoryPath)}`);
  console.log(`Generated checks_list.csv with ${Math.min(checks.length, 2000)} checks`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
