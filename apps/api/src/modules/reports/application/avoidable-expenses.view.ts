import { Money } from "../../shared-kernel/index.js";
import type { ReportPeriod } from "../domain/report-period.js";
import type { AvoidableExpenseLine } from "./ports/avoidable-expenses-report.port.js";

/**
 * Detector keys emitted on every admitted group (reports-monthly T12,
 * S11): `ant` keeps the original hormiga policy; `recurring_charge`
 * surfaces subscriptions and fixed charges; `concentration` flags a
 * single merchant/category dominating the discretionary spend;
 * `growth` compares the group against the preceding equal-length
 * window; `monthly_recurring` fires when the same key reappears in
 * that window with a similar total. A group is admitted when ANY
 * detector fires and reports every key that did, in this fixed order.
 */
export type AvoidableExpenseDetector =
  | "ant"
  | "recurring_charge"
  | "monthly_recurring"
  | "concentration"
  | "growth";

/**
 * Initial detection policy (docs/04:472-519 "Política inicial
 * configurable"): the `ant` detector needs at least this many
 * operations inside the resolved window (a ~30-day period) to fire — an
 * isolated small expense never triggers it (INV-HOR-01, CA-010).
 */
export const ANT_DETECTOR_MIN_OPERATIONS = 3;

/**
 * Conservative absolute cap per currency, in minor units
 * (reports-monthly T5, S3): when the period has no confirmed income the
 * 1%-of-income mean check cannot run, so the `ant` detector only fires
 * under this fixed cap — and only for currencies listed here. Groups it
 * admits this way can never exceed `confidence: "low"` (docs/04).
 * PEN 30.00 / USD 10.00 / EUR 10.00.
 */
export const ANT_DETECTOR_ABSOLUTE_CAP_MINOR: Readonly<
  Record<string, bigint>
> = {
  PEN: 3_000n,
  USD: 1_000n,
  EUR: 1_000n,
};

/** Minimum operations for `recurring_charge` (subscriptions, fixed fees). */
export const RECURRING_CHARGE_MIN_OPERATIONS = 2;

/** `recurring_charge` tolerance: amounts count as equal when
 * max <= 1.30 x min, expressed as the integer test 10·max <= 13·min. */
export const RECURRING_CHARGE_MAX_RATIO_PERCENT = 130;

/** `concentration` threshold: the group's share of the total
 * discretionary spend must reach 20% (integer test 5·total >= spend). */
export const CONCENTRATION_MIN_PERCENT = 20;

/** `growth` threshold: the current-window total must reach 1.5x the
 * previous window's, expressed as the integer test 2·current >= 3·prev. */
export const GROWTH_MIN_RATIO_PERCENT = 150;

/** `monthly_recurring` similarity: the two window totals count as equal
 * when max <= 1.15 x min, expressed as the integer test
 * 100·max <= 115·min. */
export const MONTHLY_RECURRING_MAX_RATIO_PERCENT = 115;

/**
 * Shared noise floor: `ant` and `growth` additionally require the group
 * total to reach 1% of the discretionary spend so trivial amounts never
 * surface as leaks (integer test 100·total >= spend).
 */
export const MIN_SHARE_OF_DISCRETIONARY_PERCENT = 1;

export interface AvoidableExpenseGroupView {
  /** Every detector that fired, in fixed policy order. */
  readonly detectors: AvoidableExpenseDetector[];
  readonly groupKind: "merchant" | "category";
  readonly key: string;
  readonly label: string;
  readonly operationCount: number;
  readonly total: string; // decimal string, never a float (INV-DIN-03)
  readonly average: string;
  readonly percentOfDiscretionary: number;
  /**
   * "low" when the group passed the `ant` check via the absolute-cap
   * path (no income); "high" otherwise (docs/04: the cap path can never
   * exceed low confidence).
   */
  readonly confidence: "low" | "high";
  /** Every aggregated figure links to its transactions (INV-HOR-05). */
  readonly transactionIds: string[];
}

export interface AvoidableExpensesView {
  readonly period: ReportPeriod;
  /** Total confirmed discretionary expense in the window. */
  readonly totalDiscretionary: string;
  /**
   * Sum of every admitted group's total (S11): the monthly spend the
   * user could avoid — groups are disjoint, so nothing double counts.
   */
  readonly potentialSavings: string;
  /** Admitted groups only, sorted by total descending. */
  readonly groups: AvoidableExpenseGroupView[];
}

interface Group {
  groupKind: "merchant" | "category";
  key: string;
  label: string;
  totalMinor: bigint;
  minMinor: bigint;
  maxMinor: bigint;
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
 * when merchant is NULL) — the same key space the previous-window totals
 * use for the growth comparison.
 */
function groupKeyOf(line: AvoidableExpenseLine): string {
  return line.merchant ?? line.categoryId;
}

function groupLines(lines: readonly AvoidableExpenseLine[]): Group[] {
  const groups = new Map<string, Group>();
  for (const line of lines) {
    const groupKind = line.merchant !== null ? "merchant" : "category";
    const key = groupKeyOf(line);
    const existing = groups.get(key);
    if (existing) {
      existing.totalMinor += line.amountMinor;
      if (line.amountMinor < existing.minMinor) {
        existing.minMinor = line.amountMinor;
      }
      if (line.amountMinor > existing.maxMinor) {
        existing.maxMinor = line.amountMinor;
      }
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
      minMinor: line.amountMinor,
      maxMinor: line.amountMinor,
      transactionIds: [line.transactionId],
    });
  }
  return [...groups.values()];
}

/**
 * Builds the avoidable-expenses view (T12, S3+S11): same grouping as the
 * former ant report, but admission is a union of five detectors —
 * `ant` (unchanged policy), `recurring_charge`, `monthly_recurring`,
 * `concentration` and `growth` against the preceding equal-length
 * window. `previousLines` is the eligible universe re-read over that
 * shifted window; only its per-key totals matter.
 */
