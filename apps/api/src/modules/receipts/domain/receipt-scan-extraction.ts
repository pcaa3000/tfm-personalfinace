import type { CategoryNature } from "../../categorization/index.js";

/**
 * Typed output of the scan step (receipt-scan-drafts T4+T5, D1b, S3+S5):
 * one LLM call extracts the line items AND classifies them against the
 * workspace catalog. Types-only here (domain stays dependency-free) —
 * the zod schema that validates raw LLM JSON lives in infrastructure/.
 */
export interface ReceiptScanNewCategorySuggestion {
  readonly name: string;
  readonly nature: CategoryNature;
}

export interface ReceiptScanItem {
  readonly description: string;
  /** Signed minor units — receipts may carry negative lines (discounts). */
  readonly amountMinorUnits: number;
  /** A key of the workspace catalog, or null when nothing fits. */
  readonly suggestedCategoryKey: string | null;
  /** S10: proposal only, NEVER auto-created without user approval. */
  readonly suggestedNewCategory: ReceiptScanNewCategorySuggestion | null;
  /** 0..1 — values < RECEIPT_LOW_CONFIDENCE force the item to review. */
  readonly confidence: number;
}

export interface ReceiptScanExtraction {
  /** Empty string when unreadable — the draft falls back to a generic concept. */
  readonly merchant: string;
  /** ISO YYYY-MM-DD or null when undetected. */
  readonly businessDate: string | null;
  /** ISO 4217 or null when undetected — the user picks in review. */
  readonly currency: string | null;
  readonly totalMinorUnits: number | null;
  readonly items: readonly ReceiptScanItem[];
}
