import { describe, expect, it, vi } from "vitest";

import type { AccountView } from "../../modules/accounts/application/account.view.js";
import type { CategoryView } from "../../modules/categorization/index.js";
import type { CurrencyView } from "../../modules/currencies/index.js";
import type {
  CallerIdentity,
  WorkspaceContext,
} from "../../modules/identity-workspace/index.js";
import type { WorkspacePreferencesPatch } from "../../modules/identity-workspace/application/update-workspace-preferences.use-case.js";
import type {
  RecordManualTransactionCommand,
  ReviseTransactionCommand,
  TransactionFilter,
  TransactionRevisionView,
  TransactionView,
  VoidTransactionCommand,
} from "../../modules/ledger/index.js";
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
  locale: "en",
  timezone: "UTC",
  defaultCurrency: "EUR",
};

function categoryView(overrides: Partial<CategoryView> = {}): CategoryView {
  return {
    id: "cat-1",
    key: "e2e_mascotas",
    label: "Mascotas",
    nature: "discretionary",
    custom: true,
    ...overrides,
  };
}

function currencyView(overrides: Partial<CurrencyView> = {}): CurrencyView {
  return {
    id: "cur-1",
    workspaceId: "ws-1",
    code: "EUR",
    nameEn: "Euro",
    nameEs: "Euro",
    minorUnitExponent: 2,
    archivedAt: null,
    ...overrides,
  };
}

function transactionView(
  overrides: Partial<TransactionView> = {},
): TransactionView {
  return {
    id: "trx-1",
    workspaceId: "ws-1",
    type: "expense",
    amount: "12.50",
    currency: "EUR",
    businessDate: "2026-10-27",
    timezone: "UTC",
    concept: "Coffee",
    accountId: "acc-1",
    destinationAccountId: null,
    categoryId: null,
    status: "confirmed",
    origin: "manual",
    confirmedAt: "2026-10-27T10:00:00.000Z",
    revisionCount: 0,
    ...overrides,
  };
}

function accountView(overrides: Partial<AccountView> = {}): AccountView {
  return {
    id: "acc-1",
    workspaceId: "ws-1",
    name: "Checking",
    currency: "EUR",
    kind: "bank",
    initialBalance: "0.00",
    archivedAt: null,
    ...overrides,
  };
}

function makeDeps(options: { authenticated?: boolean } = {}) {
  const authenticated = options.authenticated ?? true;
  return {
    callerResolver: {
      resolve: vi.fn(async () => (authenticated ? CALLER : null)),
    },
    workspaceContext: {
      resolve: vi.fn(async () => WORKSPACE),
    },
    recordManual: {
      execute: vi.fn(
        async (
          _command: RecordManualTransactionCommand,
        ): Promise<Result<TransactionView, DomainError>> =>
          ok(transactionView()),
      ),
    },
    listTransactions: {
      execute: vi.fn(
        async (_workspaceId: WorkspaceId, _filter: TransactionFilter) => [],
      ),
    },
    reviseTransaction: {
      execute: vi.fn(
        async (
          _command: ReviseTransactionCommand,
        ): Promise<Result<TransactionView, DomainError>> =>
          ok(transactionView()),
      ),
    },
    voidTransaction: {
      execute: vi.fn(
        async (
          _command: VoidTransactionCommand,
        ): Promise<Result<TransactionView, DomainError>> =>
          ok(transactionView({ status: "voided" })),
      ),
    },
    listRevisions: {
      execute: vi.fn(
        async (): Promise<
          Result<TransactionRevisionView[], DomainError>
        > => ok([]),
      ),
    },
    createAccount: {
      execute: vi.fn(async () => ok(accountView())),
    },
    listAccounts: {
      execute: vi.fn(async () => [accountView()]),
    },
    reviseAccount: {
      execute: vi.fn(async () => ok(accountView())),
    },
    archiveAccount: {
      execute: vi.fn(async () => ok(accountView())),
    },
    categoryCatalog: {
      listForWorkspace: vi.fn(async () => [categoryView()]),
    },
    createCategory: {
      execute: vi.fn(async () => ok(categoryView())),
    },
    reviseCategory: {
      execute: vi.fn(async () => ok(categoryView())),
    },
    archiveCategory: {
      execute: vi.fn(async () => ok(categoryView())),
    },
    listCurrencies: {
      execute: vi.fn(async () => [currencyView()]),
    },
    listIsoCatalog: {
      execute: vi.fn(() => [
        {
          code: "USD",
          nameEn: "US Dollar",
          nameEs: "Dólar estadounidense",
          minorUnitExponent: 2,
        },
      ]),
    },
    addCurrency: {
      execute: vi.fn(async () => ok(currencyView())),
    },
    reviseCurrency: {
      execute: vi.fn(async () => ok(currencyView())),
    },
    archiveCurrency: {
      execute: vi.fn(async () => ok(currencyView())),
    },
    updatePreferences: {
      execute: vi.fn(
        async (
          _workspaceId: WorkspaceId,
          _patch: WorkspacePreferencesPatch,
        ): Promise<Result<WorkspaceContext, DomainError>> =>
          ok(WORKSPACE),
      ),
    },
    getBalance: {
      execute: vi.fn(async () => []),
    },
  };
}

