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
import { getSupabaseClient, isAuthConfigured } from "./supabase";

export interface AuthContextValue {
  /** True when VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY are set. */
  configured: boolean;
  /** True while the initial getSession() call is in flight. */
  loading: boolean;
  session: Session | null;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
}

const defaultValue: AuthContextValue = {
  configured: false,
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
  const configured = isAuthConfigured();
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
    () => ({ configured, loading, session, signIn, signUp, signOut }),
    [configured, loading, session, signIn, signUp, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  return useContext(AuthContext);
}
