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
  type ApiError,
  type CurrencyView,
  type IsoCurrencyView,
  type E2eApp,
} from "./e2e-helpers.js";

const MARKER = "|e2e-cur-";
const ALICE = { "x-dev-user": "e2e-cur-alice" };
const BOB = { "x-dev-user": "e2e-cur-bob" };

let app: E2eApp;

async function addCurrency(
  headers: Record<string, string>,
  code: string,
) {
  return api<CurrencyView>("/api/v1/currencies", {
    method: "POST",
    headers,
    body: { code },
  });
}

async function listCurrencies(headers: Record<string, string>) {
  return api<CurrencyView[]>("/api/v1/currencies", { headers });
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

describe("GET /api/v1/currencies/catalog (S12 — tabla ISO expuesta por la API)", () => {
  it("returns the ISO 4217 table with localizable names", async () => {
    const res = await api<IsoCurrencyView[]>(
      "/api/v1/currencies/catalog",
      { headers: ALICE },
    );

    expect(res.status).toBe(200);
    expect(res.body.length).toBeGreaterThanOrEqual(160);
    const pen = res.body.find((c) => c.code === "PEN");
    expect(pen).toMatchObject({
      nameEn: "Sol",
      nameEs: "Sol",
      minorUnitExponent: 2,
    });
    const usd = res.body.find((c) => c.code === "USD");
    expect(usd).toMatchObject({
      nameEn: "US Dollar",
      nameEs: "Dólar estadounidense",
    });
    const jpy = res.body.find((c) => c.code === "JPY");
    expect(jpy?.minorUnitExponent).toBe(0);
  });

});

describe("workspace catalog bootstrap (INV-MON-01..03)", () => {
  it("seeds a new workspace catalog with its default currency (PEN)", async () => {
    const res = await listCurrencies(ALICE);

    expect(res.status).toBe(200);
    expect(res.body.map((c) => c.code)).toEqual(["PEN"]);
    expect(res.body[0]?.nameEs).toBe("Sol");
    expect(res.body[0]?.archivedAt).toBeNull();
  });
});

describe("POST /api/v1/currencies (INV-MON-01)", () => {
  it("adds an ISO currency to the workspace catalog", async () => {
    const res = await addCurrency(ALICE, "USD");

    expect(res.status).toBe(201);
    expect(res.body.code).toBe("USD");
    expect(res.body.nameEn).toBe("US Dollar");
    expect(res.body.nameEs).toBe("Dólar estadounidense");

    const list = await listCurrencies(ALICE);
    expect(list.body.map((c) => c.code)).toEqual(["PEN", "USD"]);
  });

  it("rejects a code absent from the ISO table", async () => {
    const res = await api<ApiError>("/api/v1/currencies", {
      method: "POST",
      headers: ALICE,
      body: { code: "CHP" },
    });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("CURRENCY_UNKNOWN_ISO");
  });

  it("rejects a malformed code", async () => {
    const res = await api<ApiError>("/api/v1/currencies", {
      method: "POST",
      headers: ALICE,
      body: { code: "US1" },
    });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("CURRENCY_INVALID_CODE");
  });

  it("rejects a duplicate code in the same workspace", async () => {
    await addCurrency(ALICE, "USD");

    const res = await api<ApiError>("/api/v1/currencies", {
      method: "POST",
      headers: ALICE,
      body: { code: "USD" },
    });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe("CURRENCY_CODE_TAKEN");
  });

  it("rejects the already-seeded default currency", async () => {
    const res = await api<ApiError>("/api/v1/currencies", {
      method: "POST",
      headers: ALICE,
      body: { code: "PEN" },
    });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe("CURRENCY_CODE_TAKEN");
  });
});

describe("account creation requires an enabled currency (INV-MON-03)", () => {
  it("rejects an account in a currency not in the workspace catalog", async () => {
    const res = await api<ApiError>("/api/v1/accounts", {
      method: "POST",
      headers: ALICE,
      body: { name: "e2e-cur cuenta yen", currency: "JPY" },
    });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("ACCOUNT_CURRENCY_NOT_ENABLED");
  });

  it("accepts the account once the currency is added to the catalog", async () => {
    const created = await addCurrency(ALICE, "JPY");
    expect(created.status).toBe(201);

    const res = await api("/api/v1/accounts", {
      method: "POST",
      headers: ALICE,
      body: { name: "e2e-cur cuenta yen", currency: "JPY" },
    });

    expect(res.status).toBe(201);
  });
});

describe("PATCH /api/v1/currencies/:id (INV-MON-04)", () => {
  it("changes the code when nothing uses it", async () => {
    const created = await addCurrency(ALICE, "USD");

    const res = await api<CurrencyView>(
      `/api/v1/currencies/${created.body.id}`,
      {
        method: "PATCH",
        headers: ALICE,
        body: { code: "EUR" },
      },
    );

    expect(res.status).toBe(200);
    expect(res.body.code).toBe("EUR");
    const list = await listCurrencies(ALICE);
    expect(list.body.map((c) => c.code)).toEqual(["EUR", "PEN"]);
  });

  it("rejects the change when an account uses the code", async () => {
    const created = await addCurrency(ALICE, "USD");
    await api("/api/v1/accounts", {
      method: "POST",
      headers: ALICE,
      body: { name: "e2e-cur dolares", currency: "USD" },
    });

    const res = await api<ApiError>(
      `/api/v1/currencies/${created.body.id}`,
      {
        method: "PATCH",
        headers: ALICE,
        body: { code: "EUR" },
      },
    );

    expect(res.status).toBe(409);
    expect(res.body.code).toBe("CURRENCY_IN_USE");
  });

  it("rejects the change when a transaction uses the code", async () => {
    const created = await addCurrency(ALICE, "USD");
    const account = await api<{ id: string }>("/api/v1/accounts", {
      method: "POST",
      headers: ALICE,
      body: { name: "e2e-cur usd", currency: "USD" },
    });
    const tx = await api("/api/v1/transactions", {
      method: "POST",
      headers: ALICE,
      body: {
        accountId: account.body.id,
        type: "income",
        amount: "10.00",
        currency: "USD",
        businessDate: "2026-11-04",
        timezone: "UTC",
        concept: "e2e-cur venta",
        idempotencyKey: `e2e-cur-${randomUUID()}`,
      },
    });
    expect(tx.status).toBe(201);

    const res = await api<ApiError>(
      `/api/v1/currencies/${created.body.id}`,
      {
        method: "PATCH",
        headers: ALICE,
        body: { code: "EUR" },
      },
    );

    expect(res.status).toBe(409);
    expect(res.body.code).toBe("CURRENCY_IN_USE");
  });

  it("rejects a no-op revision", async () => {
    const created = await addCurrency(ALICE, "USD");

    const res = await api<ApiError>(
      `/api/v1/currencies/${created.body.id}`,
      {
        method: "PATCH",
        headers: ALICE,
        body: { code: "USD" },
      },
    );

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("CURRENCY_NO_CHANGES");
  });

  it("returns 404 for a currency owned by another workspace", async () => {
    const created = await addCurrency(ALICE, "USD");

    const res = await api<ApiError>(
      `/api/v1/currencies/${created.body.id}`,
      {
        method: "PATCH",
        headers: BOB,
        body: { code: "EUR" },
      },
    );

    expect(res.status).toBe(404);
    expect(res.body.code).toBe("CURRENCY_NOT_FOUND");
  });
});

describe("POST /api/v1/currencies/:id/archive (INV-MON-02)", () => {
  it("archives a non-default unused currency and hides it from the list", async () => {
    const created = await addCurrency(ALICE, "USD");

    const res = await api<CurrencyView>(
      `/api/v1/currencies/${created.body.id}/archive`,
      { method: "POST", headers: ALICE },
    );

    expect(res.status).toBe(201);
    expect(res.body.archivedAt).not.toBeNull();
    const list = await listCurrencies(ALICE);
    expect(list.body.map((c) => c.code)).toEqual(["PEN"]);
  });

  it("rejects archiving the workspace default currency", async () => {
    await addCurrency(ALICE, "USD");
    const list = await listCurrencies(ALICE);
    const pen = list.body.find((c) => c.code === "PEN");

    const res = await api<ApiError>(
      `/api/v1/currencies/${pen?.id}/archive`,
      { method: "POST", headers: ALICE },
    );

    expect(res.status).toBe(409);
    expect(res.body.code).toBe("CURRENCY_IS_DEFAULT");
  });

  it("rejects archiving a currency used by an account", async () => {
    const created = await addCurrency(ALICE, "USD");
    await api("/api/v1/accounts", {
      method: "POST",
      headers: ALICE,
      body: { name: "e2e-cur dolares", currency: "USD" },
    });

    const res = await api<ApiError>(
      `/api/v1/currencies/${created.body.id}/archive`,
      { method: "POST", headers: ALICE },
    );

    expect(res.status).toBe(409);
    expect(res.body.code).toBe("CURRENCY_IN_USE");
  });

  it("rejects archiving the last active currency", async () => {
    // Move the default away from the only catalog entry so the
    // last-active guard is what fires (not CURRENCY_IS_DEFAULT).
    await api("/api/v1/workspace", {
      method: "PATCH",
      headers: ALICE,
      body: { defaultCurrency: "USD" },
    });
    const list = await listCurrencies(ALICE);
    const pen = list.body.find((c) => c.code === "PEN");

    const res = await api<ApiError>(
      `/api/v1/currencies/${pen?.id}/archive`,
      { method: "POST", headers: ALICE },
    );

    expect(res.status).toBe(409);
    expect(res.body.code).toBe("CURRENCY_LAST_ACTIVE");
  });

  it("an archived currency blocks new accounts in that code (INV-MON-03)", async () => {
    const created = await addCurrency(ALICE, "USD");
    await api(`/api/v1/currencies/${created.body.id}/archive`, {
      method: "POST",
      headers: ALICE,
    });

    const res = await api<ApiError>("/api/v1/accounts", {
      method: "POST",
      headers: ALICE,
      body: { name: "e2e-cur tarjeta usd", currency: "USD" },
    });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("ACCOUNT_CURRENCY_NOT_ENABLED");
  });

  it("returns 404 for a currency owned by another workspace", async () => {
    const created = await addCurrency(ALICE, "USD");

    const res = await api<ApiError>(
      `/api/v1/currencies/${created.body.id}/archive`,
      { method: "POST", headers: BOB },
    );

    expect(res.status).toBe(404);
    expect(res.body.code).toBe("CURRENCY_NOT_FOUND");
  });
});

describe("workspace isolation", () => {
  it("keeps catalogs independent between workspaces", async () => {
    await addCurrency(ALICE, "EUR");

    const aliceList = await listCurrencies(ALICE);
    const bobList = await listCurrencies(BOB);

    expect(aliceList.body.map((c) => c.code)).toEqual(["EUR", "PEN"]);
    expect(bobList.body.map((c) => c.code)).toEqual(["PEN"]);
  });
});
