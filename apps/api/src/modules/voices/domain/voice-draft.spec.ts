import { describe, expect, it } from "vitest";

import {
  buildVoiceDraft,
  type VoiceDraftContext,
} from "./voice-draft.js";
import type {
  VoiceExtraction,
  VoiceExtractionItem,
} from "./voice-extraction.js";

/**
 * voice-drafts T2 (S2+S3+S4): the domain groups the LLM items into
 * category splits (INV-TRX-SPLIT-01: Σ splits = amount), resolves the
 * relative date hint against the injected business date, defaults the
 * currency to the workspace one, and flags — never autocorrects — a
 * stated-total mismatch.
 */

const CONTEXT: VoiceDraftContext = {
  today: "2026-11-10", // a Tuesday
  defaultCurrency: "PEN",
};

function item(overrides: Partial<VoiceExtractionItem> = {}): VoiceExtractionItem {
  return {
    concept: "Pan",
    amountMinorUnits: 100,
    currency: null,
    suggestedCategoryKey: "groceries",
    suggestedNewCategory: null,
    confidence: 0.9,
    ...overrides,
  };
}

function extraction(
  overrides: Partial<VoiceExtraction> = {},
): VoiceExtraction {
  return {
    transcript: "compré un sol de pan",
    type: "expense",
    concept: "Compra de pan",
    dateHint: null,
    totalMinorUnits: null,
    items: [item()],
    ...overrides,
  };
}

describe("buildVoiceDraft — items → splits (S4, INV-TRX-SPLIT-01)", () => {
  it("groups items sharing a resolved category key into one split; Σ splits equals the items total", () => {
    const draft = buildVoiceDraft(
      extraction({
        items: [
          item({ concept: "Shampoo", amountMinorUnits: 70 }),
          item({ concept: "Gaseosa", amountMinorUnits: 150 }),
        ],
      }),
      CONTEXT,
    );

    expect(draft.splits).toHaveLength(1);
    expect(draft.splits[0]).toMatchObject({
      categoryKey: "groceries",
      newCategory: null,
      amountMinorUnits: 220,
      itemCount: 2,
      lowConfidence: false,
    });
    const sum = draft.splits.reduce((s, split) => s + split.amountMinorUnits, 0);
    expect(sum).toBe(220);
  });

  it("keeps distinct category keys in separate splits in first-seen order", () => {
    const draft = buildVoiceDraft(
      extraction({
        items: [
          item({ suggestedCategoryKey: "groceries", amountMinorUnits: 70 }),
          item({ suggestedCategoryKey: "transport", amountMinorUnits: 50 }),
          item({ suggestedCategoryKey: "groceries", amountMinorUnits: 30 }),
        ],
      }),
      CONTEXT,
    );

    expect(draft.splits.map((s) => s.categoryKey)).toEqual([
      "groceries",
      "transport",
    ]);
    expect(draft.splits[0]!.amountMinorUnits).toBe(100);
  });

  it("parks a low-confidence item in the uncategorized split flagged for review", () => {
    const draft = buildVoiceDraft(
      extraction({
        items: [
          item({ confidence: 0.4 }),
          item({ concept: "Gaseosa", amountMinorUnits: 50 }),
        ],
      }),
      CONTEXT,
    );

    const uncategorized = draft.splits.find((s) => s.lowConfidence);
    expect(uncategorized).toMatchObject({
      categoryKey: null,
      newCategory: null,
      amountMinorUnits: 100,
    });
  });

  it("builds a new-category split proposal when the item has no catalog match — a flag, never an auto-create (S4)", () => {
    const draft = buildVoiceDraft(
      extraction({
        items: [
          item({
            suggestedCategoryKey: null,
            suggestedNewCategory: { name: "Mascotas", nature: "discretionary" },
          }),
        ],
      }),
      CONTEXT,
    );

    expect(draft.splits[0]).toMatchObject({
      categoryKey: null,
      newCategory: { name: "Mascotas", nature: "discretionary" },
    });
  });
});

describe("buildVoiceDraft — currency default (S3)", () => {
  it("defaults the draft currency to the workspace default when no item carries one", () => {
    const draft = buildVoiceDraft(extraction(), CONTEXT);

    expect(draft.currency).toBe("PEN");
    expect(draft.currencyConflict).toBe(false);
  });

  it("uses the shared item currency when every stated currency agrees", () => {
    const draft = buildVoiceDraft(
      extraction({
        items: [
          item({ currency: "USD" }),
          item({ currency: null }),
        ],
      }),
      CONTEXT,
    );

    expect(draft.currency).toBe("USD");
    expect(draft.currencyConflict).toBe(false);
  });

  it("falls back to the workspace currency and flags a conflict when items disagree", () => {
    const draft = buildVoiceDraft(
      extraction({
        items: [item({ currency: "USD" }), item({ currency: "EUR" })],
      }),
      CONTEXT,
    );

    expect(draft.currency).toBe("PEN");
    expect(draft.currencyConflict).toBe(true);
  });
});

