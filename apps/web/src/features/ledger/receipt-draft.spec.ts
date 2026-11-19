import { describe, expect, it } from "vitest";

import {
  draftToReviewState,
  parseSplitAmount,
  reviewSplitsTotalMinorUnits,
  reviewStateToConfirmInput,
  type ReceiptDraftPayload,
  type ReceiptReviewState,
} from "./receipt-draft";
import type { CategoryView } from "./types";

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

const payload: ReceiptDraftPayload = {
  merchant: "Plaza Vea",
  concept: "Plaza Vea",
  businessDate: "2026-10-03",
  currency: "PEN",
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

describe("draftToReviewState (receipt-scan-drafts T7, S2+S7+S10)", () => {
  it("prefills concept, date, currency and defaults to an expense", () => {
    const state = draftToReviewState(payload, baseOptions);

    expect(state.type).toBe("expense");
    expect(state.concept).toBe("Plaza Vea");
    expect(state.businessDate).toBe("2026-10-03");
    expect(state.currency).toBe("PEN");
    expect(state.accountId).toBe("");
    expect(state.totalMismatch).toBe(false);
    expect(state.splits).toHaveLength(3);
  });

  it("maps a catalog categoryKey to the workspace category id", () => {
    const state = draftToReviewState(payload, baseOptions);

    expect(state.splits[0]).toMatchObject({
      selection: { kind: "category", categoryId: "cat-food" },
      amount: "50.00",
      itemCount: 3,
      lowConfidence: false,
    });
  });

  it("flags suggestedNewCategory splits as keepable new categories (S10)", () => {
    const state = draftToReviewState(payload, baseOptions);

    expect(state.splits[1]?.selection).toEqual({
      kind: "new",
      name: "Cuidado personal",
      nature: "discretionary",
    });
  });

  it("maps null category and missing catalog keys to uncategorized", () => {
    const state = draftToReviewState(payload, baseOptions);
    expect(state.splits[2]?.selection).toEqual({ kind: "uncategorized" });

    const withUnknown: ReceiptDraftPayload = {
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
    const mapped = draftToReviewState(withUnknown, baseOptions);
    expect(mapped.splits[0]?.selection).toEqual({ kind: "uncategorized" });
  });

  it("falls back to the workspace defaults when the scan found no date/currency", () => {
    const state = draftToReviewState(
      { ...payload, businessDate: null, currency: null },
      baseOptions,
    );

    expect(state.businessDate).toBe("2026-11-01");
    expect(state.currency).toBe("PEN");
  });

  it("propagates the totalMismatch warning flag", () => {
    const state = draftToReviewState(
      { ...payload, totalMismatch: true },
      baseOptions,
    );

    expect(state.totalMismatch).toBe(true);
  });
});

describe("parseSplitAmount", () => {
  it("converts decimal text to integer minor units", () => {
    expect(parseSplitAmount("50.00", "PEN")).toBe(5000);
    expect(parseSplitAmount("0.01", "PEN")).toBe(1);
    expect(parseSplitAmount("123", "JPY")).toBe(123);
  });

  it("rejects empty, non-numeric, zero, negative and over-scale input", () => {
    expect(parseSplitAmount("", "PEN")).toBeNull();
    expect(parseSplitAmount("abc", "PEN")).toBeNull();
    expect(parseSplitAmount("0", "PEN")).toBeNull();
    expect(parseSplitAmount("0.00", "PEN")).toBeNull();
    expect(parseSplitAmount("-5", "PEN")).toBeNull();
    expect(parseSplitAmount("1.234", "PEN")).toBeNull();
    expect(parseSplitAmount("1.5", "JPY")).toBeNull();
  });
});

describe("possibleDuplicates (T13, S12)", () => {
  it("carries the read-time duplicates into the review state, defaulting to []", () => {
    const duplicates = [
      {
        transactionId: "trx-dup-1",
        concept: "Plaza Vea",
        amount: 9000,
        occurredOn: "2026-10-02",
      },
    ];

    const state = draftToReviewState(
      { ...payload, possibleDuplicates: duplicates },
      baseOptions,
    );
    expect(state.possibleDuplicates).toEqual(duplicates);

    // Drafts without the field (older payloads) render no warning.
    const without = draftToReviewState(payload, baseOptions);
    expect(without.possibleDuplicates).toEqual([]);
  });
});

describe("reviewStateToConfirmInput (S4+S7)", () => {
  const state: ReceiptReviewState = {
    type: "expense",
    concept: "Plaza Vea",
    businessDate: "2026-10-03",
    currency: "PEN",
    accountId: "acc-pen",
    totalMismatch: false,
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
    const input = reviewStateToConfirmInput(state);

    expect(input).not.toBeNull();
    expect(input?.accountId).toBe("acc-pen");
    expect(input?.type).toBe("expense");
    expect(input?.concept).toBe("Plaza Vea");
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
      reviewStateToConfirmInput({ ...state, accountId: "" }),
    ).toBeNull();
    expect(
      reviewStateToConfirmInput({ ...state, concept: "  " }),
    ).toBeNull();
    expect(
      reviewStateToConfirmInput({ ...state, businessDate: "" }),
    ).toBeNull();
    expect(reviewStateToConfirmInput({ ...state, splits: [] })).toBeNull();
  });

  it("returns null when any split amount is invalid", () => {
    const invalid: ReceiptReviewState = {
      ...state,
      splits: [
        { ...state.splits[0]!, amount: "" },
        ...state.splits.slice(1),
      ],
    };

    expect(reviewStateToConfirmInput(invalid)).toBeNull();
  });
});

describe("reviewSplitsTotalMinorUnits", () => {
  it("sums valid split amounts; null while any is unparseable", () => {
    const state = draftToReviewState(payload, baseOptions);
    expect(reviewSplitsTotalMinorUnits(state)).toBe(9000);

    const broken: ReceiptReviewState = {
      ...state,
      splits: [{ ...state.splits[0]!, amount: "abc" }, ...state.splits.slice(1)],
    };
    expect(reviewSplitsTotalMinorUnits(broken)).toBeNull();
  });
});
