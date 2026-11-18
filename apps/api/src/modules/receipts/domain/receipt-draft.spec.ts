import { describe, expect, it } from "vitest";

import { WorkspaceId } from "../../shared-kernel/index.js";
import { ReceiptScan } from "./receipt-scan.js";
import {
  buildReceiptDraft,
  RECEIPT_LOW_CONFIDENCE,
  type ReceiptDraftPayload,
} from "./receipt-draft.js";
import type {
  ReceiptScanExtraction,
  ReceiptScanItem,
} from "./receipt-scan-extraction.js";

function item(overrides: Partial<ReceiptScanItem> = {}): ReceiptScanItem {
  return {
    description: "Milk 1L",
    amountMinorUnits: 150,
    suggestedCategoryKey: null,
    suggestedNewCategory: null,
    confidence: 0.95,
    ...overrides,
  };
}

function extraction(
  items: ReceiptScanItem[],
  overrides: Partial<ReceiptScanExtraction> = {},
): ReceiptScanExtraction {
  return {
    merchant: "Mercadona",
    businessDate: "2026-11-10",
    currency: "EUR",
    totalMinorUnits: 300,
    items,
    ...overrides,
  };
}

describe("buildReceiptDraft — grouped draft payload (receipt-scan-drafts T4+T5, S6)", () => {
  it("groups items by suggestedCategoryKey: one split per category with summed amount, count and confidenceAvg", () => {
    const draft = buildReceiptDraft(
      extraction([
        item({ suggestedCategoryKey: "groceries", amountMinorUnits: 200, confidence: 0.9 }),
        item({ description: "Bread", suggestedCategoryKey: "groceries", amountMinorUnits: 100, confidence: 0.7 }),
        item({ description: "Bus fare", suggestedCategoryKey: "transport", amountMinorUnits: 150, confidence: 0.8 }),
      ], { totalMinorUnits: 450 }),
    );

    expect(draft.splits).toHaveLength(2);
    expect(draft.splits[0]).toMatchObject({
      categoryKey: "groceries",
      newCategory: null,
      amountMinorUnits: 300,
      itemCount: 2,
      lowConfidence: false,
    });
    expect(draft.splits[0]!.confidenceAvg).toBeCloseTo(0.8, 5);
    expect(draft.splits[1]).toMatchObject({
      categoryKey: "transport",
      amountMinorUnits: 150,
      itemCount: 1,
    });
    expect(draft.items).toHaveLength(3); // raw evidence preserved
  });

  it("concept is the merchant, falling back to 'Receipt scan' when the merchant is empty", () => {
    const draft = buildReceiptDraft(extraction([item()]));
    expect(draft.concept).toBe("Mercadona");
    expect(draft.merchant).toBe("Mercadona");

    const noMerchant = buildReceiptDraft(
      extraction([item()], { merchant: "" }),
    );
    expect(noMerchant.concept).toBe("Receipt scan");
    expect(noMerchant.merchant).toBeNull();
  });

  it("passes currency/businessDate/totalMinorUnits through; nulls when undetected (user picks in review)", () => {
    const draft = buildReceiptDraft(
      extraction([item()], {
        businessDate: null,
        currency: null,
        totalMinorUnits: null,
      }),
    );
    expect(draft.currency).toBeNull();
    expect(draft.businessDate).toBeNull();
    expect(draft.totalMinorUnits).toBeNull();
    expect(draft.totalMismatch).toBe(false);
  });

  it("flags totalMismatch when sum(items) ≠ totalMinorUnits and keeps both values (never silently fixed)", () => {
    const draft = buildReceiptDraft(
      extraction([item({ amountMinorUnits: 150 })], { totalMinorUnits: 999 }),
    );
    expect(draft.totalMismatch).toBe(true);
    expect(draft.totalMinorUnits).toBe(999);
    expect(draft.splits[0]!.amountMinorUnits).toBe(150);

    const ok = buildReceiptDraft(
      extraction([item({ amountMinorUnits: 150 })], { totalMinorUnits: 150 }),
    );
    expect(ok.totalMismatch).toBe(false);
  });

  it(`confidence < ${RECEIPT_LOW_CONFIDENCE} drops the suggestion into an uncategorized split flagged lowConfidence`, () => {
    const draft = buildReceiptDraft(
      extraction([
        item({
          suggestedCategoryKey: "groceries",
          confidence: RECEIPT_LOW_CONFIDENCE - 0.01,
          amountMinorUnits: 150,
        }),
      ]),
    );
    expect(draft.splits).toHaveLength(1);
    expect(draft.splits[0]).toMatchObject({
      categoryKey: null,
      newCategory: null,
      lowConfidence: true,
      amountMinorUnits: 150,
    });
  });

  it("low-confidence and high-confidence unsuggested items merge into one uncategorized split", () => {
    const draft = buildReceiptDraft(
      extraction([
        item({ confidence: 0.1, amountMinorUnits: 100 }),
        item({ confidence: 0.9, amountMinorUnits: 50 }), // high conf but no suggestion
      ]),
    );
    expect(draft.splits).toHaveLength(1);
    expect(draft.splits[0]!.categoryKey).toBeNull();
    expect(draft.splits[0]!.lowConfidence).toBe(true); // any low-confidence item flags it
    expect(draft.splits[0]!.amountMinorUnits).toBe(150);
    expect(draft.splits[0]!.itemCount).toBe(2);
  });

  it("suggestedNewCategory produces a split flagged as a new category proposal (S10 — never auto-created)", () => {
    const draft = buildReceiptDraft(
      extraction([
        item({
          suggestedCategoryKey: null,
          suggestedNewCategory: { name: "Cuidado personal", nature: "discretionary" },
          confidence: 0.85,
          amountMinorUnits: 400,
        }),
      ]),
    );
    expect(draft.splits).toHaveLength(1);
    expect(draft.splits[0]).toMatchObject({
      categoryKey: null,
      newCategory: { name: "Cuidado personal", nature: "discretionary" },
      amountMinorUnits: 400,
      lowConfidence: false,
    });
  });

  it("keeps split order stable (first-seen) and round-trips through JSON for draft_payload storage", () => {
    const draft: ReceiptDraftPayload = buildReceiptDraft(
      extraction([
        item({ suggestedCategoryKey: "b_key", amountMinorUnits: 10 }),
        item({ suggestedCategoryKey: "a_key", amountMinorUnits: 20 }),
      ]),
    );
    expect(draft.splits.map((s) => s.categoryKey)).toEqual(["b_key", "a_key"]);
    expect(JSON.parse(JSON.stringify(draft))).toEqual(draft);
  });
});

