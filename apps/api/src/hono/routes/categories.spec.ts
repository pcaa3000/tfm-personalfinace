import { describe, expect, it, vi } from "vitest";

import type { AccountView } from "../../modules/accounts/application/account.view.js";
import type { ArchiveCategoryCommand } from "../../modules/categorization/application/archive-category.use-case.js";
import type { CreateCategoryCommand } from "../../modules/categorization/application/create-category.use-case.js";
import type { ReviseCategoryCommand } from "../../modules/categorization/application/revise-category.use-case.js";
import type { CategoryView } from "../../modules/categorization/index.js";
import type { AddCurrencyCommand } from "../../modules/currencies/application/add-currency.use-case.js";
import type { ArchiveCurrencyCommand } from "../../modules/currencies/application/archive-currency.use-case.js";
import type { ReviseCurrencyCommand } from "../../modules/currencies/application/revise-currency.use-case.js";
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
      execute: vi.fn(
        async (
          _command: CreateCategoryCommand,
        ): Promise<Result<CategoryView, DomainError>> =>
          ok(categoryView()),
      ),
    },
    reviseCategory: {
      execute: vi.fn(
        async (
          _command: ReviseCategoryCommand,
        ): Promise<Result<CategoryView, DomainError>> =>
          ok(categoryView()),
      ),
    },
    archiveCategory: {
      execute: vi.fn(
        async (
          _command: ArchiveCategoryCommand,
        ): Promise<Result<CategoryView, DomainError>> =>
          ok(categoryView()),
      ),
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
      execute: vi.fn(
        async (
          _command: AddCurrencyCommand,
        ): Promise<Result<CurrencyView, DomainError>> =>
          ok(currencyView({ code: "USD" })),
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
    getBalance: {
      execute: vi.fn(async () => []),
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

describe("GET /api/v1/categories", () => {
  it("returns 401 UNAUTHENTICATED when the caller cannot be resolved", async () => {
    const deps = makeDeps({ authenticated: false });
    const app = createApp(deps);
    const res = await app.request("/api/v1/categories");
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({
      code: "UNAUTHENTICATED",
      message: "Authentication required",
    });
    expect(deps.categoryCatalog.listForWorkspace).not.toHaveBeenCalled();
  });

  it("lists the catalog for the resolved workspace", async () => {
    const deps = makeDeps();
    const app = createApp(deps);
    const views = [categoryView(), categoryView({ id: "cat-2", key: "food" })];
    deps.categoryCatalog.listForWorkspace.mockResolvedValue(views);

    const res = await app.request("/api/v1/categories");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(views);
    expect(deps.categoryCatalog.listForWorkspace).toHaveBeenCalledWith(WS);
  });
});

describe("POST /api/v1/categories", () => {
  it("returns 400 INVALID_BODY for an invalid nature", async () => {
    const deps = makeDeps();
    const app = createApp(deps);
    const res = await postJson(app, "/api/v1/categories", {
      label: "e2e x",
      nature: "uncategorized",
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.code).toBe("INVALID_BODY");
    expect(body.message).toBe("Invalid category payload");
    expect(body.details).toBeDefined();
    expect(deps.createCategory.execute).not.toHaveBeenCalled();
  });

  it("creates a category without key and returns 201", async () => {
    const deps = makeDeps();
    const app = createApp(deps);
    const view = categoryView();
    deps.createCategory.execute.mockResolvedValue(ok(view));

    const res = await postJson(app, "/api/v1/categories", {
      label: "Mascotas",
      nature: "discretionary",
    });
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual(view);
    expect(deps.createCategory.execute).toHaveBeenCalledWith({
      workspaceId: WS,
      label: "Mascotas",
      nature: "discretionary",
    });
  });

  it("passes an explicit key through to the use case", async () => {
    const deps = makeDeps();
    const app = createApp(deps);
    deps.createCategory.execute.mockResolvedValue(ok(categoryView()));

    const res = await postJson(app, "/api/v1/categories", {
      key: "e2e_toys",
      label: "Juguetes",
      nature: "essential",
    });
    expect(res.status).toBe(201);
    expect(deps.createCategory.execute).toHaveBeenCalledWith({
      workspaceId: WS,
      key: "e2e_toys",
      label: "Juguetes",
      nature: "essential",
    });
  });

  it("maps a CATEGORY_KEY_TAKEN DomainError to 409", async () => {
    const deps = makeDeps();
    const app = createApp(deps);
    deps.createCategory.execute.mockResolvedValue(
      err(
        new DomainError(
          "CATEGORY_KEY_TAKEN",
          'A category with key "e2e_toys" already exists in this workspace',
        ),
      ),
    );

    const res = await postJson(app, "/api/v1/categories", {
      key: "e2e_toys",
      label: "Juguetes",
      nature: "essential",
    });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      code: "CATEGORY_KEY_TAKEN",
      message:
        'A category with key "e2e_toys" already exists in this workspace',
    });
  });
});

describe("PATCH /api/v1/categories/:id", () => {
  it("revises a category and returns 200", async () => {
    const deps = makeDeps();
    const app = createApp(deps);
    const view = categoryView({ label: "e2e editada", nature: "essential" });
    deps.reviseCategory.execute.mockResolvedValue(ok(view));

    const res = await patchJson(app, "/api/v1/categories/cat-1", {
      label: "e2e editada",
      nature: "essential",
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(view);
    expect(deps.reviseCategory.execute).toHaveBeenCalledWith({
      workspaceId: WS,
      categoryId: "cat-1",
      label: "e2e editada",
      nature: "essential",
    });
  });

  it("returns 400 INVALID_BODY when the revision payload is empty", async () => {
    const deps = makeDeps();
    const app = createApp(deps);
    const res = await patchJson(app, "/api/v1/categories/cat-1", {});
    expect(res.status).toBe(400);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.code).toBe("INVALID_BODY");
    expect(body.message).toBe("Invalid category revision payload");
    expect(deps.reviseCategory.execute).not.toHaveBeenCalled();
  });

  it("maps a CATEGORY_NOT_FOUND DomainError to 404", async () => {
    const deps = makeDeps();
    const app = createApp(deps);
    deps.reviseCategory.execute.mockResolvedValue(
      err(new DomainError("CATEGORY_NOT_FOUND", "Category not found")),
    );

    const res = await patchJson(app, "/api/v1/categories/cat-x", {
      label: "Renamed",
    });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({
      code: "CATEGORY_NOT_FOUND",
      message: "Category not found",
    });
  });
});

describe("POST /api/v1/categories/:id/archive", () => {
  it("archives a category and returns 201", async () => {
    const deps = makeDeps();
    const app = createApp(deps);
    const view = categoryView();
    deps.archiveCategory.execute.mockResolvedValue(ok(view));

    const res = await postJson(app, "/api/v1/categories/cat-1/archive", {});
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual(view);
    expect(deps.archiveCategory.execute).toHaveBeenCalledWith({
      workspaceId: WS,
      categoryId: "cat-1",
    });
  });

  it("maps a CATEGORY_NOT_FOUND DomainError to 404", async () => {
    const deps = makeDeps();
    const app = createApp(deps);
    deps.archiveCategory.execute.mockResolvedValue(
      err(new DomainError("CATEGORY_NOT_FOUND", "Category not found")),
    );

    const res = await postJson(app, "/api/v1/categories/cat-x/archive", {});
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({
      code: "CATEGORY_NOT_FOUND",
      message: "Category not found",
    });
  });
});
