import { Money } from "../../shared-kernel/index.js";
import type { ReportPeriod } from "../domain/report-period.js";
import type { AntExpenseLine } from "./ports/ant-expenses-report.port.js";

/**
 * Initial detection policy (docs/04:472-519 "Política inicial
 * configurable"): a group needs at least this many operations inside
 * the resolved window (a ~30-day period) to be a candidate — an
 * isolated small expense never triggers (INV-HOR-01, CA-010).
 */
export const ANT_EXPENSE_MIN_OPERATIONS = 3;

/**
 * Conservative absolute cap per currency, in minor units
 * (reports-monthly T5, S3): when the period has no confirmed income the
 * 1%-of-income mean check cannot run, so a group is only eligible under
 * this fixed cap — and only for currencies listed here. Groups admitted
 * this way can never exceed `confidence: "low"` (docs/04). PEN 30.00 /
 * USD 10.00 / EUR 10.00.
 */
export const ANT_EXPENSE_ABSOLUTE_CAP_MINOR: Readonly<
  Record<string, bigint>
> = {
  PEN: 30_000n,
  USD: 10_000n,
  EUR: 10_000n,
};

export interface AntExpenseGroupView {
  readonly groupKind: "merchant" | "category";
  readonly key: string;
  readonly label: string;
  readonly operationCount: number;
  readonly total: string; // decimal string, never a float (INV-DIN-03)
  readonly average: string;
  readonly percentOfDiscretionary: number;
  /**
   * "low" when the group passed via the absolute-cap path (no income);
   * "high" when it passed the regular 1%-of-income check (docs/04:
   * the cap path can never exceed low confidence).
   */
  readonly confidence: "low" | "high";
  /** Every aggregated figure links to its transactions (INV-HOR-05). */
  readonly transactionIds: string[];
}

export interface AntExpensesView {
  readonly period: ReportPeriod;
  /** Total confirmed discretionary expense in the window. */
  readonly totalDiscretionary: string;
  /** Candidate groups only, sorted by total descending. */
  readonly groups: AntExpenseGroupView[];
}

interface Group {
  groupKind: "merchant" | "category";
  key: string;
  label: string;
  totalMinor: bigint;
  transactionIds: string[];
}

function toDecimal(minorUnits: bigint, currency: string): string {
  const money = Money.fromMinorUnits(minorUnits, currency);
  if (!money.ok) {
    throw money.error;
  }
  return money.value.toDecimalString();
}

/** Percentage (0–100) rounded to two decimals; 0 when there is no spend. */
function percent(part: bigint, whole: bigint): number {
  if (whole === 0n) {
    return 0;
  }
  const hundredths = (part * 10000n + whole / 2n) / whole;
  return Number(hundredths) / 100;
}

/**
 * Groups the eligible lines by normalized merchant (fallback: category
 * when merchant is NULL) and applies the candidate policy — all of:
 * >=3 operations, mean <= 1% of confirmed income (or the per-currency
 * absolute cap when there is no income, `confidence: "low"`), and
 * group total >= 1% of the period's discretionary spend. Groups
 * failing any threshold are simply absent (CA-010).
 */
export function toAntExpensesView(
  period: ReportPeriod,
  lines: readonly AntExpenseLine[],
  incomeMinor: bigint,
): AntExpensesView {
  const groups = new Map<string, Group>();
  for (const line of lines) {
    const groupKind = line.merchant !== null ? "merchant" : "category";
    const key = line.merchant ?? line.categoryId;
    const existing = groups.get(key);
    if (existing) {
      existing.totalMinor += line.amountMinor;
      existing.transactionIds.push(line.transactionId);
      continue;
    }
    groups.set(key, {
      groupKind,
      key,
      label:
        line.merchant ??
        line.categoryLabel ??
        line.categoryKey ??
        line.categoryId,
      totalMinor: line.amountMinor,
      transactionIds: [line.transactionId],
    });
  }

  const totalDiscretionaryMinor = lines.reduce(
    (sum, line) => sum + line.amountMinor,
    0n,
  );

  const absoluteCap = ANT_EXPENSE_ABSOLUTE_CAP_MINOR[period.currency];
  const candidates = [...groups.values()].filter((group) => {
    const count = group.transactionIds.length;
    if (count < ANT_EXPENSE_MIN_OPERATIONS) {
      return false;
    }
    // (b) mean <= 1% of income ⟺ 100·total <= count·income; without
    // positive income only the configured absolute cap admits a group.
    if (incomeMinor > 0n) {
      if (group.totalMinor * 100n > BigInt(count) * incomeMinor) {
        return false;
      }
    } else {
      if (
        absoluteCap === undefined ||
        group.totalMinor > BigInt(count) * absoluteCap
      ) {
        return false;
      }
    }
    // (c) group total >= 1% of the period discretionary spend.
    return group.totalMinor * 100n >= totalDiscretionaryMinor;
  });

  candidates.sort((a, b) => {
    if (a.totalMinor !== b.totalMinor) {
      return a.totalMinor > b.totalMinor ? -1 : 1;
    }
    return a.key.localeCompare(b.key);
  });

  return {
    period,
    totalDiscretionary: toDecimal(totalDiscretionaryMinor, period.currency),
    groups: candidates.map<AntExpenseGroupView>((group) => {
      const count = BigInt(group.transactionIds.length);
      // Half-up rounding to the nearest minor unit.
      const averageMinor = (group.totalMinor + count / 2n) / count;
      return {
        groupKind: group.groupKind,
        key: group.key,
        label: group.label,
        operationCount: group.transactionIds.length,
        total: toDecimal(group.totalMinor, period.currency),
        average: toDecimal(averageMinor, period.currency),
        percentOfDiscretionary: percent(
          group.totalMinor,
          totalDiscretionaryMinor,
        ),
        confidence: incomeMinor > 0n ? "high" : "low",
        transactionIds: group.transactionIds,
      };
    }),
  };
}
