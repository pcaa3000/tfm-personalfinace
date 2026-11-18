import { describe, expect, it, vi } from "vitest";

import type { ReceiptDraftPayload, ReceiptScanView } from "./receipt-draft";
import {
  ReceiptPollTimeoutError,
  ReceiptScanFailedError,
  uploadAndAwaitDraft,
} from "./receipt-scan-flow";

const file = new File(["bytes"], "ticket.jpg", { type: "image/jpeg" });

function scanView(
  status: ReceiptScanView["status"],
  error: string | null = null,
): ReceiptScanView {
  return {
    id: "rc-1",
    workspaceId: "ws-1",
    status,
    originalFilename: "ticket.jpg",
    mimeType: "image/jpeg",
    sizeBytes: 5,
    transactionId: null,
    error,
    createdAt: "2026-10-03T00:00:00.000Z",
    updatedAt: "2026-10-03T00:00:00.000Z",
  };
}

const draft: ReceiptDraftPayload = {
  merchant: "Plaza Vea",
  concept: "Plaza Vea",
  businessDate: "2026-10-03",
  currency: "PEN",
  totalMinorUnits: 5000,
  totalMismatch: false,
  splits: [
    {
      categoryKey: "food",
      newCategory: null,
      amountMinorUnits: 5000,
      itemCount: 2,
      confidenceAvg: 0.9,
      lowConfidence: false,
    },
  ],
  items: [],
};

describe("uploadAndAwaitDraft (receipt-scan-drafts T7, S1+S2)", () => {
  it("uploads, reports phases, polls until draft_ready and returns the draft", async () => {
    const phases: string[] = [];
    const getScan = vi
      .fn()
      .mockResolvedValueOnce(scanView("pending"))
      .mockResolvedValueOnce(scanView("extracted"))
      .mockResolvedValueOnce(scanView("draft_ready"));
    const getDraft = vi.fn(async () => draft);
    const upload = vi.fn(async () => scanView("pending"));
    const sleep = vi.fn(async () => {});

    const result = await uploadAndAwaitDraft(file, {
      upload,
      getScan,
      getDraft,
      sleep,
      now: () => 0,
      pollIntervalMs: 2000,
      timeoutMs: 60_000,
      onPhase: (phase) => phases.push(phase),
    });

    expect(phases).toEqual(["uploading", "analyzing"]);
    expect(upload).toHaveBeenCalledWith(file);
    expect(getScan).toHaveBeenCalledTimes(3);
    expect(getDraft).toHaveBeenCalledWith("rc-1");
    expect(result.scan.status).toBe("draft_ready");
    expect(result.draft).toBe(draft);
  });

  it("rejects with ReceiptScanFailedError when the pipeline marks the scan failed", async () => {
    const upload = vi.fn(async () => scanView("pending"));
    const getScan = vi.fn(async () =>
      scanView("failed", "gemini quota exceeded"),
    );

    const error = await uploadAndAwaitDraft(file, {
      upload,
      getScan,
      getDraft: vi.fn(),
      sleep: async () => {},
      now: () => 0,
    }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ReceiptScanFailedError);
    expect((error as ReceiptScanFailedError).scanError).toBe(
      "gemini quota exceeded",
    );
  });

  it("rejects when the scan reaches a terminal status without a draft", async () => {
    const upload = vi.fn(async () => scanView("pending"));
    const getScan = vi.fn(async () => scanView("rejected"));

    const error = await uploadAndAwaitDraft(file, {
      upload,
      getScan,
      getDraft: vi.fn(),
      sleep: async () => {},
      now: () => 0,
    }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ReceiptScanFailedError);
  });

  it("rejects with ReceiptPollTimeoutError after the polling budget", async () => {
    let clock = 0;
    const upload = vi.fn(async () => scanView("pending"));
    const getScan = vi.fn(async () => scanView("pending"));

    const error = await uploadAndAwaitDraft(file, {
      upload,
      getScan,
      getDraft: vi.fn(),
      sleep: async (ms: number) => {
        clock += ms;
      },
      now: () => clock,
      pollIntervalMs: 2000,
      timeoutMs: 5000,
    }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ReceiptPollTimeoutError);
  });

  it("propagates a network TypeError so the UI can show the offline message", async () => {
    const upload = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });

    const error = await uploadAndAwaitDraft(file, {
      upload,
      getScan: vi.fn(),
      getDraft: vi.fn(),
      sleep: async () => {},
      now: () => 0,
    }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(TypeError);
  });
});
