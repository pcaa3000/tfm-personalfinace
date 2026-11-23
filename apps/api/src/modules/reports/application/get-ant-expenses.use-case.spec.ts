import { describe, expect, it, vi } from "vitest";

import { WorkspaceId } from "../../shared-kernel/index.js";
import { PeriodClose } from "../domain/period-close.js";
import type { AntExpenseLine } from "./ports/ant-expenses-report.port.js";
import { GetAntExpensesUseCase } from "./get-ant-expenses.use-case.js";

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

let seq = 0;
function line(overrides: Partial<AntExpenseLine> = {}): AntExpenseLine {
  seq += 1;
  return {
    transactionId: `tx-ant-${seq}`,
    merchant: "cafe central",
    categoryId: "cat-cafe",
    categoryKey: "cafe",
    categoryLabel: "Café",
    amountMinor: 500n,
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

function useCaseWith(
  lines: AntExpenseLine[],
  incomeMinor: bigint,
  closes: PeriodClose[] = [],
) {
  const query = {
    discretionaryExpenseLines: vi.fn(async () => lines),
    confirmedIncomeMinor: vi.fn(async () => incomeMinor),
  };
  const useCase = new GetAntExpensesUseCase(
    closesReturning(closes),
    query,
    clock("2026-10-15T12:00:00Z"),
  );
  return { useCase, query };
}

describe("GetAntExpensesUseCase", () => {
  it("detects a merchant group meeting every threshold and echoes the period", async () => {
    const { useCase } = useCaseWith(
      [
        line({ transactionId: "tx-1", amountMinor: 500n }),
        line({ transactionId: "tx-2", amountMinor: 500n }),
        line({ transactionId: "tx-3", amountMinor: 500n }),
      ],
      1_000_000n,
    );

    const result = await useCase.execute(baseCommand);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.period).toEqual({
      from: "2026-09-01",
      to: "2026-09-30",
      currency: "EUR",
      periodStatus: "provisional",
    });
    expect(result.value.totalDiscretionary).toBe("15.00");
    expect(result.value.groups).toEqual([
      {
        groupKind: "merchant",
        key: "cafe central",
        label: "cafe central",
        operationCount: 3,
        total: "15.00",
        average: "5.00",
        percentOfDiscretionary: 100,
        confidence: "high",
        transactionIds: ["tx-1", "tx-2", "tx-3"],
      },
    ]);
  });

  it("falls back to grouping by categoryId when merchant is NULL", async () => {
    const { useCase } = useCaseWith(
      [
        line({ transactionId: "tx-a", merchant: null, amountMinor: 300n }),
        line({ transactionId: "tx-b", merchant: null, amountMinor: 300n }),
        line({ transactionId: "tx-c", merchant: null, amountMinor: 300n }),
      ],
      1_000_000n,
    );

    const result = await useCase.execute(baseCommand);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.groups).toEqual([
      {
        groupKind: "category",
        key: "cat-cafe",
        label: "Café",
        operationCount: 3,
        total: "9.00",
        average: "3.00",
        percentOfDiscretionary: 100,
        confidence: "high",
        transactionIds: ["tx-a", "tx-b", "tx-c"],
      },
    ]);
  });

  it("never flags an isolated small expense or a two-operation merchant (CA-010, INV-HOR-01)", async () => {
    const { useCase } = useCaseWith(
      [
        line({ transactionId: "tx-solo", merchant: "kiosco", amountMinor: 100n }),
        line({ transactionId: "tx-d1", merchant: "panaderia", amountMinor: 200n }),
        line({ transactionId: "tx-d2", merchant: "panaderia", amountMinor: 200n }),
      ],
      1_000_000n,
    );

    const result = await useCase.execute(baseCommand);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.groups).toEqual([]);
  });

  it("accepts a group at the exact >=3 operations and <=1%-of-income mean boundaries", async () => {
    const { useCase } = useCaseWith(
      [
        line({ transactionId: "tx-1", amountMinor: 10_000n }),
        line({ transactionId: "tx-2", amountMinor: 10_000n }),
        line({ transactionId: "tx-3", amountMinor: 10_000n }),
      ],
      1_000_000n, // 1% of income = 100.00 = mean exactly
    );

    const result = await useCase.execute(baseCommand);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.groups.map((g) => g.key)).toEqual(["cafe central"]);
  });

  it("excludes a group whose mean exceeds 1% of income by a single minor unit", async () => {
    const { useCase } = useCaseWith(
      [
        line({ transactionId: "tx-1", amountMinor: 10_001n }),
        line({ transactionId: "tx-2", amountMinor: 10_001n }),
        line({ transactionId: "tx-3", amountMinor: 10_001n }),
      ],
      1_000_000n,
    );

    const result = await useCase.execute(baseCommand);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.groups).toEqual([]);
  });

  it("excludes a group below 1% of the period discretionary spend while keeping qualifying ones sorted desc", async () => {
    const { useCase } = useCaseWith(
      [
        // Isolated large discretionary expense: raises the denominator.
        line({ transactionId: "tx-big", merchant: "big once", amountMinor: 1_000_000n }),
        // Qualifying group: 3 ops, mean 200.00 <= 1% of income, total >= 1% of 10_603.00.
        line({ transactionId: "tx-q1", merchant: "almuerzo", amountMinor: 20_000n }),
        line({ transactionId: "tx-q2", merchant: "almuerzo", amountMinor: 20_000n }),
        line({ transactionId: "tx-q3", merchant: "almuerzo", amountMinor: 20_000n }),
        // Failing group: 3 ops and small mean, but total 3.00 < 1% of discretionary.
        line({ transactionId: "tx-t1", merchant: "chicles", amountMinor: 100n }),
        line({ transactionId: "tx-t2", merchant: "chicles", amountMinor: 100n }),
        line({ transactionId: "tx-t3", merchant: "chicles", amountMinor: 100n }),
      ],
      10_000_000n, // 1% = 1_000.00 — every mean below passes
    );

    const result = await useCase.execute(baseCommand);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.totalDiscretionary).toBe("10603.00");
    expect(result.value.groups.map((g) => g.key)).toEqual(["almuerzo"]);
    expect(result.value.groups[0]?.total).toBe("600.00");
  });

  it("uses the per-currency absolute cap with confidence low when income is absent", async () => {
    const { useCase } = useCaseWith(
      [
        // EUR absolute cap = 10.00: mean 9.00 passes, mean 20.00 fails.
        line({ transactionId: "tx-c1", merchant: "cap ok", amountMinor: 900n }),
        line({ transactionId: "tx-c2", merchant: "cap ok", amountMinor: 900n }),
        line({ transactionId: "tx-c3", merchant: "cap ok", amountMinor: 900n }),
        line({ transactionId: "tx-x1", merchant: "cap fail", amountMinor: 2_000n }),
        line({ transactionId: "tx-x2", merchant: "cap fail", amountMinor: 2_000n }),
        line({ transactionId: "tx-x3", merchant: "cap fail", amountMinor: 2_000n }),
      ],
      0n,
    );

    const result = await useCase.execute(baseCommand);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.groups).toEqual([
      expect.objectContaining({
        key: "cap ok",
        confidence: "low",
        operationCount: 3,
        total: "27.00",
      }),
    ]);
  });

  it("emits no group for a currency without an absolute cap when income is absent", async () => {
    const { useCase } = useCaseWith(
      [
        line({ transactionId: "tx-j1", amountMinor: 10n }),
        line({ transactionId: "tx-j2", amountMinor: 10n }),
        line({ transactionId: "tx-j3", amountMinor: 10n }),
      ],
      0n,
    );

    const result = await useCase.execute({ ...baseCommand, currency: "JPY" });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.groups).toEqual([]);
  });

  it("returns an empty group list when nothing is eligible", async () => {
    const { useCase } = useCaseWith([], 500_000n);

    const result = await useCase.execute(baseCommand);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.groups).toEqual([]);
    expect(result.value.totalDiscretionary).toBe("0.00");
  });

  it("propagates period resolution errors without querying", async () => {
    const { useCase, query } = useCaseWith([line()], 0n);

    const result = await useCase.execute({ ...baseCommand, month: 0 });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("PERIOD_INVALID");
    }
    expect(query.discretionaryExpenseLines).not.toHaveBeenCalled();
    expect(query.confirmedIncomeMinor).not.toHaveBeenCalled();
  });
});
