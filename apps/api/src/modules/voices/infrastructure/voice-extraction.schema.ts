import { z } from "zod";

import type { VoiceExtraction } from "../domain/voice-extraction.js";

const NATURES = [
  "income",
  "essential",
  "discretionary",
  "obligation",
  "transfer",
] as const;

const newCategorySchema = z.object({
  name: z.string().min(1).max(120),
  nature: z.enum(NATURES),
});

/**
 * Untrusted LLM amounts are bounded (review R1-2): ≥0.005 major units
 * guarantees ≥1 minor unit after `toMinorUnits` rounding (no zero-unit
 * splits); ≤ `MAX_SAFE_INTEGER / 100` keeps the major→minor conversion
 * an exact safe integer (no Infinity/huge floats in JSONB).
 */
const MIN_MAJOR_UNITS = 0.005;
const MAX_MAJOR_UNITS = Number.MAX_SAFE_INTEGER / 100;

const boundedMajorUnits = z
  .number()
  .min(MIN_MAJOR_UNITS)
  .max(MAX_MAJOR_UNITS);

const itemSchema = z.object({
  concept: z.string().min(1),
  /** Major units the model heard — "sol cincuenta" → 1.50. */
  amount: boundedMajorUnits,
  currency: z.string().regex(/^[A-Za-z]{3}$/).nullish(),
  suggestedCategoryKey: z.string().min(1).nullish(),
  suggestedNewCategory: newCategorySchema.nullish(),
  confidence: z.number().min(0).max(1),
});

/**
 * S2 (typesafe extraction): every LLM response is validated against
 * this schema before it can reach the draft payload. `items` requires
 * at least one entry — a dictation with no extractable item is a
 * pipeline failure, not an empty draft.
 */
export const voiceExtractionSchema = z.object({
  transcript: z.string().min(1),
  type: z.enum(["expense", "income"]),
  concept: z.string().nullish(),
  dateHint: z.string().min(1).nullish(),
  total: boundedMajorUnits.nullish(),
  items: z.array(itemSchema).min(1),
});

export type RawVoiceExtraction = z.infer<typeof voiceExtractionSchema>;

/** Major units → integer minor units (1.50 → 150). */
function toMinorUnits(amount: number): number {
  return Math.round(amount * 100);
}

/**
 * Canonicalizes a validated payload: absent → null, currency uppercased,
 * major-unit amounts converted to minor units, `suggestedCategoryKey`
 * demoted to null when it does not exist in the workspace catalog (a
 * hallucinated key must never reach the draft), and
 * `suggestedNewCategory` dropped whenever a real catalog key matched
 * (S4: the proposal exists only when nothing fits).
 */
export function normalizeExtraction(
  parsed: RawVoiceExtraction,
  catalogKeys: ReadonlySet<string>,
): VoiceExtraction {
  return {
    transcript: parsed.transcript,
    type: parsed.type,
    concept: parsed.concept ?? "",
    dateHint: parsed.dateHint ?? null,
    totalMinorUnits:
      parsed.total === null || parsed.total === undefined
        ? null
        : toMinorUnits(parsed.total),
    items: parsed.items.map((item) => {
      const rawKey = item.suggestedCategoryKey ?? null;
      const key = rawKey !== null && catalogKeys.has(rawKey) ? rawKey : null;
      return {
        concept: item.concept,
        amountMinorUnits: toMinorUnits(item.amount),
        currency: item.currency ? item.currency.toUpperCase() : null,
        suggestedCategoryKey: key,
        suggestedNewCategory:
          key === null ? (item.suggestedNewCategory ?? null) : null,
        confidence: item.confidence,
      };
    }),
  };
}
