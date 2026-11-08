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

import { setAccessTokenProvider } from "../ledger/api";
import { getSupabaseClient, isAuthBypassed, isAuthConfigured } from "./supabase";

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
  signUp: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
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
  signUp: async () => {
    throw new Error("Auth is not configured");
  },
  signOut: async () => {},
};

const AuthContext = createContext<AuthContextValue>(defaultValue);

export function AuthProvider({ children }: { children: ReactNode }) {
  // T26: three explicit states — bypassed (dev passthrough), configured
  // (credentials present → login required) or misconfigured (fail closed).
  const bypassed = isAuthBypassed();
  const hasCredentials = isAuthConfigured();
  const configured = !bypassed && hasCredentials;
  const misconfigured = !bypassed && !hasCredentials;
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(configured);

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
      setSession(data.session);
      setLoading(false);
    });

    const { data } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next);
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
    setSession(data.session);
  }, []);

  const signUp = useCallback(async (email: string, password: string) => {
    const { error } = await getSupabaseClient().auth.signUp({
      email,
      password,
    });
    if (error) throw error;
  }, []);

  const signOut = useCallback(async () => {
    await getSupabaseClient().auth.signOut();
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      bypassed,
      configured,
      misconfigured,
      loading,
      session,
      signIn,
      signUp,
      signOut,
    }),
    [bypassed, configured, misconfigured, loading, session, signIn, signUp, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  return useContext(AuthContext);
}
