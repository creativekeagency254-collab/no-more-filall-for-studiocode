export async function sendEmailViaResend(input: {
  to: string | string[];
  subject: string;
  html: string;
  text?: string;
  replyTo?: string;
  from?: string;
}) {
  const apiKey = Deno.env.get("RESEND_API_KEY");
  if (!apiKey) {
    return {
      sent: false,
      skipped: true,
      reason: "RESEND_API_KEY is not configured",
    };
  }

  const from = input.from
    || Deno.env.get("RESEND_FROM_EMAIL")
    || "CODE STUDIO ke <onboarding@resend.dev>";

  const payload: Record<string, unknown> = {
    from,
    to: input.to,
    subject: input.subject,
    html: input.html,
  };

  if (input.text) payload.text = input.text;
  if (input.replyTo) payload.reply_to = input.replyTo;

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(body?.message || `Resend request failed (${response.status})`);
  }

  return {
    sent: true,
    skipped: false,
    id: body?.id || null,
  };
}
