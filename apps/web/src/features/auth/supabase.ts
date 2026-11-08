import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Supabase client factory (T6-web). The credentials come from Vite env
 * vars (`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`). When either is
 * missing the app runs in dev passthrough: no login screen, no Bearer
 * header — the whole existing suite stays green.
 */
export function isAuthConfigured(): boolean {
  return Boolean(
    import.meta.env.VITE_SUPABASE_URL &&
      import.meta.env.VITE_SUPABASE_ANON_KEY,
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
