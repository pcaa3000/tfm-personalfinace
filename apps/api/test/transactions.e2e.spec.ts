import "reflect-metadata";

import { randomUUID } from "node:crypto";

import type { INestApplication } from "@nestjs/common";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";

import {
  api,
  bootApp,
  cleanE2eData,
  ensureGlobalCategory,
  prisma,
  type AccountView,
  type ApiError,
  type ApiResponse,
  type CategoryView,
  type RevisionView,
  type TxView,
} from "./e2e-helpers.js";

/**
 * HTTP e2e suite (AUTH_MODE=dev) against the real Nest app + Docker Postgres.
 * Callers are simulated with the dev-only x-dev-user header; each "e2e-*"
 * subject resolves to its own lazily created workspace, which is how the
 * cross-workspace isolation cases exercise the same code path as production.
 */

const MARKER = "|e2e-dev-";
const ALICE = { "x-dev-user": "e2e-dev-alice" };
const BOB = { "x-dev-user": "e2e-dev-bob" };

let app: INestApplication;
let categoryId: string;
let accountId: string;
let eurAccountId: string;
let bobAccountId: string;

async function createAccount(
  headers: Record<string, string>,
  name: string,
  currency = "PEN",
): Promise<string> {
  const res = await api<AccountView>("/api/v1/accounts", {
    method: "POST",
    headers,
    body: { name, currency },
  });
  return res.body.id;
}

function txPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    accountId,
    type: "expense",
    amount: "12.50",
    currency: "PEN",
    businessDate: "2026-10-01",
    timezone: "UTC",
    concept: "e2e lunch",
    idempotencyKey: `e2e-${randomUUID()}`,
    ...overrides,
  };
}

async function createTx(
  headers: Record<string, string> = ALICE,
  overrides: Record<string, unknown> = {},
): Promise<ApiResponse<TxView>> {
  return api<TxView>("/api/v1/transactions", {
    method: "POST",
    headers,
    body: txPayload({
      ...(headers === BOB ? { accountId: bobAccountId } : {}),
      ...overrides,
    }),
  });
}

beforeAll(async () => {
  app = await bootApp();
  await cleanE2eData(MARKER);
  categoryId = await ensureGlobalCategory();
}, 30_000);

beforeEach(async () => {
  await cleanE2eData(MARKER);
  accountId = await createAccount(ALICE, "e2e BCP soles", "PEN");
  eurAccountId = await createAccount(ALICE, "e2e Cuenta euros", "EUR");
  bobAccountId = await createAccount(BOB, "e2e Interbank dolares", "PEN");
});

afterAll(async () => {
  await cleanE2eData(MARKER);
  await app.close();
  await prisma.$disconnect();
});

describe("POST /api/v1/transactions", () => {
  it("creates a confirmed manual transaction", async () => {
    const res = await createTx();
    expect(res.status).toBe(201);
    expect(res.body.id).toBeTruthy();
    expect(res.body.status).toBe("confirmed");
    expect(res.body.amount).toBe("12.50");
    expect(res.body.currency).toBe("PEN");
    expect(res.body.concept).toBe("e2e lunch");
    expect(res.body.revisionCount).toBe(0);
  });

  it("rejects a body without idempotencyKey", async () => {
    const res = await api<ApiError>("/api/v1/transactions", {
      method: "POST",
      headers: ALICE,
      body: txPayload({ idempotencyKey: undefined }),
    });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("IDEMPOTENCY_KEY_REQUIRED");
  });

  it("rejects an invalid payload", async () => {
    const res = await api<ApiError>("/api/v1/transactions", {
      method: "POST",
      headers: ALICE,
      body: txPayload({ type: "transfer" }),
    });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("INVALID_BODY");
  });

  it("replays the same idempotencyKey returning the same transaction", async () => {
    const payload = txPayload();
    const first = await api<TxView>("/api/v1/transactions", {
      method: "POST",
      headers: ALICE,
      body: payload,
    });
    const second = await api<TxView>("/api/v1/transactions", {
      method: "POST",
      headers: ALICE,
      body: payload,
    });
    expect(first.status).toBe(201);
    expect(second.body.id).toBe(first.body.id);

    const list = await api<TxView[]>("/api/v1/transactions", {
      headers: ALICE,
    });
    expect(list.body).toHaveLength(1);
  });

  it("rejects an unknown account", async () => {
    const res = await api<ApiError>("/api/v1/transactions", {
      method: "POST",
      headers: ALICE,
      body: txPayload({ accountId: randomUUID() }),
    });
    expect(res.status).toBe(404);
    expect(res.body.code).toBe("ACCOUNT_NOT_FOUND");
  });

  it("rejects a transaction whose currency differs from the account", async () => {
    const res = await api<ApiError>("/api/v1/transactions", {
      method: "POST",
      headers: ALICE,
      body: txPayload({ currency: "USD" }),
    });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("ACCOUNT_CURRENCY_MISMATCH");
  });

  it("rejects an unknown category", async () => {
    const res = await api<ApiError>("/api/v1/transactions", {
      method: "POST",
      headers: ALICE,
      body: txPayload({ categoryId: randomUUID() }),
    });
    expect(res.status).toBe(404);
    expect(res.body.code).toBe("CATEGORY_NOT_FOUND");
  });
});

