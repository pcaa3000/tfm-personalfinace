import { afterEach, describe, expect, it, vi } from "vitest";

import {
  addCurrency,
  ApiError,
  archiveAccount,
  archiveCategory,
  archiveCurrency,
  createAccount,
  createCategory,
  createTransaction,
  fetchBalance,
  getWorkspace,
  listAccounts,
  listCategories,
  listCurrencies,
  listCurrencyCatalog,
  listTransactionRevisions,
  listTransactions,
  reviseAccount,
  reviseCategory,
  reviseCurrency,
  reviseTransaction,
  unarchiveAccount,
  updateWorkspace,
  voidTransaction,
  setAccessTokenProvider,
} from "./api";

const fetchMock = vi.fn<typeof fetch>(
  async () =>
    new Response(JSON.stringify([]), {
      status: 200,
      headers: { "content-type": "application/json" },
    }),
);

vi.stubGlobal("fetch", fetchMock);

afterEach(() => {
  fetchMock.mockClear();
});

function calledUrl(): string {
  const firstCall = fetchMock.mock.calls[0];
  if (!firstCall) throw new Error("fetch was not called");
  return String(firstCall[0]);
}

describe("listTransactions", () => {
  it("requests the bare endpoint without filters", async () => {
    await listTransactions();

    expect(calledUrl()).toBe("/api/v1/transactions");
  });

  it("builds the querystring from all filters (RF-013)", async () => {
    await listTransactions({
      q: "polleria",
      type: "expense",
      currency: "PEN",
      category: "uncategorized",
      from: "2026-10-01",
      to: "2026-10-31",
      limit: 25,
      offset: 50,
    });

    expect(calledUrl()).toBe(
      "/api/v1/transactions?q=polleria&type=expense&currency=PEN&category=uncategorized&from=2026-10-01&to=2026-10-31&limit=25&offset=50",
    );
  });

  it("omits empty and undefined values", async () => {
    await listTransactions({ q: "", currency: "USD", category: undefined });

    expect(calledUrl()).toBe("/api/v1/transactions?currency=USD");
  });
});

describe("fetchBalance", () => {
  it("requests the balance aggregate endpoint", async () => {
    await fetchBalance();

    expect(calledUrl()).toBe("/api/v1/balance");
  });
});

describe("transaction lifecycle", () => {
  it("creates a transaction with POST /transactions", async () => {
    const input = {
      type: "expense" as const,
      amount: "12.50",
      currency: "PEN",
      businessDate: "2026-10-01",
      timezone: "UTC",
      concept: "Almuerzo",
      accountId: "acc-1",
      categoryId: null,
      idempotencyKey: "key-1",
    };

    await createTransaction(input);

    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(String(url)).toBe("/api/v1/transactions");
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).toEqual(input);
  });

  it("revises a transaction with PATCH /transactions/:id", async () => {
    await reviseTransaction("tx-1", { concept: "Almuerzo team" });

    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(String(url)).toBe("/api/v1/transactions/tx-1");
    expect(init?.method).toBe("PATCH");
    expect(JSON.parse(String(init?.body))).toEqual({
      concept: "Almuerzo team",
    });
  });

  it("voids a transaction with POST /transactions/:id/void", async () => {
    await voidTransaction("tx-1");

    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(String(url)).toBe("/api/v1/transactions/tx-1/void");
    expect(init?.method).toBe("POST");
  });

  it("lists revisions with GET /transactions/:id/revisions", async () => {
    await listTransactionRevisions("tx-1");

    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(String(url)).toBe("/api/v1/transactions/tx-1/revisions");
    expect(init?.method ?? "GET").toBe("GET");
  });
});

describe("catalog reads", () => {
  it("lists categories with GET /categories", async () => {
    await listCategories();

    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(String(url)).toBe("/api/v1/categories");
    expect(init?.method ?? "GET").toBe("GET");
  });

  it("gets the workspace with GET /workspace", async () => {
    await getWorkspace();

    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(String(url)).toBe("/api/v1/workspace");
    expect(init?.method ?? "GET").toBe("GET");
  });

  it("lists accounts without options on the bare endpoint", async () => {
    await listAccounts();

    expect(calledUrl()).toBe("/api/v1/accounts");
  });
});

describe("ApiError", () => {
  it("throws ApiError carrying the server code, message and status", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          code: "TRANSACTION_NOT_FOUND",
          message: "El movimiento no existe.",
        }),
        { status: 404, headers: { "content-type": "application/json" } },
      ),
    );

    const error = await getWorkspace().catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).name).toBe("ApiError");
    expect(error).toMatchObject({
      code: "TRANSACTION_NOT_FOUND",
      message: "El movimiento no existe.",
      status: 404,
    });
  });

  it("keeps the server code but falls back to a generic message", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ code: "ACCOUNT_NAME_TAKEN" }), {
        status: 409,
        headers: { "content-type": "application/json" },
      }),
    );

    const error = await getWorkspace().catch((e: unknown) => e);

    expect(error).toMatchObject({
      code: "ACCOUNT_NAME_TAKEN",
      message: "Request failed with status 409",
      status: 409,
    });
  });

  it("falls back to HTTP_<status> when the payload has no code", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ detail: "boom" }), {
        status: 500,
        headers: { "content-type": "application/json" },
      }),
    );

    const error = await getWorkspace().catch((e: unknown) => e);

    expect(error).toMatchObject({
      code: "HTTP_500",
      message: "Request failed with status 500",
      status: 500,
    });
  });

  it("falls back to HTTP_<status> on a non-JSON error body", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response("upstream exploded", { status: 502 }),
    );

    const error = await getWorkspace().catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      code: "HTTP_502",
      message: "Request failed with status 502",
      status: 502,
    });
  });
});

