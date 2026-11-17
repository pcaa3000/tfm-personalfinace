// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
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

const TEN_MINUTES_MS = 10 * 60 * 1000;

function makeClient(signOut = vi.fn(async () => ({ error: null }))) {
  const session = {
    access_token: "token",
    user: { id: "u1", email: "a@b.c" },
  };
  return {
    signOut,
    client: {
      auth: {
        getSession: vi.fn(async () => ({ data: { session }, error: null })),
        onAuthStateChange: vi.fn(() => ({
          data: { subscription: { unsubscribe: vi.fn() } },
        })),
        signInWithPassword: vi.fn(async () => ({ data: {}, error: null })),
        signInWithOAuth: vi.fn(async () => ({ data: {}, error: null })),
        signUp: vi.fn(async () => ({ data: {}, error: null })),
        signOut,
        updateUser: vi.fn(async () => ({ data: {}, error: null })),
      },
    },
  };
}

function Probe() {
  const { session } = useAuth();
  return <span data-testid="email">{session?.user.email ?? "none"}</span>;
}

async function renderSignedIn(signOut = vi.fn(async () => ({ error: null }))) {
  const { client } = makeClient(signOut);
  getSupabaseClient.mockReturnValue(client);
  render(
    <AuthProvider>
      <Probe />
    </AuthProvider>,
  );
  await screen.findByText("a@b.c");
  return signOut;
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("inactivity logout (session-inactivity-logout)", () => {
  it("S1: signs out after 10 minutes without activity", async () => {
    const signOut = await renderSignedIn();
    vi.useFakeTimers();
    // The render-time timeout was armed with real timers before
    // vi.useFakeTimers(); one activity event re-arms it under the
    // fake clock so the idle window below is measurable.
    act(() => {
      window.dispatchEvent(new Event("mousemove"));
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(TEN_MINUTES_MS);
    });
    expect(signOut).toHaveBeenCalledTimes(1);
  });

  it("S1: does not sign out before 10 minutes", async () => {
    const signOut = await renderSignedIn();
    vi.useFakeTimers();
    // R3: re-arm under the fake clock — otherwise this spec is vacuous
    // (the render-time timeout used real timers and could never fire).
    act(() => {
      window.dispatchEvent(new Event("mousemove"));
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(TEN_MINUTES_MS - 1);
    });
    expect(signOut).not.toHaveBeenCalled();
  });

  it.each(["mousemove", "mousedown", "keydown", "touchstart", "scroll"])(
    "S2: %s resets the 10-minute timer",
    async (eventName) => {
      const signOut = await renderSignedIn();
      vi.useFakeTimers();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(TEN_MINUTES_MS - 1);
      });
      act(() => {
        window.dispatchEvent(new Event(eventName));
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(TEN_MINUTES_MS - 1);
      });
      expect(signOut).not.toHaveBeenCalled();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1);
      });
      expect(signOut).toHaveBeenCalledTimes(1);
    },
  );

  it("R1-001 (S2): a storage event for the shared key resets the timer", async () => {
    const signOut = await renderSignedIn();
    vi.useFakeTimers();
    act(() => {
      window.dispatchEvent(new Event("mousemove"));
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(TEN_MINUTES_MS - 1);
    });
    // Activity in another tab arrives here as a `storage` event.
    act(() => {
      window.dispatchEvent(
        new StorageEvent("storage", { key: "pf-inactivity-last-activity" }),
      );
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(TEN_MINUTES_MS - 1);
    });
    expect(signOut).not.toHaveBeenCalled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(signOut).toHaveBeenCalledTimes(1);
  });

  it("S3: no timer runs without a session", async () => {
    const client = {
      auth: {
        getSession: vi.fn(async () => ({ data: { session: null } })),
        onAuthStateChange: vi.fn(() => ({
          data: { subscription: { unsubscribe: vi.fn() } },
        })),
        signOut: vi.fn(async () => ({ error: null })),
      },
    };
    getSupabaseClient.mockReturnValue(client);
    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );
    await screen.findByText("none");
    vi.useFakeTimers();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(TEN_MINUTES_MS * 2);
    });
    expect(client.auth.signOut).not.toHaveBeenCalled();
  });
});
