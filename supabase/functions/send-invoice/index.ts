import { corsHeaders, jsonResponse } from "../_shared/cors.ts";
import { getServiceClient } from "../_shared/supabase.ts";
import {
  createPaystackPaymentRequest,
  ensurePaystackCustomer,
  initializePaystackTransaction,
} from "../_shared/paystack.ts";
import { sendEmail } from "../_shared/mailer.ts";

function asNumber(value: unknown, fallback = 0): number {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function formatKsh(amount: number): string {
  try {
    return new Intl.NumberFormat("en-KE", {
      style: "currency",
      currency: "KES",
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    return `KSh ${Math.round(amount).toLocaleString("en-US")}`;
  }
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

function extractMissingColumnName(error: unknown): string | null {
  const raw = String((error as { message?: string; details?: string; code?: string })?.message || "")
    + " "
    + String((error as { details?: string })?.details || "")
    + " "
    + String((error as { code?: string })?.code || "");
  const lowered = raw.toLowerCase();
  if (!lowered.includes("42703") && !(lowered.includes("column") && lowered.includes("does not exist"))) {
    return null;
  }
  const match = raw.match(/column\s+["']?([a-zA-Z0-9_]+)["']?\s+does not exist/i);
  return match?.[1] || null;
}

function truthyEnv(name: string, fallback = false): boolean {
  const raw = String(Deno.env.get(name) ?? String(fallback)).trim().toLowerCase();
  if (!raw) return fallback;
  return !["0", "false", "no", "off"].includes(raw);
}

function isoDateOnly(value: unknown): string | null {
  const raw = String(value || "").trim();
  if (!raw) return null;
  const date = new Date(raw);
  if (!Number.isFinite(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
}

function normalizedRedirectUrl(value: unknown): string | null {
  const raw = String(value || "").trim();
  if (!raw) return null;
  try {
    const parsed = new URL(raw);
    if (!["http:", "https:"].includes(parsed.protocol)) return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

function renderInvoiceHtml(input: {
  clientName: string;
  description: string;
  amount: number;
  dueDate: string | null;
  notes: string | null;
  paymentUrl: string | null;
  senderName: string;
  invoiceType: string;
  invoiceNumber: string;
}) {
  const invoiceType = String(input.invoiceType || "standard").toLowerCase();
  const isDeposit = invoiceType === "deposit";
  const title = isDeposit ? "Project Deposit Request" : "Invoice Payment Request";
  const intro = isDeposit
    ? "This deposit secures your project and lets our team start work immediately after confirmation."
    : "Please complete payment using the secure link below.";
  const dueLine = input.dueDate
    ? `<p style="margin:0 0 10px;color:#555;">Due date: <strong>${input.dueDate}</strong></p>`
    : "";
  const notesBlock = input.notes
    ? `<p style="margin:10px 0 0;color:#555;">Notes: ${input.notes}</p>`
    : "";

  const cta = input.paymentUrl
    ? `<p style="margin:16px 0;"><a href="${input.paymentUrl}" style="display:inline-block;background:#111;color:#fff;padding:10px 16px;border-radius:6px;text-decoration:none;font-weight:600;">Pay Securely via Paystack</a></p>`
    : `<p style="margin:16px 0;color:#555;">Payment link is being prepared. You will receive an update shortly.</p>`;

  return `
    <div style="font-family:Arial,sans-serif;max-width:620px;margin:0 auto;padding:22px;color:#111;line-height:1.5;">
      <h2 style="margin:0 0 14px;">${title} • CODE STUDIO ke</h2>
      <p style="margin:0 0 10px;">Hi ${input.clientName},</p>
      <p style="margin:0 0 12px;">${intro}</p>
      <div style="border:1px solid #ddd;border-radius:8px;padding:14px;margin:0 0 14px;">
        <p style="margin:0 0 8px;"><strong>${input.description}</strong></p>
        <p style="margin:0 0 8px;color:#555;">Invoice: <strong>${input.invoiceNumber}</strong></p>
        <p style="margin:0 0 8px;color:#555;">Amount: <strong>${formatKsh(input.amount)}</strong></p>
        ${dueLine}
        ${notesBlock}
      </div>
      ${cta}
      <div style="margin:0 0 8px;padding:12px;border-radius:8px;background:#F4F7F5;border:1px solid #DCE7DF;color:#2A352D;">
        <p style="margin:0 0 6px;font-size:13px;"><strong>What happens after payment?</strong></p>
        <p style="margin:0;font-size:13px;">Your client dashboard updates automatically to <strong>Paid</strong>, and your project workflow continues without manual refresh.</p>
      </div>
      <p style="margin:16px 0 0;color:#666;font-size:13px;">Sent by ${input.senderName}</p>
    </div>
  `;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  try {
    const payload = await req.json().catch(() => ({}));
    const invoiceId = String(payload.invoice_id || "").trim();
    if (!invoiceId) {
      return jsonResponse({ error: "invoice_id is required" }, 400);
    }

    const supabase = getServiceClient();
    const { data: invoice, error: invoiceError } = await supabase
      .from("invoices")
      .select("*")
      .eq("id", invoiceId)
      .maybeSingle();

    if (invoiceError || !invoice) {
      return jsonResponse({ error: invoiceError?.message || "Invoice not found" }, 404);
    }

    const clientEmail = String(payload.client_email || invoice.client_email || "").trim();
    const clientName = String(payload.client_name || invoice.client_name || "Client").trim();
    const description = String(payload.description || invoice.description || "Invoice").trim();
    const senderName = String(payload.sender_name || "CODE STUDIO ke Team").trim();
    const currency = String(payload.currency || invoice.currency || "KES").toUpperCase();
    const amount = asNumber(payload.amount ?? invoice.amount, 0);
    const invoiceType = String(payload.invoice_type || invoice.invoice_type || "standard").toLowerCase();
    const dueDate = payload.due_date || invoice.due_date || null;
    const notes = payload.notes || invoice.notes || null;
    const redirectUrl = normalizedRedirectUrl(payload.redirect_url)
      || normalizedRedirectUrl(Deno.env.get("PAYSTACK_INVOICE_REDIRECT_URL"));

    if (!clientEmail) {
      return jsonResponse({ error: "client_email is required" }, 400);
    }
    if (amount <= 0) {
      return jsonResponse({ error: "Invoice amount must be greater than 0" }, 400);
    }

    let paystackReference = invoice.paystack_reference || null;
    let authorizationUrl = invoice.paystack_authorization_url || null;
    let paymentError: string | null = null;
    let paystackNotificationTriggered = false;
    const forceNewPaymentRequest = payload?.force_new_request === true
      || ["1", "true", "yes", "on"].includes(String(payload?.force_new_request || "").trim().toLowerCase());
    const requestedEmailChanged = String(invoice.client_email || "").trim().toLowerCase() !== clientEmail.toLowerCase();

    if (!authorizationUrl || forceNewPaymentRequest || requestedEmailChanged) {
      try {
        const usePaymentRequest = truthyEnv("PAYSTACK_USE_PAYMENT_REQUEST", true) && !redirectUrl;
        if (usePaymentRequest) {
          const customer = await ensurePaystackCustomer({
            email: clientEmail,
            fullName: clientName,
            metadata: {
              source: "send-invoice",
              invoice_id: invoiceId,
            },
          });

          const paymentRequest = await createPaystackPaymentRequest({
            customerCode: customer.customerCode,
            amountKsh: amount,
            currency,
            description,
            dueDate: isoDateOnly(dueDate),
            metadata: {
              kind: "invoice",
              invoice_id: invoiceId,
              project_id: payload.project_id || invoice.project_id || null,
              customer_email: clientEmail,
              redirect_url: redirectUrl,
            },
            sendNotification: true,
          });

          const unifiedReference = paymentRequest.requestCode
            || `invreq_${invoiceId.replace(/-/g, "")}_${Date.now()}`;
          paystackReference = unifiedReference;
          authorizationUrl = paymentRequest.invoiceUrl;
          paystackNotificationTriggered = true;

          // Paystack may not return a hosted URL for payment requests on some integrations.
          // Generate a direct checkout URL using the same reference so webhook correlation remains consistent.
          if (!authorizationUrl) {
            const initialized = await initializePaystackTransaction({
              email: clientEmail,
              amountKsh: amount,
              currency,
              reference: unifiedReference,
              metadata: {
                kind: "invoice",
                invoice_id: invoiceId,
                project_id: payload.project_id || invoice.project_id || null,
                paystack_request_code: unifiedReference,
                redirect_url: redirectUrl,
              },
              callbackUrl: redirectUrl,
            });
            authorizationUrl = initialized.authorizationUrl;
            paystackReference = initialized.reference || unifiedReference;
          }
        } else {
          const reference = paystackReference && invoice.paystack_authorization_url
            ? String(paystackReference)
            : `inv_${invoiceId.replace(/-/g, "")}_${Date.now()}`;

          const initialized = await initializePaystackTransaction({
            email: clientEmail,
            amountKsh: amount,
            currency,
            reference,
            metadata: {
              kind: "invoice",
              invoice_id: invoiceId,
              project_id: payload.project_id || invoice.project_id || null,
              redirect_url: redirectUrl,
            },
            callbackUrl: redirectUrl,
          });

          paystackReference = initialized.reference;
          authorizationUrl = initialized.authorizationUrl;
        }
      } catch (error) {
        paymentError = String(error);
      }
    }

    let resolvedClientId: string | null = null;
    let resolvedClientEmail: string | null = null;
    const { data: clientProfile } = await supabase
      .from("profiles")
      .select("id, email")
      .eq("email", clientEmail)
      .maybeSingle();
    if (clientProfile?.id) {
      resolvedClientId = clientProfile.id;
      resolvedClientEmail = String(clientProfile.email || clientEmail || "").trim() || null;
    }

    const resolvedPayerId = resolvedClientId || (invoice.client_id ? String(invoice.client_id) : null);
    const resolvedCreatorId = payload.created_by || invoice.created_by || null;
    const resolvedPayeeId = (
      resolvedCreatorId
      && resolvedPayerId
      && String(resolvedCreatorId) !== String(resolvedPayerId)
    )
      ? String(resolvedCreatorId)
      : null;

    const updatePayload: Record<string, unknown> = {
      client_email: clientEmail,
      client_name: clientName,
      description,
      amount,
      currency,
      due_date: dueDate,
      notes,
      invoice_type: invoiceType,
      status: authorizationUrl ? "sent" : (invoice.status || "pending"),
      updated_at: new Date().toISOString(),
    };

    if (payload.project_id || invoice.project_id) {
      updatePayload.project_id = payload.project_id || invoice.project_id;
    }
    if (resolvedPayerId) {
      updatePayload.client_id = resolvedPayerId;
    }
    if (payload.created_by || invoice.created_by) {
      updatePayload.created_by = payload.created_by || invoice.created_by;
    }
    if (paystackReference) updatePayload.paystack_reference = paystackReference;
    if (authorizationUrl) updatePayload.paystack_authorization_url = authorizationUrl;

    let { data: updatedInvoice, error: updateError } = await supabase
      .from("invoices")
      .update(updatePayload)
      .eq("id", invoiceId)
      .select("*")
      .single();

    if (updateError && (isMissingColumnError(updateError, "client_id") || isMissingColumnError(updateError, "invoice_type"))) {
      const retryPayload = { ...updatePayload };
      delete retryPayload.client_id;
      delete retryPayload.invoice_type;
      const retryResult = await supabase
        .from("invoices")
        .update(retryPayload)
        .eq("id", invoiceId)
        .select("*")
        .single();
      updatedInvoice = retryResult.data;
      updateError = retryResult.error;
    }

    if (updateError) {
      return jsonResponse({ error: updateError.message }, 500);
    }

    const ledgerMeta = {
      paystack_reference: updatedInvoice.paystack_reference || null,
      paystack_authorization_url: updatedInvoice.paystack_authorization_url || null,
      paystack_notification_triggered: paystackNotificationTriggered,
      invoice_id: updatedInvoice.id,
      client_email: clientEmail,
      redirect_url: redirectUrl,
    };

    const ledgerTransactionRef = `INV-${String(updatedInvoice.id).slice(0, 8)}`;
    const financialInsert = await supabase.from("financial_transactions").upsert({
      transaction_ref: ledgerTransactionRef,
      kind: invoiceType === "deposit" ? "escrow_fund" : "invoice",
      status: "pending",
      amount,
      currency,
      invoice_id: updatedInvoice.id,
      project_id: updatedInvoice.project_id || null,
      payer_id: resolvedPayerId,
      payee_id: resolvedPayeeId,
      created_by: updatedInvoice.created_by || resolvedPayerId || null,
      description: `Invoice sent to ${clientEmail}`,
      metadata: {
        ...ledgerMeta,
        payer_user_id: resolvedPayerId,
        payer_email: resolvedClientEmail || clientEmail || null,
        payee_user_id: resolvedPayeeId,
      },
    }, { onConflict: "transaction_ref" });

    if (financialInsert.error && isMissingTableError(financialInsert.error, "financial_transactions")) {
      await supabase.from("escrow_transactions").insert({
        type: "invoice",
        status: "pending",
        amount,
        project_id: updatedInvoice.project_id || null,
        invoice_id: updatedInvoice.id,
        metadata: {
          ...ledgerMeta,
          payer_user_id: resolvedPayerId,
          payer_email: resolvedClientEmail || clientEmail || null,
          payee_user_id: resolvedPayeeId,
        },
      });
    }

    const html = renderInvoiceHtml({
      clientName,
      description,
      amount,
      dueDate,
      notes,
      paymentUrl: authorizationUrl,
      senderName,
      invoiceType,
      invoiceNumber: String(updatedInvoice.invoice_number || `INV-${String(updatedInvoice.id).slice(0, 8).toUpperCase()}`),
    });

    let emailResult: Record<string, unknown> = { sent: false, skipped: true };
    if (paystackNotificationTriggered) {
      emailResult = {
        sent: true,
        skipped: false,
        provider: "paystack",
        note: "Payment request notification sent by Paystack",
      };
    } else {
      try {
        emailResult = await sendEmail({
          to: clientEmail,
          subject: invoiceType === "deposit"
            ? `Deposit payment request - ${description}`
            : `Invoice payment request - ${description}`,
          html,
        });
      } catch (error) {
        emailResult = { sent: false, skipped: false, error: String(error) };
      }
    }

    if (resolvedClientId) {
      const notificationText = `${description} - ${formatKsh(amount)}`;
      const notificationPayload: Record<string, unknown> = {
        user_id: resolvedClientId,
        type: invoiceType === "deposit" ? "deposit_invoice" : "invoice",
        title: invoiceType === "deposit" ? "Deposit invoice available" : "New invoice available",
        body: notificationText,
        content: notificationText,
        payload: {
          invoice_id: updatedInvoice.id,
          invoice_type: invoiceType,
          description,
          amount,
          currency,
          due_date: dueDate,
          reference: updatedInvoice.paystack_reference || null,
          status: updatedInvoice.status,
          paystack_authorization_url: updatedInvoice.paystack_authorization_url || null,
          redirect_url: redirectUrl,
          paystack_notification_triggered: paystackNotificationTriggered,
        },
        is_read: false,
        read_at: null,
      };

      for (let i = 0; i < 8; i += 1) {
        const notificationInsert = await supabase.from("notifications").insert(notificationPayload);
        if (!notificationInsert.error) break;

        const missingColumn = extractMissingColumnName(notificationInsert.error);
        if (!missingColumn || !Object.prototype.hasOwnProperty.call(notificationPayload, missingColumn)) {
          break;
        }
        delete notificationPayload[missingColumn];
      }
    }

    const responseBody: Record<string, unknown> = {
      success: true,
      invoice_id: updatedInvoice.id,
      status: updatedInvoice.status,
      amount,
      currency,
      due_date: dueDate,
      reference: updatedInvoice.paystack_reference || null,
      authorization_url: updatedInvoice.paystack_authorization_url || null,
      redirect_url: redirectUrl,
      paystack_notification_triggered: paystackNotificationTriggered,
      email: emailResult,
    };

    if (paymentError && !updatedInvoice.paystack_authorization_url) {
      responseBody.error = paymentError;
    }

    return jsonResponse(responseBody, 200);
  } catch (error) {
    return jsonResponse({ error: String(error) }, 500);
  }
});
