import { describe, expect, it, vi } from "vitest";

import type {
  ArchiveAccountCommand,
} from "../../modules/accounts/application/archive-account.use-case.js";
import type { AccountView } from "../../modules/accounts/application/account.view.js";
import type {
  CreateAccountCommand,
} from "../../modules/accounts/application/create-account.use-case.js";
import type {
  ReviseAccountCommand,
} from "../../modules/accounts/application/revise-account.use-case.js";
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
      execute: vi.fn(
        async (
          _command: CreateAccountCommand,
        ): Promise<Result<AccountView, DomainError>> => ok(accountView()),
      ),
    },
    listAccounts: {
      execute: vi.fn(async () => [accountView()]),
    },
    reviseAccount: {
      execute: vi.fn(
        async (
          _command: ReviseAccountCommand,
        ): Promise<Result<AccountView, DomainError>> => ok(accountView()),
      ),
    },
    archiveAccount: {
      execute: vi.fn(
        async (
          _command: ArchiveAccountCommand,
        ): Promise<Result<AccountView, DomainError>> =>
          ok(accountView({ archivedAt: "2026-10-28T00:00:00.000Z" })),
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

describe("GET /api/v1/accounts", () => {
  it("returns 401 UNAUTHENTICATED when the caller cannot be resolved", async () => {
    const deps = makeDeps({ authenticated: false });
    const app = createApp(deps);
    const res = await app.request("/api/v1/accounts");
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({
      code: "UNAUTHENTICATED",
      message: "Authentication required",
    });
    expect(deps.listAccounts.execute).not.toHaveBeenCalled();
  });

  it("lists accounts for the resolved workspace", async () => {
    const deps = makeDeps();
    const app = createApp(deps);
    const view = accountView();
    deps.listAccounts.execute.mockResolvedValue([view]);

    const res = await app.request("/api/v1/accounts");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([view]);
    expect(deps.listAccounts.execute).toHaveBeenCalledWith(WS);
  });
});

describe("POST /api/v1/accounts", () => {
  it("returns 400 INVALID_BODY for a malformed payload", async () => {
    const deps = makeDeps();
    const app = createApp(deps);
    const res = await postJson(app, "/api/v1/accounts", {
      name: "",
      currency: "EURO",
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.code).toBe("INVALID_BODY");
    expect(body.message).toBe("Invalid account payload");
    expect(body.details).toBeDefined();
    expect(deps.createAccount.execute).not.toHaveBeenCalled();
  });

  it("creates an account and returns 201 with kind defaulted to bank", async () => {
    const deps = makeDeps();
    const app = createApp(deps);
    const view = accountView({ initialBalance: "100.00" });
    deps.createAccount.execute.mockResolvedValue(ok(view));

    const res = await postJson(app, "/api/v1/accounts", {
      name: "Checking",
      currency: "EUR",
      initialBalance: "100.00",
    });
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual(view);
    expect(deps.createAccount.execute).toHaveBeenCalledWith({
      workspaceId: WS,
      name: "Checking",
      currency: "EUR",
      kind: "bank",
      initialBalance: "100.00",
    });
  });

  it("maps an ACCOUNT_NAME_TAKEN DomainError to 409", async () => {
    const deps = makeDeps();
    const app = createApp(deps);
    deps.createAccount.execute.mockResolvedValue(
      err(
        new DomainError(
          "ACCOUNT_NAME_TAKEN",
          'An account named "Checking" already exists in this workspace',
        ),
      ),
    );

    const res = await postJson(app, "/api/v1/accounts", {
      name: "Checking",
      currency: "EUR",
    });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      code: "ACCOUNT_NAME_TAKEN",
      message:
        'An account named "Checking" already exists in this workspace',
    });
  });
});

describe("PATCH /api/v1/accounts/:id", () => {
  it("revises an account and returns 200", async () => {
    const deps = makeDeps();
    const app = createApp(deps);
    const view = accountView({ name: "Main checking" });
    deps.reviseAccount.execute.mockResolvedValue(ok(view));

    const res = await patchJson(app, "/api/v1/accounts/acc-1", {
      name: "Main checking",
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(view);
    expect(deps.reviseAccount.execute).toHaveBeenCalledWith({
      workspaceId: WS,
      accountId: "acc-1",
      name: "Main checking",
    });
  });

  it("returns 400 INVALID_BODY when the revision payload is empty", async () => {
    const deps = makeDeps();
    const app = createApp(deps);
    const res = await patchJson(app, "/api/v1/accounts/acc-1", {});
    expect(res.status).toBe(400);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.code).toBe("INVALID_BODY");
    expect(body.message).toBe("Invalid account revision payload");
    expect(deps.reviseAccount.execute).not.toHaveBeenCalled();
  });

  it("maps an ACCOUNT_NOT_FOUND DomainError to 404", async () => {
    const deps = makeDeps();
    const app = createApp(deps);
    deps.reviseAccount.execute.mockResolvedValue(
      err(
        new DomainError(
          "ACCOUNT_NOT_FOUND",
          "Account does not exist in this workspace: acc-x",
        ),
      ),
    );

    const res = await patchJson(app, "/api/v1/accounts/acc-x", {
      name: "Renamed",
    });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({
      code: "ACCOUNT_NOT_FOUND",
      message: "Account does not exist in this workspace: acc-x",
    });
  });
});

describe("POST /api/v1/accounts/:id/archive", () => {
  it("archives an account and returns 201", async () => {
    const deps = makeDeps();
    const app = createApp(deps);
    const view = accountView({ archivedAt: "2026-10-28T00:00:00.000Z" });
    deps.archiveAccount.execute.mockResolvedValue(ok(view));

    const res = await postJson(app, "/api/v1/accounts/acc-1/archive", {});
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual(view);
    expect(deps.archiveAccount.execute).toHaveBeenCalledWith({
      workspaceId: WS,
      accountId: "acc-1",
    });
  });
});
