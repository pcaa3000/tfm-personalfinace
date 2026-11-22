import type { CategoryNature } from "../../categorization/index.js";

/** Transaction kind the dictation describes (S3: "compré" vs "cobré"). */
export type VoiceDraftType = "expense" | "income";

export interface VoiceNewCategorySuggestion {
  readonly name: string;
  readonly nature: CategoryNature;
}

/**
 * One dictated line item (voice-drafts T2, S3+S4). `amountMinorUnits`
 * is already normalized to minor units — the model speaks major units
 * ("sol cincuenta" → 1.50) and the adapter's normalize step converts.
 */
export interface VoiceExtractionItem {
  readonly concept: string;
  /** Absolute minor units — a voice note never dictates a signed line. */
  readonly amountMinorUnits: number;
  /** ISO 4217 when the dictation named a currency, else null. */
  readonly currency: string | null;
  /** A key of the workspace catalog, or null when nothing fits. */
  readonly suggestedCategoryKey: string | null;
  /** S4: proposal only, NEVER auto-created without user approval. */
  readonly suggestedNewCategory: VoiceNewCategorySuggestion | null;
  /** 0..1 — values < VOICE_LOW_CONFIDENCE force the item to review. */
  readonly confidence: number;
}

/**
 * Typed output of the single LLM call (voice-drafts T2, D1, S2):
 * transcription + structured extraction + catalog classification in
 * ONE request. Types-only here (domain stays dependency-free) — the
 * zod schema validating raw model JSON lives in infrastructure/.
 */
export interface VoiceExtraction {
  /** Verbatim transcript — persisted on the note row (S7). */
  readonly transcript: string;
  readonly type: VoiceDraftType;
  /** General concept summary; empty string when the model gave none. */
  readonly concept: string;
  /**
   * Raw date evidence the model heard: an absolute `YYYY-MM-DD` or a
   * relative phrase ("ayer", "el lunes"). Resolution is server-side in
   * `buildVoiceDraft` — never trusted verbatim (S3).
   */
  readonly dateHint: string | null;
  /** Total the dictation stated, in minor units, when present. */
  readonly totalMinorUnits: number | null;
  readonly items: readonly VoiceExtractionItem[];
}