export function toAvoidableExpensesView(
  period: ReportPeriod,
  lines: readonly AvoidableExpenseLine[],
  previousLines: readonly AvoidableExpenseLine[],
  incomeMinor: bigint,
): AvoidableExpensesView {
  const groups = groupLines(lines);

  const previousTotals = new Map<string, bigint>();
  for (const line of previousLines) {
    const key = groupKeyOf(line);
    previousTotals.set(key, (previousTotals.get(key) ?? 0n) + line.amountMinor);
  }

  const totalDiscretionaryMinor = lines.reduce(
    (sum, line) => sum + line.amountMinor,
    0n,
  );

  const absoluteCap = ANT_DETECTOR_ABSOLUTE_CAP_MINOR[period.currency];
  const detected = groups
    .map((group) => {
      const count = group.transactionIds.length;
      const detectors: AvoidableExpenseDetector[] = [];

      // ant (S3, unchanged): >=3 ops AND mean <= 1% of income (or the
      // per-currency absolute cap without income) AND total >= 1% of
      // the discretionary spend. 100·total <= count·income is the exact
      // integer form of mean <= income/100.
      const antMeanOk =
        incomeMinor > 0n
          ? group.totalMinor * 100n <= BigInt(count) * incomeMinor
          : absoluteCap !== undefined &&
            group.totalMinor <= BigInt(count) * absoluteCap;
      const ant =
        count >= ANT_DETECTOR_MIN_OPERATIONS &&
        antMeanOk &&
        group.totalMinor * 100n >=
          totalDiscretionaryMinor *
            BigInt(MIN_SHARE_OF_DISCRETIONARY_PERCENT);
      if (ant) {
        detectors.push("ant");
      }

      // recurring_charge (S11): >=2 ops with nearly-equal amounts —
      // max <= 1.30 x min as the integer test 100·max <= 130·min — and
      // the same 1%-of-discretionary noise floor as ant/growth so a
      // couple of equal micro-charges never surface as avoidable.
      if (
        count >= RECURRING_CHARGE_MIN_OPERATIONS &&
        group.maxMinor * 100n <=
          group.minMinor * BigInt(RECURRING_CHARGE_MAX_RATIO_PERCENT) &&
        group.totalMinor * 100n >=
          totalDiscretionaryMinor *
            BigInt(MIN_SHARE_OF_DISCRETIONARY_PERCENT)
      ) {
        detectors.push("recurring_charge");
      }

      // monthly_recurring (S14): the same key appears in BOTH windows
      // with similar totals — each window's group total within ±15%,
      // the integer test 100·max <= 115·min — and the shared 1% noise
      // floor. Inter-window, so a single charge per window (Spotify,
      // Netflix) qualifies where recurring_charge cannot.
      const previousMinor = previousTotals.get(group.key) ?? 0n;
      const windowMax =
        group.totalMinor > previousMinor ? group.totalMinor : previousMinor;
      const windowMin =
        group.totalMinor > previousMinor ? previousMinor : group.totalMinor;
      if (
        previousMinor > 0n &&
        windowMax * 100n <=
          windowMin * BigInt(MONTHLY_RECURRING_MAX_RATIO_PERCENT) &&
        group.totalMinor * 100n >=
          totalDiscretionaryMinor *
            BigInt(MIN_SHARE_OF_DISCRETIONARY_PERCENT)
      ) {
        detectors.push("monthly_recurring");
      }

      // concentration (S11): the group alone reaches N% of the
      // discretionary spend — total·100 >= spend·N keeps the constant
      // exact for any threshold (a pre-divided 100/N only holds when
      // N divides 100).
      if (
        group.totalMinor * 100n >=
        totalDiscretionaryMinor * BigInt(CONCENTRATION_MIN_PERCENT)
      ) {
        detectors.push("concentration");
      }

      // growth (S11): current total >= 1.5x the same key's previous-
      // window total (100·cur >= 150·prev), previous > 0, and the group
      // is still at least 1% of the spend — the noise floor.
      if (
        previousMinor > 0n &&
        group.totalMinor * 100n >=
          previousMinor * BigInt(GROWTH_MIN_RATIO_PERCENT) &&
        group.totalMinor * 100n >=
          totalDiscretionaryMinor *
            BigInt(MIN_SHARE_OF_DISCRETIONARY_PERCENT)
      ) {
        detectors.push("growth");
      }

      return { group, detectors };
    })
    .filter(({ detectors }) => detectors.length > 0);

  detected.sort((a, b) => {
    if (a.group.totalMinor !== b.group.totalMinor) {
      return a.group.totalMinor > b.group.totalMinor ? -1 : 1;
    }
    return a.group.key.localeCompare(b.group.key);
  });

  const potentialSavingsMinor = detected.reduce(
    (sum, { group }) => sum + group.totalMinor,
    0n,
  );

  return {
    period,
    totalDiscretionary: toDecimal(totalDiscretionaryMinor, period.currency),
    potentialSavings: toDecimal(potentialSavingsMinor, period.currency),
    groups: detected.map<AvoidableExpenseGroupView>(({ group, detectors }) => {
      const count = BigInt(group.transactionIds.length);
      // Half-up rounding to the nearest minor unit.
      const averageMinor = (group.totalMinor + count / 2n) / count;
      return {
        detectors,
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
        // Only the ant detector's absolute-cap path (no income) can
        // degrade confidence; every other admission is high.
        confidence:
          detectors.includes("ant") && incomeMinor <= 0n ? "low" : "high",
        transactionIds: group.transactionIds,
      };
    }),
  };
}
