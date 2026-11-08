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

import { AuthProvider, useAuth } from "./auth";

afterEach(() => {
  cleanup();
  isAuthBypassed.mockReturnValue(false);
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
      signUp: vi.fn(async () => ({ data: {}, error: null })),
      signOut: vi.fn(async () => ({ error: null })),
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
