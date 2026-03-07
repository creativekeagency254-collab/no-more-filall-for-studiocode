import { corsHeaders, jsonResponse } from "../_shared/cors.ts";
import { getServiceClient, getUserFromAuthHeader } from "../_shared/supabase.ts";

const ALLOWED_FIELDS = new Set([
  "first_name",
  "last_name",
  "email",
  "phone",
  "company",
  "avatar_url",
  "available_for_work",
  "status",
]);

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function sanitizeValue(key: string, value: unknown): unknown {
  if (value == null) return null;
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return "";
    if (key === "email") return trimmed.toLowerCase().slice(0, 240);
    if (key === "avatar_url") return trimmed.slice(0, 500);
    return trimmed.slice(0, 300);
  }
  return value;
}

function extractMissingColumn(error: unknown): string | null {
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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  const auth = await getUserFromAuthHeader(req.headers.get("authorization"));
  if (!auth.user) {
    return jsonResponse({ error: auth.error || "Unauthorized" }, 401);
  }

  const supabase = getServiceClient();
  const body = await req.json().catch(() => ({}));
  const incomingPatch = asRecord(body.patch || body.profile || {});
  const patch: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(incomingPatch)) {
    if (!ALLOWED_FIELDS.has(key)) continue;
    patch[key] = sanitizeValue(key, value);
  }

  // Ensure profile row exists.
  await supabase.from("profiles").upsert({
    id: auth.user.id,
    email: String(patch.email || auth.user.email || "").toLowerCase(),
  }, { onConflict: "id" });

  const removedColumns: string[] = [];
  let workingPatch: Record<string, unknown> = {
    ...patch,
    updated_at: new Date().toISOString(),
  };

  for (let i = 0; i < 10; i += 1) {
    if (Object.keys(workingPatch).length === 1 && Object.prototype.hasOwnProperty.call(workingPatch, "updated_at")) {
      break;
    }

    const { data, error } = await supabase
      .from("profiles")
      .update(workingPatch)
      .eq("id", auth.user.id)
      .select("*")
      .maybeSingle();

    if (!error) {
      try {
        const meta: Record<string, unknown> = {};
        if (typeof workingPatch.first_name === "string") meta.first_name = workingPatch.first_name;
        if (typeof workingPatch.last_name === "string") meta.last_name = workingPatch.last_name;
        if (typeof workingPatch.avatar_url === "string" && workingPatch.avatar_url) meta.avatar_url = workingPatch.avatar_url;
        if (Object.keys(meta).length) {
          await supabase.auth.admin.updateUserById(auth.user.id, { user_metadata: meta });
        }
      } catch {
        // non-blocking
      }

      return jsonResponse({
        success: true,
        profile: data || null,
        removed_columns: removedColumns,
      }, 200);
    }

    const missingColumn = extractMissingColumn(error);
    if (!missingColumn || !Object.prototype.hasOwnProperty.call(workingPatch, missingColumn)) {
      return jsonResponse({ error: error.message || "Profile update failed", removed_columns: removedColumns }, 500);
    }

    delete workingPatch[missingColumn];
    removedColumns.push(missingColumn);
  }

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", auth.user.id)
    .maybeSingle();

  if (profileError) {
    return jsonResponse({ error: profileError.message || "Profile update failed", removed_columns: removedColumns }, 500);
  }

  return jsonResponse({
    success: true,
    profile: profile || null,
    removed_columns: removedColumns,
    skipped: true,
  }, 200);
});

