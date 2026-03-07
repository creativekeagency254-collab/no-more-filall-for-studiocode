import { corsHeaders, jsonResponse } from "../_shared/cors.ts";
import { getServiceClient, getUserFromAuthHeader, getAnonClientWithToken } from "../_shared/supabase.ts";

function normalizeRole(value: unknown): string {
  const raw = String(value || "").trim().toLowerCase();
  if (raw === "sales" || raw === "commisioner") return "commissioner";
  if (raw === "dev") return "developer";
  if (raw === "super_admin") return "admin";
  return raw || "client";
}

function initialsFromName(name: string): string {
  const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "U";
  if (parts.length === 1) return parts[0][0]?.toUpperCase() || "U";
  return `${parts[0][0] || ""}${parts[1][0] || ""}`.toUpperCase() || "U";
}

function isMissingTable(error: unknown, tableName: string): boolean {
  const raw = String((error as { message?: string; details?: string; code?: string })?.message || "")
    + " "
    + String((error as { details?: string })?.details || "")
    + " "
    + String((error as { code?: string })?.code || "");
  const lowered = raw.toLowerCase();
  return lowered.includes("42p01")
    || lowered.includes("pgrst205")
    || (lowered.includes("does not exist") && lowered.includes(tableName.toLowerCase()));
}

async function getRequesterRole(supabase: ReturnType<typeof getAnonClientWithToken>, userId: string): Promise<string> {
  const { data: profile, error: pErr } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", userId)
    .maybeSingle();
  if (!pErr && profile?.role) return normalizeRole(profile.role);

  const { data: legacy, error: uErr } = await supabase
    .from("users")
    .select("role")
    .eq("id", userId)
    .maybeSingle();
  if (!uErr && legacy?.role) return normalizeRole(legacy.role);
  return "client";
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
    let auth = await getUserFromAuthHeader(req.headers.get("authorization"));
    if (!auth.user && payload?.user_token) {
      auth = await getUserFromAuthHeader(`Bearer ${String(payload.user_token)}`);
    }
    if (!auth.user) {
      return jsonResponse({ error: auth.error || "Unauthorized" }, 401);
    }

    const token = auth.token || String(payload?.user_token || "");
    const authClient = getAnonClientWithToken(token);
    const role = await getRequesterRole(authClient, auth.user.id);
    if (role !== "admin") {
      return jsonResponse({ error: "Admin access required" }, 403);
    }

    const { data: profiles, error: profileErr } = await authClient
      .from("profiles")
      .select("id,email,first_name,last_name,full_name,role,status,is_active,avatar_url,created_at")
      .order("created_at", { ascending: false });

    let users: Array<Record<string, unknown>> = [];
    let usersErr: unknown = null;
    try {
      const service = getServiceClient();
      const usersRes = await service
        .from("users")
        .select("id,email,full_name,role,status,is_active,created_at")
        .order("created_at", { ascending: false });
      users = (usersRes.data || []) as Array<Record<string, unknown>>;
      usersErr = usersRes.error;
    } catch (error) {
      usersErr = error;
      users = [];
    }

    if (profileErr && !isMissingTable(profileErr, "profiles")) {
      return jsonResponse({ error: profileErr.message || "Failed to fetch profiles" }, 500);
    }
    if (usersErr && !isMissingTable(usersErr, "users")) {
      return jsonResponse({ error: usersErr.message || "Failed to fetch users" }, 500);
    }

    const merged = new Map<string, Record<string, unknown>>();
    (profiles || []).forEach((p) => {
      const first = String(p.first_name || "").trim();
      const last = String(p.last_name || "").trim();
      const name = `${first} ${last}`.trim() || String(p.full_name || "").trim() || String(p.email || "User").split("@")[0];
      merged.set(String(p.id), {
        id: p.id,
        email: p.email || "",
        first_name: first,
        last_name: last,
        name,
        initials: initialsFromName(name),
        role: normalizeRole(p.role),
        status: p.status || (p.is_active === false ? "suspended" : "active"),
        is_active: p.is_active !== false,
        avatar_url: p.avatar_url || "",
        created_at: p.created_at || null,
      });
    });

    (users || []).forEach((u) => {
      const key = String(u.id || "");
      if (!key || merged.has(key)) return;
      const name = String(u.full_name || "").trim() || String(u.email || "User").split("@")[0];
      merged.set(key, {
        id: u.id,
        email: u.email || "",
        first_name: "",
        last_name: "",
        name,
        initials: initialsFromName(name),
        role: normalizeRole(u.role),
        status: u.status || (u.is_active === false ? "suspended" : "active"),
        is_active: u.is_active !== false,
        avatar_url: "",
        created_at: u.created_at || null,
      });
    });

    return jsonResponse({
      success: true,
      count: merged.size,
      users: Array.from(merged.values()),
    }, 200);
  } catch (error) {
    return jsonResponse({ error: String(error) }, 500);
  }
});
