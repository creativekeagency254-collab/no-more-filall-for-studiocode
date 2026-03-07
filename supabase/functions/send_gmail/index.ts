import { serve } from "https://deno.land/std@0.203.0/http/server.ts";
import nodemailer from "npm:nodemailer";
import { corsHeaders } from "../_shared/cors.ts";

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
    },
  });
}

function asRecipients(value: unknown): string | string[] {
  if (Array.isArray(value)) {
    const list = value.map((v) => String(v || "").trim()).filter(Boolean);
    return list;
  }
  return String(value || "").trim();
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return json({ success: false, error: "Method not allowed" }, 405);
  }

  const client_id = Deno.env.get("GOOGLE_CLIENT_ID");
  const client_secret = Deno.env.get("GOOGLE_CLIENT_SECRET");
  const refresh_token = Deno.env.get("GOOGLE_REFRESH_TOKEN");
  const sender_email = Deno.env.get("GOOGLE_SENDER_EMAIL");

  if (!client_id || !client_secret || !refresh_token || !sender_email) {
    return json({
      success: false,
      error: "Missing Gmail OAuth secrets. Set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN, GOOGLE_SENDER_EMAIL.",
    }, 500);
  }

  let payload: Record<string, unknown> = {};
  try {
    payload = await req.json();
  } catch (_) {
    return json({ success: false, error: "Invalid JSON body" }, 400);
  }

  const to = asRecipients(payload.to);
  const subject = String(payload.subject || "").trim();
  const text = String(payload.text || "").trim();
  const html = String(payload.html || "").trim();

  const hasRecipients = Array.isArray(to) ? to.length > 0 : Boolean(to);
  if (!hasRecipients || !subject || (!text && !html)) {
    return json({
      success: false,
      error: "Required fields: to, subject, and either text or html.",
    }, 400);
  }

  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
      type: "OAuth2",
      user: sender_email,
      clientId: client_id,
      clientSecret: client_secret,
      refreshToken: refresh_token,
    },
  });

  try {
    const info = await transporter.sendMail({
      from: sender_email,
      to,
      subject,
      text: text || undefined,
      html: html || undefined,
    });

    return json({
      success: true,
      provider: "gmail",
      info: {
        messageId: info.messageId,
        accepted: info.accepted,
        rejected: info.rejected,
        response: info.response,
      },
    }, 200);
  } catch (error) {
    return json({
      success: false,
      error: String((error as Error)?.message || error),
    }, 500);
  }
});
