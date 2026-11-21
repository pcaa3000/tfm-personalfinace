// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const getSupabaseClient = vi.hoisted(() => vi.fn());
const isAuthConfigured = vi.hoisted(() => vi.fn(() => true));
const isAuthBypassed = vi.hoisted(() => vi.fn(() => false));
vi.mock("./supabase", () => ({
  getSupabaseClient,
  isAuthConfigured,
  isAuthBypassed,
}));

import { queryClient } from "../../query-client";
import { setAccessTokenProvider } from "../ledger/api";
import { inputFixture } from "../ledger/offline/fixtures";
import {
  enqueueTransaction,
  ledgerDb,
  listPendingTransactions,
} from "../ledger/offline/queue";
import { AuthProvider, useAuth } from "./auth";

afterEach(async () => {
  cleanup();
  isAuthBypassed.mockReturnValue(false);
  setAccessTokenProvider(null);
  localStorage.clear();
  sessionStorage.clear();
  vi.unstubAllGlobals();
  queryClient.clear();
  await ledgerDb.pendingTransactions.clear();
});

function makeClient(overrides: Record<string, unknown> = {}) {
  const unsubscribe = vi.fn();
  return {
    auth: {
      getSession: vi.fn(async () => ({ data: { session: null }, error: null })),
      onAuthStateChange: vi.fn(() => ({
        data: { subscription: { unsubscribe } },
      })),
      signInWithPassword: vi.fn(async () => ({ data: {}, error: null })),
      signInWithOAuth: vi.fn(async () => ({ data: {}, error: null })),
      signUp: vi.fn(async () => ({ data: {}, error: null })),
      signOut: vi.fn(async () => ({ error: null })),
      updateUser: vi.fn(async () => ({ data: {}, error: null })),
      ...overrides,
    },
    unsubscribe,
  };
}

function Probe() {
  const { configured, misconfigured, loading, session, signOut } = useAuth();
  return (
    <div>
      <span data-testid="configured">{String(configured)}</span>
      <span data-testid="misconfigured">{String(misconfigured)}</span>
      <span data-testid="loading">{String(loading)}</span>
      <span data-testid="email">{session?.user.email ?? "none"}</span>
      <button onClick={() => void signOut()}>logout</button>
    </div>
  );
}

function renderProvider() {
  return render(
    <AuthProvider>
      <Probe />
    </AuthProvider>,
  );
}

