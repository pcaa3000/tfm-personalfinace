import { minorToDecimalString } from "./format";
import {
  reviewStateToConfirmInput,
  type ReceiptCategoryNature,
  type ReceiptConfirmInput,
  type ReceiptDraftNewCategory,
  type ReceiptDraftPossibleDuplicate,
  type ReceiptReviewState,
  type ReviewSplitRow,
  type SplitSelection,
} from "./receipt-draft";
import { defaultCurrencyExponent } from "./summarize";
import type { CategoryView } from "./types";

/**
 * Voice-note draft types + pure mapping (voice-drafts T4). Mirrors the
 * API's `voices_voice_notes` row + `draft_payload` shape (apps/api
 * voices module): the note proposes splits grouped by category and the
 * user approves — the transaction is only created at confirm time (S2).
 *
 * The split/confirm wire shapes are identical to the receipts draft, so
 * the row/selection types and the confirm-input builder are reused from
 * `receipt-draft.ts` instead of duplicated.
 */

export type VoiceNoteStatus =
  | "pending"
  | "draft_ready"
  | "confirmed"
  | "rejected"
  | "failed";

/** Read model of `GET /api/v1/voices/:id` (polling). */
export interface VoiceNoteView {
  id: string;
  workspaceId: string;
  status: VoiceNoteStatus;
  originalFilename: string;
  mimeType: string;
  sizeBytes: number;
  transactionId: string | null;
  /** S7: the persisted transcript — null until the draft job lands it. */
  transcript: string | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
  /** Fixed media-retention deadline (S7: capture + 30d). */
  expiresAt: string;
  /** Set once the stored audio was deleted; the note row survives. */
  mediaDeletedAt: string | null;
}

/** S4 proposal — resolved by the user at confirm time. */
export type VoiceDraftNewCategory = ReceiptDraftNewCategory;
export type VoiceCategoryNature = ReceiptCategoryNature;

/** One category-level split proposed by the voice pipeline (S4). */
export interface VoiceDraftSplit {
  categoryKey: string | null;
  newCategory: ReceiptDraftNewCategory | null;
  amountMinorUnits: number;
  itemCount: number;
  confidenceAvg: number;
  lowConfidence: boolean;
}

/** Raw dictated line item kept as evidence in the payload. */
export interface VoiceDraftItem {
  concept: string;
  amountMinorUnits: number;
  currency: string | null;
  suggestedCategoryKey: string | null;
  suggestedNewCategory: ReceiptDraftNewCategory | null;
  confidence: number;
}

export type VoiceDraftPossibleDuplicate = ReceiptDraftPossibleDuplicate;

/** `GET /api/v1/voices/:id/draft` payload — the stored draft. */
export interface VoiceDraftPayload {
  /** Verbatim transcription — shown read-only in the review (S7). */
  transcript: string;
  /** Dictated kind: "compré" → expense, "cobré" → income (S3). */
  type: "expense" | "income";
  concept: string;
  /** Resolved server-side; null-tolerant for older payloads. */
  businessDate: string | null;
  dateHint: string | null;
  currency: string | null;
  /** true when the dictation named >1 currency — the user resolves it. */
  currencyConflict?: boolean;
  totalMinorUnits: number | null;
  /** true when ∑ items ≠ totalMinorUnits — the user resolves it. */
  totalMismatch: boolean;
  splits: VoiceDraftSplit[];
  items: VoiceDraftItem[];
  /** Read-time semantic dedup — absent on older payloads. */
  possibleDuplicates?: VoiceDraftPossibleDuplicate[];
}

/**
 * Editable review state derived from the stored draft. Same rows and
 * fields as the receipt review — plus the read-only transcript shown
 * as evidence of what the model heard (S7).
 */
export interface VoiceReviewState extends ReceiptReviewState {
  transcript: string;
  /** Surfaced as a non-blocking warning next to the currency field. */
  currencyConflict: boolean;
}

export interface VoiceDraftToReviewOptions {
  categories: CategoryView[];
  defaultCurrency: string;
  /** Workspace "today" used when the note resolved no date. */
  fallbackDate: string;
  exponentOf?: (code: string) => number;
}

/**
 * Maps the stored draft_payload to the review form state: catalog keys
 * resolve to workspace category ids, `suggestedNewCategory` stays
 * flagged as a keepable "new" selection, everything else degrades to
 * uncategorized (S4: nothing is created without approval). Unlike the
 * receipt draft, the voice draft already carries the dictated type —
 * "cobré" prefills income.
 */
export function voiceDraftToReviewState(
  payload: VoiceDraftPayload,
  options: VoiceDraftToReviewOptions,
): VoiceReviewState {
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
    type: payload.type,
    concept: payload.concept,
    businessDate: payload.businessDate ?? options.fallbackDate,
    currency,
    accountId: "",
    transcript: payload.transcript,
    totalMismatch: payload.totalMismatch,
    currencyConflict: payload.currencyConflict ?? false,
    possibleDuplicates: payload.possibleDuplicates ?? [],
    splits,
  };
}

/** Body of `POST /voices/:id/confirm` — same contract as receipts. */
export type VoiceConfirmInput = ReceiptConfirmInput;

/**
 * Review state → confirm body (without the idempotency key, which the
 * caller mints per attempt). The wire contract is the receipts one —
 * this delegates to the shared builder; returns null while the form
 * is invalid.
 */
export function voiceReviewStateToConfirmInput(
  state: VoiceReviewState,
  exponentOf: (code: string) => number = defaultCurrencyExponent,
): VoiceConfirmInput | null {
  return reviewStateToConfirmInput(state, exponentOf);
}
