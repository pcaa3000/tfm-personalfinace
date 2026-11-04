import { afterEach, describe, expect, it, vi } from "vitest";

import {
  addCurrency,
  archiveAccount,
  archiveCategory,
  archiveCurrency,
  createAccount,
  createCategory,
  listCurrencies,
  listCurrencyCatalog,
  listTransactions,
  reviseAccount,
  reviseCategory,
  reviseCurrency,
  updateWorkspace,
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
