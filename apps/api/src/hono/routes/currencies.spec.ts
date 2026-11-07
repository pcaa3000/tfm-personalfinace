import { describe, expect, it, vi } from "vitest";

import type { AccountView } from "../../modules/accounts/application/account.view.js";
import type { CategoryView } from "../../modules/categorization/index.js";
import type { AddCurrencyCommand } from "../../modules/currencies/application/add-currency.use-case.js";
import type { ArchiveCurrencyCommand } from "../../modules/currencies/application/archive-currency.use-case.js";
import type { ReviseCurrencyCommand } from "../../modules/currencies/application/revise-currency.use-case.js";
import type {
  CallerIdentity,
  WorkspaceContext,
} from "../../modules/identity-workspace/index.js";
import type { WorkspacePreferencesPatch } from "../../modules/identity-workspace/application/update-workspace-preferences.use-case.js";
import type { CurrencyView } from "../../modules/currencies/index.js";
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

function currencyView(overrides: Partial<CurrencyView> = {}): CurrencyView {
  return {
    id: "cur-1",
    workspaceId: "ws-1",
    code: "USD",
    nameEn: "US Dollar",
    nameEs: "Dólar estadounidense",
    minorUnitExponent: 2,
    archivedAt: null,
    ...overrides,
  };
}

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
        {
          code: "JPY",
          nameEn: "Japanese Yen",
          nameEs: "Yen japonés",
          minorUnitExponent: 0,
        },
      ]),
    },
    addCurrency: {
      execute: vi.fn(
        async (
          _command: AddCurrencyCommand,
        ): Promise<Result<CurrencyView, DomainError>> =>
          ok(currencyView()),
      ),
    },
    reviseCurrency: {
      execute: vi.fn(
        async (
          _command: ReviseCurrencyCommand,
        ): Promise<Result<CurrencyView, DomainError>> =>
          ok(currencyView()),
      ),
    },
    archiveCurrency: {
      execute: vi.fn(
        async (
          _command: ArchiveCurrencyCommand,
        ): Promise<Result<CurrencyView, DomainError>> =>
          ok(currencyView({ archivedAt: "2026-10-28T00:00:00.000Z" })),
      ),
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
  };
}

function postJson(
  app: ReturnType<typeof createApp>,
  path: string,
  body: unknown,
) {
  return app.request(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
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

describe("GET /api/v1/currencies", () => {
  it("returns 401 UNAUTHENTICATED when the caller cannot be resolved", async () => {
    const deps = makeDeps({ authenticated: false });
    const app = createApp(deps);
    const res = await app.request("/api/v1/currencies");
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({
      code: "UNAUTHENTICATED",
      message: "Authentication required",
    });
    expect(deps.listCurrencies.execute).not.toHaveBeenCalled();
  });

  it("lists the workspace catalog", async () => {
    const deps = makeDeps();
    const app = createApp(deps);
    const views = [currencyView({ code: "PEN" }), currencyView()];
    deps.listCurrencies.execute.mockResolvedValue(views);

    const res = await app.request("/api/v1/currencies");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(views);
    expect(deps.listCurrencies.execute).toHaveBeenCalledWith(WS);
  });
});

describe("GET /api/v1/currencies/catalog", () => {
  it("returns the ISO 4217 table for the resolved workspace", async () => {
    const deps = makeDeps();
    const app = createApp(deps);

    const res = await app.request("/api/v1/currencies/catalog");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([
      {
        code: "USD",
        nameEn: "US Dollar",
        nameEs: "Dólar estadounidense",
        minorUnitExponent: 2,
      },
      {
        code: "JPY",
        nameEn: "Japanese Yen",
        nameEs: "Yen japonés",
        minorUnitExponent: 0,
      },
    ]);
    expect(deps.listIsoCatalog.execute).toHaveBeenCalled();
  });

  it("returns 401 UNAUTHENTICATED when the caller cannot be resolved", async () => {
    const deps = makeDeps({ authenticated: false });
    const app = createApp(deps);
    const res = await app.request("/api/v1/currencies/catalog");
    expect(res.status).toBe(401);
    expect(deps.listIsoCatalog.execute).not.toHaveBeenCalled();
  });
});

describe("POST /api/v1/currencies", () => {
  it("returns 400 INVALID_BODY for a malformed code", async () => {
    const deps = makeDeps();
    const app = createApp(deps);
    const res = await postJson(app, "/api/v1/currencies", { code: "US" });
    expect(res.status).toBe(400);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.code).toBe("INVALID_BODY");
    expect(body.message).toBe("Invalid currency payload");
    expect(body.details).toBeDefined();
    expect(deps.addCurrency.execute).not.toHaveBeenCalled();
  });

  it("adds a currency and returns 201", async () => {
    const deps = makeDeps();
    const app = createApp(deps);
    const view = currencyView();
    deps.addCurrency.execute.mockResolvedValue(ok(view));

    const res = await postJson(app, "/api/v1/currencies", { code: "USD" });
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual(view);
    expect(deps.addCurrency.execute).toHaveBeenCalledWith({
      workspaceId: WS,
      code: "USD",
    });
  });

  it("maps a CURRENCY_CODE_TAKEN DomainError to 409", async () => {
    const deps = makeDeps();
    const app = createApp(deps);
    deps.addCurrency.execute.mockResolvedValue(
      err(
        new DomainError(
          "CURRENCY_CODE_TAKEN",
          "Currency USD is already in the workspace catalog",
        ),
      ),
    );

    const res = await postJson(app, "/api/v1/currencies", { code: "USD" });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      code: "CURRENCY_CODE_TAKEN",
      message: "Currency USD is already in the workspace catalog",
    });
  });

  it("maps a CURRENCY_UNKNOWN_ISO DomainError to 400", async () => {
    const deps = makeDeps();
    const app = createApp(deps);
    deps.addCurrency.execute.mockResolvedValue(
      err(
        new DomainError(
          "CURRENCY_UNKNOWN_ISO",
          "Currency CHP is not a valid ISO 4217 code",
        ),
      ),
    );

    const res = await postJson(app, "/api/v1/currencies", { code: "CHP" });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      code: "CURRENCY_UNKNOWN_ISO",
      message: "Currency CHP is not a valid ISO 4217 code",
    });
  });
});

