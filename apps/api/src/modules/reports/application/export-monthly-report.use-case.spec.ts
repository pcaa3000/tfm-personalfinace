import { describe, expect, it, vi } from "vitest";

import { WorkspaceId } from "../../shared-kernel/index.js";
import {
  DomainError,
  err,
  ok,
  type Result,
} from "../../shared-kernel/index.js";
import type { ReportPeriod } from "../domain/report-period.js";
import type { AntExpensesView } from "./ant-expenses.view.js";
import type { CashFlowReportView } from "./cash-flow.view.js";
import type { ExpensesByCategoryView } from "./expenses-by-category.view.js";
import type { MonthlySavingsView } from "./monthly-savings.view.js";
import {
  ExportMonthlyReportUseCase,
  type ExportMonthlyReportCommand,
} from "./export-monthly-report.use-case.js";
import type { MonthlyReportBundle } from "./report-export.serializer.js";

const wsResult = WorkspaceId.create("ws-1");
if (!wsResult.ok) throw new Error("setup failed");
const ws = wsResult.value;

const PERIOD: ReportPeriod = {
  from: "2026-09-01",
  to: "2026-09-30",
  currency: "EUR",
  periodStatus: "closed",
};

const CASH_FLOW: CashFlowReportView = {
  period: PERIOD,
  accounts: [
    {
      accountId: "acc-1",
      name: "Checking",
      kind: "bank",
      income: "100.00",
      expense: "40.50",
      transfersIn: "0.00",
      transfersOut: "38.00",
      netFlow: "21.50",
    },
  ],
};

const EXPENSES: ExpensesByCategoryView = {
  period: PERIOD,
  totalExpenses: "400.00",
  natureTotals: { essential: "400.00" },
  categories: [
    {
      categoryId: "cat-food",
      key: "food",
      label: "Food",
      nature: "essential",
      total: "400.00",
      percentOfExpenses: 100,
      transactionCount: 2,
    },
  ],
};

const ANT: AntExpensesView = { period: PERIOD, totalDiscretionary: "0.00", groups: [] };

const SAVINGS: MonthlySavingsView = {
  period: PERIOD,
  income: "10000.00",
  expense: "4000.00",
  saved: "6000.00",
  observedRate: "60.00",
  note: null,
  deficit: null,
};

const XLSX_BYTES = new Uint8Array([0x50, 0x4b, 0x03, 0x04]);

const COMMAND: ExportMonthlyReportCommand = {
  workspaceId: ws,
  currency: "EUR",
  year: 2026,
  month: 9,
  timezone: "UTC",
  format: "csv",
};

function makeUseCase() {
  const cashFlow = {
    execute: vi.fn(
      async (): Promise<Result<CashFlowReportView, DomainError>> =>
        ok(CASH_FLOW),
    ),
  };
  const expensesByCategory = {
    execute: vi.fn(
      async (): Promise<Result<ExpensesByCategoryView, DomainError>> =>
        ok(EXPENSES),
    ),
  };
  const antExpenses = {
    execute: vi.fn(
      async (): Promise<Result<AntExpensesView, DomainError>> => ok(ANT),
    ),
  };
  const monthlySavings = {
    execute: vi.fn(
      async (): Promise<Result<MonthlySavingsView, DomainError>> =>
        ok(SAVINGS),
    ),
  };
  const xlsx = {
    serialize: vi.fn(async (_bundle: MonthlyReportBundle) => XLSX_BYTES),
  };
  const clock = { now: () => new Date("2026-10-01T12:00:00.000Z") };
  const useCase = new ExportMonthlyReportUseCase(
    cashFlow,
    expensesByCategory,
    antExpenses,
    monthlySavings,
    xlsx,
    clock,
  );
  return { useCase, cashFlow, expensesByCategory, antExpenses, monthlySavings, xlsx };
}

describe("ExportMonthlyReportUseCase", () => {
  it("forwards the report period input (without the format flag) to the four report use cases", async () => {
    const { useCase, cashFlow, expensesByCategory, antExpenses, monthlySavings } =
      makeUseCase();

    const result = await useCase.execute(COMMAND);

    expect(result.ok).toBe(true);
    const input = {
      workspaceId: ws,
      currency: "EUR",
      year: 2026,
      month: 9,
      timezone: "UTC",
    };
    expect(cashFlow.execute).toHaveBeenCalledWith(input);
    expect(expensesByCategory.execute).toHaveBeenCalledWith(input);
    expect(antExpenses.execute).toHaveBeenCalledWith(input);
    expect(monthlySavings.execute).toHaveBeenCalledWith(input);
  });

  it("csv: returns a text/csv attachment file whose body serializes the bundle", async () => {
    const { useCase } = makeUseCase();

    const result = await useCase.execute(COMMAND);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.filename).toBe("report-EUR-2026-09.csv");
    expect(result.value.contentType).toBe("text/csv; charset=utf-8");
    const body = result.value.body as string;
    expect(body.startsWith("## metadata\n")).toBe(true);
    expect(body).toContain("periodStatus,closed");
    expect(body).toContain("generatedAt,2026-10-01T12:00:00.000Z");
    expect(body).toContain("timezone,UTC");
    expect(body).toContain("Checking,100.00,40.50,0.00,38.00,21.50");
  });

  it("zero-pads the month and uppercases the currency in the filename", async () => {
    const { useCase } = makeUseCase();

    const result = await useCase.execute({ ...COMMAND, month: 3 });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.filename).toBe("report-EUR-2026-03.csv");
  });

  it("xlsx: delegates to the xlsx serializer port and returns its bytes", async () => {
    const { useCase, xlsx } = makeUseCase();

    const result = await useCase.execute({ ...COMMAND, format: "xlsx" });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.filename).toBe("report-EUR-2026-09.xlsx");
    expect(result.value.contentType).toBe(
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    expect(result.value.body).toBe(XLSX_BYTES);
    expect(xlsx.serialize).toHaveBeenCalledTimes(1);
    const bundle = xlsx.serialize.mock.calls[0]![0];
    expect(bundle.metadata).toEqual({
      timezone: "UTC",
      currency: "EUR",
      from: "2026-09-01",
      to: "2026-09-30",
      periodStatus: "closed",
      generatedAt: "2026-10-01T12:00:00.000Z",
    });
    expect(bundle.cashFlow).toBe(CASH_FLOW);
    expect(bundle.expensesByCategory).toBe(EXPENSES);
    expect(bundle.antExpenses).toBe(ANT);
    expect(bundle.monthlySavings).toBe(SAVINGS);
  });

  it("does not call the xlsx serializer for csv exports", async () => {
    const { useCase, xlsx } = makeUseCase();

    await useCase.execute(COMMAND);

    expect(xlsx.serialize).not.toHaveBeenCalled();
  });

  it.each([
    ["cash-flow", "cashFlow"],
    ["expenses-by-category", "expensesByCategory"],
    ["ant-expenses", "antExpenses"],
    ["monthly-savings", "monthlySavings"],
  ] as const)(
    "propagates a domain error from the %s use case",
    async (_label, key) => {
      const deps = makeUseCase();
      deps[key].execute.mockResolvedValue(
        err(new DomainError("TIMEZONE_INVALID", "bad tz")),
      );

      const result = await deps.useCase.execute(COMMAND);

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toEqual(
        expect.objectContaining({ code: "TIMEZONE_INVALID" }),
      );
    },
  );
});
