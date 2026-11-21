import { describe, expect, it } from "vitest";

import {
  normalizeExtraction,
  voiceExtractionSchema,
} from "./voice-extraction.schema.js";

/**
 * voice-drafts T2 review (R1-2): untrusted LLM amounts must be bounded —
 * below 0.005 major units `toMinorUnits` produces 0-minor-unit splits,
 * and values above `MAX_SAFE_INTEGER / 100` overflow to unsafe integers
 * or Infinity in JSONB.
 */

const VALID_ITEM = { concept: "Pan", amount: 1, confidence: 0.9 };

function parse(overrides: {
  amount?: number;
  total?: number;
}): ReturnType<typeof voiceExtractionSchema.safeParse> {
  return voiceExtractionSchema.safeParse({
    transcript: "compré pan",
    type: "expense",
    total: overrides.total ?? null,
    items: [{ ...VALID_ITEM, amount: overrides.amount ?? 1 }],
  });
}

describe("voiceExtractionSchema — amount bounds (R1-2)", () => {
  it.each([0.004, 0.001, 0, -1])(
    "rejects an item amount below 0.005 major units (%s → <1 minor unit)",
    (amount) => {
      expect(parse({ amount }).success).toBe(false);
    },
  );

  it.each([Number.MAX_SAFE_INTEGER, Infinity, 1e20])(
    "rejects an item amount above MAX_SAFE_INTEGER/100 (%s)",
    (amount) => {
      expect(parse({ amount }).success).toBe(false);
    },
  );

  it("accepts the 0.005 boundary and rounds to 1 minor unit", () => {
    const result = parse({ amount: 0.005 });

    expect(result.success).toBe(true);
    if (!result.success) return;
    const normalized = normalizeExtraction(result.data, new Set());
    expect(normalized.items[0]!.amountMinorUnits).toBe(1);
  });

  it("accepts the MAX_SAFE_INTEGER/100 boundary and converts exactly", () => {
    const result = parse({ amount: Number.MAX_SAFE_INTEGER / 100 });

    expect(result.success).toBe(true);
    if (!result.success) return;
    const normalized = normalizeExtraction(result.data, new Set());
    expect(normalized.items[0]!.amountMinorUnits).toBe(
      Number.MAX_SAFE_INTEGER,
    );
  });

  it.each([0.001, Infinity, 1e20])(
    "rejects an out-of-bounds stated total (%s)",
    (total) => {
      expect(parse({ total }).success).toBe(false);
    },
  );
});
