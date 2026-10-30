import "reflect-metadata";

import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";

import { NestFactory } from "@nestjs/core";
import type { INestApplication } from "@nestjs/common";
import { PrismaClient } from "@prisma/client";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";

import { AppModule } from "../src/composition/app.module.js";

/**
 * HTTP e2e suite against the real Nest app + Docker Postgres.
 * Callers are simulated with the dev-only x-dev-user header; each "e2e-*"
 * subject resolves to its own lazily created workspace, which is how the
 * cross-workspace isolation cases exercise the same code path as production.
 */

const prisma = new PrismaClient();
const E2E_PREFIX = "local|e2e-";
const ALICE = { "x-dev-user": "e2e-alice" };
const BOB = { "x-dev-user": "e2e-bob" };

let app: INestApplication;
let baseUrl: string;
let categoryId: string;

interface ApiResponse<T> {
  status: number;
  body: T;
}

interface TxView {
  id: string;
  workspaceId: string;
  type: string;
  amount: string;
  currency: string;
  concept: string;
  categoryId: string | null;
  status: string;
  revisionCount: number;
}

interface ApiError {
  code: string;
  message: string;
}

interface RevisionView {
  kind: string;
  revisionNumber: number;
  actor: string;
}

interface CategoryView {
  id: string;
  key: string;
}

async function api<T>(
  path: string,
  options: {
    method?: string;
    headers?: Record<string, string>;
    body?: unknown;
  } = {},
): Promise<ApiResponse<T>> {
  const res = await fetch(`${baseUrl}${path}`, {
    method: options.method ?? "GET",
    headers: {
      "content-type": "application/json",
      ...(options.headers ?? ALICE),
    },
    ...(options.body === undefined
      ? {}
      : { body: JSON.stringify(options.body) }),
  });
  const text = await res.text();
  return { status: res.status, body: (text ? JSON.parse(text) : null) as T };
}

function txPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    type: "expense",
    amount: "12.50",
    currency: "USD",
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
    body: txPayload(overrides),
  });
}

/** Wipes workspaces, transactions and revisions created by e2e-* subjects only. */
async function cleanE2eData(): Promise<void> {
  const workspaces = await prisma.workspace.findMany({
    where: { identityKey: { startsWith: E2E_PREFIX } },
    select: { id: true },
  });
  const ids = workspaces.map((w) => w.id);
  await prisma.transaction.deleteMany({ where: { workspaceId: { in: ids } } });
  await prisma.workspace.deleteMany({
    where: { identityKey: { startsWith: E2E_PREFIX } },
  });
}

async function ensureGlobalCategory(): Promise<void> {
  const existing = await prisma.category.findFirst({
    where: { key: "e2e-food", workspaceId: null },
  });
  const category =
    existing ??
    (await prisma.category.create({
      data: {
        key: "e2e-food",
        label: "E2E Food",
        nature: "essential",
        workspaceId: null,
      },
    }));
  categoryId = category.id;
}

