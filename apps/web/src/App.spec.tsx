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

// reports-monthly T7: the four report endpoints are stubbed so the
// #/reports route can render without a network.
vi.mock("./features/reports/api", () => {
  const period = {
    from: "2026-11-01",
    to: "2026-11-12",
    currency: "PEN",
    periodStatus: "provisional",
  };
  return {
    fetchCashFlowReport: vi.fn(async () => ({ period, accounts: [] })),
    fetchExpensesByCategory: vi.fn(async () => ({
      period,
      totalExpenses: "0.00",
      natureTotals: {},
      categories: [],
    })),
    fetchAvoidableExpenses: vi.fn(async () => ({
      period,
      totalDiscretionary: "0.00",
      potentialSavings: "0.00",
      groups: [],
    })),
    fetchMonthlySavings: vi.fn(async () => ({
      period,
      income: "0.00",
      expense: "0.00",
      saved: "0.00",
      observedRate: null,
      note: "no_income",
      deficit: null,
    })),
  };
});

import { App } from "./App";

afterEach(() => {
  cleanup();
  window.location.hash = "";
});

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

  // demo-maria-session T8: a demo sign-in is a real Supabase
  // session — the gate needs no demo-specific branch.
  it("renders LedgerPage for a demo sign-in, which is a normal Supabase session", async () => {
    isAuthConfigured.mockReturnValue(true);
    useAuth.mockReturnValue(
      authValue({
        session: {
          access_token: "demo-tok",
          user: { id: "demo-1", email: "mariademo@example.com" },
        },
      }),
    );

    render(<App />);

    await waitFor(() => {
      expect(screen.getAllByText("Movimientos").length).toBeGreaterThan(0);
    });
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

  // reports-monthly T7 (S7): "#/reports" renders the reports page and
  // "#/" stays on the ledger — hash routing replaces a router dep.
  it("renders ReportsPage on the '#/reports' hash for a signed-in session", async () => {
    window.location.hash = "#/reports";
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

    expect(await screen.findByText("Gastos evitables")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Iniciar sesión" })).toBeNull();
  });

  it("keeps LedgerPage on the default hash", async () => {
    window.location.hash = "#/";
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

    await waitFor(() => {
      expect(screen.getAllByText("Movimientos").length).toBeGreaterThan(0);
    });
    expect(screen.queryByText("Gastos evitables")).toBeNull();
  });
});
