import { describe, expect, it, vi } from "vitest";

import {
  DomainError,
  err,
  ok,
  type Result,
} from "../modules/shared-kernel/index.js";
import {
  ReceiptScan,
  type ReceiptScanStatus,
  type ReceiptScanState,
} from "../modules/receipts/index.js";
import type { ReceiptScanExtraction } from "../modules/receipts/domain/receipt-scan-extraction.js";
import type { ReceiptScanRepositoryPort } from "../modules/receipts/index.js";
import type { ReceiptStoragePort } from "../modules/receipts/index.js";
import type { ReceiptScanPort } from "../modules/receipts/index.js";
import type {
  CategoryCatalogPort,
  CategoryView,
} from "../modules/categorization/index.js";
import { handleReceiptScan, type ReceiptScanJob } from "./receipt-scan.js";

const WS = "ws-1";
const NOW = new Date("2026-11-10T12:00:00.000Z");

const CATALOG: CategoryView[] = [
  { id: "c1", key: "groceries", label: "Groceries", nature: "essential", custom: true },
];

const EXTRACTION: ReceiptScanExtraction = {
  merchant: "Mercadona",
  businessDate: "2026-11-10",
  currency: "EUR",
  totalMinorUnits: 450,
  items: [
    {
      description: "Milk 1L",
      amountMinorUnits: 300,
      suggestedCategoryKey: "groceries",
      suggestedNewCategory: null,
      confidence: 0.9,
    },
    {
      description: "Bread",
      amountMinorUnits: 150,
      suggestedCategoryKey: "groceries",
      suggestedNewCategory: null,
      confidence: 0.8,
    },
  ],
};

