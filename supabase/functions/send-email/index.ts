import { corsHeaders, jsonResponse } from "../_shared/cors.ts";
import { sendEmail } from "../_shared/mailer.ts";
import { getServiceClient } from "../_shared/supabase.ts";

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function renderTemplate(template: string, data: Record<string, unknown>): { subject: string; html: string } {
  if (template === "welcome_client") {
    const name = escapeHtml(String(data.name || data.first_name || "there"));
    const dashboardUrl = escapeHtml(String(data.dashboard_url || data.site_url || "https://liveteststudiocodemuchemi.netlify.app/client_dashboard.html"));
    const supportEmail = escapeHtml(String(data.support_email || "creative.keagency254@gmail.com"));
    const supportWhatsapp = escapeHtml(String(data.support_whatsapp || "+254793832286"));
    return {
      subject: "Confirm Your Signup",
      html: `
        <div style="margin:0;padding:0;background:#050505;font-family:Arial,Helvetica,sans-serif;color:#fff;">
          <div style="max-width:650px;margin:18px auto;padding:24px;background:#121212;border:1px solid #1f1f1f;border-radius:14px;">
            <div style="text-align:center;margin-bottom:14px;">
              <img src="https://smdbfaomeghoejqqkplv.supabase.co/storage/v1/object/public/branding/codestudio-logo-outline.png" alt="CODESTUDIO.KENYA" width="68" height="68" style="display:inline-block;border:0;" />
              <h2 style="margin:10px 0 4px;color:#16A34A;letter-spacing:.4px;">CODESTUDIO.KENYA</h2>
              <p style="margin:0;color:#A7F3D0;font-size:12px;letter-spacing:.4px;">BUILDING BEST SOFTWARES</p>
            </div>
            <p style="margin:0 0 10px;color:#E5E7EB;">Hi <strong>${name}</strong>, welcome onboard.</p>
            <p style="margin:0 0 12px;color:#CBD5E1;">Your client account is ready. You can open your dashboard now and continue with project onboarding.</p>
            <p style="margin:18px 0;">
              <a href="${dashboardUrl}" style="display:inline-block;padding:12px 18px;background:#16A34A;color:#fff;text-decoration:none;border-radius:10px;font-weight:700;">
                Open Client Dashboard
              </a>
            </p>
            <ul style="margin:8px 0 0;padding-left:18px;color:#D1FAE5;line-height:1.8;">
              <li>110% Refund Guarantee</li>
              <li>Free Prototype</li>
              <li>Free Hosting</li>
              <li>Free Domain for 1 Year</li>
              <li>Free Lifetime Maintenance</li>
            </ul>
            <p style="margin:18px 0 0;color:#9CA3AF;font-size:12px;">Support: ${supportEmail} • WhatsApp: ${supportWhatsapp}</p>
          </div>
        </div>
      `,
    };
  }

  if (template === "proposal_accepted") {
    const name = escapeHtml(String(data.name || "Developer"));
    const brief = escapeHtml(String(data.brief || "your project"));
    return {
      subject: `You have been hired for ${brief}`,
      html: `
        <div style="font-family:Arial,sans-serif;max-width:620px;margin:0 auto;padding:22px;color:#111;line-height:1.5;">
          <h2 style="margin:0 0 14px;">CODE STUDIO ke Update</h2>
          <p style="margin:0 0 10px;">Hi ${name},</p>
          <p style="margin:0 0 10px;">Good news. Your proposal has been accepted for <strong>${brief}</strong>.</p>
          <p style="margin:0;color:#555;">Log in to your dashboard to review next steps.</p>
        </div>
      `,
    };
  }

  const title = escapeHtml(String(data.title || "CODE STUDIO ke Notification"));
  const message = escapeHtml(String(data.message || "You have a new update."));

  return {
    subject: title,
    html: `
      <div style="font-family:Arial,sans-serif;max-width:620px;margin:0 auto;padding:22px;color:#111;line-height:1.5;">
        <h2 style="margin:0 0 14px;">${title}</h2>
        <p style="margin:0;">${message}</p>
      </div>
    `,
  };
}

function toRecipientList(to: unknown): string[] {
  if (Array.isArray(to)) return to.map((v) => String(v || "").trim().toLowerCase()).filter(Boolean);
  const single = String(to || "").trim().toLowerCase();
  return single ? [single] : [];
}

function extractMissingColumnName(error: unknown): string | null {
  const raw = String((error as { message?: string; details?: string })?.message || "")
    + " "
    + String((error as { details?: string })?.details || "");
  const lowered = raw.toLowerCase();
  if (!(lowered.includes("column") && lowered.includes("does not exist"))) return null;
  const match = raw.match(/column\s+["']?([a-zA-Z0-9_]+)["']?\s+does not exist/i);
  return match?.[1] || null;
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
    const recipients = toRecipientList(payload.to);
    if (!recipients.length) {
      return jsonResponse({ error: "to is required" }, 400);
    }

    const explicitSubject = payload.subject ? String(payload.subject) : "";
    const explicitHtml = payload.html ? String(payload.html) : "";
    const template = payload.template ? String(payload.template) : "";
    const data = (payload.data && typeof payload.data === "object") ? payload.data : {};

    let subject = explicitSubject;
    let html = explicitHtml;

    if (!subject || !html) {
      const rendered = renderTemplate(template, data);
      subject = subject || rendered.subject;
      html = html || rendered.html;
    }

    let emailResult: Record<string, unknown> = { sent: false, skipped: true };
    let sendError: string | null = null;
    try {
      emailResult = await sendEmail({
        to: recipients,
        subject,
        html,
      });
    } catch (error) {
      sendError = String(error);
      emailResult = { sent: false, skipped: false, error: sendError };
    }

    let fallbackNotifications = 0;
    if (!emailResult?.sent) {
      try {
        const supabase = getServiceClient();
        const { data: profiles } = await supabase
          .from("profiles")
          .select("id,email")
          .in("email", recipients);
        const userIds = (profiles || []).map((p) => p.id).filter(Boolean);

        for (const userId of userIds) {
          const row: Record<string, unknown> = {
            user_id: userId,
            type: "email",
            title: subject,
            body: `Email fallback generated for ${subject}`,
            content: `Email fallback generated for ${subject}`,
            payload: {
              template,
              recipients,
            },
            is_read: false,
            read_at: null,
          };

          for (let i = 0; i < 6; i += 1) {
            const ins = await supabase.from("notifications").insert(row);
            if (!ins.error) {
              fallbackNotifications += 1;
              break;
            }
            const missing = extractMissingColumnName(ins.error);
            if (!missing || !Object.prototype.hasOwnProperty.call(row, missing)) break;
            delete row[missing];
          }
        }
      } catch (_) {
        // best-effort fallback only
      }
    }

    return jsonResponse({
      success: true,
      recipients,
      email: emailResult,
      fallback_notifications: fallbackNotifications,
      error: sendError,
    }, 200);
  } catch (error) {
    return jsonResponse({ error: String(error) }, 500);
  }
});
