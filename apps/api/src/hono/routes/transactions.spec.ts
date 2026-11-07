import { describe, expect, it, vi } from "vitest";

import type { AccountView } from "../../modules/accounts/application/account.view.js";
import type {
  CallerIdentity,
  WorkspaceContext,
} from "../../modules/identity-workspace/index.js";
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
        async (_workspaceId: WorkspaceId, _filter: TransactionFilter) => [
          transactionView(),
        ],
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

const VALID_CREATE = {
  type: "expense",
  amount: "12.50",
  currency: "EUR",
  businessDate: "2026-10-27",
  timezone: "UTC",
  concept: "Coffee",
  accountId: "acc-1",
  idempotencyKey: "idem-000001",
};

describe("POST /api/v1/transactions", () => {
  it("returns 401 UNAUTHENTICATED when the caller cannot be resolved", async () => {
    const deps = makeDeps({ authenticated: false });
    const app = createApp(deps);
    const res = await postJson(app, "/api/v1/transactions", VALID_CREATE);
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({
      code: "UNAUTHENTICATED",
      message: "Authentication required",
    });
    expect(deps.recordManual.execute).not.toHaveBeenCalled();
  });

  it("returns 400 INVALID_BODY for a malformed payload", async () => {
    const deps = makeDeps();
    const app = createApp(deps);
    const res = await postJson(app, "/api/v1/transactions", {
      type: "not-a-type",
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.code).toBe("INVALID_BODY");
    expect(body.message).toBe("Invalid transaction payload");
    expect(body.details).toBeDefined();
    expect(deps.recordManual.execute).not.toHaveBeenCalled();
  });

  it("returns 400 IDEMPOTENCY_KEY_REQUIRED when idempotencyKey is missing", async () => {
    const deps = makeDeps();
    const app = createApp(deps);
    const { idempotencyKey: _omitted, ...withoutKey } = VALID_CREATE;
    const res = await postJson(app, "/api/v1/transactions", withoutKey);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      code: "IDEMPOTENCY_KEY_REQUIRED",
      message: "An idempotencyKey is required to create a transaction",
    });
    expect(deps.recordManual.execute).not.toHaveBeenCalled();
  });

  it("creates a transaction and returns 201 with the workspace from context", async () => {
    const deps = makeDeps();
    const app = createApp(deps);
    const view = transactionView();
    deps.recordManual.execute.mockResolvedValue(ok(view));

    const res = await postJson(app, "/api/v1/transactions", VALID_CREATE);
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual(view);
    expect(deps.recordManual.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: WS,
        idempotencyKey: "idem-000001",
        type: "expense",
        amount: "12.50",
        currency: "EUR",
        businessDate: "2026-10-27",
        timezone: "UTC",
        concept: "Coffee",
        accountId: "acc-1",
        destinationAccountId: null,
        categoryId: null,
        actor: "user-1",
      }),
    );
  });
});

describe("GET /api/v1/transactions", () => {
  it("returns 400 INVALID_QUERY for invalid filters", async () => {
    const deps = makeDeps();
    const app = createApp(deps);
    const res = await app.request("/api/v1/transactions?limit=abc");
    expect(res.status).toBe(400);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.code).toBe("INVALID_QUERY");
    expect(body.message).toBe("Invalid list filters");
    expect(body.details).toBeDefined();
    expect(deps.listTransactions.execute).not.toHaveBeenCalled();
  });

  it("passes parsed filters through to the use case", async () => {
    const deps = makeDeps();
    const app = createApp(deps);
    const view = transactionView();
    deps.listTransactions.execute.mockResolvedValue([view]);

    const res = await app.request(
      "/api/v1/transactions?from=2026-01-01&to=2026-01-31&type=expense" +
        "&currency=EUR&category=uncategorized&q=coffee&limit=10&offset=5",
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([view]);
    expect(deps.listTransactions.execute).toHaveBeenCalledWith(WS, {
      from: "2026-01-01",
      to: "2026-01-31",
      type: "expense",
      currency: "EUR",
      category: "uncategorized",
      q: "coffee",
      limit: 10,
      offset: 5,
    });
  });
});

describe("PATCH /api/v1/transactions/:id", () => {
  it("revises a transaction and returns 200", async () => {
    const deps = makeDeps();
    const app = createApp(deps);
    const view = transactionView({ concept: "Tea" });
    deps.reviseTransaction.execute.mockResolvedValue(ok(view));

    const res = await patchJson(app, "/api/v1/transactions/trx-9", {
      concept: "Tea",
      categoryId: null,
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(view);
    expect(deps.reviseTransaction.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: WS,
        transactionId: "trx-9",
        concept: "Tea",
        categoryId: null,
        actor: "user-1",
      }),
    );
    const command = deps.reviseTransaction.execute.mock.calls[0]?.[0];
    expect(command).not.toHaveProperty("amount");
    expect(command).not.toHaveProperty("type");
  });

  it("maps a TRANSACTION_NOT_FOUND DomainError to 404", async () => {
    const deps = makeDeps();
    const app = createApp(deps);
    deps.reviseTransaction.execute.mockResolvedValue(
      err(
        new DomainError(
          "TRANSACTION_NOT_FOUND",
          "Transaction not found: trx-x",
        ),
      ),
    );

    const res = await patchJson(app, "/api/v1/transactions/trx-x", {
      concept: "Tea",
    });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({
      code: "TRANSACTION_NOT_FOUND",
      message: "Transaction not found: trx-x",
    });
  });
});

describe("POST /api/v1/transactions/:id/void", () => {
  it("voids a transaction and returns 201", async () => {
    const deps = makeDeps();
    const app = createApp(deps);
    const view = transactionView({ status: "voided" });
    deps.voidTransaction.execute.mockResolvedValue(ok(view));

    const res = await postJson(app, "/api/v1/transactions/trx-9/void", {});
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual(view);
    expect(deps.voidTransaction.execute).toHaveBeenCalledWith({
      workspaceId: WS,
      transactionId: "trx-9",
      actor: "user-1",
    });
  });
});

describe("GET /api/v1/transactions/:id/revisions", () => {
  it("returns the revision list", async () => {
    const deps = makeDeps();
    const app = createApp(deps);
    deps.listRevisions.execute.mockResolvedValue(ok([]));

    const res = await app.request("/api/v1/transactions/trx-9/revisions");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([]);
    expect(deps.listRevisions.execute).toHaveBeenCalledWith(WS, "trx-9");
  });
});
