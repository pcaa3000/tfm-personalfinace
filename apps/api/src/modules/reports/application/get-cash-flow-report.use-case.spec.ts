import { describe, expect, it, vi } from "vitest";

import { WorkspaceId } from "../../shared-kernel/index.js";
import { PeriodClose } from "../domain/period-close.js";
import type { CashFlowAccountTotals } from "./ports/cash-flow-report.port.js";
import { GetCashFlowReportUseCase } from "./get-cash-flow-report.use-case.js";

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

function totals(
  overrides: Partial<CashFlowAccountTotals> = {},
): CashFlowAccountTotals {
  return {
    accountId: "acc-1",
    accountName: "Checking",
    accountKind: "bank",
    incomeMinor: 0n,
    expenseMinor: 0n,
    transfersInMinor: 0n,
    transfersOutMinor: 0n,
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

function useCaseWith(rows: CashFlowAccountTotals[], closes: PeriodClose[] = []) {
  const query = {
    totalsPerAccount: vi.fn(async () => rows),
  };
  const useCase = new GetCashFlowReportUseCase(
    closesReturning(closes),
    query,
    clock("2026-10-15T12:00:00Z"),
  );
  return { useCase, query };
}

describe("GetCashFlowReportUseCase", () => {
  it("aggregates each account into income/expense/transfers and net flow as decimal strings", async () => {
    const { useCase } = useCaseWith([
      totals({
        accountId: "acc-1",
        accountName: "Checking",
        incomeMinor: 10000n,
        expenseMinor: 4050n,
        transfersInMinor: 0n,
        transfersOutMinor: 3800n,
      }),
      totals({
        accountId: "acc-2",
        accountName: "Savings",
        incomeMinor: 20000n,
        transfersInMinor: 3000n,
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
    const [checking, savings] = result.value.accounts;
    expect(checking).toEqual({
      accountId: "acc-1",
      name: "Checking",
      kind: "bank",
      income: "100.00",
      expense: "40.50",
      transfersIn: "0.00",
      transfersOut: "38.00",
      netFlow: "21.50",
    });
    expect(savings).toMatchObject({
      accountId: "acc-2",
      transfersIn: "30.00",
      netFlow: "230.00",
    });
  });

  it("reports NULL accountId as the unassigned group, sorted after named accounts", async () => {
    const { useCase } = useCaseWith([
      totals({
        accountId: null,
        accountName: null,
        accountKind: null,
        expenseMinor: 1525n,
        transfersInMinor: 800n,
      }),
      totals({ accountId: "acc-z", accountName: "Zeta" }),
      totals({ accountId: "acc-a", accountName: "Alpha" }),
    ]);

    const result = await useCase.execute(baseCommand);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const [first, second, last] = result.value.accounts;
    expect(first?.accountId).toBe("acc-a");
    expect(second?.accountId).toBe("acc-z");
    expect(last).toEqual({
      accountId: null,
      name: null,
      kind: null,
      income: "0.00",
      expense: "15.25",
      transfersIn: "8.00",
      transfersOut: "0.00",
      netFlow: "-7.25",
    });
  });

  it("echoes a closed period when the month has an active close", async () => {
    const close = PeriodClose.reconstitute({
      id: "close-1",
      workspaceId: ws,
      currency: "EUR",
      periodStart: "2026-09-01",
      periodEnd: "2026-09-30",
      timezone: "UTC",
      integrityDeclared: true,
      closedAt: new Date("2026-10-01T10:00:00Z"),
      invalidatedAt: null,
      supersededAt: null,
      createdAt: new Date("2026-10-01T10:00:00Z"),
    });
    const { useCase } = useCaseWith([totals()], [close]);

    const result = await useCase.execute(baseCommand);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.period.periodStatus).toBe("closed");
  });

  it("queries the rolling 30-day window when the requested month is still running", async () => {
    const { useCase, query } = useCaseWith([]);

    const result = await useCase.execute({ ...baseCommand, month: 10 });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.period).toEqual({
      from: "2026-09-16",
      to: "2026-10-15",
      currency: "EUR",
      periodStatus: "provisional",
    });
    expect(query.totalsPerAccount).toHaveBeenCalledWith(
      ws,
      "EUR",
      "2026-09-16",
      "2026-10-15",
    );
  });

  it("returns an empty account list when the period has no activity", async () => {
    const { useCase } = useCaseWith([]);

    const result = await useCase.execute(baseCommand);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.accounts).toEqual([]);
  });

  it("propagates period resolution errors without querying", async () => {
    const { useCase, query } = useCaseWith([totals()]);

    const result = await useCase.execute({ ...baseCommand, month: 13 });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("PERIOD_INVALID");
    }
    expect(query.totalsPerAccount).not.toHaveBeenCalled();
  });
});
