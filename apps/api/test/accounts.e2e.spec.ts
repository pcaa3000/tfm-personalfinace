import { randomUUID } from "node:crypto";

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
  closeTestDb,
  type AccountView,
  type ApiError,
  type ApiResponse,
  type E2eApp,
} from "./e2e-helpers.js";

const MARKER = "|e2e-acc-";
const ALICE = { "x-dev-user": "e2e-acc-alice" };
const BOB = { "x-dev-user": "e2e-acc-bob" };

let app: E2eApp;

async function createAccount(
  headers: Record<string, string>,
  body: Record<string, unknown> = {},
): Promise<ApiResponse<AccountView>> {
  return api<AccountView>("/api/v1/accounts", {
    method: "POST",
    headers,
    body: { name: `acc-${randomUUID()}`, currency: "PEN", ...body },
  });
}

beforeAll(async () => {
  app = await bootApp();
  await cleanE2eData(MARKER);
}, 30_000);

beforeEach(async () => {
  await cleanE2eData(MARKER);
});

afterAll(async () => {
  await cleanE2eData(MARKER);
  await app.close();
  await closeTestDb();
});

describe("POST /api/v1/accounts", () => {
  it("creates an account with kind and initial balance", async () => {
    const res = await createAccount(ALICE, {
      name: "e2e-acc Ahorros",
      kind: "savings",
      initialBalance: "250.75",
    });
    expect(res.status).toBe(201);
    expect(res.body.kind).toBe("savings");
    expect(res.body.initialBalance).toBe("250.75");
  });

  it("defaults initialBalance to 0.00 when omitted", async () => {
    const res = await createAccount(ALICE, { kind: "bank" });
    expect(res.status).toBe(201);
    expect(res.body.initialBalance).toBe("0.00");
  });

  it("rejects the legacy wallet kind", async () => {
    const res = await createAccount(ALICE, { kind: "wallet" });
    expect(res.status).toBe(400);
  });

  it("rejects a negative initial balance", async () => {
    const res = await createAccount(ALICE, { initialBalance: "-10.00" });
    expect(res.status).toBe(400);
  });
});

describe("PATCH /api/v1/accounts/:id", () => {
  it("edits name, kind and initial balance", async () => {
    const created = await createAccount(ALICE, { name: "e2e-acc Original" });
    const res = await api<AccountView>(`/api/v1/accounts/${created.body.id}`, {
      method: "PATCH",
      headers: ALICE,
      body: { name: "e2e-acc Renombrada", kind: "cash", initialBalance: "99.90" },
    });
    expect(res.status).toBe(200);
    expect(res.body.name).toBe("e2e-acc Renombrada");
    expect(res.body.kind).toBe("cash");
    expect(res.body.initialBalance).toBe("99.90");
  });

  it("rejects renaming to an existing name in the workspace", async () => {
    const first = await createAccount(ALICE, { name: "e2e-acc Uno" });
    const second = await createAccount(ALICE, { name: "e2e-acc Dos" });
    const res = await api<AccountView>(`/api/v1/accounts/${second.body.id}`, {
      method: "PATCH",
      headers: ALICE,
      body: { name: first.body.name },
    });
    expect(res.status).toBe(409);
    expect((res.body as unknown as ApiError).code).toBe("ACCOUNT_NAME_TAKEN");
  });

  it("returns 404 for an account owned by another workspace", async () => {
    const created = await createAccount(ALICE, { name: "e2e-acc Privada" });
    const res = await api<AccountView>(`/api/v1/accounts/${created.body.id}`, {
      method: "PATCH",
      headers: BOB,
      body: { name: "robo" },
    });
    expect(res.status).toBe(404);
  });
});

describe("POST /api/v1/accounts/:id/archive", () => {
  it("archives the account and hides it from the list", async () => {
    const created = await createAccount(ALICE, { name: "e2e-acc Cerrada" });
    const res = await api<AccountView>(
      `/api/v1/accounts/${created.body.id}/archive`,
      { method: "POST", headers: ALICE },
    );
    expect(res.status).toBe(201);

    const list = await api<AccountView[]>("/api/v1/accounts", {
      headers: ALICE,
    });
    expect(list.body.some((a) => a.id === created.body.id)).toBe(false);
  });

  it("an archived account rejects new transactions", async () => {
    const created = await createAccount(ALICE, { name: "e2e-acc Muerta" });
    await api(`/api/v1/accounts/${created.body.id}/archive`, {
      method: "POST",
      headers: ALICE,
    });
    const res = await api("/api/v1/transactions", {
      method: "POST",
      headers: ALICE,
      body: {
        accountId: created.body.id,
        type: "expense",
        amount: "10.00",
        currency: "PEN",
        businessDate: "2026-11-01",
        timezone: "UTC",
        concept: "e2e-acc gasto",
        idempotencyKey: `e2e-acc-${randomUUID()}`,
      },
    });
    expect(res.status).toBe(404);
    expect((res.body as unknown as ApiError).code).toBe("ACCOUNT_NOT_FOUND");
  });

  it("returns 404 archiving twice", async () => {
    const created = await createAccount(ALICE, { name: "e2e-acc Doble" });
    await api(`/api/v1/accounts/${created.body.id}/archive`, {
      method: "POST",
      headers: ALICE,
    });
    const res = await api(`/api/v1/accounts/${created.body.id}/archive`, {
      method: "POST",
      headers: ALICE,
    });
    expect(res.status).toBe(404);
  });
});
