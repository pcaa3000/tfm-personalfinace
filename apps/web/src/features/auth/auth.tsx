import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { Session } from "@supabase/supabase-js";

import { refreshDemoWorkspace, setAccessTokenProvider } from "../ledger/api";
import { clearClientCaches } from "./client-caches";
import { demoEmail } from "./demo-session";
import { getSupabaseClient, isAuthBypassed, isAuthConfigured } from "./supabase";
import { useInactivityLogout } from "./use-inactivity-logout";

export interface AuthContextValue {
  /** True when VITE_AUTH_BYPASS=true in a dev build (T26). */
  bypassed: boolean;
  /** True when credentials are set and auth is not bypassed. */
  configured: boolean;
  /** True when auth is required but credentials are missing (fail closed). */
  misconfigured: boolean;
  /** True while the initial getSession() call is in flight. */
  loading: boolean;
  session: Session | null;
  signIn: (email: string, password: string) => Promise<void>;
  /**
   * Enters the "María" demo (demo-maria-session T4, S1+S5): a real
   * Supabase password sign-in with the fixed env-provided demo email,
   * followed by `POST /demo/refresh` with the fresh bearer — fired
   * fire-and-forget, so entry never blocks on it. The demo is an
   * ordinary signed-in session; only the password is needed from the
   * visitor.
   */
  signInDemo: (password: string) => Promise<void>;
  /**
   * Starts the OAuth PKCE redirect flow for a social provider (T30).
   * On success the browser navigates away to the provider, so no
   * session is set locally — the returning redirect establishes it.
   */
  signInWithOAuth: (provider: "google" | "facebook") => Promise<void>;
  signUp: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  /** Updates the signed-in user's password via Supabase Auth (T29). */
  updatePassword: (newPassword: string) => Promise<void>;
}

const defaultValue: AuthContextValue = {
  bypassed: false,
  configured: false,
  misconfigured: false,
  loading: false,
  session: null,
  signIn: async () => {
    throw new Error("Auth is not configured");
  },
  signInDemo: async () => {
    throw new Error("Auth is not configured");
  },
  signInWithOAuth: async () => {
    throw new Error("Auth is not configured");
  },
  signUp: async () => {
    throw new Error("Auth is not configured");
  },
  signOut: async () => {},
  updatePassword: async () => {
    throw new Error("Auth is not configured");
  },
};

const AuthContext = createContext<AuthContextValue>(defaultValue);

export function AuthProvider({ children }: { children: ReactNode }) {
  // T26: three explicit states — bypassed (dev passthrough), configured
  // (credentials present → login required) or misconfigured (fail closed).
  const bypassed = isAuthBypassed();
  const hasCredentials = isAuthConfigured();
  const configured = !bypassed && hasCredentials;
  const misconfigured = !bypassed && !hasCredentials;
  const [supabaseSession, setSupabaseSession] = useState<Session | null>(
    null,
  );
  const [loading, setLoading] = useState(configured);
  // demo-maria-session T4: the demo is a real Supabase session — no
  // pseudo-session, sid or demo flag exists on the client.
  const session = supabaseSession;

  useEffect(() => {
    if (!configured) return;
    const supabase = getSupabaseClient();

    // T6-web: the API client reads the bearer token through this
    // injectable provider; it resolves the cached session each call.
    setAccessTokenProvider(async () => {
      const { data } = await supabase.auth.getSession();
      return data.session?.access_token ?? null;
    });

    let mounted = true;
    void supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return;
      setSupabaseSession(data.session);
      setLoading(false);
    });

    const { data } = supabase.auth.onAuthStateChange((_event, next) => {
      setSupabaseSession(next);
      setLoading(false);
    });

    return () => {
      mounted = false;
      data.subscription.unsubscribe();
      setAccessTokenProvider(null);
    };
  }, [configured]);

  const signIn = useCallback(async (email: string, password: string) => {
    const { data, error } = await getSupabaseClient().auth.signInWithPassword({
      email,
      password,
    });
    if (error) throw error;
    // Reflect the new session immediately; onAuthStateChange may lag.
    setSupabaseSession(data.session);
  }, []);

  // demo-maria-session T4 (S1+S5): real sign-in with the env-provided
  // demo email, then `POST /demo/refresh` asks the API to refresh the
  // seeded workspace. The refresh is fire-and-forget: entry must not
  // block on it and a failed refresh is never the visitor's problem,
  // so it is logged and swallowed.
  const signInDemo = useCallback(async (password: string) => {
    const { data, error } = await getSupabaseClient().auth.signInWithPassword({
      email: demoEmail() ?? "",
      password,
    });
    if (error) throw error;
    setSupabaseSession(data.session);
    void refreshDemoWorkspace().catch((refreshError: unknown) => {
      console.warn("demo workspace refresh failed", refreshError);
    });
  }, []);

  // T30 (S13): the PKCE redirect flow navigates the browser away to
  // the provider, so on success no session is set locally — the
  // session only materializes when Supabase redirects back to the app.
  const signInWithOAuth = useCallback(
    async (provider: "google" | "facebook") => {
      const { error } = await getSupabaseClient().auth.signInWithOAuth({
        provider,
      });
      if (error) throw error;
    },
    [],
  );

  const signUp = useCallback(async (email: string, password: string) => {
    const { error } = await getSupabaseClient().auth.signUp({
      email,
      password,
    });
    if (error) throw error;
  }, []);

  // GAP-SEC-08 (S6): after the server session ends, wipe the offline
  // outbox and the query cache so nothing of this identity survives on
  // a shared browser. Skipped when the auth call itself fails — the
  // session is still valid and the user's data must not be destroyed.
  const signOut = useCallback(async () => {
    // supabase-js resolves {error} on server 5xx without throwing;
    // in that path the session is still valid, so the wipe must not run.
    const { error } = await getSupabaseClient().auth.signOut();
    if (error) throw error;
    await clearClientCaches();
  }, []);

  const updatePassword = useCallback(async (newPassword: string) => {
    const { error } = await getSupabaseClient().auth.updateUser({
      password: newPassword,
    });
    if (error) throw error;
  }, []);

  // T1 (S1–S4): auto signOut after 10 idle minutes; the hook is inert
  // without a session, so bypass/misconfigured states stay unaffected.
  useInactivityLogout(session, signOut);

  const value = useMemo<AuthContextValue>(
    () => ({
      bypassed,
      configured,
      misconfigured,
      loading,
      session,
      signIn,
      signInDemo,
      signInWithOAuth,
      signUp,
      signOut,
      updatePassword,
    }),
    [
      bypassed,
      configured,
      misconfigured,
      loading,
      session,
      signIn,
      signInDemo,
      signInWithOAuth,
      signUp,
      signOut,
      updatePassword,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  return useContext(AuthContext);
}
