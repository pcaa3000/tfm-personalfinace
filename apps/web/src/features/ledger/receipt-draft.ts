import { minorToDecimalString } from "./format";
import { amountToMinor, defaultCurrencyExponent } from "./summarize";
import type { CategoryView } from "./types";

/**
 * Receipt-scan draft types + pure mapping (receipt-scan-drafts T7).
 * Mirrors the API's `draft_payload` shape (apps/api receipts module):
 * the scan proposes splits grouped by category and the user approves —
 * the transaction is only created at confirm time (S2).
 */

export type ReceiptScanStatus =
  | "pending"
  | "extracted"
  | "draft_ready"
  | "confirmed"
  | "rejected"
  | "failed";

/** Read model of `GET /api/v1/receipts/:id` (polling). */
export interface ReceiptScanView {
  id: string;
  workspaceId: string;
  status: ReceiptScanStatus;
  originalFilename: string;
  mimeType: string;
  sizeBytes: number;
  transactionId: string | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * Statuses surfaced by `GET /api/v1/receipts` list rows
 * (receipt-review-link T4, S3): any scan state is listed, including
 * scans still in the pipeline.
 */
export type ReceiptListStatus =
  | "pending"
  | "extracted"
  | "draft_ready"
  | "confirmed"
  | "rejected"
  | "failed";

/** Row of `GET /api/v1/receipts` (receipt-review-link T4, S1). */
export interface ReceiptListItemView {
  id: string;
  status: ReceiptListStatus;
  originalFilename: string;
  fileMimeType: string;
  createdAt: string;
  /** Set once the scan was confirmed into a transaction; null before. */
  transactionId: string | null;
}

export type ReceiptCategoryNature =
  | "income"
  | "essential"
  | "discretionary"
  | "obligation"
  | "transfer";

export interface ReceiptDraftNewCategory {
  name: string;
  nature: ReceiptCategoryNature;
}

/** One category-level split proposed by the scan pipeline (S6). */
export interface ReceiptDraftSplit {
  categoryKey: string | null;
  /** S10 proposal — only when the LLM found no catalog match. */
  newCategory: ReceiptDraftNewCategory | null;
  amountMinorUnits: number;
  itemCount: number;
  confidenceAvg: number;
  lowConfidence: boolean;
}

export interface ReceiptDraftItem {
  description: string;
  amountMinorUnits: number;
  suggestedCategoryKey: string | null;
  suggestedNewCategory: ReceiptDraftNewCategory | null;
  confidence: number;
}

/**
 * A workspace expense that may already record this voucher (T13, S12 —
 * semantic dedup warning). Computed by the API at draft-read time.
 */
export interface ReceiptDraftPossibleDuplicate {
  transactionId: string;
  concept: string;
  /** Absolute amount in minor units. */
  amount: number;
  /** YYYY-MM-DD. */
  occurredOn: string;
}

/** `GET /api/v1/receipts/:id/draft` payload — the stored draft. */
export interface ReceiptDraftPayload {
  merchant: string | null;
  concept: string;
  businessDate: string | null;
  currency: string | null;
  totalMinorUnits: number | null;
  /** true when ∑ items ≠ totalMinorUnits — the user resolves it. */
  totalMismatch: boolean;
  splits: ReceiptDraftSplit[];
  items: ReceiptDraftItem[];
  /** T13 (S12): read-time only — absent on older payloads. */
  possibleDuplicates?: ReceiptDraftPossibleDuplicate[];
}

/** What a review row's category select resolves to at confirm time. */
export type SplitSelection =
  | { kind: "category"; categoryId: string }
  /** S10: keep the proposed new category — created on confirm. */
  | { kind: "new"; name: string; nature: ReceiptCategoryNature }
  | { kind: "uncategorized" };

export interface ReviewSplitRow {
  selection: SplitSelection;
  /** Decimal text in the review currency — user-editable. */
  amount: string;
  itemCount: number;
  lowConfidence: boolean;
}

/** Editable review state derived from the stored draft (S7). */
export interface ReceiptReviewState {
  type: "expense" | "income";
  concept: string;
  businessDate: string;
  currency: string;
  accountId: string;
  totalMismatch: boolean;
  /** T13 (S12): shown as a non-blocking warning in the review step. */
  possibleDuplicates: ReceiptDraftPossibleDuplicate[];
  splits: ReviewSplitRow[];
}

export interface DraftToReviewOptions {
  categories: CategoryView[];
  defaultCurrency: string;
  /** Workspace "today" used when the scan found no date. */
  fallbackDate: string;
  exponentOf?: (code: string) => number;
}

/**
 * Maps the stored draft_payload to the review form state: catalog keys
 * resolve to workspace category ids, `suggestedNewCategory` stays
 * flagged as a keepable "new" selection, everything else degrades to
 * uncategorized (S10: nothing is created without approval).
 */
export function draftToReviewState(
  payload: ReceiptDraftPayload,
  options: DraftToReviewOptions,
): ReceiptReviewState {
  const exponentOf = options.exponentOf ?? defaultCurrencyExponent;
  const currency = payload.currency ?? options.defaultCurrency;
  const exponent = exponentOf(currency);
  const byKey = new Map(options.categories.map((c) => [c.key, c.id]));

  const splits: ReviewSplitRow[] = payload.splits.map((split) => {
    let selection: SplitSelection = { kind: "uncategorized" };
    if (split.newCategory) {
      selection = {
        kind: "new",
        name: split.newCategory.name,
        nature: split.newCategory.nature,
      };
    } else if (split.categoryKey) {
      const categoryId = byKey.get(split.categoryKey);
      if (categoryId) selection = { kind: "category", categoryId };
    }
    return {
      selection,
      amount: minorToDecimalString(BigInt(split.amountMinorUnits), exponent),
      itemCount: split.itemCount,
      lowConfidence: split.lowConfidence,
    };
  });

  return {
    type: "expense",
    concept: payload.concept,
    businessDate: payload.businessDate ?? options.fallbackDate,
    currency,
    accountId: "",
    totalMismatch: payload.totalMismatch,
    possibleDuplicates: payload.possibleDuplicates ?? [],
    splits,
  };
}

/** Strict decimal text → integer minor units; null when not a positive amount. */
export function parseSplitAmount(
  text: string,
  currency: string,
  exponentOf: (code: string) => number = defaultCurrencyExponent,
): number | null {
  const trimmed = text.trim();
  if (!/^\d+(\.\d+)?$/.test(trimmed)) return null;
  const frac = trimmed.split(".")[1] ?? "";
  if (frac.length > exponentOf(currency)) return null;
  const minor = amountToMinor(trimmed, currency, exponentOf);
  if (minor <= 0n || minor > BigInt(Number.MAX_SAFE_INTEGER)) return null;
  return Number(minor);
}

/** One split of `POST /receipts/:id/confirm` (S4+S10). */
export interface ConfirmSplitInput {
  categoryId: string | null;
  newCategory: ReceiptDraftNewCategory | null;
  amountMinorUnits: number;
}

export interface ReceiptConfirmInput {
  accountId: string;
  type: "expense" | "income";
  businessDate: string;
  currency: string;
  concept: string;
  splits: ConfirmSplitInput[];
}

/**
 * Review state → confirm body (without the idempotency key, which the
 * caller mints per attempt). Returns null while the form is invalid —
 * account/concept/date missing or any split amount unparseable.
 */
export function reviewStateToConfirmInput(
  state: ReceiptReviewState,
  exponentOf: (code: string) => number = defaultCurrencyExponent,
): ReceiptConfirmInput | null {
  if (!state.accountId) return null;
  if (!state.concept.trim()) return null;
  if (!state.businessDate) return null;
  if (state.splits.length === 0) return null;

  const splits: ConfirmSplitInput[] = [];
  for (const row of state.splits) {
    const amountMinorUnits = parseSplitAmount(
      row.amount,
      state.currency,
      exponentOf,
    );
    if (amountMinorUnits === null) return null;
    if (row.selection.kind === "category") {
      splits.push({
        categoryId: row.selection.categoryId,
        newCategory: null,
        amountMinorUnits,
      });
    } else if (row.selection.kind === "new") {
      splits.push({
        categoryId: null,
        newCategory: {
          name: row.selection.name,
          nature: row.selection.nature,
        },
        amountMinorUnits,
      });
    } else {
      splits.push({ categoryId: null, newCategory: null, amountMinorUnits });
    }
  }

  return {
    accountId: state.accountId,
    type: state.type,
    businessDate: state.businessDate,
    currency: state.currency,
    concept: state.concept.trim(),
    splits,
  };
}

/** Sum of the split amounts (minor units); null while any is unparseable. */
export function reviewSplitsTotalMinorUnits(
  state: ReceiptReviewState,
  exponentOf: (code: string) => number = defaultCurrencyExponent,
): number | null {
  let total = 0;
  for (const row of state.splits) {
    const minor = parseSplitAmount(row.amount, state.currency, exponentOf);
    if (minor === null) return null;
    total += minor;
  }
  return total;
}
