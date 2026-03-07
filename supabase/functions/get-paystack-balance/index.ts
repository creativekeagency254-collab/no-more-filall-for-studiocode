import { corsHeaders, jsonResponse } from "../_shared/cors.ts";
import { getPaystackLiveBalance } from "../_shared/paystack.ts";
import { getServiceClient, getUserFromAuthHeader } from "../_shared/supabase.ts";

async function isAdminUser(userId: string): Promise<boolean> {
  const supabase = getServiceClient();
  const { data, error } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", userId)
    .maybeSingle();

  if (error) return false;
  return String(data?.role || "").toLowerCase() === "admin";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  const { user, error } = await getUserFromAuthHeader(req.headers.get("authorization"));
  if (error || !user?.id) {
    return jsonResponse({ error: error || "Unauthorized" }, 401);
  }

  const allowed = await isAdminUser(user.id);
  if (!allowed) {
    return jsonResponse({ error: "Admin access required" }, 403);
  }

  try {
    const payload = await req.json().catch(() => ({}));
    const currency = String(payload?.currency || "KES").toUpperCase();
    const balance = await getPaystackLiveBalance({ currency });
    return jsonResponse({
      success: true,
      currency: balance.currency,
      balance_subunit: balance.balanceSubunit,
      balance_ksh: balance.balanceKsh,
    });
  } catch (err) {
    return jsonResponse({ error: String(err) }, 500);
  }
});

