import { describe, expect, it, vi } from "vitest";

import type {
  CallerIdentity,
  WorkspaceContext,
} from "../../modules/identity-workspace/index.js";
import type {
  CashFlowReportView,
  ExpensesByCategoryView,
  ReportPeriod,
} from "../../modules/reports/index.js";
import {
  DomainError,
  WorkspaceId,
  err,
  ok,
  type Result,
} from "../../modules/shared-kernel/index.js";
import { createApp } from "../app.js";

const wsResult = WorkspaceId.create("ws-1");
if (!wsResult.ok) throw new Error("workspace setup failed");
const WS = wsResult.value;

const CALLER: CallerIdentity = { issuer: "test", subject: "user-1" };
const WORKSPACE: WorkspaceContext = {
  workspaceId: WS,
  timezone: "UTC",
  defaultCurrency: "EUR",
};

const PERIOD: ReportPeriod = {
  from: "2026-09-01",
  to: "2026-09-30",
  currency: "EUR",
  periodStatus: "provisional",
};

const CASH_FLOW_VIEW: CashFlowReportView = {
  period: PERIOD,
  accounts: [
    {
      accountId: "acc-1",
      name: "Checking",
      kind: "bank",
      income: "100.00",
      expense: "40.50",
      transfersIn: "0.00",
      transfersOut: "38.00",
      netFlow: "21.50",
    },
  ],
};

const EXPENSES_VIEW: ExpensesByCategoryView = {
  period: PERIOD,
  totalExpenses: "400.00",
  natureTotals: {
    essential: "300.00",
    discretionary: "100.00",
    obligation: "0.00",
    uncategorized: "0.00",
  },
  categories: [
    {
      categoryId: "cat-food",
      key: "food",
      label: "Food",
      nature: "essential",
      total: "300.00",
      percentOfExpenses: 75,
      transactionCount: 2,
    },
  ],
};

// Required stubs for every mounted router — mirrors the convention in
// transactions.spec.ts; only the reports deps are exercised here.
function makeDeps(options: { authenticated?: boolean } = {}) {
  const authenticated = options.authenticated ?? true;
  const unusedResult = vi.fn(
    async (): Promise<Result<never, DomainError>> =>
      err(new DomainError("UNUSED", "unused in these specs")),
  );
  return {
    callerResolver: {
      resolve: vi.fn(async () => (authenticated ? CALLER : null)),
    },
    workspaceContext: {
      resolve: vi.fn(async () => WORKSPACE),
    },
    recordManual: { execute: unusedResult },
    listTransactions: { execute: vi.fn(async () => []) },
    reviseTransaction: { execute: unusedResult },
    voidTransaction: { execute: unusedResult },
    listRevisions: { execute: vi.fn(async () => ok([])) },
    createAccount: { execute: unusedResult },
    listAccounts: { execute: vi.fn(async () => []) },
    reviseAccount: { execute: unusedResult },
    archiveAccount: { execute: unusedResult },
    categoryCatalog: { listForWorkspace: vi.fn(async () => []) },
    createCategory: { execute: unusedResult },
    reviseCategory: { execute: unusedResult },
    archiveCategory: { execute: unusedResult },
    listCurrencies: { execute: vi.fn(async () => []) },
    listIsoCatalog: { execute: vi.fn(() => []) },
    addCurrency: { execute: unusedResult },
    reviseCurrency: { execute: unusedResult },
    archiveCurrency: { execute: unusedResult },
    updatePreferences: { execute: vi.fn(async () => ok(WORKSPACE)) },
    listNotifications: { execute: vi.fn(async () => []) },
    getBalance: { execute: vi.fn(async () => []) },
    uploadReceipt: { execute: unusedResult },
    listReceiptScans: {
      execute: vi.fn(async () => ({ items: [], nextCursor: null })),
    },
    getReceiptScan: { execute: unusedResult },
    getReceiptFile: { execute: unusedResult },
    deleteReceiptFile: { execute: unusedResult },
    getReceiptDraft: { execute: unusedResult },
    confirmReceiptDraft: { execute: unusedResult },
    rejectReceiptScan: { execute: unusedResult },
    retryReceiptScan: { execute: unusedResult },
    purgeReceiptMedia: { execute: vi.fn(async () => 0) },
    uploadVoiceNote: { execute: unusedResult },
    listVoiceNotes: {
      execute: vi.fn(async () => ({ items: [], nextCursor: null })),
    },
    getVoiceNote: { execute: unusedResult },
    getVoiceFile: { execute: unusedResult },
    getVoiceDraft: { execute: unusedResult },
    confirmVoiceDraft: { execute: unusedResult },
    rejectVoiceNote: { execute: unusedResult },
    retryVoiceNote: { execute: unusedResult },
    getVoiceConsent: {
      execute: vi.fn(async () => ({
        provider: "gemini",
        granted: false,
        grantedAt: null,
        revokedAt: null,
      })),
    },
    setVoiceConsent: {
      execute: vi.fn(async () => ({
        provider: "gemini",
        granted: false,
        grantedAt: null,
        revokedAt: null,
      })),
    },
    // The deps under test.
    cashFlowReport: {
      execute: vi.fn(
        async (): Promise<Result<CashFlowReportView, DomainError>> =>
          ok(CASH_FLOW_VIEW),
      ),
    },
    expensesByCategory: {
      execute: vi.fn(
        async (): Promise<Result<ExpensesByCategoryView, DomainError>> =>
          ok(EXPENSES_VIEW),
      ),
    },
  };
}