describe("custom categories (RF-040, RF-044)", () => {
  it("creates a category with POST /categories", async () => {
    await createCategory({ label: "Mascotas", nature: "discretionary" });

    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(String(url)).toBe("/api/v1/categories");
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).toEqual({
      label: "Mascotas",
      nature: "discretionary",
    });
  });

  it("revises a category with PATCH /categories/:id", async () => {
    await reviseCategory("cat-1", { label: "Mis mascotas", nature: "essential" });

    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(String(url)).toBe("/api/v1/categories/cat-1");
    expect(init?.method).toBe("PATCH");
    expect(JSON.parse(String(init?.body))).toEqual({
      label: "Mis mascotas",
      nature: "essential",
    });
  });

  it("archives a category with POST /categories/:id/archive", async () => {
    await archiveCategory("cat-1");

    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(String(url)).toBe("/api/v1/categories/cat-1/archive");
    expect(init?.method).toBe("POST");
  });
});

describe("accounts (S12-2)", () => {
  it("creates an account with kind and initialBalance", async () => {
    await createAccount({
      name: "BCP soles",
      currency: "PEN",
      kind: "bank",
      initialBalance: "1500.00",
    });

    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(String(url)).toBe("/api/v1/accounts");
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).toEqual({
      name: "BCP soles",
      currency: "PEN",
      kind: "bank",
      initialBalance: "1500.00",
    });
  });

  it("revises an account with PATCH /accounts/:id", async () => {
    await reviseAccount("acc-1", {
      name: "BCP principal",
      kind: "savings",
      initialBalance: "200.00",
    });

    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(String(url)).toBe("/api/v1/accounts/acc-1");
    expect(init?.method).toBe("PATCH");
    expect(JSON.parse(String(init?.body))).toEqual({
      name: "BCP principal",
      kind: "savings",
      initialBalance: "200.00",
    });
  });

  it("archives an account with POST /accounts/:id/archive", async () => {
    await archiveAccount("acc-1");

    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(String(url)).toBe("/api/v1/accounts/acc-1/archive");
    expect(init?.method).toBe("POST");
  });
});

describe("workspace currencies (S12-4)", () => {
  it("lists the active workspace currencies", async () => {
    await listCurrencies();

    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(String(url)).toBe("/api/v1/currencies");
    expect(init?.method ?? "GET").toBe("GET");
  });

  it("lists the ISO 4217 catalog for the searchable selector", async () => {
    await listCurrencyCatalog();

    expect(calledUrl()).toBe("/api/v1/currencies/catalog");
  });

  it("adds a currency with POST /currencies", async () => {
    await addCurrency({ code: "USD" });

    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(String(url)).toBe("/api/v1/currencies");
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).toEqual({ code: "USD" });
  });

  it("revises a currency code with PATCH /currencies/:id", async () => {
    await reviseCurrency("cur-1", { code: "EUR" });

    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(String(url)).toBe("/api/v1/currencies/cur-1");
    expect(init?.method).toBe("PATCH");
    expect(JSON.parse(String(init?.body))).toEqual({ code: "EUR" });
  });

  it("archives a currency with POST /currencies/:id/archive", async () => {
    await archiveCurrency("cur-1");

    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(String(url)).toBe("/api/v1/currencies/cur-1/archive");
    expect(init?.method).toBe("POST");
  });
});

describe("workspace preferences (RF-003)", () => {
  it("sends the preference patch with PATCH /workspace", async () => {
    await updateWorkspace({ timezone: "America/Lima", locale: "es-PE" });

    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(String(url)).toBe("/api/v1/workspace");
    expect(init?.method).toBe("PATCH");
    expect(JSON.parse(String(init?.body))).toEqual({
      timezone: "America/Lima",
      locale: "es-PE",
    });
  });

  it("sends a partial patch with only the changed field", async () => {
    await updateWorkspace({ defaultCurrency: "USD" });

    const [, init] = fetchMock.mock.calls[0] ?? [];
    expect(JSON.parse(String(init?.body))).toEqual({
      defaultCurrency: "USD",
    });
  });
});

describe("unarchive accounts (T25)", () => {
  it("lists accounts including archived via query param", async () => {
    await listAccounts({ includeArchived: true });

    expect(calledUrl()).toBe("/api/v1/accounts?includeArchived=true");
  });

  it("restores an account with PATCH {archived:false}", async () => {
    await unarchiveAccount("acc-9");

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe("/api/v1/accounts/acc-9");
    expect(init?.method).toBe("PATCH");
    expect(String(init?.body)).toBe(JSON.stringify({ archived: false }));
  });
});

describe("access token provider (T6-web)", () => {
  afterEach(() => {
    setAccessTokenProvider(null);
  });

  it("sends Authorization: Bearer when the provider yields a token", async () => {
    setAccessTokenProvider(async () => "token-abc");

    await listTransactions();

    const [, init] = fetchMock.mock.calls[0]!;
    const headers = new Headers(init?.headers);
    expect(headers.get("authorization")).toBe("Bearer token-abc");
    expect(headers.get("content-type")).toBe("application/json");
  });

  it("omits the Authorization header when no provider is set", async () => {
    await listTransactions();

    const [, init] = fetchMock.mock.calls[0]!;
    const headers = new Headers(init?.headers);
    expect(headers.get("authorization")).toBeNull();
  });

  it("omits the Authorization header when the provider yields null", async () => {
    setAccessTokenProvider(async () => null);

    await listTransactions();

    const [, init] = fetchMock.mock.calls[0]!;
    const headers = new Headers(init?.headers);
    expect(headers.get("authorization")).toBeNull();
  });
});
