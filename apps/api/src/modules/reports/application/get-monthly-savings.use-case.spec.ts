import { describe, expect, it, vi } from "vitest";

import { WorkspaceId } from "../../shared-kernel/index.js";
import { PeriodClose } from "../domain/period-close.js";
import type { MonthlySavingsTotals } from "./ports/monthly-savings-report.port.js";
import { GetMonthlySavingsUseCase } from "./get-monthly-savings.use-case.js";

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

const baseCommand = {
  workspaceId: ws,
  currency: "EUR",
  year: 2026,
  month: 9,
  timezone: "UTC",
};

function useCaseWith(totals: MonthlySavingsTotals, closes: PeriodClose[] = []) {
  const query = {
    incomeExpenseTotals: vi.fn(async () => totals),
  };
  const useCase = new GetMonthlySavingsUseCase(
    closesReturning(closes),
    query,
    clock("2026-10-15T12:00:00Z"),
  );
  return { useCase, query };
}

describe("GetMonthlySavingsUseCase", () => {
  it("reports the observed savings rate and saved amount for a normal month", async () => {
    const { useCase } = useCaseWith({
      incomeMinor: 1_000_000n,
      expenseMinor: 400_000n,
    });

    const result = await useCase.execute(baseCommand);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.period).toEqual({
      from: "2026-09-01",
      to: "2026-09-30",
      currency: "EUR",
      periodStatus: "provisional",
    });
    expect(result.value.income).toBe("10000.00");
    expect(result.value.expense).toBe("4000.00");
    expect(result.value.saved).toBe("6000.00");
    expect(result.value.observedRate).toBe("60.00");
    expect(result.value.note).toBeNull();
    expect(result.value.deficit).toBeNull();
  });

  it("rounds the observed rate to two decimals", async () => {
    const { useCase } = useCaseWith({
      incomeMinor: 300_000n,
      expenseMinor: 100_000n,
    });

    const result = await useCase.execute(baseCommand);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.saved).toBe("2000.00");
    expect(result.value.observedRate).toBe("66.67");
  });

  it("reports 0.00 rate, note deficit and the deficit amount when expenses exceed income (CA-008)", async () => {
    const { useCase } = useCaseWith({
      incomeMinor: 500_000n,
      expenseMinor: 600_000n,
    });

    const result = await useCase.execute(baseCommand);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.saved).toBe("-1000.00");
    expect(result.value.observedRate).toBe("0.00");
    expect(result.value.note).toBe("deficit");
    expect(result.value.deficit).toBe("1000.00");
  });

  it("treats expenses equal to income as a zero deficit", async () => {
    const { useCase } = useCaseWith({
      incomeMinor: 100_000n,
      expenseMinor: 100_000n,
    });

    const result = await useCase.execute(baseCommand);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.saved).toBe("0.00");
    expect(result.value.observedRate).toBe("0.00");
    expect(result.value.note).toBe("deficit");
    expect(result.value.deficit).toBe("0.00");
  });

  it("omits the observed rate with note no_income when income is zero — never divides by zero", async () => {
    const { useCase } = useCaseWith({
      incomeMinor: 0n,
      expenseMinor: 50_000n,
    });

    const result = await useCase.execute(baseCommand);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.income).toBe("0.00");
    expect(result.value.saved).toBe("-500.00");
    expect(result.value.observedRate).toBeNull();
    expect(result.value.note).toBe("no_income");
    expect(result.value.deficit).toBeNull();
  });

  it("returns a zeroed report with note no_income for an empty period", async () => {
    const { useCase } = useCaseWith({ incomeMinor: 0n, expenseMinor: 0n });

    const result = await useCase.execute(baseCommand);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.saved).toBe("0.00");
    expect(result.value.observedRate).toBeNull();
    expect(result.value.note).toBe("no_income");
  });

  it("propagates period resolution errors without querying", async () => {
    const { useCase, query } = useCaseWith({
      incomeMinor: 0n,
      expenseMinor: 0n,
    });

    const result = await useCase.execute({ ...baseCommand, month: 13 });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("PERIOD_INVALID");
    }
    expect(query.incomeExpenseTotals).not.toHaveBeenCalled();
  });
});
