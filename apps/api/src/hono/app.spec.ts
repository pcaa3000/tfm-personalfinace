import { describe, expect, it, vi } from "vitest";

import type {
  CallerIdentity,
  WorkspaceContext,
} from "../modules/identity-workspace/index.js";
import type { AccountView } from "../modules/accounts/application/account.view.js";
import { WorkspaceId, ok } from "../modules/shared-kernel/index.js";
import { createApp } from "./app.js";

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

function makeDeps() {
  return {
    callerResolver: {
      resolve: vi.fn(async () => CALLER),
    },
    workspaceContext: {
      resolve: vi.fn(async () => WORKSPACE),
    },
    recordManual: { execute: vi.fn(async () => ok(accountView() as never)) },
    listTransactions: { execute: vi.fn(async () => []) },
    reviseTransaction: { execute: vi.fn(async () => ok(accountView() as never)) },
    voidTransaction: { execute: vi.fn(async () => ok(accountView() as never)) },
    listRevisions: { execute: vi.fn(async () => ok([])) },
    createAccount: { execute: vi.fn(async () => ok(accountView())) },
    listAccounts: { execute: vi.fn(async () => [accountView()]) },
    reviseAccount: { execute: vi.fn(async () => ok(accountView())) },
    archiveAccount: {
      execute: vi.fn(async () =>
        ok(accountView({ archivedAt: "2026-10-28T00:00:00.000Z" })),
      ),
    },
  };
}

describe("hono app shell", () => {
  it("GET /health returns the Nest parity payload", async () => {
    const app = createApp(makeDeps());
    const res = await app.request("/health");
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toMatchObject({ status: "ok", service: "tfm-api" });
    expect(typeof body.timestamp).toBe("string");
  });

  it("returns a Nest-shaped 404 for unknown routes", async () => {
    const app = createApp(makeDeps());
    const res = await app.request("/api/v1/nope");
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({
      statusCode: 404,
      message: "Cannot GET /api/v1/nope",
      error: "Not Found",
    });
  });
});
