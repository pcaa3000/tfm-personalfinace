import { afterEach, describe, expect, it, vi } from "vitest";

import {
  fetchAntExpenses,
  fetchCashFlowReport,
  fetchExpensesByCategory,
  fetchMonthlySavings,
} from "./api";

const fetchMock = vi.fn<typeof fetch>(
  async () =>
    new Response(JSON.stringify({}), {
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

const periodQuery = { currency: "PEN", year: 2026, month: 11 };

describe("reports api (reports-monthly T7, S7)", () => {
  it("fetches the cash-flow report with currency/year/month query params", async () => {
    await fetchCashFlowReport(periodQuery);

    expect(calledUrl()).toBe(
      "/api/v1/reports/cash-flow?currency=PEN&year=2026&month=11",
    );
  });

  it("fetches the expenses-by-category report with the same period query", async () => {
    await fetchExpensesByCategory(periodQuery);

    expect(calledUrl()).toBe(
      "/api/v1/reports/expenses-by-category?currency=PEN&year=2026&month=11",
    );
  });

  it("fetches the ant-expenses report with the same period query", async () => {
    await fetchAntExpenses(periodQuery);

    expect(calledUrl()).toBe(
      "/api/v1/reports/ant-expenses?currency=PEN&year=2026&month=11",
    );
  });

  it("fetches the monthly-savings report with the same period query", async () => {
    await fetchMonthlySavings(periodQuery);

    expect(calledUrl()).toBe(
      "/api/v1/reports/monthly-savings?currency=PEN&year=2026&month=11",
    );
  });

  it("sends the report query through the shared auth path (bearer + dev/demo headers)", async () => {
    const { setAccessTokenProvider } = await import("../ledger/api");
    setAccessTokenProvider(async () => "token-abc");
    try {
      await fetchCashFlowReport(periodQuery);

      const headers = new Headers(fetchMock.mock.calls[0]?.[1]?.headers);
      expect(headers.get("authorization")).toBe("Bearer token-abc");
    } finally {
      setAccessTokenProvider(null);
    }
  });
});
