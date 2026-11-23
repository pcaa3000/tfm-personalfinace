import { afterEach, describe, expect, it, vi } from "vitest";

import {
  closePeriod,
  fetchAvoidableExpenses,
  fetchCashFlowReport,
  fetchExpensesByCategory,
  fetchMonthlySavings,
  fetchReportExport,
  listPeriodCloses,
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

  it("fetches the avoidable-expenses report with the same period query", async () => {
    await fetchAvoidableExpenses(periodQuery);

    expect(calledUrl()).toBe(
      "/api/v1/reports/avoidable-expenses?currency=PEN&year=2026&month=11",
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

describe("period closes api (reports-monthly T9, S5)", () => {
  it("posts the close with the integrity declaration always true", async () => {
    await closePeriod("PEN", 2026, 10);

    expect(calledUrl()).toBe("/api/v1/period-closes");
    const init = fetchMock.mock.calls[0]?.[1];
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).toEqual({
      currency: "PEN",
      year: 2026,
      month: 10,
      integrityConfirmed: true,
    });
  });

  it("lists period closes filtered by currency", async () => {
    await listPeriodCloses("PEN");

    expect(calledUrl()).toBe("/api/v1/period-closes?currency=PEN");
  });

  it("lists all period closes when no currency is given", async () => {
    await listPeriodCloses();

    expect(calledUrl()).toBe("/api/v1/period-closes");
  });
});

describe("report export api (reports-monthly T10)", () => {
  it("fetches the export attachment with the format param as a blob", async () => {
    const blob = await fetchReportExport(periodQuery, "csv");

    expect(calledUrl()).toBe(
      "/api/v1/reports/export?currency=PEN&year=2026&month=11&format=csv",
    );
    expect(blob).toBeInstanceOf(Blob);
  });

  it("requests the xlsx format through the same export path", async () => {
    await fetchReportExport(periodQuery, "xlsx");

    expect(calledUrl()).toBe(
      "/api/v1/reports/export?currency=PEN&year=2026&month=11&format=xlsx",
    );
  });

  it("attaches the same auth headers as the JSON requests", async () => {
    const { setAccessTokenProvider } = await import("../ledger/api");
    setAccessTokenProvider(async () => "token-xyz");
    try {
      await fetchReportExport(periodQuery, "csv");

      const headers = new Headers(fetchMock.mock.calls[0]?.[1]?.headers);
      expect(headers.get("authorization")).toBe("Bearer token-xyz");
    } finally {
      setAccessTokenProvider(null);
    }
  });

  it("throws the ApiError envelope on a failed export", async () => {
    const { ApiError } = await import("../ledger/api");
    fetchMock.mockImplementationOnce(
      async () =>
        new Response(
          JSON.stringify({ code: "REPORT_EXPORT_FAILED", message: "nope" }),
          { status: 500, headers: { "content-type": "application/json" } },
        ),
    );

    const error: unknown = await fetchReportExport(
      periodQuery,
      "csv",
    ).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      code: "REPORT_EXPORT_FAILED",
      status: 500,
    });
  });
});
