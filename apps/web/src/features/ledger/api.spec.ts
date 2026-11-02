import { afterEach, describe, expect, it, vi } from "vitest";

import { listTransactions } from "./api";

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
