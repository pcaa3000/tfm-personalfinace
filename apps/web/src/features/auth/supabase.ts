import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Supabase client factory (T6-web). The credentials come from Vite env
 * vars (`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`).
 *
 * T26 (L35): auth has three explicit states instead of the old implicit
 * dev passthrough — `isAuthBypassed()` (explicit opt-in),
 * `isAuthConfigured()` (credentials present, login required) or
 * misconfigured (neither: the app fails closed).
 */
export function isAuthConfigured(): boolean {
  return Boolean(
    import.meta.env.VITE_SUPABASE_URL &&
      import.meta.env.VITE_SUPABASE_ANON_KEY,
  );
}

/**
 * Explicit dev bypass (T26): `VITE_AUTH_BYPASS=true` disables the login
 * and passes straight through to the ledger. The `import.meta.env.DEV`
 * guard makes bypass impossible in production builds.
 */
export function isAuthBypassed(): boolean {
  return (
    import.meta.env.DEV === true &&
    import.meta.env.VITE_AUTH_BYPASS === "true"
  );
}

let client: SupabaseClient | null = null;

export function getSupabaseClient(): SupabaseClient {
  if (!client) {
    client = createClient(
      import.meta.env.VITE_SUPABASE_URL as string,
      import.meta.env.VITE_SUPABASE_ANON_KEY as string,
      { auth: { flowType: "pkce" } },
    );
  }
  return client;
}
