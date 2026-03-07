import { sendEmailViaResend } from "./resend.ts";

export type MailInput = {
  to: string | string[];
  subject: string;
  html: string;
  text?: string;
  replyTo?: string;
  from?: string;
};

function toList(to: string | string[]): string[] {
  if (Array.isArray(to)) return to.map((item) => String(item || "").trim()).filter(Boolean);
  const single = String(to || "").trim();
  return single ? [single] : [];
}

function base64UrlEncode(input: string): string {
  const bytes = new TextEncoder().encode(input);
  let binary = "";
  bytes.forEach((b) => binary += String.fromCharCode(b));
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function stripHtml(input: string): string {
  return String(input || "")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function getGoogleAccessToken(): Promise<string | null> {
  const clientId = Deno.env.get("GOOGLE_CLIENT_ID") || Deno.env.get("GMAIL_CLIENT_ID");
  const clientSecret = Deno.env.get("GOOGLE_CLIENT_SECRET") || Deno.env.get("GMAIL_CLIENT_SECRET");
  const refreshToken = Deno.env.get("GOOGLE_REFRESH_TOKEN") || Deno.env.get("GMAIL_REFRESH_TOKEN");
  if (!clientId || !clientSecret || !refreshToken) return null;

  const form = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
    grant_type: "refresh_token",
  });

  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: form.toString(),
  });
  const tokenBody = await tokenRes.json().catch(() => ({}));
  if (!tokenRes.ok || !tokenBody?.access_token) {
    throw new Error(tokenBody?.error_description || tokenBody?.error || `Google token request failed (${tokenRes.status})`);
  }
  return String(tokenBody.access_token);
}

export async function sendEmailViaGoogle(input: MailInput) {
  const accessToken = await getGoogleAccessToken();
  if (!accessToken) {
    return {
      sent: false,
      skipped: true,
      reason: "Google email credentials are not configured",
      provider: "gmail",
    };
  }

  const recipients = toList(input.to);
  if (!recipients.length) {
    return { sent: false, skipped: true, reason: "No recipients provided", provider: "gmail" };
  }

  const from = input.from
    || Deno.env.get("GOOGLE_SENDER_EMAIL")
    || Deno.env.get("GMAIL_SENDER_EMAIL")
    || Deno.env.get("GOOGLE_FROM_EMAIL")
    || "creative.keagency254@gmail.com";
  const text = String(input.text || stripHtml(input.html || ""));

  const headers: string[] = [
    `From: ${from}`,
    `To: ${recipients.join(", ")}`,
    `Subject: ${input.subject}`,
    "MIME-Version: 1.0",
    "Content-Type: text/html; charset=UTF-8",
  ];
  if (input.replyTo) headers.push(`Reply-To: ${String(input.replyTo).trim()}`);

  const message = `${headers.join("\r\n")}\r\n\r\n${input.html || text}`;
  const raw = base64UrlEncode(message);

  const sendRes = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ raw }),
  });
  const sendBody = await sendRes.json().catch(() => ({}));
  if (!sendRes.ok) {
    throw new Error(sendBody?.error?.message || `Gmail send failed (${sendRes.status})`);
  }
  return {
    sent: true,
    skipped: false,
    provider: "gmail",
    id: sendBody?.id || null,
    threadId: sendBody?.threadId || null,
  };
}

export async function sendEmail(input: MailInput) {
  // Default to Gmail-only unless explicitly enabled.
  const allowResendFallback = !/^(0|false|no)$/i.test(String(Deno.env.get("ALLOW_RESEND_FALLBACK") || "false"));

  try {
    const gmail = await sendEmailViaGoogle(input);
    if (gmail.sent) return gmail;
    if (!allowResendFallback) return gmail;
  } catch (error) {
    const message = String(error);
    if (!allowResendFallback) {
      return { sent: false, skipped: false, provider: "gmail", error: message };
    }
    try {
      const resend = await sendEmailViaResend(input);
      return { ...resend, provider: "resend", warning: message };
    } catch (fallbackError) {
      return { sent: false, skipped: false, provider: "gmail+resend", error: `${message}; ${String(fallbackError)}` };
    }
  }

  if (!allowResendFallback) {
    return { sent: false, skipped: true, provider: "gmail", reason: "Gmail send skipped and Resend fallback disabled" };
  }

  const resend = await sendEmailViaResend(input);
  return { ...resend, provider: "resend" };
}
