import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { Session, User } from "@supabase/supabase-js";

import { resetDemoWorkspace, setAccessTokenProvider } from "../ledger/api";
import { clearClientCaches } from "./client-caches";
import {
  DEMO_SUBJECT,
  endDemoSession,
  isDemoSession,
  startDemoSession,
} from "./demo-session";
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
  /** True while the client-side demo session flag is set (T2, S3). */
  demoSession: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  /**
   * Enters the "María" demo (demo-maria-login T2, S1–S3): re-seeds the
   * demo workspace through `POST /demo/reset` and only then sets the
   * client-side flag that makes the API client send
   * `x-dev-user: demo-maria`. No Supabase session is created — the
   * context exposes a pseudo-session instead.
   */
  signInDemo: () => Promise<void>;
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
  demoSession: false,
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

/**
 * Pseudo-session exposed while the demo flag lives (T2, S3): it lets
 * the app shell (AuthGate, account menu, inactivity logout) treat the
 * demo exactly like a signed-in identity without a Supabase session.
 * `access_token` is never sent — `isDemoSession()` short-circuits the
 * API headers to `x-dev-user` first.
 */
const DEMO_USER: User = {
  id: DEMO_SUBJECT,
  aud: "authenticated",
  role: "authenticated",
  email: DEMO_SUBJECT,
  app_metadata: {},
  user_metadata: {},
  created_at: "",
};

const DEMO_PSEUDO_SESSION: Session = {
  access_token: "demo",
  refresh_token: "",
  token_type: "bearer",
  expires_in: 0,
  user: DEMO_USER,
};

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
  // T2 (S3): restored from the localStorage flag so a reload keeps the
  // visitor inside the demo until they sign out.
  const [demoSession, setDemoSession] = useState(isDemoSession);
  const [loading, setLoading] = useState(configured);
  const session = demoSession ? DEMO_PSEUDO_SESSION : supabaseSession;

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

    // Supabase events only update the stored real session; while the
    // demo flag lives the exposed session stays the pseudo-session, so
    // a stray SIGNED_IN/SIGNED_OUT event can't break the demo out of
    // or into a real identity.
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

  // demo-maria-login T2 (S2+S3): the API re-seeds `local|demo-maria`
  // BEFORE the flag is written — a failed reset must never leave a
  // half-open demo session pointing at stale data.
  const signInDemo = useCallback(async () => {
    await resetDemoWorkspace();
    startDemoSession();
    setDemoSession(true);
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
    // Demo sign-out is local (T2, S3): the demo never created a
    // Supabase session, so no remote signOut runs — the flag and the
    // client caches are wiped exactly like a normal signOut.
    if (demoSession) {
      endDemoSession();
      setDemoSession(false);
      setSupabaseSession(null);
      await clearClientCaches();
      return;
    }
    // supabase-js resolves {error} on server 5xx without throwing;
    // in that path the session is still valid, so the wipe must not run.
    const { error } = await getSupabaseClient().auth.signOut();
    if (error) throw error;
    await clearClientCaches();
  }, [demoSession]);

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
      demoSession,
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
      demoSession,
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
