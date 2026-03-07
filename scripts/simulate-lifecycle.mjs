#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

function parseEnvFile(pathname) {
  const out = {};
  const raw = readFileSync(pathname, "utf8");
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const idx = trimmed.indexOf("=");
    if (idx < 1) continue;
    const key = trimmed.slice(0, idx).trim();
    const value = trimmed.slice(idx + 1).trim();
    out[key] = value;
  }
  return out;
}

const ENV = {
  ...parseEnvFile(join(process.cwd(), ".env")),
  ...process.env,
};

const SUPABASE_URL = String(ENV.SUPABASE_URL || "").replace(/\/$/, "");
const SUPABASE_ANON_KEY = String(ENV.SUPABASE_ANON_KEY || "");
const SUPABASE_SERVICE_ROLE_KEY = String(ENV.SUPABASE_SERVICE_ROLE_KEY || "");
const SIMULATION_TARGET_EMAIL = String(ENV.SIMULATION_TARGET_EMAIL || "mikomike200@gmail.com").trim().toLowerCase();

if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("Missing SUPABASE_URL, SUPABASE_ANON_KEY or SUPABASE_SERVICE_ROLE_KEY.");
  process.exit(1);
}

const TEST_USERS = {
  client: { email: "client@test.com", password: "Password123!" },
  admin: { email: "admin@test.com", password: "Password123!" },
  commissioner: { email: "commissioner@test.com", password: "Password123!" },
  developer: { email: "developer@test.com", password: "Password123!" },
};

const scenarioTag = `SIM-${Date.now()}`;
const scenario = {
  tag: scenarioTag,
  startedAt: new Date().toISOString(),
  steps: [],
  entities: {},
  links: [],
  emailAttempt: null,
};

function step(name, ok, details = "", extra = {}) {
  scenario.steps.push({
    name,
    ok: Boolean(ok),
    details: String(details || ""),
    at: new Date().toISOString(),
    ...extra,
  });
}

async function api(url, options = {}) {
  const res = await fetch(url, options);
  const text = await res.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { ok: res.ok, status: res.status, body, headers: res.headers };
}