describe("GET /api/v1/reports/cash-flow", () => {
  it("returns 200 with the report payload", async () => {
    const deps = makeDeps();
    const app = createApp(deps);

    const res = await app.request(
      "/api/v1/reports/cash-flow?currency=EUR&year=2026&month=9",
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(CASH_FLOW_VIEW);
  });

  it("passes the query period and the server-resolved workspace timezone to the use case", async () => {
    const deps = makeDeps();
    const app = createApp(deps);

    await app.request(
      "/api/v1/reports/cash-flow?currency=EUR&year=2026&month=9",
    );

    expect(deps.cashFlowReport.execute).toHaveBeenCalledWith({
      workspaceId: WS,
      currency: "EUR",
      year: 2026,
      month: 9,
      timezone: "UTC",
    });
  });

  it("rejects requests without an authenticated caller", async () => {
    const deps = makeDeps({ authenticated: false });
    const app = createApp(deps);

    const res = await app.request(
      "/api/v1/reports/cash-flow?currency=EUR&year=2026&month=9",
    );

    expect(res.status).toBe(401);
    expect(deps.cashFlowReport.execute).not.toHaveBeenCalled();
  });

  it.each([
    ["missing currency", "year=2026&month=9"],
    ["missing month", "currency=EUR&year=2026"],
    ["missing year", "currency=EUR&month=9"],
    ["out-of-range month", "currency=EUR&year=2026&month=13"],
    ["invalid currency length", "currency=EU&year=2026&month=9"],
  ])("responds 400 INVALID_QUERY when %s", async (_label, query) => {
    const deps = makeDeps();
    const app = createApp(deps);

    const res = await app.request(`/api/v1/reports/cash-flow?${query}`);

    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("INVALID_QUERY");
    expect(deps.cashFlowReport.execute).not.toHaveBeenCalled();
  });

  it("maps domain errors to the {code, message} envelope", async () => {
    const deps = makeDeps();
    deps.cashFlowReport.execute.mockResolvedValue(
      err(new DomainError("TIMEZONE_INVALID", "bad tz")),
    );
    const app = createApp(deps);

    const res = await app.request(
      "/api/v1/reports/cash-flow?currency=EUR&year=2026&month=9",
    );

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      code: "TIMEZONE_INVALID",
      message: "bad tz",
    });
  });
});

describe("GET /api/v1/reports/expenses-by-category", () => {
  it("returns 200 with the report payload", async () => {
    const deps = makeDeps();
    const app = createApp(deps);

    const res = await app.request(
      "/api/v1/reports/expenses-by-category?currency=EUR&year=2026&month=9",
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(EXPENSES_VIEW);
  });

  it("passes the query period and the server-resolved workspace timezone to the use case", async () => {
    const deps = makeDeps();
    const app = createApp(deps);

    await app.request(
      "/api/v1/reports/expenses-by-category?currency=USD&year=2026&month=3",
    );

    expect(deps.expensesByCategory.execute).toHaveBeenCalledWith({
      workspaceId: WS,
      currency: "USD",
      year: 2026,
      month: 3,
      timezone: "UTC",
    });
  });

  it("rejects an invalid query with 400 INVALID_QUERY", async () => {
    const deps = makeDeps();
    const app = createApp(deps);

    const res = await app.request(
      "/api/v1/reports/expenses-by-category?currency=EUR",
    );

    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("INVALID_QUERY");
    expect(deps.expensesByCategory.execute).not.toHaveBeenCalled();
  });
});

describe("reports routes when deps are absent", () => {
  it("does not mount the endpoints (fail-closed 404)", async () => {
    const deps = makeDeps();
    const { cashFlowReport: _cf, expensesByCategory: _ec, ...rest } = deps;
    const app = createApp(rest);

    const cash = await app.request(
      "/api/v1/reports/cash-flow?currency=EUR&year=2026&month=9",
    );
    const cat = await app.request(
      "/api/v1/reports/expenses-by-category?currency=EUR&year=2026&month=9",
    );

    expect(cash.status).toBe(404);
    expect(cat.status).toBe(404);
  });
});
