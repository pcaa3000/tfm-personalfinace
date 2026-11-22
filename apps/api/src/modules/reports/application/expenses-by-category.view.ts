import { Money } from "../../shared-kernel/index.js";
import type { ReportPeriod } from "../domain/report-period.js";
import type { ExpenseCategoryTotals } from "./ports/expenses-by-category-report.port.js";

/**
 * The report-level uncategorized bucket (reports-monthly T4, S2): rows
 * with NULL `categoryId` AND rows on the system "Sin categorizar"
 * category — whose `nature` is the marker "uncategorized" outside
 * CategoryNature — collapse into a single group.
 */
const UNCATEGORIZED = {
  key: "uncategorized",
  label: "Sin categorizar",
  nature: "uncategorized",
} as const;

/** Natures always present in `natureTotals`, even when empty. */
const EXPENSE_NATURES = [
  "essential",
  "discretionary",
  "obligation",
  UNCATEGORIZED.nature,
] as const;

export interface ExpenseCategoryView {
  readonly categoryId: string | null;
  readonly key: string;
  readonly label: string;
  readonly nature: string;
  readonly total: string; // decimal string, never a float (INV-DIN-03)
  readonly percentOfExpenses: number;
  readonly transactionCount: number;
}

export interface ExpensesByCategoryView {
  readonly period: ReportPeriod;
  readonly totalExpenses: string;
  /** Per-nature subtotals; the four expense natures are always present. */
  readonly natureTotals: Record<string, string>;
  /** Sorted by total descending, label as deterministic tie-break. */
  readonly categories: ExpenseCategoryView[];
}

interface Bucket {
  categoryId: string | null;
  key: string;
  label: string;
  nature: string;
  totalMinor: bigint;
  transactionCount: number;
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
 * Maps raw per-category totals to the public view, folding every
 * uncategorized source (NULL categoryId, dangling category, the system
 * "Sin categorizar" nature) into one bucket keyed `categoryId: null`.
 */
export function toExpensesByCategoryView(
  period: ReportPeriod,
  rows: readonly ExpenseCategoryTotals[],
): ExpensesByCategoryView {
  const buckets = new Map<string, Bucket>();
  for (const row of rows) {
    const uncategorized =
      row.categoryId === null ||
      row.nature === null ||
      row.nature === UNCATEGORIZED.nature;
    const bucketKey = uncategorized ? UNCATEGORIZED.key : row.categoryId;
    const existing = buckets.get(bucketKey);
    if (existing) {
      buckets.set(bucketKey, {
        ...existing,
        totalMinor: existing.totalMinor + row.totalMinor,
        transactionCount: existing.transactionCount + row.transactionCount,
      });
      continue;
    }
    buckets.set(bucketKey, {
      categoryId: uncategorized ? null : row.categoryId,
      key: uncategorized ? UNCATEGORIZED.key : (row.categoryKey ?? bucketKey),
      label: uncategorized
        ? UNCATEGORIZED.label
        : (row.categoryLabel ?? row.categoryKey ?? bucketKey),
      nature: uncategorized ? UNCATEGORIZED.nature : (row.nature ?? ""),
      totalMinor: row.totalMinor,
      transactionCount: row.transactionCount,
    });
  }

  const totalMinor = rows.reduce((sum, row) => sum + row.totalMinor, 0n);

  const byNature = new Map<string, bigint>(
    EXPENSE_NATURES.map((nature) => [nature, 0n]),
  );
  for (const bucket of buckets.values()) {
    byNature.set(
      bucket.nature,
      (byNature.get(bucket.nature) ?? 0n) + bucket.totalMinor,
    );
  }
  const natureTotals: Record<string, string> = {};
  for (const [nature, minor] of byNature) {
    natureTotals[nature] = toDecimal(minor, period.currency);
  }

  const categories = [...buckets.values()]
    .sort((a, b) => {
      if (a.totalMinor !== b.totalMinor) {
        return a.totalMinor > b.totalMinor ? -1 : 1;
      }
      return a.label.localeCompare(b.label);
    })
    .map<ExpenseCategoryView>((bucket) => ({
      categoryId: bucket.categoryId,
      key: bucket.key,
      label: bucket.label,
      nature: bucket.nature,
      total: toDecimal(bucket.totalMinor, period.currency),
      percentOfExpenses: percent(bucket.totalMinor, totalMinor),
      transactionCount: bucket.transactionCount,
    }));

  return {
    period,
    totalExpenses: toDecimal(totalMinor, period.currency),
    natureTotals,
    categories,
  };
}
