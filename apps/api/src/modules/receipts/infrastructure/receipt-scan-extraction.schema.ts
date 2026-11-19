import { z } from "zod";

import type { ReceiptScanExtraction } from "../domain/receipt-scan-extraction.js";

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

const itemSchema = z.object({
  description: z.string().min(1),
  amountMinorUnits: z.number().int(),
  suggestedCategoryKey: z.string().min(1).nullish(),
  suggestedNewCategory: newCategorySchema.nullish(),
  confidence: z.number().min(0).max(1),
});

/**
 * S3 (typesafe extraction): every LLM response is validated against this
 * schema before it can reach the draft payload. Field nullability is
 * loose on purpose — models return `null` or omit keys interchangeably —
 * and {@link normalizeExtraction} canonicalizes the shape.
 */
export const receiptScanExtractionSchema = z.object({
  merchant: z.string().nullish(),
  businessDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
  currency: z.string().regex(/^[A-Za-z]{3}$/).nullish(),
  totalMinorUnits: z.number().int().nullish(),
  items: z.array(itemSchema),
});

export type RawReceiptScanExtraction = z.infer<
  typeof receiptScanExtractionSchema
>;

/**
 * Canonicalizes a validated payload: absent → null, currency uppercased,
 * `suggestedCategoryKey` demoted to null when it does not exist in the
 * workspace catalog (a hallucinated key must never reach the draft), and
 * `suggestedNewCategory` dropped whenever a real catalog key matched
 * (S10: the proposal exists only when nothing fits).
 */
export function normalizeExtraction(
  parsed: RawReceiptScanExtraction,
  catalogKeys: ReadonlySet<string>,
): ReceiptScanExtraction {
  return {
    merchant: parsed.merchant ?? "",
    businessDate: parsed.businessDate ?? null,
    currency: parsed.currency ? parsed.currency.toUpperCase() : null,
    totalMinorUnits: parsed.totalMinorUnits ?? null,
    items: parsed.items.map((item) => {
      const rawKey = item.suggestedCategoryKey ?? null;
      const key = rawKey !== null && catalogKeys.has(rawKey) ? rawKey : null;
      return {
        description: item.description,
        amountMinorUnits: item.amountMinorUnits,
        suggestedCategoryKey: key,
        suggestedNewCategory:
          key === null ? (item.suggestedNewCategory ?? null) : null,
        confidence: item.confidence,
      };
    }),
  };
}
