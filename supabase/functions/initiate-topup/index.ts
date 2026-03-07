import { corsHeaders, jsonResponse } from "../_shared/cors.ts";
import { getServiceClient, getUserFromAuthHeader } from "../_shared/supabase.ts";
import { initializePaystackTransaction } from "../_shared/paystack.ts";

function asNumber(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  try {
    const auth = await getUserFromAuthHeader(req.headers.get("Authorization"));
    if (!auth.user) {
      return jsonResponse({ error: auth.error || "Unauthorized" }, 401);
    }

    const body = await req.json().catch(() => ({}));
    const amount = asNumber(body.amount);
    const provider = String(body.provider || "paystack").toLowerCase().trim();
    const phoneOrRef = body.phone_or_ref ? String(body.phone_or_ref).trim() : null;
    const source = body.source ? String(body.source) : "client_dashboard";
    const redirectUrl = normalizedRedirectUrl(body.redirect_url)
      || normalizedRedirectUrl(Deno.env.get("PAYSTACK_TOPUP_REDIRECT_URL"))
      || normalizedRedirectUrl(Deno.env.get("PAYSTACK_INVOICE_REDIRECT_URL"));

    if (amount <= 0) {
      return jsonResponse({ error: "amount must be greater than 0" }, 400);
    }
    if (!["paystack", "mpesa", "bank", "other"].includes(provider)) {
      return jsonResponse({ error: "Unsupported provider" }, 400);
    }

    const supabase = getServiceClient();

    const { data: profile } = await supabase
      .from("profiles")
      .select("first_name,last_name")
      .eq("id", auth.user.id)
      .maybeSingle();
    const fullName = `${profile?.first_name || ""} ${profile?.last_name || ""}`.trim() || auth.user.email || "Client";

    const { data: invoice, error: invoiceErr } = await supabase
      .from("invoices")
      .insert({
        project_id: null,
        client_id: auth.user.id,
        created_by: auth.user.id,
        invoice_type: "topup",
        client_email: auth.user.email || body.email || null,
        client_name: fullName,
        description: "Wallet Top-up",
        amount,
        currency: "KES",
        status: "pending",
        notes: `Provider: ${provider}${phoneOrRef ? ` | Ref: ${phoneOrRef}` : ""} | Source: ${source}`,
      })
      .select("*")
      .single();

    if (invoiceErr || !invoice) {
      return jsonResponse({ error: invoiceErr?.message || "Failed to create top-up invoice" }, 500);
    }

    if (provider !== "paystack") {
      const legacyInsert = await supabase.from("escrow_transactions").insert({
        type: "wallet_topup",
        status: "pending",
        amount,
        project_id: null,
        invoice_id: invoice.id,
        metadata: {
          source,
          provider,
          phone_or_ref: phoneOrRef,
          client_email: auth.user.email || null,
        },
      });
      if (legacyInsert.error && !isMissingTableError(legacyInsert.error, "escrow_transactions")) {
        return jsonResponse({ error: legacyInsert.error.message }, 500);
      }

      return jsonResponse({
        success: true,
        topup_id: invoice.id,
        invoice_id: invoice.id,
        status: "pending",
        message: "Top-up invoice recorded. Awaiting manual confirmation.",
      }, 200);
    }

    try {
      const initialized = await initializePaystackTransaction({
        email: auth.user.email || body.email || "",
        amountKsh: amount,
        reference: `topup_${String(invoice.id).replace(/-/g, "")}`,
        currency: "KES",
        metadata: {
          kind: "wallet_topup",
          invoice_id: invoice.id,
          user_id: auth.user.id,
          source,
          provider,
          phone_or_ref: phoneOrRef,
          redirect_url: redirectUrl,
        },
        callbackUrl: redirectUrl,
      });

      const { error: updateInvoiceErr } = await supabase
        .from("invoices")
        .update({
          paystack_reference: initialized.reference,
          paystack_authorization_url: initialized.authorizationUrl,
          status: "sent",
          updated_at: new Date().toISOString(),
        })
        .eq("id", invoice.id);
      if (updateInvoiceErr) {
        return jsonResponse({ error: updateInvoiceErr.message }, 500);
      }

      const txInsert = await supabase.from("financial_transactions").insert({
        transaction_ref: `TOPUP-${String(invoice.id).slice(0, 8)}-${Date.now()}`,
        kind: "wallet_topup",
        status: "pending",
        amount,
        currency: "KES",
        invoice_id: invoice.id,
        payer_id: auth.user.id,
        payee_id: null,
        created_by: auth.user.id,
        description: `Wallet top-up request via ${provider}`,
        metadata: {
          source,
          provider,
          phone_or_ref: phoneOrRef,
          payer_user_id: auth.user.id,
          payer_email: auth.user.email || null,
          paystack_reference: initialized.reference,
          paystack_authorization_url: initialized.authorizationUrl,
        },
      });

      if (txInsert.error && isMissingTableError(txInsert.error, "financial_transactions")) {
        const legacyTxInsert = await supabase.from("escrow_transactions").insert({
          type: "wallet_topup",
          status: "pending",
          amount,
          project_id: null,
          invoice_id: invoice.id,
          metadata: {
            source,
            provider,
            phone_or_ref: phoneOrRef,
            paystack_reference: initialized.reference,
            paystack_authorization_url: initialized.authorizationUrl,
            client_email: auth.user.email || null,
          },
        });
        if (legacyTxInsert.error && !isMissingTableError(legacyTxInsert.error, "escrow_transactions")) {
          return jsonResponse({ error: legacyTxInsert.error.message }, 500);
        }
      } else if (txInsert.error) {
        return jsonResponse({ error: txInsert.error.message }, 500);
      }

      return jsonResponse({
        success: true,
        topup_id: invoice.id,
        invoice_id: invoice.id,
        reference: initialized.reference,
        authorization_url: initialized.authorizationUrl,
        redirect_url: redirectUrl,
        status: "pending",
        message: "Top-up created. Redirect to Paystack checkout.",
      }, 200);
    } catch (error) {
      await supabase
        .from("invoices")
        .update({
          status: "failed",
          updated_at: new Date().toISOString(),
          notes: `${invoice.notes || ""}\nPayment init error: ${String(error)}`.trim(),
        })
        .eq("id", invoice.id);
      return jsonResponse({ error: String(error), topup_id: invoice.id }, 500);
    }
  } catch (error) {
    return jsonResponse({ error: String(error) }, 500);
  }
});
