import { describe, expect, it, vi } from "vitest";

import { WorkspaceId } from "../../shared-kernel/index.js";
import { PeriodClose } from "../domain/period-close.js";
import type { AvoidableExpenseLine } from "./ports/avoidable-expenses-report.port.js";
import { GetAvoidableExpensesUseCase } from "./get-avoidable-expenses.use-case.js";

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
function line(
  overrides: Partial<AvoidableExpenseLine> = {},
): AvoidableExpenseLine {
  seq += 1;
  return {
    transactionId: `tx-av-${seq}`,
    merchant: "cafe central",
    categoryId: "cat-cafe",
    categoryKey: "cafe",
    categoryLabel: "Café",
    amountMinor: 500n,
    ...overrides,
  };
}

/**
 * Discretionary padding: `count` one-off expenses under distinct
 * merchants. A single operation can never fire ant (>=3 ops) or
 * recurring_charge (>=2 ops), and each padded merchant is kept under
 * the 20% concentration share by the chosen amounts — so pads only
 * raise the discretionary denominator.
 */
function padding(
  count: number,
  amountMinor: bigint,
): AvoidableExpenseLine[] {
  return Array.from({ length: count }, (_, index) =>
    line({
      transactionId: `tx-pad-${index}`,
      merchant: `pad-${index}`,
      amountMinor,
    }),
  );
}

const baseCommand = {
  workspaceId: ws,
  currency: "EUR",
  year: 2026,
  month: 9,
  timezone: "UTC",
};

// The resolved window for 2026-09 (no close, clock in October) is the
// provisional full month: 2026-09-01..2026-09-30 — a 30-day window, so
// the preceding equal-length window is 2026-08-02..2026-08-31.
const CURRENT_FROM = "2026-09-01";
const PREVIOUS_FROM = "2026-08-02";
const PREVIOUS_TO = "2026-08-31";

function useCaseWith(
  lines: AvoidableExpenseLine[],
  incomeMinor: bigint,
  previousLines: AvoidableExpenseLine[] = [],
  closes: PeriodClose[] = [],
) {
  const query = {
    discretionaryExpenseLines: vi.fn(
      async (
        _workspaceId: WorkspaceId,
        _currency: string,
        from: string,
      ) => (from < CURRENT_FROM ? previousLines : lines),
    ),
    confirmedIncomeMinor: vi.fn(async () => incomeMinor),
  };
  const useCase = new GetAvoidableExpensesUseCase(
    closesReturning(closes),
    query,
    clock("2026-10-15T12:00:00Z"),
  );
  return { useCase, query };
}

