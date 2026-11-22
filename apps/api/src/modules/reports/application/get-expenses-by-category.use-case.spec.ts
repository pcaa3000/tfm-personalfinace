import { describe, expect, it, vi } from "vitest";

import { WorkspaceId } from "../../shared-kernel/index.js";
import { PeriodClose } from "../domain/period-close.js";
import type { ExpenseCategoryTotals } from "./ports/expenses-by-category-report.port.js";
import { GetExpensesByCategoryUseCase } from "./get-expenses-by-category.use-case.js";

const wsResult = WorkspaceId.create("ws-1");
if (!wsResult.ok) throw new Error("setup failed");
const ws = wsResult.value;

const clock = (iso: string) => ({ now: () => new Date(iso) });

function closesReturning(stored: PeriodClose[]) {
  return {
    async findActiveByPeriod(
      workspaceId: WorkspaceId,
      currency: string,
      periodStart: string,
    ) {
      return (
        stored.find(
          (c) =>
            c.workspaceId.equals(workspaceId) &&
            c.currency === currency &&
            c.periodStart === periodStart &&
            c.supersededAt === null,
        ) ?? null
      );
    },
  };
}

function row(
  overrides: Partial<ExpenseCategoryTotals> = {},
): ExpenseCategoryTotals {
  return {
    categoryId: "cat-1",
    categoryKey: "food",
    categoryLabel: "Food",
    nature: "essential",
    totalMinor: 0n,
    transactionCount: 0,
    ...overrides,
  };
}

const baseCommand = {
  workspaceId: ws,
  currency: "EUR",
  year: 2026,
  month: 9,
  timezone: "UTC",
};

function useCaseWith(rows: ExpenseCategoryTotals[], closes: PeriodClose[] = []) {
  const query = {
    totalsPerCategory: vi.fn(async () => rows),
  };
  const useCase = new GetExpensesByCategoryUseCase(
    closesReturning(closes),
    query,
    clock("2026-10-15T12:00:00Z"),
  );
  return { useCase, query };
}

describe("GetExpensesByCategoryUseCase", () => {
  it("maps groups to decimal totals, percents, counts and nature subtotals", async () => {
    const { useCase } = useCaseWith([
      row({
        categoryId: "cat-food",
        categoryKey: "food",
        categoryLabel: "Food",
        nature: "essential",
        totalMinor: 30000n,
        transactionCount: 2,
      }),
      row({
        categoryId: "cat-fun",
        categoryKey: "fun",
        categoryLabel: "Fun",
        nature: "discretionary",
        totalMinor: 10000n,
        transactionCount: 1,
      }),
    ]);

    const result = await useCase.execute(baseCommand);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.period).toEqual({
      from: "2026-09-01",
      to: "2026-09-30",
      currency: "EUR",
      periodStatus: "provisional",
    });
    expect(result.value.totalExpenses).toBe("400.00");
    expect(result.value.categories).toEqual([
      {
        categoryId: "cat-food",
        key: "food",
        label: "Food",
        nature: "essential",
        total: "300.00",
        percentOfExpenses: 75,
        transactionCount: 2,
      },
      {
        categoryId: "cat-fun",
        key: "fun",
        label: "Fun",
        nature: "discretionary",
        total: "100.00",
        percentOfExpenses: 25,
        transactionCount: 1,
      },
    ]);
    expect(result.value.natureTotals).toEqual({
      essential: "300.00",
      discretionary: "100.00",
      obligation: "0.00",
      uncategorized: "0.00",
    });
  });

  it("folds NULL categoryId and the system uncategorized row into one uncategorized group", async () => {
    const { useCase } = useCaseWith([
      row({
        categoryId: null,
        categoryKey: null,
        categoryLabel: null,
        nature: null,
        totalMinor: 500n,
        transactionCount: 1,
      }),
      row({
        categoryId: "sys-uncategorized",
        categoryKey: "uncategorized",
        categoryLabel: "Sin categorizar",
        nature: "uncategorized",
        totalMinor: 700n,
        transactionCount: 2,
      }),
    ]);

    const result = await useCase.execute(baseCommand);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.categories).toEqual([
      {
        categoryId: null,
        key: "uncategorized",
        label: "Sin categorizar",
        nature: "uncategorized",
        total: "12.00",
        percentOfExpenses: 100,
        transactionCount: 3,
      },
    ]);
    expect(result.value.natureTotals.uncategorized).toBe("12.00");
    expect(result.value.totalExpenses).toBe("12.00");
  });

  it("exposes expense transactions under non-expense natures as their own group and subtotal", async () => {
    const { useCase } = useCaseWith([
      row({
        categoryId: "cat-salary",
        categoryKey: "salary",
        categoryLabel: "Salary",
        nature: "income",
        totalMinor: 800n,
        transactionCount: 1,
      }),
    ]);

    const result = await useCase.execute(baseCommand);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.categories[0]?.nature).toBe("income");
    expect(result.value.natureTotals.income).toBe("8.00");
  });

  it("sorts groups by total descending with a deterministic label tie-break", async () => {
    const { useCase } = useCaseWith([
      row({
        categoryId: "cat-b",
        categoryLabel: "Bravo",
        totalMinor: 1000n,
      }),
      row({
        categoryId: "cat-a",
        categoryLabel: "Alpha",
        totalMinor: 1000n,
      }),
      row({
        categoryId: "cat-c",
        categoryLabel: "Charlie",
        totalMinor: 5000n,
      }),
    ]);

    const result = await useCase.execute(baseCommand);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.categories.map((c) => c.categoryId)).toEqual([
      "cat-c",
      "cat-a",
      "cat-b",
    ]);
  });

  it("returns an empty report with zeroed nature subtotals when no expenses exist", async () => {
    const { useCase } = useCaseWith([]);

    const result = await useCase.execute(baseCommand);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.categories).toEqual([]);
    expect(result.value.totalExpenses).toBe("0.00");
    expect(result.value.natureTotals).toEqual({
      essential: "0.00",
      discretionary: "0.00",
      obligation: "0.00",
      uncategorized: "0.00",
    });
  });

  it("propagates period resolution errors without querying", async () => {
    const { useCase, query } = useCaseWith([row()]);

    const result = await useCase.execute({ ...baseCommand, month: 0 });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("PERIOD_INVALID");
    }
    expect(query.totalsPerCategory).not.toHaveBeenCalled();
  });
});