function patchJson(
  app: ReturnType<typeof createApp>,
  path: string,
  body: unknown,
) {
  return app.request(path, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("GET /api/v1/workspace", () => {
  it("returns 401 UNAUTHENTICATED when the caller cannot be resolved", async () => {
    const deps = makeDeps({ authenticated: false });
    const app = createApp(deps);
    const res = await app.request("/api/v1/workspace");
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({
      code: "UNAUTHENTICATED",
      message: "Authentication required",
    });
    expect(deps.workspaceContext.resolve).not.toHaveBeenCalled();
  });

  it("returns the caller workspace context projection", async () => {
    const deps = makeDeps();
    const app = createApp(deps);

    const res = await app.request("/api/v1/workspace");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      workspaceId: "ws-1",
      locale: "en",
      timezone: "UTC",
      defaultCurrency: "EUR",
    });
    expect(deps.workspaceContext.resolve).toHaveBeenCalledWith(CALLER);
  });
});

describe("PATCH /api/v1/workspace", () => {
  it("returns 400 INVALID_BODY for an empty patch", async () => {
    const deps = makeDeps();
    const app = createApp(deps);
    const res = await patchJson(app, "/api/v1/workspace", {});
    expect(res.status).toBe(400);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.code).toBe("INVALID_BODY");
    expect(body.message).toBe("Invalid workspace payload");
    expect(body.details).toBeDefined();
    expect(deps.updatePreferences.execute).not.toHaveBeenCalled();
  });

  it("updates preferences and returns the projected context", async () => {
    const deps = makeDeps();
    const app = createApp(deps);
    const updated: WorkspaceContext = {
      ...WORKSPACE,
      defaultCurrency: "USD",
      locale: "es-PE",
      timezone: "America/Lima",
    };
    deps.updatePreferences.execute.mockResolvedValue(ok(updated));

    const res = await patchJson(app, "/api/v1/workspace", {
      defaultCurrency: "USD",
      locale: "es-PE",
      timezone: "America/Lima",
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      workspaceId: "ws-1",
      locale: "es-PE",
      timezone: "America/Lima",
      defaultCurrency: "USD",
    });
    expect(deps.updatePreferences.execute).toHaveBeenCalledWith(WS, {
      defaultCurrency: "USD",
      locale: "es-PE",
      timezone: "America/Lima",
    });
  });

  it("passes only the provided fields to the use case", async () => {
    const deps = makeDeps();
    const app = createApp(deps);
    deps.updatePreferences.execute.mockResolvedValue(
      ok({ ...WORKSPACE, locale: "es-PE" }),
    );

    const res = await patchJson(app, "/api/v1/workspace", {
      locale: "es-PE",
    });
    expect(res.status).toBe(200);
    expect(deps.updatePreferences.execute).toHaveBeenCalledWith(WS, {
      locale: "es-PE",
    });
  });

  it("maps a TIMEZONE_INVALID DomainError to 400", async () => {
    const deps = makeDeps();
    const app = createApp(deps);
    deps.updatePreferences.execute.mockResolvedValue(
      err(
        new DomainError(
          "TIMEZONE_INVALID",
          'Not a valid IANA timezone: "Mars/Olympus_Mons"',
        ),
      ),
    );

    const res = await patchJson(app, "/api/v1/workspace", {
      timezone: "Mars/Olympus_Mons",
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      code: "TIMEZONE_INVALID",
      message: 'Not a valid IANA timezone: "Mars/Olympus_Mons"',
    });
  });

  it("maps a WORKSPACE_NOT_FOUND DomainError to 404", async () => {
    const deps = makeDeps();
    const app = createApp(deps);
    deps.updatePreferences.execute.mockResolvedValue(
      err(new DomainError("WORKSPACE_NOT_FOUND", "Workspace not found")),
    );

    const res = await patchJson(app, "/api/v1/workspace", {
      locale: "es-PE",
    });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({
      code: "WORKSPACE_NOT_FOUND",
      message: "Workspace not found",
    });
  });

  it("does not map _TAKEN codes to 409 (unlike the other controllers)", async () => {
    const deps = makeDeps();
    const app = createApp(deps);
    deps.updatePreferences.execute.mockResolvedValue(
      err(new DomainError("WORKSPACE_TAKEN", "Conflict-ish failure")),
    );

    const res = await patchJson(app, "/api/v1/workspace", {
      locale: "es-PE",
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      code: "WORKSPACE_TAKEN",
      message: "Conflict-ish failure",
    });
  });
});