describe("buildVoiceDraft — relative date hint resolved server-side (S3)", () => {
  it("defaults to the business date when the model emitted no hint", () => {
    const draft = buildVoiceDraft(extraction({ dateHint: null }), CONTEXT);

    expect(draft.businessDate).toBe("2026-11-10");
  });

  it("keeps an explicit YYYY-MM-DD hint verbatim", () => {
    const draft = buildVoiceDraft(
      extraction({ dateHint: "2026-10-31" }),
      CONTEXT,
    );

    expect(draft.businessDate).toBe("2026-10-31");
  });

  it.each([
    ["hoy", "2026-11-10"],
    ["ayer", "2026-11-09"],
    ["anteayer", "2026-11-08"],
    ["today", "2026-11-10"],
    ["yesterday", "2026-11-09"],
    ["el lunes", "2026-11-09"], // most recent Monday ≤ Tuesday 2026-11-10
    ["el viernes", "2026-11-06"],
    ["hace 3 días", "2026-11-07"],
    ["3 days ago", "2026-11-07"],
  ])("resolves the relative hint %s against today", (hint, expected) => {
    const draft = buildVoiceDraft(extraction({ dateHint: hint }), CONTEXT);

    expect(draft.businessDate).toBe(expected);
    expect(draft.dateHint).toBe(hint);
  });

  it("a weekday hint on its own day resolves to today (most recent occurrence, inclusive)", () => {
    const draft = buildVoiceDraft(
      extraction({ dateHint: "el martes" }),
      CONTEXT, // 2026-11-10 is a Tuesday
    );

    expect(draft.businessDate).toBe("2026-11-10");
  });

  it("an unparseable hint falls back to the business date instead of guessing", () => {
    const draft = buildVoiceDraft(
      extraction({ dateHint: "la semana que viene" }),
      CONTEXT,
    );

    expect(draft.businessDate).toBe("2026-11-10");
  });

  it.each(["__proto__", "constructor", "toString"])(
    "a prototype-inherited key hint %s falls back to today instead of crashing (R1-1)",
    (hint) => {
      const draft = buildVoiceDraft(extraction({ dateHint: hint }), CONTEXT);

      expect(draft.businessDate).toBe("2026-11-10");
    },
  );

  it.each(["2026-99-99", "2026-13-01", "2026-02-30", "2026-00-10"])(
    "an impossible ISO date %s falls back to today instead of persisting verbatim (R1-1)",
    (hint) => {
      const draft = buildVoiceDraft(extraction({ dateHint: hint }), CONTEXT);

      expect(draft.businessDate).toBe("2026-11-10");
    },
  );

  it.each(["hace 9999999 días", "12345678 days ago"])(
    "a days-ago hint beyond the bounded digit count (%s) falls back to today instead of overflowing Date (R1-1)",
    (hint) => {
      const draft = buildVoiceDraft(extraction({ dateHint: hint }), CONTEXT);

      expect(draft.businessDate).toBe("2026-11-10");
    },
  );
});

describe("buildVoiceDraft — payload shape (S2+S7)", () => {
  it("carries the transcript, the detected type and the stated total without autocorrection", () => {
    const draft = buildVoiceDraft(
      extraction({
        type: "income",
        transcript: "cobré 100 soles por mantenimiento de PC",
        totalMinorUnits: 9999,
      }),
      CONTEXT,
    );

    expect(draft.transcript).toBe("cobré 100 soles por mantenimiento de PC");
    expect(draft.type).toBe("income");
    expect(draft.totalMinorUnits).toBe(9999);
    expect(draft.totalMismatch).toBe(true); // 9999 ≠ Σ items (100) — flagged, not fixed
  });

  it("totalMismatch stays false when the stated total equals the items sum", () => {
    const draft = buildVoiceDraft(
      extraction({ totalMinorUnits: 100 }),
      CONTEXT,
    );

    expect(draft.totalMismatch).toBe(false);
  });

  it("keeps the raw items as evidence and derives the general concept", () => {
    const draft = buildVoiceDraft(
      extraction({
        concept: "",
        items: [item({ concept: "Pan integral" })],
      }),
      CONTEXT,
    );

    expect(draft.concept).toBe("Pan integral");
    expect(draft.items).toHaveLength(1);
    expect(draft.items[0]!.concept).toBe("Pan integral");
  });

  it("falls back to a generic concept when the model gave none and items are unusable", () => {
    const draft = buildVoiceDraft(
      extraction({ concept: "", items: [item({ concept: " " })] }),
      CONTEXT,
    );

    expect(draft.concept).toBe("Voice note");
  });
});