describe("ReceiptScan pipeline transitions (T4+T5)", () => {
  const wsResult = WorkspaceId.create("ws-1");
  if (!wsResult.ok) throw new Error("workspace setup failed");
  const WS = wsResult.value;
  const T0 = new Date("2026-11-10T12:00:00.000Z");
  const T1 = new Date("2026-11-10T12:00:05.000Z");

  function pendingScan(): ReceiptScan {
    const result = ReceiptScan.quarantine({
      id: "scan-1",
      workspaceId: WS,
      uploaderSubject: "user-1",
      storageKey: "quarantine/ws-1/scan-1.jpg",
      originalFilename: "ticket.jpg",
      mimeType: "image/jpeg",
      sizeBytes: 10,
      now: T0,
    });
    if (!result.ok) throw new Error("scan setup failed");
    return result.value;
  }

  it("markDraftReady stores extracted + draft payloads and bumps status/updatedAt", () => {
    const scan = pendingScan();
    scan.markDraftReady(
      { merchant: "Mercadona" },
      { concept: "Mercadona", splits: [] },
      T1,
    );
    expect(scan.status).toBe("draft_ready");
    expect(scan.extractedPayload).toEqual({ merchant: "Mercadona" });
    expect(scan.draftPayload).toEqual({ concept: "Mercadona", splits: [] });
    expect(scan.error).toBeNull();
    expect(scan.updatedAt).toBe(T1);
  });

  it("markFailed records the error and is terminal for the pipeline", () => {
    const scan = pendingScan();
    scan.markFailed("RECEIPT_SCAN_FAILED: bad json", T1);
    expect(scan.status).toBe("failed");
    expect(scan.error).toBe("RECEIPT_SCAN_FAILED: bad json");
    expect(scan.updatedAt).toBe(T1);
  });
});
