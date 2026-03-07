import { corsHeaders, jsonResponse } from "../_shared/cors.ts";
import { getServiceClient } from "../_shared/supabase.ts";
import { verifyPaystackSignature } from "../_shared/paystack.ts";
import { sendEmail } from "../_shared/mailer.ts";

type AnyRecord = Record<string, unknown>;

function amountFromPaystackKobo(value: unknown): number {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return 0;
  return Math.round((amount / 100) * 100) / 100;
}

function formatMoney(amount: number, currency = "KES"): string {
  try {
    return new Intl.NumberFormat("en-KE", {
      style: "currency",
      currency: String(currency || "KES").toUpperCase(),
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    return `${Math.round(amount).toLocaleString()} ${String(currency || "KES").toUpperCase()}`;
  }
}

function renderPaymentSuccessHtml(input: {
  clientEmail: string;
  invoiceType: string;
  amount: number;
  currency: string;
  invoiceLabel: string;
  projectId: string | null;
  reference: string;
}) {
  const invoiceType = String(input.invoiceType || "standard").toLowerCase();
  const isDeposit = invoiceType === "deposit";
  const heading = isDeposit ? "Deposit Payment Confirmed" : "Payment Confirmed";
  const nextStep = isDeposit
    ? "Your project has been activated and the team can proceed with execution."
    : "Your payment has been recorded successfully and your project workflow continues.";

  return `
    <div style="font-family:Arial,sans-serif;max-width:620px;margin:0 auto;padding:22px;color:#111;line-height:1.5;">
      <h2 style="margin:0 0 14px;">${heading} • CODE STUDIO ke</h2>
      <p style="margin:0 0 12px;">Hi ${input.clientEmail},</p>
      <p style="margin:0 0 12px;">Great news. We have confirmed your payment.</p>
      <div style="border:1px solid #ddd;border-radius:8px;padding:14px;margin:0 0 14px;">
        <p style="margin:0 0 8px;"><strong>Invoice:</strong> ${input.invoiceLabel}</p>
        <p style="margin:0 0 8px;"><strong>Amount:</strong> ${formatMoney(input.amount, input.currency)}</p>
        <p style="margin:0 0 8px;"><strong>Reference:</strong> ${input.reference}</p>
        ${input.projectId ? `<p style="margin:0;color:#555;"><strong>Project ID:</strong> ${input.projectId}</p>` : ""}
      </div>
      <div style="margin:0 0 8px;padding:12px;border-radius:8px;background:#F4F7F5;border:1px solid #DCE7DF;color:#2A352D;">
        <p style="margin:0 0 6px;font-size:13px;"><strong>Next step</strong></p>
        <p style="margin:0;font-size:13px;">${nextStep}</p>
      </div>
      <p style="margin:16px 0 0;color:#666;font-size:13px;">You can view this update immediately in your client dashboard.</p>
    </div>
  `;
}

function isMissingTableError(error: unknown, tableName: string): boolean {
  const raw = String((error as { message?: string; details?: string; code?: string })?.message || "")
    + " "
    + String((error as { details?: string })?.details || "")
    + " "
    + String((error as { code?: string })?.code || "");
  const lowered = raw.toLowerCase();
  const table = tableName.toLowerCase();
  return lowered.includes("pgrst205")
    || lowered.includes("42p01")
    || (lowered.includes("schema cache") && lowered.includes(table))
    || (lowered.includes("does not exist") && lowered.includes(table));
}

function isMissingColumnError(error: unknown, columnName: string): boolean {
  const raw = String((error as { message?: string; details?: string; code?: string })?.message || "")
    + " "
    + String((error as { details?: string })?.details || "")
    + " "
    + String((error as { code?: string })?.code || "");
  const lowered = raw.toLowerCase();
  const column = columnName.toLowerCase();
  return lowered.includes("42703")
    || (lowered.includes("column") && lowered.includes("does not exist") && lowered.includes(column));
}

function normalizedStatus(value: unknown): string {
  return String(value || "").trim().toLowerCase();
}

function gatherReferenceCandidates(eventData: AnyRecord): string[] {
  const nestedRequest = (eventData.request || eventData.payment_request || eventData.invoice || {}) as AnyRecord;
  const candidates = [
    eventData.reference,
    eventData.request_code,
    nestedRequest.reference,
    nestedRequest.request_code,
    eventData.id,
  ]
    .map((value) => String(value || "").trim())
    .filter(Boolean);

  return Array.from(new Set(candidates));
}

function isSuccessWebhookEvent(eventType: string, eventData: AnyRecord): boolean {
  const type = eventType.toLowerCase();
  if (type === "charge.success" || type === "paymentrequest.success") return true;
  if (type === "invoice.update") {
    const status = normalizedStatus(eventData.status || (eventData.invoice as AnyRecord | undefined)?.status);
    return ["paid", "success", "completed", "settled"].includes(status);
  }
  return false;
}

function isFailedWebhookEvent(eventType: string, eventData: AnyRecord): boolean {
  const type = eventType.toLowerCase();
  if (type === "charge.failed" || type === "paymentrequest.failed") return true;
  if (type === "invoice.update") {
    const status = normalizedStatus(eventData.status || (eventData.invoice as AnyRecord | undefined)?.status);
    return ["failed", "abandoned", "expired", "cancelled"].includes(status);
  }
  return false;
}

async function updateWebhookEvent(
  supabase: ReturnType<typeof getServiceClient>,
  eventId: string | null,
  patch: AnyRecord,
) {
  if (!eventId) return;
  await supabase
    .from("payment_webhook_events")
    .update({ ...patch, processed_at: new Date().toISOString() })
    .eq("id", eventId);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  const rawBody = await req.text();
  const signature = req.headers.get("x-paystack-signature");

  try {
    const isValid = await verifyPaystackSignature(rawBody, signature);
    if (!isValid) {
      return jsonResponse({ error: "Invalid Paystack signature" }, 401);
    }
  } catch (error) {
    return jsonResponse({ error: String(error) }, 500);
  }

  let event: AnyRecord;
  try {
    event = JSON.parse(rawBody);
  } catch {
    return jsonResponse({ error: "Invalid JSON payload" }, 400);
  }

  const eventType = String(event.event || "unknown");
  const eventData = (event.data || {}) as AnyRecord;
  const referenceCandidates = gatherReferenceCandidates(eventData);
  const primaryReference = referenceCandidates[0] || "";

  const supabase = getServiceClient();

  let eventLogId: string | null = null;
  try {
    const { data: logRow } = await supabase
      .from("payment_webhook_events")
      .insert({
        provider: "paystack",
        event_type: eventType,
        reference: primaryReference || null,
        status: "received",
        payload: event,
      })
      .select("id")
      .single();

    eventLogId = logRow?.id || null;
  } catch {
    // Continue even if webhook log table is missing.
  }

  try {
    if (!referenceCandidates.length) {
      await updateWebhookEvent(supabase, eventLogId, {
        status: "ignored",
        error: "Missing Paystack transaction/payment-request reference",
      });
      return jsonResponse({ ok: true, ignored: true }, 200);
    }

    const normalizedEventType = eventType.toLowerCase();

    const { data: invoices } = await supabase
      .from("invoices")
      .select("id, amount, currency, status, project_id, client_id, client_email, created_by, invoice_type, paystack_reference, description, due_date")
      .in("paystack_reference", referenceCandidates)
      .limit(1);
    const invoice = Array.isArray(invoices) ? invoices[0] : null;
    const matchedReference = String((invoice as { paystack_reference?: string })?.paystack_reference || primaryReference);

    if (invoice?.id) {
      let resolvedClientId = invoice.client_id ? String(invoice.client_id) : null;
      if (!resolvedClientId && invoice.client_email) {
        const { data: clientProfile } = await supabase
          .from("profiles")
          .select("id")
          .eq("email", invoice.client_email)
          .maybeSingle();
        resolvedClientId = clientProfile?.id || null;
      }
      const resolvedPayeeId = (
        invoice.created_by
        && resolvedClientId
        && String(invoice.created_by) !== String(resolvedClientId)
      )
        ? String(invoice.created_by)
        : null;
      const invoiceType = String((invoice as { invoice_type?: string }).invoice_type || "standard").toLowerCase();
      if (isSuccessWebhookEvent(normalizedEventType, eventData)) {
        const gatewayAmount = amountFromPaystackKobo(eventData.amount);
        const settledAmount = gatewayAmount > 0
          ? gatewayAmount
          : Number(invoice.amount || 0);
        const settledCurrency = String(eventData.currency || invoice.currency || "KES").toUpperCase();
        await supabase
          .from("invoices")
          .update({
            status: "paid",
            amount: settledAmount,
            currency: settledCurrency,
            paid_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq("id", invoice.id);

        const updatePrimaryLedger = await supabase
          .from("financial_transactions")
          .update({
            status: "paid",
            payer_id: resolvedClientId,
            payee_id: resolvedPayeeId,
            metadata: {
              paystack_reference: matchedReference,
              event_type: normalizedEventType,
              gateway_amount: settledAmount,
              gateway_currency: settledCurrency,
              payer_user_id: resolvedClientId,
              payee_user_id: resolvedPayeeId,
              payer_email: invoice.client_email || null,
            },
          })
          .eq("invoice_id", invoice.id)
          .in("kind", ["invoice", "escrow_fund", "wallet_topup"]);
        if (updatePrimaryLedger.error && isMissingTableError(updatePrimaryLedger.error, "financial_transactions")) {
          await supabase
            .from("escrow_transactions")
            .update({
              status: "paid",
              metadata: {
                paystack_reference: matchedReference,
                event_type: normalizedEventType,
                gateway_amount: settledAmount,
                gateway_currency: settledCurrency,
              },
            })
            .eq("invoice_id", invoice.id)
            .eq("type", "invoice");
        }

        const paymentInsert = await supabase
          .from("financial_transactions")
          .upsert({
            transaction_ref: `INV-PAY-${String(invoice.id).slice(0, 8)}`,
            kind: invoiceType === "deposit"
              ? "escrow_fund"
              : (invoiceType === "topup" ? "wallet_topup" : "invoice_payment"),
            status: "paid",
            amount: settledAmount,
            currency: settledCurrency,
            project_id: invoice.project_id || null,
            invoice_id: invoice.id,
            payer_id: resolvedClientId,
            payee_id: resolvedPayeeId,
            created_by: invoice.created_by || resolvedClientId || null,
            metadata: {
              paystack_reference: matchedReference,
              event_type: normalizedEventType,
              gateway_payload: eventData,
              gateway_amount: settledAmount,
              gateway_currency: settledCurrency,
              payer_user_id: resolvedClientId,
              payee_user_id: resolvedPayeeId,
              payer_email: invoice.client_email || null,
            },
          }, { onConflict: "transaction_ref" });
        if (paymentInsert.error && isMissingTableError(paymentInsert.error, "financial_transactions")) {
          await supabase
            .from("escrow_transactions")
            .insert({
              type: invoiceType === "deposit"
                ? "escrow_fund"
                : (invoiceType === "topup" ? "wallet_topup" : "invoice_payment"),
              status: "paid",
              amount: settledAmount,
              project_id: invoice.project_id || null,
              invoice_id: invoice.id,
              metadata: {
                paystack_reference: matchedReference,
                event_type: normalizedEventType,
                gateway_payload: eventData,
                gateway_amount: settledAmount,
                gateway_currency: settledCurrency,
                payer_user_id: resolvedClientId,
                payee_user_id: resolvedPayeeId,
                payer_email: invoice.client_email || null,
              },
            });
        }

        if (invoiceType === "deposit" && invoice.project_id) {
          const { data: projectRow } = await supabase
            .from("projects")
            .select("id, escrow_balance, status")
            .eq("id", invoice.project_id)
            .maybeSingle();
          if (projectRow?.id) {
            const currentEscrow = Number((projectRow as { escrow_balance?: number }).escrow_balance || 0);
            const depositAmount = settledAmount;
            const currentStatus = String((projectRow as { status?: string }).status || "").toLowerCase();
            const nextStatus = currentStatus === "pending_deposit" ? "open" : (projectRow as { status?: string }).status;
            await supabase
              .from("projects")
              .update({
                escrow_balance: Math.round((currentEscrow + depositAmount) * 100) / 100,
                status: nextStatus || "open",
                updated_at: new Date().toISOString(),
              })
              .eq("id", invoice.project_id);
          }
        }

        let clientProfileId: string | null = null;
        if (invoice.client_email) {
          const { data: clientProfile } = await supabase
            .from("profiles")
            .select("id")
            .eq("email", invoice.client_email)
            .maybeSingle();
          if (clientProfile?.id) clientProfileId = clientProfile.id;
        }

        if (clientProfileId) {
          const statusLabel = "paid";
          const successSummary = invoiceType === "deposit"
            ? `Deposit received: ${formatMoney(settledAmount, settledCurrency)}.`
            : `Payment confirmed: ${formatMoney(settledAmount, settledCurrency)}.`;
          const notification = await supabase.from("notifications").insert({
            user_id: clientProfileId,
            type: "invoice_paid",
            title: "Payment confirmed",
            body: `${successSummary} Your project workflow continues.`,
            payload: {
              invoice_id: invoice.id,
              reference: matchedReference,
              invoice_type: invoiceType,
              project_id: invoice.project_id || null,
              amount: settledAmount,
              currency: settledCurrency,
              status: statusLabel,
              description: invoice.description || null,
              due_date: invoice.due_date || null,
            },
          });
          if (notification.error && (isMissingColumnError(notification.error, "body") || isMissingColumnError(notification.error, "payload"))) {
            await supabase.from("notifications").insert({
              user_id: clientProfileId,
              type: "invoice_paid",
              title: "Payment confirmed",
              content: `${successSummary} Your project workflow continues.`,
              is_read: false,
            });
          }
        }

        if (invoice.client_email) {
          try {
            await sendEmail({
              to: invoice.client_email,
              subject: invoiceType === "deposit"
                ? "Deposit confirmed - project now active"
                : "Payment confirmed - CODE STUDIO ke",
              html: renderPaymentSuccessHtml({
                clientEmail: invoice.client_email,
                invoiceType,
                amount: settledAmount,
                currency: settledCurrency,
                invoiceLabel: `INV-${String(invoice.id).slice(0, 8).toUpperCase()}`,
                projectId: invoice.project_id || null,
                reference: matchedReference,
              }),
            });
          } catch (_emailErr) {
            // Payment should still be marked successful even if confirmation email fails.
          }
        }

        await updateWebhookEvent(supabase, eventLogId, { status: "processed", error: null });
        return jsonResponse({ ok: true, type: "invoice", id: invoice.id }, 200);
      }

      if (isFailedWebhookEvent(normalizedEventType, eventData)) {
        const gatewayAmount = amountFromPaystackKobo(eventData.amount);
        const failedAmount = gatewayAmount > 0
          ? gatewayAmount
          : Number(invoice.amount || 0);
        const failedCurrency = String(eventData.currency || invoice.currency || "KES").toUpperCase();
        await supabase
          .from("invoices")
          .update({
            status: "failed",
            amount: failedAmount,
            currency: failedCurrency,
            updated_at: new Date().toISOString(),
          })
          .eq("id", invoice.id);

        const failedPrimaryLedger = await supabase
          .from("financial_transactions")
          .update({
            status: "failed",
            payer_id: resolvedClientId,
            payee_id: resolvedPayeeId,
            metadata: {
              paystack_reference: matchedReference,
              event_type: normalizedEventType,
              gateway_amount: failedAmount,
              gateway_currency: failedCurrency,
              payer_user_id: resolvedClientId,
              payee_user_id: resolvedPayeeId,
              payer_email: invoice.client_email || null,
            },
          })
          .eq("invoice_id", invoice.id)
          .in("kind", ["invoice", "escrow_fund", "wallet_topup"]);
        if (failedPrimaryLedger.error && isMissingTableError(failedPrimaryLedger.error, "financial_transactions")) {
          await supabase
            .from("escrow_transactions")
            .update({
              status: "failed",
              metadata: {
                paystack_reference: matchedReference,
                event_type: normalizedEventType,
                gateway_amount: failedAmount,
                gateway_currency: failedCurrency,
              },
            })
            .eq("invoice_id", invoice.id)
            .eq("type", "invoice");
        }

        await updateWebhookEvent(supabase, eventLogId, { status: "processed", error: null });
        return jsonResponse({ ok: true, type: "invoice", id: invoice.id }, 200);
      }
    }

    await updateWebhookEvent(supabase, eventLogId, {
      status: "ignored",
      error: `No invoice found for references: ${referenceCandidates.join(", ")}`,
    });

    return jsonResponse({ ok: true, ignored: true }, 200);
  } catch (error) {
    await updateWebhookEvent(supabase, eventLogId, {
      status: "failed",
      error: String(error),
    });
    return jsonResponse({ error: String(error) }, 500);
  }
});
