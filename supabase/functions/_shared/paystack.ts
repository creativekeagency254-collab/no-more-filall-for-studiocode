const PAYSTACK_BASE_URL = "https://api.paystack.co";

const encoder = new TextEncoder();

function requiredSecret(name: string): string {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`${name} is not configured`);
  return value;
}

type PaystackResponse<T = Record<string, unknown>> = {
  status: boolean;
  message?: string;
  data?: T;
};

async function paystackRequest<T = Record<string, unknown>>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const secretKey = requiredSecret("PAYSTACK_SECRET_KEY");
  const response = await fetch(`${PAYSTACK_BASE_URL}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${secretKey}`,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });

  const body = await response.json().catch(() => ({})) as PaystackResponse<T>;
  if (!response.ok || !body?.status) {
    throw new Error(body?.message || `Paystack request failed (${response.status})`);
  }
  return (body.data || {}) as T;
}

function normalizeEmail(value: string): string {
  return String(value || "").trim().toLowerCase();
}

function splitName(value: string): { firstName: string; lastName: string } {
  const parts = String(value || "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return { firstName: "", lastName: "" };
  if (parts.length === 1) return { firstName: parts[0], lastName: "" };
  return {
    firstName: parts.slice(0, -1).join(" "),
    lastName: parts.slice(-1)[0] || "",
  };
}

type PaystackCustomer = {
  customer_code?: string;
  email?: string;
};

async function getPaystackCustomer(idOrCodeOrEmail: string): Promise<PaystackCustomer | null> {
  const key = String(idOrCodeOrEmail || "").trim();
  if (!key) return null;

  try {
    const data = await paystackRequest<PaystackCustomer>(`/customer/${encodeURIComponent(key)}`, {
      method: "GET",
      headers: { "Content-Type": "application/json" },
    });
    return data?.customer_code ? data : null;
  } catch {
    return null;
  }
}

export async function ensurePaystackCustomer(params: {
  email: string;
  fullName?: string;
  firstName?: string;
  lastName?: string;
  phone?: string;
  metadata?: Record<string, unknown>;
}) {
  const email = normalizeEmail(params.email);
  if (!email) throw new Error("Customer email is required");

  const existing = await getPaystackCustomer(email);
  if (existing?.customer_code) {
    return {
      customerCode: String(existing.customer_code),
      email: String(existing.email || email),
      raw: existing,
    };
  }

  const split = splitName(params.fullName || "");
  const firstName = String(params.firstName || split.firstName || "").trim();
  const lastName = String(params.lastName || split.lastName || "").trim();
  const phone = String(params.phone || "").trim();

  try {
    const created = await paystackRequest<PaystackCustomer>("/customer", {
      method: "POST",
      body: JSON.stringify({
        email,
        first_name: firstName || undefined,
        last_name: lastName || undefined,
        phone: phone || undefined,
        metadata: params.metadata || {},
      }),
    });
    if (!created?.customer_code) {
      throw new Error("Paystack customer created without customer_code");
    }
    return {
      customerCode: String(created.customer_code),
      email: String(created.email || email),
      raw: created,
    };
  } catch (error) {
    const retryable = /already exists|duplicate|exists/i.test(String(error));
    if (!retryable) throw error;

    const retry = await getPaystackCustomer(email);
    if (!retry?.customer_code) throw error;
    return {
      customerCode: String(retry.customer_code),
      email: String(retry.email || email),
      raw: retry,
    };
  }
}

export async function createPaystackPaymentRequest(params: {
  customerCode: string;
  amountKsh: number;
  description: string;
  currency?: string;
  dueDate?: string | null;
  metadata?: Record<string, unknown>;
  sendNotification?: boolean;
}) {
  const amountSubunit = Math.round(Number(params.amountKsh || 0) * 100);
  if (!Number.isFinite(amountSubunit) || amountSubunit <= 0) {
    throw new Error("Invalid amount for Paystack payment request");
  }

  const data = await paystackRequest<Record<string, unknown>>("/paymentrequest", {
    method: "POST",
    body: JSON.stringify({
      customer: params.customerCode,
      amount: amountSubunit,
      description: params.description,
      currency: (params.currency || "KES").toUpperCase(),
      due_date: params.dueDate || undefined,
      metadata: params.metadata || {},
      send_notification: params.sendNotification ?? true,
      draft: false,
    }),
  });

  const invoiceUrl = String(data?.invoice_url || data?.authorization_url || data?.url || "");
  const requestCode = String(data?.request_code || data?.reference || "");
  const offlineReference = String(data?.offline_reference || "");

  return {
    invoiceUrl: invoiceUrl || null,
    requestCode: requestCode || null,
    offlineReference: offlineReference || null,
    raw: data,
  };
}

export async function initializePaystackTransaction(params: {
  email: string;
  amountKsh: number;
  reference: string;
  currency?: string;
  metadata?: Record<string, unknown>;
  callbackUrl?: string | null;
}) {
  const callbackUrl = String(params.callbackUrl || "").trim();
  const data = await paystackRequest<Record<string, unknown>>("/transaction/initialize", {
    method: "POST",
    body: JSON.stringify({
      email: params.email,
      amount: Math.round(Number(params.amountKsh || 0) * 100),
      currency: (params.currency || "KES").toUpperCase(),
      reference: params.reference,
      metadata: params.metadata || {},
      callback_url: callbackUrl || undefined,
    }),
  });

  if (!data?.authorization_url) {
    throw new Error("Paystack initialize did not return authorization URL");
  }

  return {
    authorizationUrl: String(data.authorization_url),
    reference: String(data.reference || params.reference),
    raw: data,
  };
}

export async function getPaystackLiveBalance(params?: { currency?: string }) {
  const rows = await paystackRequest<Array<Record<string, unknown>>>("/balance", {
    method: "GET",
    headers: { "Content-Type": "application/json" },
  });

  const preferredCurrency = String(params?.currency || "KES").toUpperCase();
  const list = Array.isArray(rows) ? rows : [];
  const preferred = list.find((row) => String(row?.currency || "").toUpperCase() === preferredCurrency);
  const selected = preferred || list[0] || {};
  const balanceSubunit = Number(selected?.balance || 0);
  const normalizedSubunit = Number.isFinite(balanceSubunit) ? balanceSubunit : 0;
  const currency = String(selected?.currency || preferredCurrency || "KES").toUpperCase();

  return {
    currency,
    balanceSubunit: normalizedSubunit,
    balanceKsh: normalizedSubunit / 100,
    raw: list,
  };
}

async function hmacSha512Hex(payload: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-512" },
    false,
    ["sign"],
  );

  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(payload));
  const bytes = new Uint8Array(signature);
  return Array.from(bytes).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function verifyPaystackSignature(rawBody: string, signature: string | null): Promise<boolean> {
  if (!signature) return false;
  const secretKey = requiredSecret("PAYSTACK_SECRET_KEY");
  const expected = await hmacSha512Hex(rawBody, secretKey);
  return expected.toLowerCase() === String(signature).toLowerCase();
}