describe("GetAvoidableExpensesUseCase", () => {
  it("flags an ant group meeting every threshold, echoes the period and sums potentialSavings", async () => {
    const { useCase } = useCaseWith(
      [
        // Varied amounts: max 600 > 1.30 x 400, so only the ant
        // detector can fire here.
        line({ transactionId: "tx-1", amountMinor: 400n }),
        line({ transactionId: "tx-2", amountMinor: 500n }),
        line({ transactionId: "tx-3", amountMinor: 600n }),
        ...padding(6, 2_000n),
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
    expect(result.value.totalDiscretionary).toBe("135.00");
    expect(result.value.potentialSavings).toBe("15.00");
    expect(result.value.groups).toEqual([
      {
        detectors: ["ant"],
        groupKind: "merchant",
        key: "cafe central",
        label: "cafe central",
        operationCount: 3,
        total: "15.00",
        average: "5.00",
        percentOfDiscretionary: 11.11,
        confidence: "high",
        transactionIds: ["tx-1", "tx-2", "tx-3"],
      },
    ]);
  });

  it("falls back to grouping by categoryId when merchant is NULL", async () => {
    const { useCase } = useCaseWith(
      [
        line({ transactionId: "tx-a", merchant: null, amountMinor: 200n }),
        line({ transactionId: "tx-b", merchant: null, amountMinor: 300n }),
        line({ transactionId: "tx-c", merchant: null, amountMinor: 400n }),
        ...padding(6, 2_000n),
      ],
      1_000_000n,
    );

    const result = await useCase.execute(baseCommand);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.groups).toEqual([
      {
        detectors: ["ant"],
        groupKind: "category",
        key: "cat-cafe",
        label: "Café",
        operationCount: 3,
        total: "9.00",
        average: "3.00",
        percentOfDiscretionary: 6.98,
        confidence: "high",
        transactionIds: ["tx-a", "tx-b", "tx-c"],
      },
    ]);
  });

  it("fires recurring_charge for >=2 nearly-equal amounts (subscriptions) even when ant cannot run", async () => {
    const { useCase } = useCaseWith(
      [
        // Two equal subscription charges: too few ops for ant, but a
        // textbook recurring charge (S11).
        line({ transactionId: "tx-s1", merchant: "spotify", amountMinor: 999n }),
        line({ transactionId: "tx-s2", merchant: "spotify", amountMinor: 999n }),
        ...padding(6, 2_000n),
      ],
      1_000_000n,
    );

    const result = await useCase.execute(baseCommand);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.groups).toEqual([
      expect.objectContaining({
        detectors: ["recurring_charge"],
        key: "spotify",
        operationCount: 2,
        confidence: "high",
      }),
    ]);
  });

  it("fires recurring_charge at exactly max = 1.30 x min and not one minor unit above", async () => {
    const { useCase } = useCaseWith(
      [
        line({ transactionId: "tx-a1", merchant: "netflix", amountMinor: 1_000n }),
        line({ transactionId: "tx-a2", merchant: "netflix", amountMinor: 1_300n }),
        line({ transactionId: "tx-b1", merchant: "hbo", amountMinor: 1_000n }),
        line({ transactionId: "tx-b2", merchant: "hbo", amountMinor: 1_301n }),
        ...padding(6, 2_000n),
      ],
      1_000_000n,
    );

    const result = await useCase.execute(baseCommand);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.groups.map((g) => g.key)).toEqual(["netflix"]);
    expect(result.value.groups[0]?.detectors).toEqual(["recurring_charge"]);
  });

  it("rejects recurring_charge micro-charges below the 1% discretionary noise floor", async () => {
    const { useCase } = useCaseWith(
      [
        // Two equal EUR 0.01 charges — recurring by ratio but trivial.
        line({ transactionId: "tx-f1", merchant: "fee", amountMinor: 1n }),
        line({ transactionId: "tx-f2", merchant: "fee", amountMinor: 1n }),
        ...padding(6, 20_000n),
      ],
      1_000_000n,
    );

    const result = await useCase.execute(baseCommand);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.groups).toEqual([]);
    expect(result.value.potentialSavings).toBe("0.00");
  });

  it("fires concentration when a group reaches 20% of the discretionary spend", async () => {
    const { useCase } = useCaseWith(
      [
        // One big discretionary purchase — a single operation, so only
        // concentration can flag it.
        line({ transactionId: "tx-v", merchant: "vuelos lima", amountMinor: 60_000n }),
        ...padding(6, 20_000n),
      ],
      1_000_000n,
    );

    const result = await useCase.execute(baseCommand);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.groups).toEqual([
      expect.objectContaining({
        detectors: ["concentration"],
        key: "vuelos lima",
        operationCount: 1,
        total: "600.00",
        percentOfDiscretionary: 33.33,
      }),
    ]);
  });

  it("fires growth when the group total is >= 1.5x the same key in the preceding equal-length window", async () => {
    const { useCase, query } = useCaseWith(
      [
        // Current window: 300.00 across two uneven ops (no recurring,
        // no ant count, below concentration share).
        line({ transactionId: "tx-g1", merchant: "gimnasio", amountMinor: 10_000n }),
        line({ transactionId: "tx-g2", merchant: "gimnasio", amountMinor: 20_000n }),
        ...padding(6, 30_000n),
      ],
      1_000_000n,
      [
        // Previous window total for the same merchant: 100.00.
        line({ transactionId: "tx-prev-1", merchant: "gimnasio", amountMinor: 10_000n }),
      ],
    );

    const result = await useCase.execute(baseCommand);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.groups).toEqual([
      expect.objectContaining({
        detectors: ["growth"],
        key: "gimnasio",
        total: "300.00",
      }),
    ]);
    // The growth detector re-reads the eligible universe over the
    // preceding 30-day window: from shifted back 30 days, ending the
    // day before the current window starts.
    expect(query.discretionaryExpenseLines).toHaveBeenCalledWith(
      ws,
      "EUR",
      CURRENT_FROM,
      "2026-09-30",
    );
    expect(query.discretionaryExpenseLines).toHaveBeenCalledWith(
      ws,
      "EUR",
      PREVIOUS_FROM,
      PREVIOUS_TO,
    );
  });

  it("fires growth at exactly 1.5x the previous total and not below it", async () => {
    const { useCase } = useCaseWith(
      [
        line({ transactionId: "tx-e1", merchant: "yoga", amountMinor: 15_000n }),
        line({ transactionId: "tx-n1", merchant: "pilates", amountMinor: 14_999n }),
        ...padding(8, 30_000n),
      ],
      1_000_000n,
      [
        line({ transactionId: "tx-pv1", merchant: "yoga", amountMinor: 10_000n }),
        line({ transactionId: "tx-pv2", merchant: "pilates", amountMinor: 10_000n }),
      ],
    );

    const result = await useCase.execute(baseCommand);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.groups.map((g) => g.key)).toEqual(["yoga"]);
    expect(result.value.groups[0]?.detectors).toEqual(["growth"]);
  });

  it("never fires growth when the previous-window total is zero", async () => {
    const { useCase } = useCaseWith(
      [
        // A brand-new merchant this window: 150.00, nothing before.
        line({ transactionId: "tx-new", merchant: "nuevo gym", amountMinor: 15_000n }),
        ...padding(8, 30_000n),
      ],
      1_000_000n,
      [],
    );

    const result = await useCase.execute(baseCommand);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.groups).toEqual([]);
  });

  it("applies the 1%-of-discretionary noise floor to the growth detector", async () => {
    const { useCase } = useCaseWith(
      [
        // 15.00 vs 10.00 before: a 1.5x growth, but far below 1% of a
        // 2_000.00+ discretionary spend — noise, not a leak.
        line({ transactionId: "tx-tiny", merchant: "parking", amountMinor: 1_500n }),
        ...padding(10, 20_000n),
      ],
      1_000_000n,
      [
        line({ transactionId: "tx-pv", merchant: "parking", amountMinor: 1_000n }),
      ],
    );

    const result = await useCase.execute(baseCommand);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.groups).toEqual([]);
  });

  it("lists every detector that fired on the same group", async () => {
    const { useCase } = useCaseWith(
      [
        // 3 ops (ant count), max 520 = 1.30 x min 400 exactly (recurring
        // boundary), mean 4.73 <= 1% of income — ant + recurring_charge.
        line({ transactionId: "tx-1", amountMinor: 400n }),
        line({ transactionId: "tx-2", amountMinor: 500n }),
        line({ transactionId: "tx-3", amountMinor: 520n }),
        ...padding(6, 2_000n),
      ],
      1_000_000n,
    );

    const result = await useCase.execute(baseCommand);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.groups).toEqual([
      expect.objectContaining({
        key: "cafe central",
        detectors: ["ant", "recurring_charge"],
      }),
    ]);
  });

  it("sums potentialSavings across every admitted group (disjoint grouping)", async () => {
    const { useCase } = useCaseWith(
      [
        line({ transactionId: "tx-1", amountMinor: 400n }),
        line({ transactionId: "tx-2", amountMinor: 500n }),
        line({ transactionId: "tx-3", amountMinor: 600n }),
        line({ transactionId: "tx-v", merchant: "vuelos lima", amountMinor: 60_000n }),
        ...padding(6, 5_000n),
      ],
      1_000_000n,
    );

    const result = await useCase.execute(baseCommand);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Cafe (15.00, ant) + flights (600.00, concentration), sorted desc.
    expect(result.value.groups.map((g) => g.key)).toEqual([
      "vuelos lima",
      "cafe central",
    ]);
    expect(result.value.potentialSavings).toBe("615.00");
    expect(result.value.totalDiscretionary).toBe("915.00");
  });

  it("never fires ant for an isolated small expense or a two-operation merchant (CA-010, INV-HOR-01)", async () => {
    const { useCase } = useCaseWith(
      [
        line({ transactionId: "tx-solo", merchant: "kiosco", amountMinor: 100n }),
        line({ transactionId: "tx-d1", merchant: "panaderia", amountMinor: 500n }),
        line({ transactionId: "tx-d2", merchant: "panaderia", amountMinor: 700n }),
        ...padding(6, 2_000n),
      ],
      1_000_000n,
    );

    const result = await useCase.execute(baseCommand);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // The isolated expense fires nothing; the 2-op merchant can only
    // appear via recurring_charge — 7.00 > 1.30 x 5.00, so it is out too.
    expect(result.value.groups).toEqual([]);
  });

  it("accepts an ant group at the exact >=3 operations and <=1%-of-income mean boundaries", async () => {
    const { useCase } = useCaseWith(
      [
        line({ transactionId: "tx-1", amountMinor: 10_000n }),
        line({ transactionId: "tx-2", amountMinor: 5_000n }),
        line({ transactionId: "tx-3", amountMinor: 15_000n }),
        ...padding(8, 50_000n),
      ],
      1_000_000n, // 1% of income = 100.00 = mean exactly
    );

    const result = await useCase.execute(baseCommand);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const group = result.value.groups.find((g) => g.key === "cafe central");
    expect(group?.detectors).toContain("ant");
  });

  it("does not fire ant when the mean exceeds 1% of income by a single minor unit", async () => {
    const { useCase } = useCaseWith(
      [
        // Uneven amounts keep recurring_charge and concentration out,
        // so the group is absent exactly when the ant mean check fails.
        line({ transactionId: "tx-1", amountMinor: 10_001n }),
        line({ transactionId: "tx-2", amountMinor: 20_001n }),
        line({ transactionId: "tx-3", amountMinor: 30_001n }),
        ...padding(6, 50_000n),
      ],
      1_000_000n,
    );

    const result = await useCase.execute(baseCommand);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.groups).toEqual([]);
  });

  it("uses the per-currency absolute cap with confidence low for the ant detector when income is absent", async () => {
    const { useCase } = useCaseWith(
      [
        // EUR absolute cap = 10.00: mean 9.00 passes, mean ~23.33
        // fails. Amounts stay uneven (max > 1.30 x min) so only the
        // ant detector can fire.
        line({ transactionId: "tx-c1", merchant: "cap ok", amountMinor: 700n }),
        line({ transactionId: "tx-c2", merchant: "cap ok", amountMinor: 900n }),
        line({ transactionId: "tx-c3", merchant: "cap ok", amountMinor: 1_100n }),
        line({ transactionId: "tx-x1", merchant: "cap fail", amountMinor: 2_000n }),
        line({ transactionId: "tx-x2", merchant: "cap fail", amountMinor: 2_100n }),
        line({ transactionId: "tx-x3", merchant: "cap fail", amountMinor: 2_900n }),
        ...padding(6, 5_000n),
      ],
      0n,
    );

    const result = await useCase.execute(baseCommand);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.groups).toEqual([
      expect.objectContaining({
        key: "cap ok",
        detectors: ["ant"],
        confidence: "low",
        operationCount: 3,
        total: "27.00",
      }),
    ]);
  });

  it("emits no group for a currency without an absolute cap when income is absent", async () => {
    const { useCase } = useCaseWith(
      [
        // JPY has no configured cap; amounts also dodge recurring_charge
        // and concentration so the group stays out entirely.
        line({ transactionId: "tx-j1", amountMinor: 1_000n }),
        line({ transactionId: "tx-j2", amountMinor: 1_100n }),
        line({ transactionId: "tx-j3", amountMinor: 1_400n }),
        ...padding(6, 10_000n),
      ],
      0n,
    );

    const result = await useCase.execute({
      ...baseCommand,
      currency: "JPY",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.groups).toEqual([]);
  });

  it("returns empty groups and zeroed totals when nothing is eligible", async () => {
    const { useCase } = useCaseWith([], 500_000n);

    const result = await useCase.execute(baseCommand);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.groups).toEqual([]);
    expect(result.value.totalDiscretionary).toBe("0.00");
    expect(result.value.potentialSavings).toBe("0.00");
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
