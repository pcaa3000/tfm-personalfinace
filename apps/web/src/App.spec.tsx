// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const isAuthConfigured = vi.hoisted(() => vi.fn(() => true));
const isAuthBypassed = vi.hoisted(() => vi.fn(() => false));
const useAuth = vi.hoisted(() => vi.fn());
vi.mock("./features/auth/auth", () => ({
  AuthProvider: ({ children }: { children: React.ReactNode }) => children,
  useAuth,
}));
vi.mock("./features/auth/supabase", () => ({
  isAuthConfigured,
  isAuthBypassed,
}));

// LedgerPage pulls the whole api surface; keep it real but stub network.
vi.mock("./features/ledger/api", async (importOriginal) => {
  const original = await importOriginal<typeof import("./features/ledger/api")>();
  const empty = async () => [];
  return {
    ...original,
    listTransactions: vi.fn(empty),
    fetchBalance: vi.fn(empty),
    listAccounts: vi.fn(empty),
    listCategories: vi.fn(empty),
    listCurrencies: vi.fn(empty),
    listCurrencyCatalog: vi.fn(empty),
    getWorkspace: vi.fn(async () => ({
      workspaceId: "ws-1",
      locale: "es-PE",
      timezone: "UTC",
      defaultCurrency: "PEN",
    })),
  };
});
vi.mock("./features/ledger/offline/queue", () => ({
  listPendingTransactions: vi.fn(async () => []),
}));
vi.mock("./features/ledger/offline/use-pending-sync", () => ({
  PENDING_QUERY_KEY: ["pending-transactions"],
  usePendingSync: () => {},
}));

import { App } from "./App";

afterEach(cleanup);

function authValue(overrides: Record<string, unknown> = {}) {
  return {
    configured: true,
    bypassed: false,
    misconfigured: false,
    loading: false,
    session: null,
    signIn: vi.fn(),
    signUp: vi.fn(),
    signOut: vi.fn(),
    ...overrides,
  };
}

describe("App auth gate (T6-web)", () => {
  it("renders LoginPage when auth is configured and there is no session", async () => {
    isAuthConfigured.mockReturnValue(true);
    useAuth.mockReturnValue(authValue());

    render(<App />);

    expect(
      await screen.findByRole("button", { name: "Iniciar sesión" }),
    ).toBeTruthy();
    expect(screen.queryByText("Movimientos")).toBeNull();
  });

  it("renders LedgerPage when a session exists", async () => {
    isAuthConfigured.mockReturnValue(true);
    useAuth.mockReturnValue(
      authValue({
        session: {
          access_token: "tok",
          user: { id: "u", email: "a@b.c" },
        },
      }),
    );

    render(<App />);

    expect(
      await screen.findAllByText("Movimientos"),
    ).not.toHaveLength(0);
    expect(screen.queryByRole("button", { name: "Iniciar sesión" })).toBeNull();
  });

  it("renders LedgerPage without login when auth is bypassed (dev passthrough)", async () => {
    isAuthConfigured.mockReturnValue(false);
    useAuth.mockReturnValue(
      authValue({ configured: false, misconfigured: false, bypassed: true }),
    );

    render(<App />);

    await waitFor(() => {
      expect(screen.getAllByText("Movimientos").length).toBeGreaterThan(0);
    });
    expect(screen.queryByRole("button", { name: "Iniciar sesión" })).toBeNull();
  });

  it("fails closed with the misconfiguration screen when auth is neither configured nor bypassed", async () => {
    isAuthConfigured.mockReturnValue(false);
    useAuth.mockReturnValue(
      authValue({ configured: false, misconfigured: true }),
    );

    render(<App />);

    expect(
      await screen.findByText("Autenticación mal configurada"),
    ).toBeTruthy();
    expect(screen.getByText(/VITE_AUTH_BYPASS/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Iniciar sesión" })).toBeNull();
    expect(screen.queryByText("Movimientos")).toBeNull();
  });
});
