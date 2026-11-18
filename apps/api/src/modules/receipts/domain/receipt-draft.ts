import type { CategoryNature } from "../../categorization/index.js";
import type {
  ReceiptScanExtraction,
  ReceiptScanItem,
} from "./receipt-scan-extraction.js";

/**
 * S3: below this confidence the LLM suggestion is not trusted — the item
 * is parked in the uncategorized split and flagged for the review UI.
 */
export const RECEIPT_LOW_CONFIDENCE = 0.6;

const FALLBACK_CONCEPT = "Receipt scan";

export interface ReceiptDraftNewCategory {
  readonly name: string;
  readonly nature: CategoryNature;
}

export interface ReceiptDraftSplit {
  /** Catalog key, or null for the uncategorized / new-category splits. */
  readonly categoryKey: string | null;
  /** S10 proposal — resolved by the user at confirm time (T6). */
  readonly newCategory: ReceiptDraftNewCategory | null;
  readonly amountMinorUnits: number;
  readonly itemCount: number;
  readonly confidenceAvg: number;
  /** true when the split holds items under RECEIPT_LOW_CONFIDENCE. */
  readonly lowConfidence: boolean;
}

/**
 * Draft payload persisted on `receipts_receipt_scans.draft_payload`
 * (T4+T5, S2+S6). `items` keeps the raw extraction as evidence.
 */
export interface ReceiptDraftPayload {
  readonly merchant: string | null;
  readonly concept: string;
  readonly businessDate: string | null;
  readonly currency: string | null;
  readonly totalMinorUnits: number | null;
  /** true when ∑items ≠ totalMinorUnits — the user resolves it in review. */
  readonly totalMismatch: boolean;
  readonly splits: readonly ReceiptDraftSplit[];
  readonly items: readonly ReceiptScanItem[];
}

interface SplitAcc {
  categoryKey: string | null;
  newCategory: ReceiptDraftNewCategory | null;
  amountMinorUnits: number;
  itemCount: number;
  confidenceSum: number;
  lowConfidence: boolean;
}

const UNCATEGORIZED = "uncategorized";

function groupKey(item: ReceiptScanItem): string {
  if (item.confidence < RECEIPT_LOW_CONFIDENCE) return UNCATEGORIZED;
  if (item.suggestedCategoryKey !== null) return `key:${item.suggestedCategoryKey}`;
  if (item.suggestedNewCategory !== null) {
    return `new:${item.suggestedNewCategory.name.toLowerCase()}`;
  }
  return UNCATEGORIZED;
}

/**
 * Groups the extracted items into category splits (S6): one split per
 * effective category — catalog key, `NEW:<name>` proposal, or the shared
 * uncategorized bucket. Pure function: no I/O, deterministic order
 * (first-seen) so the stored payload is stable.
 */
export function buildReceiptDraft(
  extraction: ReceiptScanExtraction,
): ReceiptDraftPayload {
  const groups = new Map<string, SplitAcc>();
  for (const item of extraction.items) {
    const key = groupKey(item);
    let acc = groups.get(key);
    if (!acc) {
      acc = {
        categoryKey:
          item.confidence >= RECEIPT_LOW_CONFIDENCE
            ? item.suggestedCategoryKey
            : null,
        newCategory:
          item.confidence >= RECEIPT_LOW_CONFIDENCE &&
          item.suggestedCategoryKey === null
            ? item.suggestedNewCategory
            : null,
        amountMinorUnits: 0,
        itemCount: 0,
        confidenceSum: 0,
        lowConfidence: false,
      };
      groups.set(key, acc);
    }
    acc.amountMinorUnits += item.amountMinorUnits;
    acc.itemCount += 1;
    acc.confidenceSum += item.confidence;
    if (item.confidence < RECEIPT_LOW_CONFIDENCE) acc.lowConfidence = true;
  }

  const splits: ReceiptDraftSplit[] = [...groups.values()].map((acc) => ({
    categoryKey: acc.categoryKey,
    newCategory: acc.newCategory,
    amountMinorUnits: acc.amountMinorUnits,
    itemCount: acc.itemCount,
    confidenceAvg:
      acc.itemCount > 0
        ? Math.round((acc.confidenceSum / acc.itemCount) * 1000) / 1000
        : 0,
    lowConfidence: acc.lowConfidence,
  }));

  const merchant = extraction.merchant.trim();
  const itemsSum = extraction.items.reduce(
    (sum, i) => sum + i.amountMinorUnits,
    0,
  );

  return {
    merchant: merchant.length > 0 ? merchant : null,
    concept: merchant.length > 0 ? merchant : FALLBACK_CONCEPT,
    businessDate: extraction.businessDate,
    currency: extraction.currency,
    totalMinorUnits: extraction.totalMinorUnits,
    totalMismatch:
      extraction.totalMinorUnits !== null &&
      extraction.totalMinorUnits !== itemsSum,
    splits,
    items: extraction.items,
  };
}