describe("GET /api/v1/transactions", () => {
  it("lists transactions and applies filters", async () => {
    await createTx(ALICE);
    await createTx(ALICE, {
      type: "income",
      currency: "EUR",
      amount: "100",
      accountId: eurAccountId,
    });
    await createTx(ALICE, { categoryId });

    const all = await api<TxView[]>("/api/v1/transactions", {
      headers: ALICE,
    });
    expect(all.body).toHaveLength(3);

    const expenses = await api<TxView[]>("/api/v1/transactions?type=expense", {
      headers: ALICE,
    });
    expect(expenses.body).toHaveLength(2);

    const eur = await api<TxView[]>("/api/v1/transactions?currency=EUR", {
      headers: ALICE,
    });
    expect(eur.body).toHaveLength(1);
    expect(eur.body[0]?.type).toBe("income");

    const uncategorized = await api<TxView[]>(
      "/api/v1/transactions?category=uncategorized",
      { headers: ALICE },
    );
    expect(uncategorized.body).toHaveLength(2);

    const byCategory = await api<TxView[]>(
      `/api/v1/transactions?category=${categoryId}`,
      { headers: ALICE },
    );
    expect(byCategory.body).toHaveLength(1);
    expect(byCategory.body[0]?.categoryId).toBe(categoryId);

    const ranged = await api<TxView[]>(
      "/api/v1/transactions?from=2026-10-02&to=2026-10-31",
      { headers: ALICE },
    );
    expect(ranged.body).toHaveLength(0);
  });

  it("rejects invalid filters", async () => {
    const res = await api<ApiError>("/api/v1/transactions?type=transfer", {
      headers: ALICE,
    });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("INVALID_QUERY");
  });

  it("filters by q matching concept case-insensitively (RF-013)", async () => {
    await createTx(ALICE, { concept: "e2e almuerzo polleria" });
    await createTx(ALICE, { concept: "e2e taxi nocturno" });

    const res = await api<TxView[]>("/api/v1/transactions?q=POLLERIA", {
      headers: ALICE,
    });
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0]?.concept).toBe("e2e almuerzo polleria");
  });
});