function scanState(status: ReceiptScanStatus): ReceiptScanState {
  return {
    id: "scan-1",
    workspaceId: WS,
    uploaderSubject: "user-1",
    storageKey: `quarantine/${WS}/scan-1.jpg`,
    originalFilename: "ticket.jpg",
    mimeType: "image/jpeg",
    sizeBytes: 10,
    status,
    extractedPayload: null,
    draftPayload: null,
    transactionId: null,
    error: null,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function makeDeps(options: {
  status?: ReceiptScanStatus;
  found?: boolean;
  bytes?: Uint8Array | null;
  scanResult?: Result<ReceiptScanExtraction, DomainError>;
}) {
  const saved: ReceiptScan[] = [];
  const scan =
    options.found === false
      ? null
      : ReceiptScan.reconstitute(scanState(options.status ?? "pending"));
  const scans: ReceiptScanRepositoryPort = {
    save: vi.fn(async (s: ReceiptScan) => {
      saved.push(s);
    }),
    findById: vi.fn(async () => scan),
  };
  const storage: ReceiptStoragePort = {
    save: vi.fn(async (key: string) => key),
    open: vi.fn(async () =>
      "bytes" in options ? options.bytes! : Uint8Array.from([1, 2, 3]),
    ),
  };
  const categories: CategoryCatalogPort = {
    listForWorkspace: vi.fn(async () => CATALOG),
  };
  const scanner: ReceiptScanPort = {
    scan: vi.fn(async () => options.scanResult ?? ok(EXTRACTION)),
  };
  const deps = { scans, storage, categories, scanner, clock: { now: () => NOW } };
  return { deps, scans, storage, categories, scanner, saved, scan };
}

const JOB: ReceiptScanJob = { receiptId: "scan-1", workspaceId: WS };

describe("handleReceiptScan — receipt-scan pg-boss job (T4+T5, S3+S5+S6+S9+S10)", () => {
  it("pending scan → stores raw extraction + grouped draft payload, status draft_ready", async () => {
    const { deps, saved, scanner, storage, categories } = makeDeps({});

    await handleReceiptScan(deps, JOB);

    expect(storage.open).toHaveBeenCalledWith("quarantine/ws-1/scan-1.jpg");
    expect(categories.listForWorkspace).toHaveBeenCalled();
    expect(scanner.scan).toHaveBeenCalledWith(
      expect.any(Uint8Array),
      "image/jpeg",
      CATALOG,
    );
    expect(saved).toHaveLength(1);
    const done = saved[0]!;
    expect(done.status).toBe("draft_ready");
    expect(done.extractedPayload).toEqual(EXTRACTION);
    const draft = done.draftPayload as {
      concept: string;
      currency: string;
      totalMinorUnits: number;
      totalMismatch: boolean;
      splits: Array<Record<string, unknown>>;
      items: unknown[];
    };
    expect(draft.concept).toBe("Mercadona");
    expect(draft.currency).toBe("EUR");
    expect(draft.totalMinorUnits).toBe(450);
    expect(draft.totalMismatch).toBe(false);
    expect(draft.splits).toHaveLength(1);
    expect(draft.splits[0]).toMatchObject({
      categoryKey: "groceries",
      amountMinorUnits: 450,
      itemCount: 2,
    });
    expect(draft.items).toHaveLength(2);
    expect(done.error).toBeNull();
  });

  it("skips a scan that is not pending (at-least-once redelivery is idempotent)", async () => {
    const { deps, scans, storage, scanner, saved } = makeDeps({
      status: "draft_ready",
    });

    await handleReceiptScan(deps, JOB);

    expect(storage.open).not.toHaveBeenCalled();
    expect(scanner.scan).not.toHaveBeenCalled();
    expect(scans.save).not.toHaveBeenCalled();
    expect(saved).toHaveLength(0);
  });

  it("missing scan row → logs and returns without touching the pipeline", async () => {
    const { deps, storage, scanner, scans } = makeDeps({ found: false });
    const log = vi.spyOn(console, "error").mockImplementation(() => {});

    await handleReceiptScan(deps, JOB);

    expect(storage.open).not.toHaveBeenCalled();
    expect(scanner.scan).not.toHaveBeenCalled();
    expect(scans.save).not.toHaveBeenCalled();
    log.mockRestore();
  });

  it("missing object bytes → status failed with error, row still saved", async () => {
    const { deps, saved, scanner } = makeDeps({ bytes: null });

    await handleReceiptScan(deps, JOB);

    expect(scanner.scan).not.toHaveBeenCalled();
    expect(saved).toHaveLength(1);
    expect(saved[0]!.status).toBe("failed");
    expect(saved[0]!.error).toMatch(/storage|missing/i);
  });

  it("scanner error → status failed with the domain error recorded", async () => {
    const { deps, saved } = makeDeps({
      scanResult: err(new DomainError("RECEIPT_SCAN_FAILED", "bad json")),
    });

    await handleReceiptScan(deps, JOB);

    expect(saved).toHaveLength(1);
    expect(saved[0]!.status).toBe("failed");
    expect(saved[0]!.error).toContain("RECEIPT_SCAN_FAILED");
    expect(saved[0]!.error).toContain("bad json");
  });

  it("unexpected throw → marks failed instead of letting it escape the handler", async () => {
    const { deps, saved, scanner } = makeDeps({});
    vi.mocked(scanner.scan).mockRejectedValueOnce(new Error("boom"));

    await expect(handleReceiptScan(deps, JOB)).resolves.toBeUndefined();
    expect(saved[0]!.status).toBe("failed");
    expect(saved[0]!.error).toContain("boom");
  });

  it("low-confidence item lands in the uncategorized split flagged for review (S3)", async () => {
    const extraction: ReceiptScanExtraction = {
      ...EXTRACTION,
      totalMinorUnits: 100,
      items: [
        {
          description: "??",
          amountMinorUnits: 100,
          suggestedCategoryKey: "groceries",
          suggestedNewCategory: null,
          confidence: 0.4,
        },
      ],
    };
    const { deps, saved } = makeDeps({ scanResult: ok(extraction) });

    await handleReceiptScan(deps, JOB);

    const draft = saved[0]!.draftPayload as {
      splits: Array<{ categoryKey: string | null; lowConfidence: boolean }>;
    };
    expect(draft.splits[0]).toMatchObject({
      categoryKey: null,
      lowConfidence: true,
    });
  });

  it("new-category proposal produces a flagged split — never a created category (S10)", async () => {
    const extraction: ReceiptScanExtraction = {
      ...EXTRACTION,
      items: [
        {
          description: "Shampoo",
          amountMinorUnits: 450,
          suggestedCategoryKey: null,
          suggestedNewCategory: { name: "Cuidado personal", nature: "discretionary" },
          confidence: 0.9,
        },
      ],
    };
    const { deps, saved } = makeDeps({ scanResult: ok(extraction) });

    await handleReceiptScan(deps, JOB);

    const draft = saved[0]!.draftPayload as {
      splits: Array<{ categoryKey: string | null; newCategory: unknown }>;
    };
    expect(draft.splits[0]).toMatchObject({
      categoryKey: null,
      newCategory: { name: "Cuidado personal", nature: "discretionary" },
    });
  });

  it("totalMismatch flag set when items do not add up to the receipt total", async () => {
    const extraction: ReceiptScanExtraction = {
      ...EXTRACTION,
      totalMinorUnits: 999,
    };
    const { deps, saved } = makeDeps({ scanResult: ok(extraction) });

    await handleReceiptScan(deps, JOB);

    const draft = saved[0]!.draftPayload as { totalMismatch: boolean };
    expect(draft.totalMismatch).toBe(true);
    expect(saved[0]!.status).toBe("draft_ready");
  });
});
