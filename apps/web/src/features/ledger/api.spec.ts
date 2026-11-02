import { afterEach, describe, expect, it, vi } from "vitest";

import {
  archiveCategory,
  createCategory,
  listTransactions,
  reviseCategory,
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
