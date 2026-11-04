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
let secondPenAccountId: string;
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
  secondPenAccountId = await createAccount(ALICE, "e2e BBVA soles", "PEN");
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
      body: txPayload({ type: "invalid" }),
    });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("INVALID_BODY");
  });

  it("creates a transfer between two accounts of the same currency (INV-TFR-01..04)", async () => {
    const res = await createTx(ALICE, {
      type: "transfer",
      accountId,
      destinationAccountId: secondPenAccountId,
      amount: "50.00",
      concept: "e2e ahorro",
    });
    expect(res.status).toBe(201);
    expect(res.body.type).toBe("transfer");
    expect(res.body.accountId).toBe(accountId);
    expect(res.body.destinationAccountId).toBe(secondPenAccountId);
    expect(res.body.categoryId).toBeNull();

    const transfers = await api<TxView[]>("/api/v1/transactions?type=transfer", {
      headers: ALICE,
    });
    expect(transfers.status).toBe(200);
    expect(transfers.body).toHaveLength(1);
    expect(transfers.body[0]?.id).toBe(res.body.id);
    expect(transfers.body[0]?.destinationAccountId).toBe(secondPenAccountId);
  });

  it("rejects a transfer without destinationAccountId (INV-TFR-01)", async () => {
    const res = await api<ApiError>("/api/v1/transactions", {
      method: "POST",
      headers: ALICE,
      body: txPayload({ type: "transfer" }),
    });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("TRANSFER_DESTINATION_REQUIRED");
  });

  it("rejects a transfer where destination equals source account (INV-TFR-02)", async () => {
    const res = await api<ApiError>("/api/v1/transactions", {
      method: "POST",
      headers: ALICE,
      body: txPayload({
        type: "transfer",
        accountId,
        destinationAccountId: accountId,
      }),
    });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("TRANSFER_SAME_ACCOUNT");
  });

  it("rejects a transfer when destination account has a different currency (INV-TFR-03)", async () => {
    const res = await api<ApiError>("/api/v1/transactions", {
      method: "POST",
      headers: ALICE,
      body: txPayload({
        type: "transfer",
        accountId,
        destinationAccountId: eurAccountId,
        currency: "PEN",
      }),
    });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("ACCOUNT_CURRENCY_MISMATCH");
  });

  it("rejects a transfer when destination account belongs to another workspace (INV-TFR-01)", async () => {
    const res = await api<ApiError>("/api/v1/transactions", {
      method: "POST",
      headers: ALICE,
      body: txPayload({
        type: "transfer",
        accountId,
        destinationAccountId: bobAccountId,
      }),
    });
    expect(res.status).toBe(404);
    expect(res.body.code).toBe("ACCOUNT_NOT_FOUND");
  });

  it.each(["income", "expense"] as const)(
    "rejects destinationAccountId on %s creation",
    async (type) => {
      const res = await api<ApiError>("/api/v1/transactions", {
        method: "POST",
        headers: ALICE,
        body: txPayload({
          type,
          destinationAccountId: secondPenAccountId,
        }),
      });
      expect(res.status).toBe(400);
      expect(res.body.code).toBe("TRANSFER_DESTINATION_FORBIDDEN");
    },
  );

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
    const res = await api<ApiError>("/api/v1/transactions?type=invalid", {
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

  it("rejects an over-long q filter (RF-013)", async () => {
    const res = await api<ApiError>(
      `/api/v1/transactions?q=${"x".repeat(101)}`,
      { headers: ALICE },
    );
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("INVALID_QUERY");
  });

  it("filters by business date period (RF-013)", async () => {
    await createTx(ALICE, { businessDate: "2026-10-05", concept: "e2e dentro" });
    await createTx(ALICE, { businessDate: "2026-11-20", concept: "e2e fuera" });

    const res = await api<TxView[]>(
      "/api/v1/transactions?from=2026-10-01&to=2026-10-31",
      { headers: ALICE },
    );
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0]?.concept).toBe("e2e dentro");
  });

  it("paginates with limit and offset over the date-desc ordering (RF-013)", async () => {
    await createTx(ALICE, { businessDate: "2026-10-01", concept: "e2e pag-1" });
    await createTx(ALICE, { businessDate: "2026-10-02", concept: "e2e pag-2" });
    await createTx(ALICE, { businessDate: "2026-10-03", concept: "e2e pag-3" });
    await createTx(ALICE, { businessDate: "2026-10-04", concept: "e2e pag-4" });

    const first = await api<TxView[]>("/api/v1/transactions?limit=2", {
      headers: ALICE,
    });
    expect(first.status).toBe(200);
    expect(first.body.map((t) => t.concept)).toEqual([
      "e2e pag-4",
      "e2e pag-3",
    ]);

    const second = await api<TxView[]>(
      "/api/v1/transactions?limit=2&offset=2",
      { headers: ALICE },
    );
    expect(second.status).toBe(200);
    expect(second.body.map((t) => t.concept)).toEqual([
      "e2e pag-2",
      "e2e pag-1",
    ]);
  });

  it("rejects invalid pagination params (RF-013)", async () => {
    for (const qs of ["limit=0", "limit=201", "limit=abc", "offset=-1"]) {
      const res = await api<ApiError>(`/api/v1/transactions?${qs}`, {
        headers: ALICE,
      });
      expect(res.status).toBe(400);
      expect(res.body.code).toBe("INVALID_QUERY");
    }
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

  it("revises an expense to transfer and audits destinationAccountId (INV-TFR-01, INV-TRX-03)", async () => {
    const created = await createTx(ALICE, { categoryId });
    const res = await api<TxView>(`/api/v1/transactions/${created.body.id}`, {
      method: "PATCH",
      headers: ALICE,
      body: {
        type: "transfer",
        destinationAccountId: secondPenAccountId,
      },
    });
    expect(res.status).toBe(200);
    expect(res.body.type).toBe("transfer");
    expect(res.body.destinationAccountId).toBe(secondPenAccountId);
    expect(res.body.categoryId).toBeNull();

    const revisions = await api<RevisionView[]>(
      `/api/v1/transactions/${created.body.id}/revisions`,
      { headers: ALICE },
    );
    expect(revisions.status).toBe(200);
    expect(revisions.body[0]?.changes).toEqual(
      expect.arrayContaining([
        { field: "type", previous: "expense", next: "transfer" },
        {
          field: "destinationAccountId",
          previous: "none",
          next: secondPenAccountId,
        },
      ]),
    );
  });

  it("revises transfer fields and enforces destination invariants on PATCH", async () => {
    const created = await createTx(ALICE, {
      type: "transfer",
      accountId,
      destinationAccountId: secondPenAccountId,
      amount: "40.00",
    });
    expect(created.status).toBe(201);

    const updated = await api<TxView>(
      `/api/v1/transactions/${created.body.id}`,
      {
        method: "PATCH",
        headers: ALICE,
        body: { concept: "e2e transferencia editada", amount: "45.00" },
      },
    );
    expect(updated.status).toBe(200);
    expect(updated.body.concept).toBe("e2e transferencia editada");
    expect(updated.body.amount).toBe("45.00");
    expect(updated.body.destinationAccountId).toBe(secondPenAccountId);

    const sameAcc = await api<ApiError>(
      `/api/v1/transactions/${created.body.id}`,
      {
        method: "PATCH",
        headers: ALICE,
        body: { destinationAccountId: accountId },
      },
    );
    expect(sameAcc.status).toBe(400);
    expect(sameAcc.body.code).toBe("TRANSFER_SAME_ACCOUNT");

    const wrongCurrency = await api<ApiError>(
      `/api/v1/transactions/${created.body.id}`,
      {
        method: "PATCH",
        headers: ALICE,
        body: { destinationAccountId: eurAccountId },
      },
    );
    expect(wrongCurrency.status).toBe(400);
    expect(wrongCurrency.body.code).toBe("ACCOUNT_CURRENCY_MISMATCH");

    const foreignAcc = await api<ApiError>(
      `/api/v1/transactions/${created.body.id}`,
      {
        method: "PATCH",
        headers: ALICE,
        body: { destinationAccountId: bobAccountId },
      },
    );
    expect(foreignAcc.status).toBe(404);
    expect(foreignAcc.body.code).toBe("ACCOUNT_NOT_FOUND");
  });

  it("rejects PATCH with destinationAccountId on an income transaction with 400", async () => {
    const created = await createTx(ALICE, { type: "income" });
    const res = await api<ApiError>(`/api/v1/transactions/${created.body.id}`, {
      method: "PATCH",
      headers: ALICE,
      body: { destinationAccountId: secondPenAccountId },
    });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("TRANSFER_DESTINATION_FORBIDDEN");
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

describe("custom categories (RF-040, RF-041, RF-044)", () => {
  it("creates a workspace category and lists it as custom", async () => {
    const created = await api<CategoryView>("/api/v1/categories", {
      method: "POST",
      headers: ALICE,
      body: { label: "e2e Mascotas", nature: "discretionary" },
    });
    expect(created.status).toBe(201);
    expect(created.body.key).toBe("e2e_mascotas");
    expect(created.body.custom).toBe(true);

    const list = await api<CategoryView[]>("/api/v1/categories", {
      headers: ALICE,
    });
    const mine = list.body.find((c) => c.id === created.body.id);
    expect(mine?.label).toBe("e2e Mascotas");
    expect(mine?.custom).toBe(true);
  });

  it("rejects a duplicated key inside the same workspace", async () => {
    const first = await api<CategoryView>("/api/v1/categories", {
      method: "POST",
      headers: ALICE,
      body: { key: "e2e_dup", label: "e2e dup", nature: "essential" },
    });
    expect(first.status).toBe(201);

    const dup = await api<ApiError>("/api/v1/categories", {
      method: "POST",
      headers: ALICE,
      body: { key: "e2e_dup", label: "e2e dup again", nature: "essential" },
    });
    expect(dup.status).toBe(409);
    expect(dup.body.code).toBe("CATEGORY_KEY_TAKEN");
  });

  it("rejects an invalid nature or body", async () => {
    const res = await api<ApiError>("/api/v1/categories", {
      method: "POST",
      headers: ALICE,
      body: { label: "e2e x", nature: "uncategorized" },
    });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("INVALID_BODY");
  });

  it("edits label and nature of a workspace category", async () => {
    const created = await api<CategoryView>("/api/v1/categories", {
      method: "POST",
      headers: ALICE,
      body: { label: "e2e editable", nature: "discretionary" },
    });

    const edited = await api<CategoryView>(
      `/api/v1/categories/${created.body.id}`,
      {
        method: "PATCH",
        headers: ALICE,
        body: { label: "e2e editada", nature: "essential" },
      },
    );
    expect(edited.status).toBe(200);
    expect(edited.body.label).toBe("e2e editada");
    expect(edited.body.nature).toBe("essential");
  });

  it("archiving keeps historical transactions but blocks new usage (RF-044)", async () => {
    const created = await api<CategoryView>("/api/v1/categories", {
      method: "POST",
      headers: ALICE,
      body: { label: "e2e archivable", nature: "essential" },
    });
    const tx = await createTx(ALICE, { categoryId: created.body.id });
    expect(tx.status).toBe(201);

    const archived = await api<CategoryView>(
      `/api/v1/categories/${created.body.id}/archive`,
      { method: "POST", headers: ALICE },
    );
    expect(archived.status).toBe(201);

    const list = await api<TxView[]>("/api/v1/transactions", {
      headers: ALICE,
    });
    const kept = list.body.find((t) => t.id === tx.body.id);
    expect(kept?.categoryId).toBe(created.body.id);

    const reuse = await api<ApiError>("/api/v1/transactions", {
      method: "POST",
      headers: ALICE,
      body: txPayload({ categoryId: created.body.id }),
    });
    expect(reuse.status).toBe(404);
    expect(reuse.body.code).toBe("CATEGORY_NOT_FOUND");
  });

  it("protects global and foreign categories from edits and archive", async () => {
    const globalPatch = await api<ApiError>(
      `/api/v1/categories/${categoryId}`,
      { method: "PATCH", headers: ALICE, body: { label: "hijack" } },
    );
    expect(globalPatch.status).toBe(404);

    const mine = await api<CategoryView>("/api/v1/categories", {
      method: "POST",
      headers: ALICE,
      body: { label: "e2e privada", nature: "essential" },
    });
    const bobPatch = await api<ApiError>(
      `/api/v1/categories/${mine.body.id}`,
      { method: "PATCH", headers: BOB, body: { label: "hijack" } },
    );
    expect(bobPatch.status).toBe(404);
    const bobArchive = await api<ApiError>(
      `/api/v1/categories/${mine.body.id}/archive`,
      { method: "POST", headers: BOB },
    );
    expect(bobArchive.status).toBe(404);

    const bobList = await api<CategoryView[]>("/api/v1/categories", {
      headers: BOB,
    });
    expect(bobList.body.map((c) => c.id)).not.toContain(mine.body.id);
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

  it("updates timezone and locale and persists them (RF-003)", async () => {
    const patch = await api<{ timezone: string; locale: string }>(
      "/api/v1/workspace",
      {
        method: "PATCH",
        headers: ALICE,
        body: { timezone: "America/Lima", locale: "es-PE" },
      },
    );
    expect(patch.status).toBe(200);
    expect(patch.body.timezone).toBe("America/Lima");
    expect(patch.body.locale).toBe("es-PE");

    const get = await api<{ timezone: string; locale: string }>(
      "/api/v1/workspace",
      { headers: ALICE },
    );
    expect(get.body.timezone).toBe("America/Lima");
    expect(get.body.locale).toBe("es-PE");
  });

  it("rejects invalid timezone, locale and empty patches", async () => {
    for (const [body, code] of [
      [{ timezone: "Mars/Olympus_Mons" }, "TIMEZONE_INVALID"],
      [{ locale: "!!bad!!" }, "LOCALE_INVALID"],
      [{}, "INVALID_BODY"],
    ] as const) {
      const res = await api<ApiError>("/api/v1/workspace", {
        method: "PATCH",
        headers: ALICE,
        body,
      });
      expect(res.status).toBe(400);
      expect(res.body.code).toBe(code);
    }
  });

  it("changing preferences never rewrites historical transactions (RF-004)", async () => {
    const tx = await createTx(ALICE, {
      businessDate: "2026-10-05",
      timezone: "UTC",
      concept: "e2e histórico",
    });
    expect(tx.status).toBe(201);

    const patch = await api<{ timezone: string }>("/api/v1/workspace", {
      method: "PATCH",
      headers: ALICE,
      body: { timezone: "America/Lima", defaultCurrency: "EUR" },
    });
    expect(patch.status).toBe(200);

    const list = await api<(TxView & { businessDate: string; timezone: string })[]>(
      "/api/v1/transactions",
      { headers: ALICE },
    );
    const kept = list.body.find((t) => t.id === tx.body.id);
    expect(kept?.businessDate).toBe("2026-10-05");
    expect(kept?.timezone).toBe("UTC");
    expect(kept?.currency).toBe("PEN");
  });
});