beforeAll(async () => {
  app = await NestFactory.create(AppModule, { logger: false });
  await app.listen(0);
  const address = app.getHttpServer().address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${address.port}`;
  await cleanE2eData();
  await ensureGlobalCategory();
}, 30_000);

beforeEach(cleanE2eData);

afterAll(async () => {
  await cleanE2eData();
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
    expect(res.body.currency).toBe("USD");
    expect(res.body.concept).toBe("e2e lunch");
    expect(res.body.revisionCount).toBe(0);
  });

  it("rejects a body without idempotencyKey", async () => {
    const res = await api<ApiError>("/api/v1/transactions", {
      method: "POST",
      body: txPayload({ idempotencyKey: undefined }),
    });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("IDEMPOTENCY_KEY_REQUIRED");
  });

  it("rejects an invalid payload", async () => {
    const res = await api<ApiError>("/api/v1/transactions", {
      method: "POST",
      body: txPayload({ type: "transfer" }),
    });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("INVALID_BODY");
  });

  it("replays the same idempotencyKey returning the same transaction", async () => {
    const payload = txPayload();
    const first = await api<TxView>("/api/v1/transactions", {
      method: "POST",
      body: payload,
    });
    const second = await api<TxView>("/api/v1/transactions", {
      method: "POST",
      body: payload,
    });
    expect(first.status).toBe(201);
    expect(second.body.id).toBe(first.body.id);

    const list = await api<TxView[]>("/api/v1/transactions");
    expect(list.body).toHaveLength(1);
  });

  it("rejects an unknown category", async () => {
    const res = await api<ApiError>("/api/v1/transactions", {
      method: "POST",
      body: txPayload({ categoryId: randomUUID() }),
    });
    expect(res.status).toBe(404);
    expect(res.body.code).toBe("CATEGORY_NOT_FOUND");
  });
});

describe("GET /api/v1/transactions", () => {
  it("lists transactions and applies filters", async () => {
    await createTx(ALICE, { type: "expense", currency: "USD" });
    await createTx(ALICE, { type: "income", currency: "EUR", amount: "100" });
    await createTx(ALICE, { categoryId });

    const all = await api<TxView[]>("/api/v1/transactions");
    expect(all.body).toHaveLength(3);

    const expenses = await api<TxView[]>("/api/v1/transactions?type=expense");
    expect(expenses.body).toHaveLength(2);

    const eur = await api<TxView[]>("/api/v1/transactions?currency=EUR");
    expect(eur.body).toHaveLength(1);
    expect(eur.body[0]?.type).toBe("income");

    const uncategorized = await api<TxView[]>(
      "/api/v1/transactions?category=uncategorized",
    );
    expect(uncategorized.body).toHaveLength(2);

    const byCategory = await api<TxView[]>(
      `/api/v1/transactions?category=${categoryId}`,
    );
    expect(byCategory.body).toHaveLength(1);
    expect(byCategory.body[0]?.categoryId).toBe(categoryId);

    const ranged = await api<TxView[]>(
      "/api/v1/transactions?from=2026-10-02&to=2026-10-31",
    );
    expect(ranged.body).toHaveLength(0);
  });

  it("rejects invalid filters", async () => {
    const res = await api<ApiError>("/api/v1/transactions?type=transfer");
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("INVALID_QUERY");
  });
});

describe("PATCH /api/v1/transactions/:id", () => {
  it("revises fields and records a revision", async () => {
    const created = await createTx();
    const res = await api<TxView>(`/api/v1/transactions/${created.body.id}`, {
      method: "PATCH",
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
      body: { concept: "nope" },
    });
    expect(res.status).toBe(404);
    expect(res.body.code).toMatch(/_NOT_FOUND$/);
  });

  it("rejects revising a voided transaction", async () => {
    const created = await createTx();
    await api<TxView>(`/api/v1/transactions/${created.body.id}/void`, {
      method: "POST",
    });
    const res = await api<ApiError>(`/api/v1/transactions/${created.body.id}`, {
      method: "PATCH",
      body: { concept: "late edit" },
    });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("TRANSACTION_ALREADY_VOIDED");
  });
});

describe("POST /api/v1/transactions/:id/void", () => {
  it("voids a transaction and replays idempotently", async () => {
    const created = await createTx();
    const voided = await api<TxView>(
      `/api/v1/transactions/${created.body.id}/void`,
      { method: "POST" },
    );
    expect(voided.status).toBe(201);
    expect(voided.body.status).toBe("voided");
    expect(voided.body.revisionCount).toBe(1);

    const replay = await api<TxView>(
      `/api/v1/transactions/${created.body.id}/void`,
      { method: "POST" },
    );
    expect(replay.body.status).toBe("voided");
    expect(replay.body.revisionCount).toBe(1);
  });

  it("returns 404 for an unknown transaction", async () => {
    const res = await api<ApiError>(
      `/api/v1/transactions/${randomUUID()}/void`,
      { method: "POST" },
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
      body: { concept: "edited" },
    });
    await api<TxView>(`/api/v1/transactions/${id}/void`, { method: "POST" });

    const res = await api<RevisionView[]>(
      `/api/v1/transactions/${id}/revisions`,
    );
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
    expect(res.body[0]?.kind).toBe("revision");
    expect(res.body[0]?.revisionNumber).toBe(1);
    expect(res.body[0]?.actor).toBe("e2e-alice");
    expect(res.body[1]?.kind).toBe("void");
    expect(res.body[1]?.revisionNumber).toBe(2);
  });

  it("returns 404 for an unknown transaction", async () => {
    const res = await api<ApiError>(
      `/api/v1/transactions/${randomUUID()}/revisions`,
    );
    expect(res.status).toBe(404);
  });
});

describe("GET /api/v1/categories", () => {
  it("lists the global catalog for the caller workspace", async () => {
    const res = await api<CategoryView[]>("/api/v1/categories");
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
