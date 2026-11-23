import { describe, expect, it, vi } from "vitest";

import type {
  CallerIdentity,
  WorkspaceContext,
} from "../../modules/identity-workspace/index.js";
import type {
  AntExpensesView,
  CashFlowReportView,
  ExpensesByCategoryView,
  MonthlySavingsView,
  ReportExportFile,
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

const ANT_EXPENSES_VIEW: AntExpensesView = {
  period: PERIOD,
  totalDiscretionary: "15.00",
  groups: [
    {
      groupKind: "merchant",
      key: "cafe central",
      label: "cafe central",
      operationCount: 3,
      total: "15.00",
      average: "5.00",
      percentOfDiscretionary: 100,
      confidence: "high",
      transactionIds: ["tx-1", "tx-2", "tx-3"],
    },
  ],
};

const MONTHLY_SAVINGS_VIEW: MonthlySavingsView = {
  period: PERIOD,
  income: "10000.00",
  expense: "4000.00",
  saved: "6000.00",
  observedRate: "60.00",
  note: null,
  deficit: null,
};

const EXPORT_CSV_FILE: ReportExportFile = {
  filename: "report-EUR-2026-09.csv",
  contentType: "text/csv; charset=utf-8",
  body: "## metadata\nkey,value\ntimezone,UTC\n",
};

const EXPORT_XLSX_FILE: ReportExportFile = {
  filename: "report-EUR-2026-09.xlsx",
  contentType:
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  body: new Uint8Array([0x50, 0x4b, 0x03, 0x04]),
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
    antExpenses: {
      execute: vi.fn(
        async (): Promise<Result<AntExpensesView, DomainError>> =>
          ok(ANT_EXPENSES_VIEW),
      ),
    },
    monthlySavings: {
      execute: vi.fn(
        async (): Promise<Result<MonthlySavingsView, DomainError>> =>
          ok(MONTHLY_SAVINGS_VIEW),
      ),
    },
    exportReport: {
      execute: vi.fn(
        async (): Promise<Result<ReportExportFile, DomainError>> =>
          ok(EXPORT_CSV_FILE),
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

describe("GET /api/v1/reports/ant-expenses", () => {
  it("returns 200 with the report payload", async () => {
    const deps = makeDeps();
    const app = createApp(deps);

    const res = await app.request(
      "/api/v1/reports/ant-expenses?currency=EUR&year=2026&month=9",
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(ANT_EXPENSES_VIEW);
  });

  it("passes the query period and the server-resolved workspace timezone to the use case", async () => {
    const deps = makeDeps();
    const app = createApp(deps);

    await app.request(
      "/api/v1/reports/ant-expenses?currency=PEN&year=2026&month=4",
    );

    expect(deps.antExpenses.execute).toHaveBeenCalledWith({
      workspaceId: WS,
      currency: "PEN",
      year: 2026,
      month: 4,
      timezone: "UTC",
    });
  });

  it("rejects an invalid query with 400 INVALID_QUERY", async () => {
    const deps = makeDeps();
    const app = createApp(deps);

    const res = await app.request(
      "/api/v1/reports/ant-expenses?currency=EUR&year=2026",
    );

    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("INVALID_QUERY");
    expect(deps.antExpenses.execute).not.toHaveBeenCalled();
  });

  it("maps domain errors to the {code, message} envelope", async () => {
    const deps = makeDeps();
    deps.antExpenses.execute.mockResolvedValue(
      err(new DomainError("TIMEZONE_INVALID", "bad tz")),
    );
    const app = createApp(deps);

    const res = await app.request(
      "/api/v1/reports/ant-expenses?currency=EUR&year=2026&month=9",
    );

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      code: "TIMEZONE_INVALID",
      message: "bad tz",
    });
  });
});

describe("GET /api/v1/reports/monthly-savings", () => {
  it("returns 200 with the report payload", async () => {
    const deps = makeDeps();
    const app = createApp(deps);

    const res = await app.request(
      "/api/v1/reports/monthly-savings?currency=EUR&year=2026&month=9",
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(MONTHLY_SAVINGS_VIEW);
  });

  it("passes the query period and the server-resolved workspace timezone to the use case", async () => {
    const deps = makeDeps();
    const app = createApp(deps);

    await app.request(
      "/api/v1/reports/monthly-savings?currency=USD&year=2026&month=1",
    );

    expect(deps.monthlySavings.execute).toHaveBeenCalledWith({
      workspaceId: WS,
      currency: "USD",
      year: 2026,
      month: 1,
      timezone: "UTC",
    });
  });

  it("rejects requests without an authenticated caller", async () => {
    const deps = makeDeps({ authenticated: false });
    const app = createApp(deps);

    const res = await app.request(
      "/api/v1/reports/monthly-savings?currency=EUR&year=2026&month=9",
    );

    expect(res.status).toBe(401);
    expect(deps.monthlySavings.execute).not.toHaveBeenCalled();
  });

  it("rejects an invalid query with 400 INVALID_QUERY", async () => {
    const deps = makeDeps();
    const app = createApp(deps);

    const res = await app.request(
      "/api/v1/reports/monthly-savings?currency=EUR&year=2026&month=0",
    );

    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("INVALID_QUERY");
    expect(deps.monthlySavings.execute).not.toHaveBeenCalled();
  });
});

describe("GET /api/v1/reports/export", () => {
  it("returns 200 with a CSV attachment", async () => {
    const deps = makeDeps();
    const app = createApp(deps);

    const res = await app.request(
      "/api/v1/reports/export?currency=EUR&year=2026&month=9&format=csv",
    );

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/csv");
    expect(res.headers.get("content-disposition")).toBe(
      'attachment; filename="report-EUR-2026-09.csv"',
    );
    expect(await res.text()).toBe(EXPORT_CSV_FILE.body);
  });

  it("returns 200 with an XLSX attachment", async () => {
    const deps = makeDeps();
    deps.exportReport.execute.mockResolvedValue(ok(EXPORT_XLSX_FILE));
    const app = createApp(deps);

    const res = await app.request(
      "/api/v1/reports/export?currency=EUR&year=2026&month=9&format=xlsx",
    );

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe(
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    expect(res.headers.get("content-disposition")).toBe(
      'attachment; filename="report-EUR-2026-09.xlsx"',
    );
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(
      EXPORT_XLSX_FILE.body,
    );
  });

  it("passes the query period, format and workspace timezone to the use case", async () => {
    const deps = makeDeps();
    const app = createApp(deps);

    await app.request(
      "/api/v1/reports/export?currency=EUR&year=2026&month=9&format=csv",
    );

    expect(deps.exportReport.execute).toHaveBeenCalledWith({
      workspaceId: WS,
      currency: "EUR",
      year: 2026,
      month: 9,
      timezone: "UTC",
      format: "csv",
    });
  });

  it.each([
    ["invalid format", "currency=EUR&year=2026&month=9&format=pdf"],
    ["missing format", "currency=EUR&year=2026&month=9"],
    ["missing currency", "year=2026&month=9&format=csv"],
  ])("responds 400 INVALID_QUERY when %s", async (_label, query) => {
    const deps = makeDeps();
    const app = createApp(deps);

    const res = await app.request(`/api/v1/reports/export?${query}`);

    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("INVALID_QUERY");
    expect(deps.exportReport.execute).not.toHaveBeenCalled();
  });

  it("rejects requests without an authenticated caller", async () => {
    const deps = makeDeps({ authenticated: false });
    const app = createApp(deps);

    const res = await app.request(
      "/api/v1/reports/export?currency=EUR&year=2026&month=9&format=csv",
    );

    expect(res.status).toBe(401);
    expect(deps.exportReport.execute).not.toHaveBeenCalled();
  });

  it("maps domain errors to the {code, message} envelope", async () => {
    const deps = makeDeps();
    deps.exportReport.execute.mockResolvedValue(
      err(new DomainError("PERIOD_INVALID", "bad period")),
    );
    const app = createApp(deps);

    const res = await app.request(
      "/api/v1/reports/export?currency=EUR&year=2026&month=9&format=csv",
    );

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      code: "PERIOD_INVALID",
      message: "bad period",
    });
  });
});

describe("reports routes when deps are absent", () => {
  it("does not mount the endpoints (fail-closed 404)", async () => {
    const deps = makeDeps();
    const {
      cashFlowReport: _cf,
      expensesByCategory: _ec,
      antExpenses: _ae,
      monthlySavings: _ms,
      exportReport: _ex,
      ...rest
    } = deps;
    const app = createApp(rest);

    const cash = await app.request(
      "/api/v1/reports/cash-flow?currency=EUR&year=2026&month=9",
    );
    const cat = await app.request(
      "/api/v1/reports/expenses-by-category?currency=EUR&year=2026&month=9",
    );
    const ant = await app.request(
      "/api/v1/reports/ant-expenses?currency=EUR&year=2026&month=9",
    );
    const savings = await app.request(
      "/api/v1/reports/monthly-savings?currency=EUR&year=2026&month=9",
    );
    const exportRes = await app.request(
      "/api/v1/reports/export?currency=EUR&year=2026&month=9&format=csv",
    );

    expect(cash.status).toBe(404);
    expect(cat.status).toBe(404);
    expect(ant.status).toBe(404);
    expect(savings.status).toBe(404);
    expect(exportRes.status).toBe(404);
  });

  it("does not mount /export when only the export dep is absent", async () => {
    const deps = makeDeps();
    const { exportReport: _ex, ...rest } = deps;
    const app = createApp(rest);

    const exportRes = await app.request(
      "/api/v1/reports/export?currency=EUR&year=2026&month=9&format=csv",
    );
    const cash = await app.request(
      "/api/v1/reports/cash-flow?currency=EUR&year=2026&month=9",
    );

    expect(exportRes.status).toBe(404);
    expect(cash.status).toBe(200);
  });
});
