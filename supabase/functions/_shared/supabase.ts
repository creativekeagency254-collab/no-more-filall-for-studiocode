import { createClient, type User } from "https://esm.sh/@supabase/supabase-js@2.45.4";

function requiredEnv(name: string): string {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`${name} is not configured`);
  return value;
}

function requiredServiceRoleKey(): string {
  const direct = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (direct) return direct;
  const fallback = Deno.env.get("SUPABASE_SECRET_KEY");
  if (fallback) return fallback;
  throw new Error("SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_SECRET_KEY fallback) is not configured");
}

export function getServiceClient() {
  return createClient(
    requiredEnv("SUPABASE_URL"),
    requiredServiceRoleKey(),
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    },
  );
}

export function getAnonClientWithToken(accessToken?: string) {
  const headers: Record<string, string> = {};
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;

  return createClient(
    requiredEnv("SUPABASE_URL"),
    requiredEnv("SUPABASE_ANON_KEY"),
    {
      global: { headers },
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    },
  );
}

export async function getUserFromAuthHeader(authHeader: string | null): Promise<{
  user: User | null;
  error: string | null;
  token: string | null;
}> {
  const token = String(authHeader || "").replace(/^Bearer\s+/i, "").trim();
  if (!token) {
    return { user: null, error: "Missing bearer token", token: null };
  }

  try {
    const authClient = getAnonClientWithToken(token);
    const { data, error } = await authClient.auth.getUser(token);
    if (error || !data?.user) {
      return { user: null, error: error?.message || "Invalid token", token };
    }
    return { user: data.user, error: null, token };
  } catch (error) {
    return { user: null, error: String(error), token };
  }
}