describe("PATCH /api/v1/currencies/:id", () => {
  it("revises a currency code and returns 200", async () => {
    const deps = makeDeps();
    const app = createApp(deps);
    const view = currencyView({ code: "EUR" });
    deps.reviseCurrency.execute.mockResolvedValue(ok(view));

    const res = await patchJson(app, "/api/v1/currencies/cur-1", {
      code: "EUR",
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(view);
    expect(deps.reviseCurrency.execute).toHaveBeenCalledWith({
      workspaceId: WS,
      currencyId: "cur-1",
      code: "EUR",
    });
  });

  it("returns 400 INVALID_BODY for a malformed code", async () => {
    const deps = makeDeps();
    const app = createApp(deps);
    const res = await patchJson(app, "/api/v1/currencies/cur-1", {
      code: "EURO",
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.code).toBe("INVALID_BODY");
    expect(body.message).toBe("Invalid currency revision payload");
    expect(deps.reviseCurrency.execute).not.toHaveBeenCalled();
  });

  it("maps a CURRENCY_NOT_FOUND DomainError to 404", async () => {
    const deps = makeDeps();
    const app = createApp(deps);
    deps.reviseCurrency.execute.mockResolvedValue(
      err(new DomainError("CURRENCY_NOT_FOUND", "Currency not found")),
    );

    const res = await patchJson(app, "/api/v1/currencies/cur-x", {
      code: "EUR",
    });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({
      code: "CURRENCY_NOT_FOUND",
      message: "Currency not found",
    });
  });

  it("maps a CURRENCY_IN_USE DomainError to 409 via CONFLICT_CODES", async () => {
    const deps = makeDeps();
    const app = createApp(deps);
    deps.reviseCurrency.execute.mockResolvedValue(
      err(
        new DomainError(
          "CURRENCY_IN_USE",
          "Currency USD is used by 1 account(s) and 0 transaction(s)",
        ),
      ),
    );

    const res = await patchJson(app, "/api/v1/currencies/cur-1", {
      code: "EUR",
    });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      code: "CURRENCY_IN_USE",
      message: "Currency USD is used by 1 account(s) and 0 transaction(s)",
    });
  });

  it("maps a CURRENCY_NO_CHANGES DomainError to 400", async () => {
    const deps = makeDeps();
    const app = createApp(deps);
    deps.reviseCurrency.execute.mockResolvedValue(
      err(
        new DomainError(
          "CURRENCY_NO_CHANGES",
          "A revision must change the currency code",
        ),
      ),
    );

    const res = await patchJson(app, "/api/v1/currencies/cur-1", {
      code: "USD",
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      code: "CURRENCY_NO_CHANGES",
      message: "A revision must change the currency code",
    });
  });
});

describe("POST /api/v1/currencies/:id/archive", () => {
  it("archives a currency and returns 201 with the workspace default", async () => {
    const deps = makeDeps();
    const app = createApp(deps);
    const view = currencyView({ archivedAt: "2026-10-28T00:00:00.000Z" });
    deps.archiveCurrency.execute.mockResolvedValue(ok(view));

    const res = await postJson(app, "/api/v1/currencies/cur-1/archive", {});
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual(view);
    expect(deps.archiveCurrency.execute).toHaveBeenCalledWith({
      workspaceId: WS,
      currencyId: "cur-1",
      defaultCurrency: "EUR",
    });
  });

  it("maps a CURRENCY_IS_DEFAULT DomainError to 409", async () => {
    const deps = makeDeps();
    const app = createApp(deps);
    deps.archiveCurrency.execute.mockResolvedValue(
      err(
        new DomainError(
          "CURRENCY_IS_DEFAULT",
          "Currency EUR is the workspace default currency",
        ),
      ),
    );

    const res = await postJson(app, "/api/v1/currencies/cur-1/archive", {});
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      code: "CURRENCY_IS_DEFAULT",
      message: "Currency EUR is the workspace default currency",
    });
  });
});
