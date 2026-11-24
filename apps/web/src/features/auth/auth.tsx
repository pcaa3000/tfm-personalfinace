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

import {
  createDemoSession,
  deleteDemoSession,
  getDemoSessionStatus,
  setAccessTokenProvider,
} from "../ledger/api";
import { clearClientCaches } from "./client-caches";
import {
  clearDemoSessionId,
  demoEmail,
  getDemoSessionId,
  setDemoSessionId,
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
  /**
   * demo-maria-session T9 (S10): the session is the demo account but
   * its sid/seed is not ready yet — the gate must hold a "preparing"
   * state instead of landing the visitor on an empty ledger while
   * the async seed is still generating data.
   */
  demoPending: boolean;
  /**
   * demo-seed-six-months T6 (S7): the session belongs to the demo
   * account — the UI hides credentials actions (password change) that
   * would mutate the shared demo identity.
   */
  isDemoSession: boolean;
  session: Session | null;
  signIn: (email: string, password: string) => Promise<void>;
  /**
   * Enters the "María" demo (demo-maria-session T8, S1–S3; L10): a
   * real Supabase password sign-in with the env-provided demo email,
   * followed by `POST /demo/session` with the fresh bearer — the
   * returned sid is stored per-tab and rides as `x-demo-session` on
   * every API call. The demo is therefore an ordinary signed-in
   * session; only the password is needed from the visitor.
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
  demoPending: false,
  isDemoSession: false,
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

/**
 * Restore-path demo mint (demo-maria-session R3-001): a signed-in
 * Supabase demo user whose per-tab sid is gone (new tab, cleared
 * storage) would hit fail-closed 403s on every API call — a dead
 * demo tab. Minting a fresh sid is fire-and-forget: a fresh sid means
 * a fresh seeded workspace, which is correct under the discard model.
 * The in-flight flag keeps concurrent restore paths from minting
 * twice; a failure is swallowed (the session stays usable, the API
 * keeps failing closed) and the next demo sign-in mints again — the
 * mint never loops on its own.
 */
let restoredDemoMint: Promise<void> | null = null;

/**
 * demo-maria-session T9 (S10): bounded poll of
 * `GET /demo/session/status` — the async seed takes a few seconds
 * (~bootstrap + 3 month batches), so the client holds the demo gate
 * until the workspace already shows ledger rows instead of landing
 * on an empty view. The timeout guarantees a stuck or failed seed
 * never wedges the demo — the visitor lands on the (possibly empty)
 * ledger rather than on an eternal spinner, and the API keeps
 * failing closed if the sid itself never materialized.
 */
const DEMO_SEED_POLL_MS = 500;
const DEMO_SEED_TIMEOUT_MS = 20000;

async function waitForDemoSeed(deadline: number): Promise<void> {
  for (;;) {
    try {
      const { ready } = await getDemoSessionStatus();
      if (ready) return;
    } catch {
      // Best-effort — a transient error simply retries next tick.
    }
    if (Date.now() >= deadline) return;
    await new Promise((resolve) => setTimeout(resolve, DEMO_SEED_POLL_MS));
  }
}

function mintRestoredDemoSession(session: Session): void {
  if (getDemoSessionId() !== null || restoredDemoMint !== null) return;
  const email = demoEmail();
  if (email === null || session.user.email !== email) return;
  restoredDemoMint = createDemoSession()
    .then(({ sessionId }) => {
      setDemoSessionId(sessionId);
    })
    .catch(() => {
      // Best-effort — nothing to surface; see the contract above.
    })
    .finally(() => {
      restoredDemoMint = null;
    });
}

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
  // demo-maria-session T9 (S10): the demo gate holds until the sid
  // exists AND the async seed has produced ledger rows — the visitor
  // must never land on an empty ledger mid-seed.
  const [demoReady, setDemoReady] = useState(false);
  // demo-maria-session T8: the demo is a real Supabase session — no
  // pseudo-session or demo flag exists; the per-tab sid lives in
  // sessionStorage and only affects request headers.
  const session = supabaseSession;
  const isDemoSession =
    session !== null &&
    demoEmail() !== null &&
    session.user.email === demoEmail();

  useEffect(() => {
    if (!isDemoSession) {
      setDemoReady(false);
      return;
    }
    let active = true;
    void (async () => {
      // ONE deadline covers mint + seed (advisory R3-001): a stalled
      // restore-time POST /demo/session must never wedge the gate,
      // exactly like a seed that never reports ready. A failed mint
      // leaves no sid; we unblock anyway so the visitor sees the app
      // (fail-closed API errors) instead of an eternal spinner.
      const deadline = Date.now() + DEMO_SEED_TIMEOUT_MS;
      if (restoredDemoMint !== null) {
        await Promise.race([
          restoredDemoMint.catch(() => {}),
          new Promise((resolve) =>
            setTimeout(resolve, DEMO_SEED_TIMEOUT_MS),
          ),
        ]);
      }
      if (getDemoSessionId() !== null && Date.now() < deadline) {
        await waitForDemoSeed(deadline);
      }
      if (active) setDemoReady(true);
    })();
    return () => {
      active = false;
    };
  }, [isDemoSession]);

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
      // R3-001: restore-path sid mint for the demo account.
      if (data.session) mintRestoredDemoSession(data.session);
    });

    const { data } = supabase.auth.onAuthStateChange((_event, next) => {
      // R3-004: never publish a demo session whose per-tab sid is
      // still being minted — ledger queries would fire without
      // x-demo-session and hit the fail-closed resolver. signInDemo
      // and the restore path publish the demo session themselves.
      const email = demoEmail();
      if (
        next !== null &&
        email !== null &&
        next.user.email === email &&
        getDemoSessionId() === null
      ) {
        return;
      }
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

  // demo-maria-session T8 (S1–S3; L10): real sign-in with the
  // env-provided demo email, then `POST /demo/session` materializes
  // the ephemeral workspace and the sid is stored per-tab. If the
  // session POST fails the Supabase sign-in is rolled back — a demo
  // session without sid can only produce fail-closed 403s on the API,
  // so it is never left half-open.
  const signInDemo = useCallback(async (password: string) => {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase.auth.signInWithPassword({
      email: demoEmail() ?? "",
      password,
    });
    if (error) throw error;
    try {
      // R3-004: the sid must be stored BEFORE the session is
      // published — otherwise ledger queries can fire without
      // x-demo-session between the two updates and fail closed.
      const { sessionId } = await createDemoSession();
      setDemoSessionId(sessionId);
    } catch (sessionError) {
      await supabase.auth.signOut().catch(() => {});
      setSupabaseSession(null);
      throw sessionError;
    }
    setSupabaseSession(data.session);
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
    // demo-maria-session T8 (L10): a stored sid marks the session as
    // demo — ask the API to tear down the ephemeral workspace (and
    // sweep orphans) BEFORE ending the Supabase session. Best-effort:
    // a failed DELETE must never block or break the sign-out.
    if (getDemoSessionId()) {
      await deleteDemoSession().catch(() => {});
    }
    // supabase-js resolves {error} on server 5xx without throwing;
    // in that path the session is still valid, so the wipe must not run.
    const { error } = await getSupabaseClient().auth.signOut();
    if (error) throw error;
    // The per-tab sid is dropped together with the caches (no-op for
    // non-demo sessions).
    clearDemoSessionId();
    await clearClientCaches();
  }, []);

  const updatePassword = useCallback(async (newPassword: string) => {
    // T6 (S7): the demo account's password is shared infrastructure —
    // refuse before it reaches Supabase Auth (defense in depth; the
    // menu item is already hidden).
    const demo = demoEmail();
    if (
      demo !== null &&
      session?.user.email?.toLowerCase() === demo.toLowerCase()
    ) {
      throw new Error("Password change is not available in the demo session");
    }
    const { error } = await getSupabaseClient().auth.updateUser({
      password: newPassword,
    });
    if (error) throw error;
  }, [session]);

  // T1 (S1–S4): auto signOut after 10 idle minutes; the hook is inert
  // without a session, so bypass/misconfigured states stay unaffected.
  useInactivityLogout(session, signOut);

  const value = useMemo<AuthContextValue>(
    () => ({
      bypassed,
      configured,
      misconfigured,
      loading,
      demoPending: isDemoSession && !demoReady,
      isDemoSession,
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
      isDemoSession,
      demoReady,
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