describe("PATCH /api/v1/transactions/:id", () => {
  it("revises fields and records a revision", async () => {
    const created = await createTx();
    const res = await api<TxView>(`/api/v1/transactions/${created.body.id}`, {
      method: "PATCH",
      headers: ALICE,
      body: { concept: "e2e dinner", amount: "20.00" },
    });
    expect(res.status).toBe(200);
    expect(res.body.concept).toBe("e2e dinner");
    expect(res.body.amount).toBe("20.00");
    expect(res.body.revisionCount).toBe(1);
  });

  it("returns 404 for an unknown transaction", async () => {
    const res = await api<ApiError>(`/api/v1/transactions/${randomUUID()}`, {
      method: "PATCH",
      headers: ALICE,
      body: { concept: "nope" },
    });
    expect(res.status).toBe(404);
    expect(res.body.code).toMatch(/_NOT_FOUND$/);
  });

  it("rejects revising a voided transaction", async () => {
    const created = await createTx();
    await api<TxView>(`/api/v1/transactions/${created.body.id}/void`, {
      method: "POST",
      headers: ALICE,
    });
    const res = await api<ApiError>(`/api/v1/transactions/${created.body.id}`, {
      method: "PATCH",
      headers: ALICE,
      body: { concept: "late edit" },
    });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("TRANSACTION_ALREADY_VOIDED");
  });

  it("rejects changing currency when it mismatches the stored account currency (INV-CTA-01)", async () => {
    const created = await createTx();
    const res = await api<ApiError>(`/api/v1/transactions/${created.body.id}`, {
      method: "PATCH",
      headers: ALICE,
      body: { currency: "EUR" },
    });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("ACCOUNT_CURRENCY_MISMATCH");
  });

  it("revises currency and accountId together and persists the account change (INV-CTA-01, INV-CTA-03)", async () => {
    const created = await createTx();
    const res = await api<TxView>(`/api/v1/transactions/${created.body.id}`, {
      method: "PATCH",
      headers: ALICE,
      body: { currency: "EUR", accountId: eurAccountId, amount: "15.00" },
    });
    expect(res.status).toBe(200);
    expect(res.body.currency).toBe("EUR");
    expect(res.body.accountId).toBe(eurAccountId);

    const revisions = await api<RevisionView[]>(
      `/api/v1/transactions/${created.body.id}/revisions`,
      { headers: ALICE },
    );
    expect(revisions.status).toBe(200);
    expect(revisions.body[0]?.changes).toEqual(
      expect.arrayContaining([
        { field: "accountId", previous: accountId, next: eurAccountId },
        { field: "currency", previous: "PEN", next: "EUR" },
      ]),
    );
  });
});

describe("POST /api/v1/transactions/:id/void", () => {
  it("voids a transaction and replays idempotently", async () => {
    const created = await createTx();
    const voided = await api<TxView>(
      `/api/v1/transactions/${created.body.id}/void`,
      { method: "POST", headers: ALICE },
    );
    expect(voided.status).toBe(201);
    expect(voided.body.status).toBe("voided");
    expect(voided.body.revisionCount).toBe(1);

    const replay = await api<TxView>(
      `/api/v1/transactions/${created.body.id}/void`,
      { method: "POST", headers: ALICE },
    );
    expect(replay.body.status).toBe("voided");
    expect(replay.body.revisionCount).toBe(1);
  });

  it("returns 404 for an unknown transaction", async () => {
    const res = await api<ApiError>(
      `/api/v1/transactions/${randomUUID()}/void`,
      { method: "POST", headers: ALICE },
    );
    expect(res.status).toBe(404);
  });
});

describe("GET /api/v1/transactions/:id/revisions", () => {
  it("returns the ordered audit trail", async () => {
    const created = await createTx();
    const id = created.body.id;
    await api<TxView>(`/api/v1/transactions/${id}`, {
      method: "PATCH",
      headers: ALICE,
      body: { concept: "edited" },
    });
    await api<TxView>(`/api/v1/transactions/${id}/void`, {
      method: "POST",
      headers: ALICE,
    });

    const res = await api<RevisionView[]>(
      `/api/v1/transactions/${id}/revisions`,
      { headers: ALICE },
    );
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
    expect(res.body[0]?.kind).toBe("revision");
    expect(res.body[0]?.revisionNumber).toBe(1);
    expect(res.body[0]?.actor).toBe("e2e-dev-alice");
    expect(res.body[1]?.kind).toBe("void");
    expect(res.body[1]?.revisionNumber).toBe(2);
  });

  it("returns 404 for an unknown transaction", async () => {
    const res = await api<ApiError>(
      `/api/v1/transactions/${randomUUID()}/revisions`,
      { headers: ALICE },
    );
    expect(res.status).toBe(404);
  });
});

describe("GET /api/v1/categories", () => {
  it("lists the global catalog for the caller workspace", async () => {
    const res = await api<CategoryView[]>("/api/v1/categories", {
      headers: ALICE,
    });
    expect(res.status).toBe(200);
    const keys = res.body.map((c) => c.key);
    expect(keys).toContain("e2e-food");
  });
});

