import { describe, expect, it } from "vitest";

import type { CategoryView } from "./types";
import {
  voiceDraftToReviewState,
  voiceReviewStateToConfirmInput,
  type VoiceDraftPayload,
  type VoiceReviewState,
} from "./voice-draft";

const categories: CategoryView[] = [
  {
    id: "cat-food",
    key: "food",
    label: "Comida",
    nature: "essential",
    custom: false,
  },
  {
    id: "cat-home",
    key: "home",
    label: "Hogar",
    nature: "essential",
    custom: false,
  },
];

const payload: VoiceDraftPayload = {
  transcript:
    "compré un sachet de champú a setenta céntimos y una gaseosa a sol cincuenta",
  type: "expense",
  concept: "Champú y gaseosa",
  businessDate: "2026-10-03",
  dateHint: null,
  currency: "PEN",
  currencyConflict: false,
  totalMinorUnits: 9000,
  totalMismatch: false,
  splits: [
    {
      categoryKey: "food",
      newCategory: null,
      amountMinorUnits: 5000,
      itemCount: 3,
      confidenceAvg: 0.9,
      lowConfidence: false,
    },
    {
      categoryKey: null,
      newCategory: { name: "Cuidado personal", nature: "discretionary" },
      amountMinorUnits: 3000,
      itemCount: 1,
      confidenceAvg: 0.8,
      lowConfidence: false,
    },
    {
      categoryKey: null,
      newCategory: null,
      amountMinorUnits: 1000,
      itemCount: 1,
      confidenceAvg: 0.4,
      lowConfidence: true,
    },
  ],
  items: [],
};

const baseOptions = {
  categories,
  defaultCurrency: "PEN",
  fallbackDate: "2026-11-01",
};

describe("voiceDraftToReviewState (voice-drafts T4, S2+S4)", () => {
  it("prefills concept, date, currency, transcript and the dictated type", () => {
    const state = voiceDraftToReviewState(payload, baseOptions);

    expect(state.type).toBe("expense");
    expect(state.concept).toBe("Champú y gaseosa");
    expect(state.businessDate).toBe("2026-10-03");
    expect(state.currency).toBe("PEN");
    expect(state.transcript).toBe(payload.transcript);
    expect(state.accountId).toBe("");
    expect(state.totalMismatch).toBe(false);
    expect(state.splits).toHaveLength(3);
  });

  it("prefills an income type when the dictation describes a cobro (S3)", () => {
    const state = voiceDraftToReviewState(
      { ...payload, type: "income" },
      baseOptions,
    );

    expect(state.type).toBe("income");
  });

  it("maps a catalog categoryKey to the workspace category id", () => {
    const state = voiceDraftToReviewState(payload, baseOptions);

    expect(state.splits[0]).toMatchObject({
      selection: { kind: "category", categoryId: "cat-food" },
      amount: "50.00",
      itemCount: 3,
      lowConfidence: false,
    });
  });

  it("flags suggestedNewCategory splits as keepable new categories (S4)", () => {
    const state = voiceDraftToReviewState(payload, baseOptions);

    expect(state.splits[1]?.selection).toEqual({
      kind: "new",
      name: "Cuidado personal",
      nature: "discretionary",
    });
  });

  it("maps null category and missing catalog keys to uncategorized", () => {
    const state = voiceDraftToReviewState(payload, baseOptions);
    expect(state.splits[2]?.selection).toEqual({ kind: "uncategorized" });

    const withUnknown: VoiceDraftPayload = {
      ...payload,
      splits: [
        {
          categoryKey: "unknown-key",
          newCategory: null,
          amountMinorUnits: 700,
          itemCount: 1,
          confidenceAvg: 0.9,
          lowConfidence: false,
        },
      ],
    };
    const mapped = voiceDraftToReviewState(withUnknown, baseOptions);
    expect(mapped.splits[0]?.selection).toEqual({ kind: "uncategorized" });
  });

  it("falls back to the workspace defaults when the note found no date/currency", () => {
    const state = voiceDraftToReviewState(
      { ...payload, businessDate: null, currency: null },
      baseOptions,
    );

    expect(state.businessDate).toBe("2026-11-01");
    expect(state.currency).toBe("PEN");
  });

  it("propagates the totalMismatch and currencyConflict warning flags", () => {
    const state = voiceDraftToReviewState(
      { ...payload, totalMismatch: true, currencyConflict: true },
      baseOptions,
    );

    expect(state.totalMismatch).toBe(true);
    expect(state.currencyConflict).toBe(true);
  });

  it("carries the read-time duplicates into the review state, defaulting to []", () => {
    const duplicates = [
      {
        transactionId: "trx-dup-1",
        concept: "Champú",
        amount: 9000,
        occurredOn: "2026-10-02",
      },
    ];

    const state = voiceDraftToReviewState(
      { ...payload, possibleDuplicates: duplicates },
      baseOptions,
    );
    expect(state.possibleDuplicates).toEqual(duplicates);

    const without = voiceDraftToReviewState(payload, baseOptions);
    expect(without.possibleDuplicates).toEqual([]);
  });
});

describe("voiceReviewStateToConfirmInput (S4)", () => {
  const state: VoiceReviewState = {
    type: "expense",
    concept: "Champú y gaseosa",
    businessDate: "2026-10-03",
    currency: "PEN",
    accountId: "acc-pen",
    transcript: payload.transcript,
    totalMismatch: false,
    currencyConflict: false,
    possibleDuplicates: [],
    splits: [
      {
        selection: { kind: "category", categoryId: "cat-food" },
        amount: "50.00",
        itemCount: 3,
        lowConfidence: false,
      },
      {
        selection: {
          kind: "new",
          name: "Cuidado personal",
          nature: "discretionary",
        },
        amount: "30.00",
        itemCount: 1,
        lowConfidence: false,
      },
      {
        selection: { kind: "uncategorized" },
        amount: "10.00",
        itemCount: 1,
        lowConfidence: true,
      },
    ],
  };

  it("builds the confirm payload resolving each selection shape", () => {
    const input = voiceReviewStateToConfirmInput(state);

    expect(input).not.toBeNull();
    expect(input?.accountId).toBe("acc-pen");
    expect(input?.type).toBe("expense");
    expect(input?.concept).toBe("Champú y gaseosa");
    expect(input?.businessDate).toBe("2026-10-03");
    expect(input?.currency).toBe("PEN");
    expect(input?.splits).toEqual([
      {
        categoryId: "cat-food",
        newCategory: null,
        amountMinorUnits: 5000,
      },
      {
        categoryId: null,
        newCategory: { name: "Cuidado personal", nature: "discretionary" },
        amountMinorUnits: 3000,
      },
      {
        categoryId: null,
        newCategory: null,
        amountMinorUnits: 1000,
      },
    ]);
  });

  it("returns null when the account, concept or date are missing", () => {
    expect(
      voiceReviewStateToConfirmInput({ ...state, accountId: "" }),
    ).toBeNull();
    expect(
      voiceReviewStateToConfirmInput({ ...state, concept: "  " }),
    ).toBeNull();
    expect(
      voiceReviewStateToConfirmInput({ ...state, businessDate: "" }),
    ).toBeNull();
    expect(
      voiceReviewStateToConfirmInput({ ...state, splits: [] }),
    ).toBeNull();
  });

  it("returns null when any split amount is invalid", () => {
    const invalid: VoiceReviewState = {
      ...state,
      splits: [{ ...state.splits[0]!, amount: "" }, ...state.splits.slice(1)],
    };

    expect(voiceReviewStateToConfirmInput(invalid)).toBeNull();
  });
});