describe("AuthProvider", () => {
  it("bypasses auth in dev: configured=false, misconfigured=false, no session load", async () => {
    isAuthBypassed.mockReturnValue(true);
    // Credentials present must not matter: bypass wins (T26).
    isAuthConfigured.mockReturnValue(true);
    const client = makeClient();
    getSupabaseClient.mockReturnValue(client);

    renderProvider();

    await waitFor(() => {
      expect(screen.getByTestId("configured").textContent).toBe("false");
    });
    expect(screen.getByTestId("misconfigured").textContent).toBe("false");
    expect(screen.getByTestId("loading").textContent).toBe("false");
    expect(client.auth.getSession).not.toHaveBeenCalled();
    expect(client.auth.onAuthStateChange).not.toHaveBeenCalled();
  });

  it("fails closed when auth is required but credentials are missing", async () => {
    isAuthBypassed.mockReturnValue(false);
    isAuthConfigured.mockReturnValue(false);
    const client = makeClient();
    getSupabaseClient.mockReturnValue(client);

    renderProvider();

    await waitFor(() => {
      expect(screen.getByTestId("misconfigured").textContent).toBe("true");
    });
    expect(screen.getByTestId("configured").textContent).toBe("false");
    expect(screen.getByTestId("loading").textContent).toBe("false");
    expect(client.auth.getSession).not.toHaveBeenCalled();
    expect(client.auth.onAuthStateChange).not.toHaveBeenCalled();
  });

  it("resolves the initial session via getSession", async () => {
    isAuthConfigured.mockReturnValue(true);
    const session = {
      access_token: "tok-1",
      user: { id: "u-1", email: "ana@example.com" },
    };
    const client = makeClient({
      getSession: vi.fn(async () => ({ data: { session }, error: null })),
    });
    getSupabaseClient.mockReturnValue(client);

    renderProvider();

    await waitFor(() => {
      expect(screen.getByTestId("loading").textContent).toBe("false");
    });
    expect(screen.getByTestId("misconfigured").textContent).toBe("false");
    expect(screen.getByTestId("email").textContent).toBe("ana@example.com");
    expect(client.auth.getSession).toHaveBeenCalledTimes(1);
    expect(client.auth.onAuthStateChange).toHaveBeenCalledTimes(1);
  });

  it("stays without a session when getSession returns none", async () => {
    isAuthConfigured.mockReturnValue(true);
    getSupabaseClient.mockReturnValue(makeClient());

    renderProvider();

    await waitFor(() => {
      expect(screen.getByTestId("loading").textContent).toBe("false");
    });
    expect(screen.getByTestId("email").textContent).toBe("none");
  });

  it("signIn delegates to signInWithPassword and updates the session", async () => {
    isAuthConfigured.mockReturnValue(true);
    const session = {
      access_token: "tok-2",
      user: { id: "u-2", email: "bo@example.com" },
    };
    const client = makeClient({
      signInWithPassword: vi.fn(async () => ({
        data: { session, user: session.user },
        error: null,
      })),
    });
    getSupabaseClient.mockReturnValue(client);

    function SignInProbe() {
      const { signIn } = useAuth();
      return (
        <button onClick={() => void signIn("bo@example.com", "secret")}>go</button>
      );
    }
    render(
      <AuthProvider>
        <SignInProbe />
        <Probe />
      </AuthProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("loading").textContent).toBe("false");
    });
    fireEvent.click(screen.getByRole("button", { name: "go" }));

    await waitFor(() => {
      expect(client.auth.signInWithPassword).toHaveBeenCalledWith({
        email: "bo@example.com",
        password: "secret",
      });
    });
    await waitFor(() => {
      expect(screen.getByTestId("email").textContent).toBe("bo@example.com");
    });
  });

  it("signIn rethrows the auth error", async () => {
    isAuthConfigured.mockReturnValue(true);
    const failure = new Error("Invalid login credentials");
    const client = makeClient({
      signInWithPassword: vi.fn(async () => ({ data: {}, error: failure })),
    });
    getSupabaseClient.mockReturnValue(client);

    let caught: unknown = null;
    function FailProbe() {
      const { signIn } = useAuth();
      return (
        <button
          onClick={async () => {
            try {
              await signIn("x@example.com", "bad");
            } catch (error) {
              caught = error;
            }
          }}
        >
          go
        </button>
      );
    }
    render(
      <AuthProvider>
        <FailProbe />
      </AuthProvider>,
    );

    fireEvent.click(await screen.findByRole("button", { name: "go" }));

    await waitFor(() => {
      expect(caught).toBe(failure);
    });
  });

  // T30 (S13): social login via supabase.auth.signInWithOAuth. The
  // PKCE redirect navigates the browser away, so no session is set
  // locally on success — the local session must stay untouched.
  it("signInWithOAuth delegates to supabase signInWithOAuth and leaves the local session unset", async () => {
    isAuthConfigured.mockReturnValue(true);
    const client = makeClient();
    getSupabaseClient.mockReturnValue(client);

    let done = false;
    function OAuthProbe() {
      const { signInWithOAuth } = useAuth();
      return (
        <button
          onClick={async () => {
            await signInWithOAuth("google");
            done = true;
          }}
        >
          go
        </button>
      );
    }
    render(
      <AuthProvider>
        <OAuthProbe />
        <Probe />
      </AuthProvider>,
    );

    fireEvent.click(await screen.findByRole("button", { name: "go" }));

    await waitFor(() => {
      expect(done).toBe(true);
    });
    expect(client.auth.signInWithOAuth).toHaveBeenCalledWith({
      provider: "google",
    });
    // The redirect flow owns the session — nothing is stored locally.
    expect(screen.getByTestId("email").textContent).toBe("none");
  });

  it("signInWithOAuth delegates the facebook provider", async () => {
    isAuthConfigured.mockReturnValue(true);
    const client = makeClient();
    getSupabaseClient.mockReturnValue(client);

    function OAuthProbe() {
      const { signInWithOAuth } = useAuth();
      return (
        <button onClick={() => void signInWithOAuth("facebook")}>go</button>
      );
    }
    render(
      <AuthProvider>
        <OAuthProbe />
      </AuthProvider>,
    );

    fireEvent.click(await screen.findByRole("button", { name: "go" }));

    await waitFor(() => {
      expect(client.auth.signInWithOAuth).toHaveBeenCalledWith({
        provider: "facebook",
      });
    });
  });

  it("signInWithOAuth rethrows the auth error", async () => {
    isAuthConfigured.mockReturnValue(true);
    const failure = new Error("Provider is not enabled");
    const client = makeClient({
      signInWithOAuth: vi.fn(async () => ({ data: {}, error: failure })),
    });
    getSupabaseClient.mockReturnValue(client);

    let caught: unknown = null;
    function FailProbe() {
      const { signInWithOAuth } = useAuth();
      return (
        <button
          onClick={async () => {
            try {
              await signInWithOAuth("google");
            } catch (error) {
              caught = error;
            }
          }}
        >
          go
        </button>
      );
    }
    render(
      <AuthProvider>
        <FailProbe />
      </AuthProvider>,
    );

    fireEvent.click(await screen.findByRole("button", { name: "go" }));

    await waitFor(() => {
      expect(caught).toBe(failure);
    });
  });

  it("signUp delegates to supabase signUp", async () => {
    isAuthConfigured.mockReturnValue(true);
    const client = makeClient();
    getSupabaseClient.mockReturnValue(client);

    function SignUpProbe() {
      const { signUp } = useAuth();
      return (
        <button onClick={() => void signUp("new@example.com", "pw")}>go</button>
      );
    }
    render(
      <AuthProvider>
        <SignUpProbe />
      </AuthProvider>,
    );

    fireEvent.click(await screen.findByRole("button", { name: "go" }));

    await waitFor(() => {
      expect(client.auth.signUp).toHaveBeenCalledWith({
        email: "new@example.com",
        password: "pw",
      });
    });
  });

  it("updatePassword delegates to supabase updateUser", async () => {
    isAuthConfigured.mockReturnValue(true);
    const client = makeClient();
    getSupabaseClient.mockReturnValue(client);

    function PwProbe() {
      const { updatePassword } = useAuth();
      return (
        <button onClick={() => void updatePassword("new-secret-1")}>
          go
        </button>
      );
    }
    render(
      <AuthProvider>
        <PwProbe />
      </AuthProvider>,
    );

    fireEvent.click(await screen.findByRole("button", { name: "go" }));

    await waitFor(() => {
      expect(client.auth.updateUser).toHaveBeenCalledWith({
        password: "new-secret-1",
      });
    });
  });

  it("updatePassword rethrows the auth error", async () => {
    isAuthConfigured.mockReturnValue(true);
    const failure = new Error("New password should be different");
    const client = makeClient({
      updateUser: vi.fn(async () => ({ data: {}, error: failure })),
    });
    getSupabaseClient.mockReturnValue(client);

    let caught: unknown = null;
    function FailProbe() {
      const { updatePassword } = useAuth();
      return (
        <button
          onClick={async () => {
            try {
              await updatePassword("weak");
            } catch (error) {
              caught = error;
            }
          }}
        >
          go
        </button>
      );
    }
    render(
      <AuthProvider>
        <FailProbe />
      </AuthProvider>,
    );

    fireEvent.click(await screen.findByRole("button", { name: "go" }));

    await waitFor(() => {
      expect(caught).toBe(failure);
    });
  });

  // GAP-SEC-08 (S6): on a shared browser nothing of identity A may
  // survive logout — the Dexie outbox and the React Query cache are
  // wiped together with the session.
  it("signOut clears the offline queue and the React Query cache", async () => {
    isAuthConfigured.mockReturnValue(true);
    const session = {
      access_token: "tok-9",
      user: { id: "u-9", email: "di@example.com" },
    };
    const client = makeClient({
      getSession: vi.fn(async () => ({ data: { session }, error: null })),
    });
    getSupabaseClient.mockReturnValue(client);
    setAccessTokenProvider(null);
    await enqueueTransaction(inputFixture({ idempotencyKey: "queued-1" }));
    queryClient.setQueryData(["transactions"], [{ id: "cached" }]);

    renderProvider();

    await waitFor(() => {
      expect(screen.getByTestId("email").textContent).toBe("di@example.com");
    });
    fireEvent.click(screen.getByRole("button", { name: "logout" }));

    await waitFor(() => {
      expect(client.auth.signOut).toHaveBeenCalledTimes(1);
    });
    await waitFor(async () => {
      expect(await listPendingTransactions()).toHaveLength(0);
    });
    expect(queryClient.getQueryData(["transactions"])).toBeUndefined();
  });

  it("signOut keeps the offline queue and cache when the auth call returns an error (S6)", async () => {
    // supabase-js signOut resolves {error} on server 5xx — it does not
    // throw. The session is still valid, so queued financial data and
    // the cache must NOT be destroyed. signOut() rethrows the auth error
    // to the caller, so the probe must catch it — a bare `void signOut()`
    // would leave an unhandled rejection and fail the suite run.
    isAuthConfigured.mockReturnValue(true);
    const session = {
      access_token: "tok-err",
      user: { id: "u-err", email: "e@example.com" },
    };
    const failure = new Error("server error");
    const client = makeClient({
      getSession: vi.fn(async () => ({ data: { session }, error: null })),
      signOut: vi.fn(async () => ({ error: failure })),
    });
    getSupabaseClient.mockReturnValue(client);
    setAccessTokenProvider(null);
    await enqueueTransaction(inputFixture({ idempotencyKey: "keep-me" }));
    queryClient.setQueryData(["transactions"], [{ id: "cached" }]);

    let caught: unknown = null;
    function FailProbe() {
      const { signOut } = useAuth();
      return (
        <button
          onClick={async () => {
            try {
              await signOut();
            } catch (error) {
              caught = error;
            }
          }}
        >
          logout-error
        </button>
      );
    }
    render(
      <AuthProvider>
        <Probe />
        <FailProbe />
      </AuthProvider>,
    );
    await waitFor(() => {
      expect(screen.getByTestId("email").textContent).toBe("e@example.com");
    });
    fireEvent.click(screen.getByRole("button", { name: "logout-error" }));

    await waitFor(() => {
      expect(client.auth.signOut).toHaveBeenCalledTimes(1);
    });
    // The error still propagates to the caller (L4 fix) — it just must
    // not destroy anything owned by the still-valid session.
    await waitFor(() => {
      expect(caught).toBe(failure);
    });
    expect(await listPendingTransactions()).toHaveLength(1);
    expect(queryClient.getQueryData(["transactions"])).toBeDefined();
  });

  // demo-maria-session T3 (S1+S2+S3): signInDemo does a real Supabase
  // password sign-in with the fixed demo email, then POSTs
  // /demo/session with the bearer and stores the returned sid in
  // sessionStorage (per-tab). The demo is a normal signed-in session —
  // no pseudo-session, no localStorage flag.
  it("signInDemo signs in with the fixed demo email, creates the demo session and stores the sid", async () => {
    isAuthConfigured.mockReturnValue(true);
    let currentSession: unknown = null;
    const demoSession = {
      access_token: "demo-tok",
      user: { id: "demo-1", email: "mariademo@example.com" },
    };
    const client = makeClient({
      getSession: vi.fn(async () => ({
        data: { session: currentSession },
        error: null,
      })),
      signInWithPassword: vi.fn(async () => {
        currentSession = demoSession;
        return { data: { session: demoSession }, error: null };
      }),
    });
    getSupabaseClient.mockReturnValue(client);
    const fetchSpy = vi.fn<typeof fetch>(
      async () =>
        new Response(JSON.stringify({ sessionId: "sid-1" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );
    vi.stubGlobal("fetch", fetchSpy);

    function DemoProbe() {
      const { session, signInDemo } = useAuth();
      return (
        <>
          <span data-testid="demo-email">
            {session?.user.email ?? "none"}
          </span>
          <button onClick={() => void signInDemo("demo-pw")}>demo</button>
        </>
      );
    }
    render(
      <AuthProvider>
        <DemoProbe />
      </AuthProvider>,
    );

    fireEvent.click(await screen.findByRole("button", { name: "demo" }));

    await waitFor(() => {
      expect(client.auth.signInWithPassword).toHaveBeenCalledWith({
        email: "mariademo@example.com",
        password: "demo-pw",
      });
    });
    await waitFor(() => {
      expect(sessionStorage.getItem("demo-sid")).toBe("sid-1");
    });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0] ?? [];
    expect(String(url)).toBe("/api/v1/demo/session");
    expect((init as RequestInit | undefined)?.method).toBe("POST");
    const headers = new Headers(
      (init as RequestInit | undefined)?.headers,
    );
    expect(headers.get("authorization")).toBe("Bearer demo-tok");
    expect(headers.get("x-dev-user")).toBeNull();
    await waitFor(() => {
      expect(screen.getByTestId("demo-email").textContent).toBe(
        "mariademo@example.com",
      );
    });
    // The old client-side flag flow is gone entirely (T3).
    expect(localStorage.getItem("demo-session")).toBeNull();
  });

  it("does not create a demo session or store a sid when the demo password sign-in fails", async () => {
    isAuthConfigured.mockReturnValue(true);
    const failure = new Error("Invalid login credentials");
    const client = makeClient({
      signInWithPassword: vi.fn(async () => ({ data: {}, error: failure })),
    });
    getSupabaseClient.mockReturnValue(client);
    const fetchSpy = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetchSpy);

    let caught: unknown = null;
    function DemoProbe() {
      const { session, signInDemo } = useAuth();
      return (
        <>
          <span data-testid="demo-email">
            {session?.user.email ?? "none"}
          </span>
          <button
            onClick={async () => {
              try {
                await signInDemo("bad-pw");
              } catch (error) {
                caught = error;
              }
            }}
          >
            demo
          </button>
        </>
      );
    }
    render(
      <AuthProvider>
        <DemoProbe />
      </AuthProvider>,
    );

    fireEvent.click(await screen.findByRole("button", { name: "demo" }));

    await waitFor(() => {
      expect(caught).toBe(failure);
    });
    expect(client.auth.signInWithPassword).toHaveBeenCalledWith({
      email: "mariademo@example.com",
      password: "bad-pw",
    });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(sessionStorage.getItem("demo-sid")).toBeNull();
    expect(screen.getByTestId("demo-email").textContent).toBe("none");
  });

  it("rolls back the Supabase sign-in and stores no sid when /demo/session fails", async () => {
    isAuthConfigured.mockReturnValue(true);
    let currentSession: unknown = null;
    const demoSession = {
      access_token: "demo-tok",
      user: { id: "demo-1", email: "mariademo@example.com" },
    };
    const client = makeClient({
      getSession: vi.fn(async () => ({
        data: { session: currentSession },
        error: null,
      })),
      signInWithPassword: vi.fn(async () => {
        currentSession = demoSession;
        return { data: { session: demoSession }, error: null };
      }),
    });
    getSupabaseClient.mockReturnValue(client);
    const fetchSpy = vi.fn<typeof fetch>(
      async () =>
        new Response(JSON.stringify({ code: "GENERIC" }), {
          status: 500,
          headers: { "content-type": "application/json" },
        }),
    );
    vi.stubGlobal("fetch", fetchSpy);

    let caught: unknown = null;
    function DemoProbe() {
      const { session, signInDemo } = useAuth();
      return (
        <>
          <span data-testid="demo-email">
            {session?.user.email ?? "none"}
          </span>
          <button
            onClick={async () => {
              try {
                await signInDemo("demo-pw");
              } catch (error) {
                caught = error;
              }
            }}
          >
            demo
          </button>
        </>
      );
    }
    render(
      <AuthProvider>
        <DemoProbe />
      </AuthProvider>,
    );

    fireEvent.click(await screen.findByRole("button", { name: "demo" }));

    await waitFor(() => {
      expect(caught).not.toBeNull();
    });
    expect(sessionStorage.getItem("demo-sid")).toBeNull();
    // A real demo session without sid would be fail-closed 401s on the
    // API (S5), so the sign-in is rolled back.
    expect(client.auth.signOut).toHaveBeenCalledTimes(1);
    await waitFor(() => {
      expect(screen.getByTestId("demo-email").textContent).toBe("none");
    });
  });

  it("signOut calls the Supabase signOut and clears the demo sid together with the caches", async () => {
    sessionStorage.setItem("demo-sid", "sid-9");
    isAuthConfigured.mockReturnValue(true);
    const session = {
      access_token: "demo-tok",
      user: { id: "demo-1", email: "mariademo@example.com" },
    };
    const client = makeClient({
      getSession: vi.fn(async () => ({ data: { session }, error: null })),
    });
    getSupabaseClient.mockReturnValue(client);
    await enqueueTransaction(inputFixture({ idempotencyKey: "demo-queued" }));
    queryClient.setQueryData(["transactions"], [{ id: "cached" }]);

    renderProvider();
    await waitFor(() => {
      expect(screen.getByTestId("email").textContent).toBe(
        "mariademo@example.com",
      );
    });

    fireEvent.click(screen.getByRole("button", { name: "logout" }));

    await waitFor(() => {
      expect(client.auth.signOut).toHaveBeenCalledTimes(1);
    });
    expect(sessionStorage.getItem("demo-sid")).toBeNull();
    await waitFor(async () => {
      expect(await listPendingTransactions()).toHaveLength(0);
    });
    expect(queryClient.getQueryData(["transactions"])).toBeUndefined();
  });

  it("signOut keeps the demo sid when the auth call fails", async () => {
    sessionStorage.setItem("demo-sid", "sid-9");
    isAuthConfigured.mockReturnValue(true);
    const session = {
      access_token: "demo-tok",
      user: { id: "demo-1", email: "mariademo@example.com" },
    };
    const failure = new Error("server error");
    const client = makeClient({
      getSession: vi.fn(async () => ({ data: { session }, error: null })),
      signOut: vi.fn(async () => ({ error: failure })),
    });
    getSupabaseClient.mockReturnValue(client);

    let caught: unknown = null;
    function FailProbe() {
      const { signOut } = useAuth();
      return (
        <button
          onClick={async () => {
            try {
              await signOut();
            } catch (error) {
              caught = error;
            }
          }}
        >
          logout-error
        </button>
      );
    }
    render(
      <AuthProvider>
        <Probe />
        <FailProbe />
      </AuthProvider>,
    );
    await waitFor(() => {
      expect(screen.getByTestId("email").textContent).toBe(
        "mariademo@example.com",
      );
    });

    fireEvent.click(screen.getByRole("button", { name: "logout-error" }));

    await waitFor(() => {
      expect(caught).toBe(failure);
    });
    // The session is still valid, so the sid survives exactly like the
    // queued data and the cache (S6 fail-safe).
    expect(sessionStorage.getItem("demo-sid")).toBe("sid-9");
  });

  it("signOut clears the session through the auth client", async () => {
    isAuthConfigured.mockReturnValue(true);
    const session = {
      access_token: "tok-3",
      user: { id: "u-3", email: "ca@example.com" },
    };
    const client = makeClient({
      getSession: vi.fn(async () => ({ data: { session }, error: null })),
    });
    getSupabaseClient.mockReturnValue(client);

    renderProvider();

    await waitFor(() => {
      expect(screen.getByTestId("email").textContent).toBe("ca@example.com");
    });
    fireEvent.click(screen.getByRole("button", { name: "logout" }));

    await waitFor(() => {
      expect(client.auth.signOut).toHaveBeenCalledTimes(1);
    });
  });
});