describe("workspace isolation", () => {
  it("a transaction owned by alice is invisible and untouchable for bob", async () => {
    const created = await createTx(ALICE);
    const id = created.body.id;

    const bobList = await api<TxView[]>("/api/v1/transactions", {
      headers: BOB,
    });
    expect(bobList.body.map((t) => t.id)).not.toContain(id);

    const bobPatch = await api<ApiError>(`/api/v1/transactions/${id}`, {
      method: "PATCH",
      headers: BOB,
      body: { concept: "hijack" },
    });
    expect(bobPatch.status).toBe(404);

    const bobVoid = await api<ApiError>(`/api/v1/transactions/${id}/void`, {
      method: "POST",
      headers: BOB,
    });
    expect(bobVoid.status).toBe(404);

    const bobRevisions = await api<ApiError>(
      `/api/v1/transactions/${id}/revisions`,
      { headers: BOB },
    );
    expect(bobRevisions.status).toBe(404);

    const aliceRevisions = await api<RevisionView[]>(
      `/api/v1/transactions/${id}/revisions`,
      { headers: ALICE },
    );
    expect(aliceRevisions.status).toBe(200);
  });

  it("the same idempotencyKey under another subject creates a separate transaction", async () => {
    const key = `e2e-shared-${randomUUID()}`;
    const aliceTx = await createTx(ALICE, { idempotencyKey: key });
    const bobTx = await createTx(BOB, { idempotencyKey: key });

    expect(aliceTx.status).toBe(201);
    expect(bobTx.status).toBe(201);
    expect(bobTx.body.id).not.toBe(aliceTx.body.id);
    expect(bobTx.body.workspaceId).not.toBe(aliceTx.body.workspaceId);
  });
});

describe("/api/v1/accounts", () => {
  it("creates and lists accounts for the caller workspace", async () => {
    const res = await api<AccountView[]>("/api/v1/accounts", {
      headers: ALICE,
    });
    expect(res.status).toBe(200);
    expect(res.body.map((a) => a.name)).toContain("e2e BCP soles");
  });

  it("rejects a duplicate account name in the same workspace", async () => {
    const res = await api<ApiError>("/api/v1/accounts", {
      method: "POST",
      headers: ALICE,
      body: { name: "e2e BCP soles", currency: "USD" },
    });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("ACCOUNT_NAME_TAKEN");
  });

  it("keeps accounts isolated between workspaces", async () => {
    const res = await api<ApiError>("/api/v1/transactions", {
      method: "POST",
      headers: BOB,
      body: txPayload({ accountId }),
    });
    expect(res.status).toBe(404);
    expect(res.body.code).toBe("ACCOUNT_NOT_FOUND");
  });
});

describe("/api/v1/accounts validation", () => {
  it("rejects an invalid create body", async () => {
    const res = await api<ApiError>("/api/v1/accounts", {
      method: "POST",
      headers: ALICE,
      body: { name: "", currency: "PEN" },
    });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("INVALID_BODY");
  });

  it("rejects an invalid account kind", async () => {
    const res = await api<ApiError>("/api/v1/accounts", {
      method: "POST",
      headers: ALICE,
      body: { name: "e2e bolsillo", currency: "PEN", kind: "crypto" },
    });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("INVALID_BODY");
  });
});

describe("/api/v1/workspace", () => {
  it("returns the caller workspace context", async () => {
    const res = await api<{ defaultCurrency: string; workspaceId: string }>(
      "/api/v1/workspace",
      { headers: ALICE },
    );
    expect(res.status).toBe(200);
    expect(res.body.defaultCurrency).toBe("PEN");
  });

  it("updates the default currency and persists it", async () => {
    const patch = await api<{ defaultCurrency: string }>("/api/v1/workspace", {
      method: "PATCH",
      headers: ALICE,
      body: { defaultCurrency: "USD" },
    });
    expect(patch.status).toBe(200);
    expect(patch.body.defaultCurrency).toBe("USD");

    const get = await api<{ defaultCurrency: string }>("/api/v1/workspace", {
      headers: ALICE,
    });
    expect(get.body.defaultCurrency).toBe("USD");
  });

  it("rejects an invalid currency code", async () => {
    const res = await api<ApiError>("/api/v1/workspace", {
      method: "PATCH",
      headers: ALICE,
      body: { defaultCurrency: "US1" },
    });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("CURRENCY_INVALID_CODE");
  });
});