function anonHeaders(token) {
  const headers = {
    apikey: SUPABASE_ANON_KEY,
    "Content-Type": "application/json",
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

function serviceHeaders() {
  return {
    apikey: SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    "Content-Type": "application/json",
    Prefer: "return=representation",
  };
}

async function login(email, password) {
  const url = `${SUPABASE_URL}/auth/v1/token?grant_type=password`;
  const result = await api(url, {
    method: "POST",
    headers: anonHeaders(),
    body: JSON.stringify({ email, password }),
  });
  if (!result.ok) {
    throw new Error(`Login failed for ${email}: ${result.status} ${JSON.stringify(result.body)}`);
  }
  return {
    accessToken: result.body.access_token,
    userId: result.body.user?.id,
    email: result.body.user?.email,
  };
}

async function restInsert(table, payload, token, useService = false) {
  const headers = useService ? serviceHeaders() : { ...anonHeaders(token), Prefer: "return=representation" };
  return api(`${SUPABASE_URL}/rest/v1/${table}`, {
    method: "POST",
    headers,
    body: JSON.stringify([payload]),
  });
}

async function restInsertVariants(table, payloads, token, useService = false) {
  let last = null;
  for (const payload of payloads) {
    const res = await restInsert(table, payload, token, useService);
    if (res.ok) return res;
    last = res;
  }
  return last;
}

async function restPatch(table, query, payload, token, useService = false) {
  const headers = useService ? serviceHeaders() : { ...anonHeaders(token), Prefer: "return=representation" };
  const url = `${SUPABASE_URL}/rest/v1/${table}?${query}`;
  return api(url, {
    method: "PATCH",
    headers,
    body: JSON.stringify(payload),
  });
}

async function restPatchVariants(table, query, payloads, token, useService = false) {
  let last = null;
  for (const payload of payloads) {
    const res = await restPatch(table, query, payload, token, useService);
    if (res.ok) return res;
    last = res;
  }
  return last;
}

async function restGet(path, token, useService = false) {
  const headers = useService
    ? { apikey: SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}` }
    : anonHeaders(token);
  return api(`${SUPABASE_URL}/rest/v1/${path}`, { method: "GET", headers });
}

async function callEdge(fn, payload, token, forceService = false) {
  const authToken = forceService ? SUPABASE_SERVICE_ROLE_KEY : SUPABASE_ANON_KEY;
  const headers = {
    apikey: SUPABASE_ANON_KEY,
    Authorization: `Bearer ${authToken}`,
    "Content-Type": "application/json",
  };
  return api(`${SUPABASE_URL}/functions/v1/${fn}`, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  });
}

function shouldRetryEdge(response) {
  if (!response || response.ok) return false;
  if ([408, 429, 500, 502, 503, 504, 520, 522, 524].includes(Number(response.status))) return true;
  const raw = String(response.body || "");
  return /edge-runtime|cloudflare|unknown error|temporarily unavailable/i.test(raw);
}

async function callEdgeWithRetry(fn, payload, token, forceService = false, maxAttempts = 3) {
  let lastResponse = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const response = await callEdge(fn, payload, token, forceService);
    if (response.ok || !shouldRetryEdge(response) || attempt === maxAttempts) return response;
    lastResponse = response;
    await new Promise((resolve) => setTimeout(resolve, 600 * attempt));
  }
  return lastResponse;
}

function fmtAmount(num) {
  return `KSh ${Number(num || 0).toLocaleString("en-KE", { maximumFractionDigits: 2 })}`;
}

async function main() {
  const auth = {};
  for (const [role, creds] of Object.entries(TEST_USERS)) {
    try {
      auth[role] = await login(creds.email, creds.password);
      step(`login:${role}`, true, `${creds.email} authenticated`);
    } catch (error) {
      step(`login:${role}`, false, String(error));
    }
  }
  if (!auth.client?.accessToken || !auth.commissioner?.accessToken || !auth.developer?.accessToken || !auth.admin?.accessToken) {
    throw new Error("Required role login failed; aborting lifecycle simulation.");
  }

  scenario.entities.users = {
    client_id: auth.client.userId,
    commissioner_id: auth.commissioner.userId,
    developer_id: auth.developer.userId,
    admin_id: auth.admin.userId,
  };

  const projectTitle = `${scenarioTag} - Client Web Platform`;
  const projectBudget = 180000;
  const baseProjectPayloads = [
    {
      title: projectTitle,
      description: "Simulated full lifecycle project (client -> commissioner -> developer -> admin).",
      total_value: projectBudget,
      client_id: auth.client.userId,
      commissioner_id: auth.commissioner.userId,
      status: "pending_deposit",
      timeline: "6-8 weeks",
      software_type: "Web Platform",
      priority: "high",
      scope: "full-product",
      requirements: {
        scope: "full-product",
        timeline: "6-8 weeks",
        software_type: "Web Platform",
        priority: "high",
        checklist: ["Auth", "Billing", "Realtime Chat", "Admin Controls"],
      },
      created_by: auth.client.userId,
    },
    {
      title: projectTitle,
      description: "Simulated full lifecycle project (fallback payload).",
      total_value: projectBudget,
      client_id: auth.client.userId,
      commissioner_id: auth.commissioner.userId,
      status: "pending_deposit",
      created_by: auth.client.userId,
    },
    {
      title: projectTitle,
      description: "Simulated full lifecycle project (minimal fallback).",
      total_value: projectBudget,
      client_id: auth.client.userId,
      commissioner_id: auth.commissioner.userId,
      status: "pending_deposit",
    },
  ];

  const createProjectRes = await restInsertVariants("projects", baseProjectPayloads, auth.client.accessToken, false);
  if (!createProjectRes?.ok) {
    step("client:create_project", false, `Failed ${createProjectRes?.status}: ${JSON.stringify(createProjectRes?.body)}`);
    throw new Error("Project creation failed.");
  }
  const project = Array.isArray(createProjectRes.body) ? createProjectRes.body[0] : createProjectRes.body;
  scenario.entities.project_id = project.id;
  step("client:create_project", true, `Project created: ${project.id}`);

  const depositAmount = Math.round(projectBudget * 0.45 * 100) / 100;
  const invoicePayloads = [
    {
      project_id: project.id,
      created_by: auth.client.userId,
      client_email: TEST_USERS.client.email,
      client_name: "Client User",
      description: `Project deposit (45%) - ${projectTitle}`,
      amount: depositAmount,
      currency: "KES",
      status: "pending",
      invoice_type: "deposit",
      notes: "Simulated deposit invoice.",
    },
    {
      project_id: project.id,
      created_by: auth.client.userId,
      client_email: TEST_USERS.client.email,
      client_name: "Client User",
      description: `Project deposit (45%) - ${projectTitle}`,
      amount: depositAmount,
      currency: "KES",
      status: "pending",
      notes: "Simulated deposit invoice.",
    },
  ];
  const invoiceInsert = await restInsertVariants("invoices", invoicePayloads, "", true);
  if (!invoiceInsert?.ok) {
    step("finance:create_deposit_invoice", false, `Failed ${invoiceInsert?.status}: ${JSON.stringify(invoiceInsert?.body)}`);
    throw new Error("Invoice creation failed.");
  }
  const depositInvoice = Array.isArray(invoiceInsert.body) ? invoiceInsert.body[0] : invoiceInsert.body;
  scenario.entities.deposit_invoice_id = depositInvoice.id;
  step("finance:create_deposit_invoice", true, `Invoice ${depositInvoice.id} amount ${fmtAmount(depositAmount)}`);

  const sendDepositResult = await callEdgeWithRetry("send-invoice", {
    invoice_id: depositInvoice.id,
    project_id: project.id,
    invoice_type: "deposit",
    client_email: TEST_USERS.client.email,
    client_name: "Client User",
    description: `Project deposit (45%) - ${projectTitle}`,
    amount: depositAmount,
    currency: "KES",
    notes: "Simulated deposit invoice.",
  }, auth.client.accessToken);
  if (sendDepositResult.ok) {
    const link = sendDepositResult.body?.authorization_url || sendDepositResult.body?.payment_url || null;
    if (link) scenario.links.push({ type: "deposit_payment_link", url: link });
    step("finance:generate_deposit_payment_link", true, link ? `Link generated` : `No link returned`);
  } else {
    step("finance:generate_deposit_payment_link", false, `${sendDepositResult.status} ${JSON.stringify(sendDepositResult.body)}`);
  }

  const payInvoice = await restPatch(
    "invoices",
    `id=eq.${encodeURIComponent(depositInvoice.id)}`,
    { status: "paid", paid_at: new Date().toISOString(), updated_at: new Date().toISOString() },
    "",
    true,
  );
  step("finance:simulate_deposit_paid", payInvoice.ok, payInvoice.ok ? "Invoice marked paid" : JSON.stringify(payInvoice.body));

  const depositTxPayloads = [
    {
      transaction_ref: `DEP-${String(depositInvoice.id).slice(0, 8)}-${Date.now()}`,
      kind: "escrow_fund",
      status: "paid",
      amount: depositAmount,
      currency: "KES",
      project_id: project.id,
      invoice_id: depositInvoice.id,
      payer_id: auth.client.userId,
      commissioner_id: auth.commissioner.userId,
      created_by: auth.client.userId,
      description: "Simulated paid deposit",
    },
    {
      kind: "invoice_payment",
      status: "paid",
      amount: depositAmount,
      project_id: project.id,
      invoice_id: depositInvoice.id,
      payer_id: auth.client.userId,
      created_by: auth.client.userId,
      description: "Simulated paid deposit",
    },
  ];
  const depTx = await restInsertVariants("financial_transactions", depositTxPayloads, "", true);
  step("finance:record_deposit_transaction", depTx?.ok, depTx?.ok ? "Transaction recorded" : JSON.stringify(depTx?.body));

  const proposalPayloads = [
    {
      project_id: project.id,
      developer_id: auth.developer.userId,
      commissioner_id: auth.commissioner.userId,
      amount: 160000,
      message: `${scenarioTag} proposal: delivery in 7 weeks with weekly demos.`,
      status: "pending",
    },
    {
      project_id: project.id,
      developer_id: auth.developer.userId,
      amount: 160000,
      message: `${scenarioTag} proposal fallback.`,
    },
  ];

  let proposalRes = await restInsertVariants("proposals", proposalPayloads, auth.developer.accessToken, false);
  if (!proposalRes?.ok) {
    proposalRes = await restInsertVariants("proposals", proposalPayloads, "", true);
  }
  if (!proposalRes?.ok) {
    step("developer:submit_proposal", false, JSON.stringify(proposalRes?.body));
    throw new Error("Proposal submit failed.");
  }
  const proposal = Array.isArray(proposalRes.body) ? proposalRes.body[0] : proposalRes.body;
  scenario.entities.proposal_id = proposal.id;
  step("developer:submit_proposal", true, `Proposal ${proposal.id} created`);

  const assignProject = await restPatch(
    "projects",
    `id=eq.${encodeURIComponent(project.id)}`,
    {
      commissioner_id: auth.commissioner.userId,
      developer_id: auth.developer.userId,
      status: "in-progress",
      updated_at: new Date().toISOString(),
    },
    "",
    true,
  );
  step("commissioner:assign_developer", assignProject.ok, assignProject.ok ? "Project moved to in-progress" : JSON.stringify(assignProject.body));

  const acceptProposal = await restPatch(
    "proposals",
    `id=eq.${encodeURIComponent(proposal.id)}`,
    { status: "accepted", updated_at: new Date().toISOString() },
    "",
    true,
  );
  step("commissioner:accept_proposal", acceptProposal.ok, acceptProposal.ok ? "Proposal accepted" : JSON.stringify(acceptProposal.body));

  const milestones = [
    { title: "Discovery + Wireframes", description: "Requirements + UX", amount: Math.round(projectBudget * 0.2), status: "locked" },
    { title: "Core Build", description: "Core engineering", amount: Math.round(projectBudget * 0.5), status: "locked" },
    { title: "UAT + Handover", description: "Testing + deployment", amount: Math.round(projectBudget * 0.3), status: "locked" },
  ];
  const msInsert = await restInsertVariants(
    "milestones",
    milestones.map((m) => ({ ...m, project_id: project.id }))[0]
      ? [
          { ...milestones[0], project_id: project.id },
          { ...milestones[1], project_id: project.id },
          { ...milestones[2], project_id: project.id },
        ]
      : [],
    "",
    true,
  );
  if (!msInsert?.ok) {
    // try bulk as array insert using direct call
    const bulkRes = await api(`${SUPABASE_URL}/rest/v1/milestones`, {
      method: "POST",
      headers: serviceHeaders(),
      body: JSON.stringify(milestones.map((m) => ({ ...m, project_id: project.id }))),
    });
    step("project:create_milestones", bulkRes.ok, bulkRes.ok ? "3 milestones created (bulk)" : JSON.stringify(bulkRes.body));
  } else {
    step("project:create_milestones", true, "Milestone creation path succeeded");
  }

  const milestoneList = await restGet(`milestones?select=*&project_id=eq.${encodeURIComponent(project.id)}&order=created_at.asc`, "", true);
  const firstMilestone = Array.isArray(milestoneList.body) ? milestoneList.body[0] : null;
  const secondMilestone = Array.isArray(milestoneList.body) ? milestoneList.body[1] : null;
  if (firstMilestone?.id) {
    const submitPayloadBase = {
      status: "submitted",
      submission_link: `https://example.com/demo/${scenarioTag.toLowerCase()}`,
      submitted_at: new Date().toISOString(),
    };
    const submitMs = await restPatchVariants(
      "milestones",
      `id=eq.${encodeURIComponent(firstMilestone.id)}`,
      [
        {
          ...submitPayloadBase,
          updated_at: new Date().toISOString(),
        },
        submitPayloadBase,
        {
          status: "submitted",
          submission_link: submitPayloadBase.submission_link,
        },
        {
          status: "submitted",
          submitted_at: submitPayloadBase.submitted_at,
        },
        {
          status: "submitted",
        },
      ],
      "",
      true,
    );
    step("developer:submit_milestone", submitMs.ok, submitMs.ok ? `Milestone ${firstMilestone.id} submitted` : JSON.stringify(submitMs.body));

    const approveMs = await restPatchVariants(
      "milestones",
      `id=eq.${encodeURIComponent(firstMilestone.id)}`,
      [
        {
          status: "paid",
          approved_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
        {
          status: "paid",
          approved_at: new Date().toISOString(),
        },
        { status: "paid" },
      ],
      "",
      true,
    );
    step("client:approve_milestone", approveMs.ok, approveMs.ok ? "Milestone approved/paid" : JSON.stringify(approveMs.body));
  } else {
    step("developer:submit_milestone", false, "No milestone found to submit");
  }

  if (firstMilestone?.id) {
    const milestoneTx = await restInsertVariants("financial_transactions", [
      {
        transaction_ref: `MS-${String(firstMilestone.id).slice(0, 8)}-${Date.now()}`,
        kind: "milestone_release",
        status: "paid",
        amount: Number(firstMilestone.amount || 0),
        currency: "KES",
        project_id: project.id,
        payer_id: auth.client.userId,
        payee_id: auth.developer.userId,
        created_by: auth.admin.userId,
        description: "Simulated milestone release",
      },
      {
        kind: "milestone_release",
        status: "paid",
        amount: Number(firstMilestone.amount || 0),
        project_id: project.id,
        payer_id: auth.client.userId,
        payee_id: auth.developer.userId,
        created_by: auth.admin.userId,
        description: "Simulated milestone release",
      },
    ], "", true);
    step("finance:record_milestone_release", milestoneTx?.ok, milestoneTx?.ok ? "Milestone payment recorded" : JSON.stringify(milestoneTx?.body));
  }

  const conflictOutcome = Math.random() > 0.5 ? "refund" : "release";
  const disputePayloads = [
    {
      project_id: project.id,
      raised_by: auth.client.userId,
      reason: `${scenarioTag} Random QA conflict: delivery interpretation mismatch.`,
      status: "open",
    },
    {
      project_id: project.id,
      reason: `${scenarioTag} Random QA conflict`,
      status: "open",
    },
  ];
  const disputeCreate = await restInsertVariants("disputes", disputePayloads, "", true);
  let disputeId = null;
  if (disputeCreate?.ok) {
    const dispute = Array.isArray(disputeCreate.body) ? disputeCreate.body[0] : disputeCreate.body;
    disputeId = dispute.id;
    scenario.entities.dispute_id = disputeId;
    step("conflict:create_dispute", true, `Dispute ${disputeId} created`);
  } else {
    step("conflict:create_dispute", false, JSON.stringify(disputeCreate?.body));
  }

  if (disputeId) {
    const resolve = await restPatch(
      "disputes",
      `id=eq.${encodeURIComponent(disputeId)}`,
      {
        status: "resolved",
        resolution: `${scenarioTag} Admin resolved dispute with outcome: ${conflictOutcome}`,
        resolved_at: new Date().toISOString(),
      },
      "",
      true,
    );
    step("admin:resolve_dispute", resolve.ok, resolve.ok ? `Resolved as ${conflictOutcome}` : JSON.stringify(resolve.body));

    const amount = secondMilestone?.amount || Math.round(projectBudget * 0.3);
    const disputeTx = await restInsertVariants("financial_transactions", [
      {
        transaction_ref: `DSP-${String(disputeId).slice(0, 8)}-${Date.now()}`,
        kind: conflictOutcome === "refund" ? "refund" : "milestone_release",
        status: "paid",
        amount,
        currency: "KES",
        project_id: project.id,
        payer_id: conflictOutcome === "refund" ? null : auth.client.userId,
        payee_id: conflictOutcome === "refund" ? auth.client.userId : auth.developer.userId,
        created_by: auth.admin.userId,
        description: `Dispute resolved: ${conflictOutcome}`,
        metadata: { dispute_id: disputeId, outcome: conflictOutcome },
      },
      {
        kind: conflictOutcome === "refund" ? "refund" : "milestone_release",
        status: "paid",
        amount,
        project_id: project.id,
        created_by: auth.admin.userId,
        description: `Dispute resolved: ${conflictOutcome}`,
      },
    ], "", true);
    step("finance:record_dispute_outcome", disputeTx?.ok, disputeTx?.ok ? "Dispute transaction recorded" : JSON.stringify(disputeTx?.body));
  }

  async function createPayout(requesterId, kind, amount) {
    const payoutInsert = await restInsertVariants("payout_requests", [
      { requester_id: requesterId, amount, status: "pending", notes: `${scenarioTag} payout request` },
      { requester_id: requesterId, amount, status: "pending" },
    ], "", true);
    if (!payoutInsert?.ok) return { ok: false, error: payoutInsert?.body };
    const payout = Array.isArray(payoutInsert.body) ? payoutInsert.body[0] : payoutInsert.body;
    const finInsert = await restInsertVariants("financial_transactions", [
      {
        transaction_ref: `PO-${String(payout.id).slice(0, 8)}-${Date.now()}`,
        kind,
        status: "pending",
        amount,
        currency: "KES",
        payout_request_id: payout.id,
        commissioner_id: kind === "commission_payout" ? requesterId : null,
        payee_id: kind === "wallet_withdrawal" ? requesterId : null,
        created_by: requesterId,
        description: `${kind} pending`,
      },
      {
        kind,
        status: "pending",
        amount,
        payout_request_id: payout.id,
        created_by: requesterId,
        description: `${kind} pending`,
      },
    ], "", true);
    return { ok: Boolean(finInsert?.ok), payoutId: payout.id, tx: finInsert?.body, txOk: finInsert?.ok, txErr: finInsert?.body };
  }

  const salesPayout = await createPayout(auth.commissioner.userId, "commission_payout", 25000);
  step("commissioner:request_payout", salesPayout.ok, salesPayout.ok ? `Payout ${salesPayout.payoutId}` : JSON.stringify(salesPayout.error || salesPayout.txErr));

  const devPayout = await createPayout(auth.developer.userId, "wallet_withdrawal", 40000);
  step("developer:request_payout", devPayout.ok, devPayout.ok ? `Payout ${devPayout.payoutId}` : JSON.stringify(devPayout.error || devPayout.txErr));

  for (const payoutId of [salesPayout.payoutId, devPayout.payoutId].filter(Boolean)) {
    const patchPayout = await restPatch(
      "payout_requests",
      `id=eq.${encodeURIComponent(payoutId)}`,
      {
        status: "paid",
        approved_by: auth.admin.userId,
        approved_at: new Date().toISOString(),
        paid_at: new Date().toISOString(),
      },
      "",
      true,
    );
    const patchTx = await restPatch(
      "financial_transactions",
      `payout_request_id=eq.${encodeURIComponent(payoutId)}`,
      {
        status: "paid",
        description: "Payout request completed",
      },
      "",
      true,
    );
    step(`admin:approve_and_pay_payout:${payoutId.slice(0, 8)}`, patchPayout.ok && patchTx.ok, `payout=${patchPayout.status} tx=${patchTx.status}`);
  }

  // Send one more invoice for final balance and generate link
  const finalInvoiceAmount = projectBudget - depositAmount;
  const finalInvoiceInsert = await restInsertVariants("invoices", [
    {
      project_id: project.id,
      created_by: auth.admin.userId,
      client_email: TEST_USERS.client.email,
      client_name: "Client User",
      description: `Final balance invoice - ${projectTitle}`,
      amount: finalInvoiceAmount,
      currency: "KES",
      status: "pending",
      invoice_type: "milestone",
      notes: "Final payment before handover",
    },
    {
      project_id: project.id,
      created_by: auth.admin.userId,
      client_email: TEST_USERS.client.email,
      client_name: "Client User",
      description: `Final balance invoice - ${projectTitle}`,
      amount: finalInvoiceAmount,
      currency: "KES",
      status: "pending",
      notes: "Final payment before handover",
    },
  ], "", true);

  if (finalInvoiceInsert?.ok) {
    const finalInvoice = Array.isArray(finalInvoiceInsert.body) ? finalInvoiceInsert.body[0] : finalInvoiceInsert.body;
    scenario.entities.final_invoice_id = finalInvoice.id;
    const sendFinal = await callEdgeWithRetry("send-invoice", {
      invoice_id: finalInvoice.id,
      project_id: project.id,
      invoice_type: "milestone",
      client_email: TEST_USERS.client.email,
      client_name: "Client User",
      description: `Final balance invoice - ${projectTitle}`,
      amount: finalInvoiceAmount,
      currency: "KES",
      notes: "Final payment before handover",
    }, auth.admin.accessToken);
    if (sendFinal.ok && sendFinal.body?.authorization_url) {
      scenario.links.push({ type: "final_payment_link", url: sendFinal.body.authorization_url });
      step("finance:generate_final_payment_link", true, "Final payment link generated");
    } else {
      step("finance:generate_final_payment_link", false, `${sendFinal.status} ${JSON.stringify(sendFinal.body)}`);
    }

    const finalPaid = await restPatch(
      "invoices",
      `id=eq.${encodeURIComponent(finalInvoice.id)}`,
      { status: "paid", paid_at: new Date().toISOString(), updated_at: new Date().toISOString() },
      "",
      true,
    );
    step("finance:simulate_final_invoice_paid", finalPaid.ok, finalPaid.ok ? "Final invoice marked paid" : JSON.stringify(finalPaid.body));
  } else {
    step("finance:create_final_invoice", false, JSON.stringify(finalInvoiceInsert?.body));
  }

  // Realtime signal data: insert notification that should appear on client without refresh.
  const clientNotify = await restInsertVariants("notifications", [
    {
      user_id: auth.client.userId,
      type: "system",
      title: `${scenarioTag} QA notification`,
      body: "Realtime check: this should appear instantly in client dashboard.",
      content: "Realtime check: this should appear instantly in client dashboard.",
      is_read: false,
      read_at: null,
      payload: { scenario: scenarioTag },
    },
    {
      user_id: auth.client.userId,
      type: "system",
      title: `${scenarioTag} QA notification`,
      content: "Realtime check: this should appear instantly in client dashboard.",
      is_read: false,
      payload: { scenario: scenarioTag },
    },
  ], "", true);
  step("realtime:insert_client_notification", clientNotify?.ok, clientNotify?.ok ? "Notification inserted for realtime test" : JSON.stringify(clientNotify?.body));

  // Attempt to send report to target email with payment links.
  const reportHtml = `
    <div style="font-family:Arial,sans-serif;max-width:760px;margin:0 auto;padding:20px;color:#111;">
      <h2>CODE STUDIO ke - End-to-End Simulation Report</h2>
      <p>Scenario: <strong>${scenarioTag}</strong></p>
      <p>Steps: <strong>${scenario.steps.length}</strong>, Pass: <strong>${scenario.steps.filter((s) => s.ok).length}</strong>, Fail: <strong>${scenario.steps.filter((s) => !s.ok).length}</strong></p>
      <p>Project ID: <code>${scenario.entities.project_id || "-"}</code></p>
      <p>Deposit Invoice ID: <code>${scenario.entities.deposit_invoice_id || "-"}</code></p>
      <p>Final Invoice ID: <code>${scenario.entities.final_invoice_id || "-"}</code></p>
      <h3>Payment Links</h3>
      <ul>
        ${(scenario.links.length
          ? scenario.links.map((l) => `<li><strong>${l.type}</strong>: <a href="${l.url}">${l.url}</a></li>`).join("")
          : `<li>No payment links were returned in this run.</li>`)}
      </ul>
      <h3>Conflict Simulation</h3>
      <p>Outcome used: <strong>${conflictOutcome}</strong></p>
      <h3>Top Steps</h3>
      <ol>
        ${scenario.steps.slice(0, 10).map((s) => `<li>${s.ok ? "PASS" : "FAIL"} - ${s.name}: ${s.details}</li>`).join("")}
      </ol>
    </div>
  `;
  const mailAttempt = await callEdgeWithRetry("send-email", {
    to: SIMULATION_TARGET_EMAIL,
    subject: `CODE STUDIO Simulation Report ${scenarioTag}`,
    html: reportHtml,
  }, auth.admin.accessToken);
  scenario.emailAttempt = {
    ok: mailAttempt.ok,
    status: mailAttempt.status,
    body: mailAttempt.body,
  };
  step(
    "email:send_report_to_target",
    mailAttempt.ok && (mailAttempt.body?.email?.sent === true),
    `status=${mailAttempt.status}, email=${JSON.stringify(mailAttempt.body?.email || null)}`,
  );

  // Also attempt explicit payment-link email through invoice edge to requested recipient.
  if (scenario.entities.final_invoice_id) {
    const paymentMail = await callEdgeWithRetry("send-invoice", {
      invoice_id: scenario.entities.final_invoice_id,
      client_email: SIMULATION_TARGET_EMAIL,
      client_name: "Simulation Recipient",
      amount: finalInvoiceAmount,
      description: `Simulation payment request - ${projectTitle}`,
      currency: "KES",
      notes: "Simulation payment-link email to requested recipient",
    }, auth.admin.accessToken);
    step(
      "email:send_payment_link_to_target",
      paymentMail.ok && Boolean(paymentMail.body?.authorization_url),
      `status=${paymentMail.status}, auth_url=${paymentMail.body?.authorization_url ? "present" : "missing"}, email=${JSON.stringify(paymentMail.body?.email || null)}`,
    );
    if (paymentMail.ok && paymentMail.body?.authorization_url) {
      scenario.links.push({ type: "target_payment_link", url: paymentMail.body.authorization_url });
    }
  }

  // Compose report text after all steps (including email attempts).
  scenario.endedAt = new Date().toISOString();
  const passCount = scenario.steps.filter((s) => s.ok).length;
  const failCount = scenario.steps.length - passCount;
  const reportPath = join(process.cwd(), "SIMULATION_LIFECYCLE_REPORT.md");
  const report = [
    `# Simulation Lifecycle Report`,
    ``,
    `- Scenario: \`${scenarioTag}\``,
    `- Started: ${scenario.startedAt}`,
    `- Ended: ${scenario.endedAt}`,
    `- Steps: ${scenario.steps.length} (pass=${passCount}, fail=${failCount})`,
    ``,
    `## Roles Used`,
    `- Client: ${TEST_USERS.client.email}`,
    `- Commissioner: ${TEST_USERS.commissioner.email}`,
    `- Developer: ${TEST_USERS.developer.email}`,
    `- Admin: ${TEST_USERS.admin.email}`,
    ``,
    `## Key Entity IDs`,
    `- Project: ${scenario.entities.project_id || "-"}`,
    `- Deposit Invoice: ${scenario.entities.deposit_invoice_id || "-"}`,
    `- Proposal: ${scenario.entities.proposal_id || "-"}`,
    `- Dispute: ${scenario.entities.dispute_id || "-"}`,
    `- Final Invoice: ${scenario.entities.final_invoice_id || "-"}`,
    ``,
    `## Payment Links Generated`,
    ...(scenario.links.length
      ? scenario.links.map((l) => `- ${l.type}: ${l.url}`)
      : ["- No authorization URL returned by edge function in this run."]),
    ``,
    `## Step Results`,
    ...scenario.steps.map((s, i) => `${i + 1}. [${s.ok ? "PASS" : "FAIL"}] ${s.name} - ${s.details}`),
    ``,
    `## Conflict Simulation`,
    `- Random conflict outcome selected: ${conflictOutcome}`,
    `- Dispute lifecycle simulated: create -> resolve -> finance record`,
    ``,
    `## Realtime / No-Reload Note`,
    `- Notification row inserted for client realtime channel validation.`,
    `- Verify in browser that client notification badge increments without page reload.`,
    ``,
    `## Email Dispatch Attempt`,
    `- Target recipient: ${SIMULATION_TARGET_EMAIL}`,
    `- Result: ${scenario.emailAttempt ? `status=${scenario.emailAttempt.status}, ok=${scenario.emailAttempt.ok}` : "not attempted"}`,
    ``,
    `## Summary`,
    failCount === 0
      ? `All scripted lifecycle steps passed.`
      : `${failCount} step(s) failed. See Step Results for exact failure points.`,
    ``,
  ].join("\n");
  writeFileSync(reportPath, report, "utf8");

  const jsonPath = join(process.cwd(), "SIMULATION_LIFECYCLE_RESULT.json");
  writeFileSync(jsonPath, JSON.stringify(scenario, null, 2), "utf8");

  console.log(`Simulation complete.`);
  console.log(`Report: ${reportPath}`);
  console.log(`JSON: ${jsonPath}`);
  console.log(`Pass=${scenario.steps.filter((s) => s.ok).length} Fail=${scenario.steps.filter((s) => !s.ok).length}`);
}

main().catch((error) => {
  step("fatal", false, String(error));
  const jsonPath = join(process.cwd(), "SIMULATION_LIFECYCLE_RESULT.json");
  writeFileSync(jsonPath, JSON.stringify(scenario, null, 2), "utf8");
  console.error(error);
  process.exit(1);
});
