import { afterEach, describe, expect, it, vi } from "vitest";

const createClient = vi.hoisted(() => vi.fn());
vi.mock("@supabase/supabase-js", () => ({ createClient }));

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
  createClient.mockReset();
});

describe("supabase client factory", () => {
  it("isAuthConfigured is false when env vars are missing", async () => {
    vi.stubEnv("VITE_SUPABASE_URL", "");
    vi.stubEnv("VITE_SUPABASE_ANON_KEY", "");
    const { isAuthConfigured } = await import("./supabase");
    expect(isAuthConfigured()).toBe(false);
  });

  it("isAuthConfigured is true only when both env vars are set", async () => {
    vi.stubEnv("VITE_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("VITE_SUPABASE_ANON_KEY", "anon-key");
    const { isAuthConfigured } = await import("./supabase");
    expect(isAuthConfigured()).toBe(true);
  });

  it("isAuthConfigured is false when only one env var is set", async () => {
    vi.stubEnv("VITE_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("VITE_SUPABASE_ANON_KEY", "");
    const { isAuthConfigured } = await import("./supabase");
    expect(isAuthConfigured()).toBe(false);
  });

  it("creates the client lazily with PKCE flow and env credentials", async () => {
    vi.stubEnv("VITE_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("VITE_SUPABASE_ANON_KEY", "anon-key");
    createClient.mockReturnValue({ marker: "client" });

    const { getSupabaseClient } = await import("./supabase");
    const client = getSupabaseClient();

    expect(createClient).toHaveBeenCalledTimes(1);
    expect(createClient).toHaveBeenCalledWith("https://example.supabase.co", "anon-key", {
      auth: { flowType: "pkce" },
    });
    expect(client).toBe(createClient.mock.results[0]?.value);
  });

  it("memoizes the client across calls", async () => {
    vi.stubEnv("VITE_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("VITE_SUPABASE_ANON_KEY", "anon-key");
    createClient.mockReturnValue({ marker: "client" });

    const { getSupabaseClient } = await import("./supabase");
    const first = getSupabaseClient();
    const second = getSupabaseClient();

    expect(first).toBe(second);
    expect(createClient).toHaveBeenCalledTimes(1);
  });
});

describe("isAuthBypassed (T26)", () => {
  it("isAuthConfigured stays a pure credentials check even when bypass is set", async () => {
    vi.stubEnv("VITE_AUTH_BYPASS", "true");
    vi.stubEnv("VITE_SUPABASE_URL", "");
    vi.stubEnv("VITE_SUPABASE_ANON_KEY", "");
    const { isAuthConfigured } = await import("./supabase");
    expect(isAuthConfigured()).toBe(false);
  });

  it("is true only when VITE_AUTH_BYPASS is exactly 'true' in a dev build", async () => {
    vi.stubEnv("VITE_AUTH_BYPASS", "true");
    const { isAuthBypassed } = await import("./supabase");
    expect(isAuthBypassed()).toBe(true);
  });

  it("is false when VITE_AUTH_BYPASS is unset", async () => {
    vi.stubEnv("VITE_AUTH_BYPASS", undefined);
    const { isAuthBypassed } = await import("./supabase");
    expect(isAuthBypassed()).toBe(false);
  });

  it("is false when VITE_AUTH_BYPASS is not exactly 'true'", async () => {
    vi.stubEnv("VITE_AUTH_BYPASS", "1");
    const { isAuthBypassed } = await import("./supabase");
    expect(isAuthBypassed()).toBe(false);
  });

  it("can never bypass in a production build even with the flag set", async () => {
    vi.stubEnv("DEV", false);
    vi.stubEnv("VITE_AUTH_BYPASS", "true");
    const { isAuthBypassed } = await import("./supabase");
    expect(isAuthBypassed()).toBe(false);
  });
});
