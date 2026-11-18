import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";

import {
  DomainError,
  WorkspaceId,
  err,
  ok,
  type Result,
} from "../../modules/shared-kernel/index.js";
import type {
  ConfirmReceiptDraftCommand,
  ConfirmReceiptDraftResult,
  ReceiptDraftPayload,
  ReceiptScanView,
  UploadReceiptCommand,
} from "../../modules/receipts/index.js";
import { httpErrorHandler } from "../middleware/errors.js";
import type { HonoEnv } from "../middleware/auth.js";
import { registerReceiptRoutes } from "./receipts.js";

const wsResult = WorkspaceId.create("ws-1");
if (!wsResult.ok) throw new Error("workspace setup failed");
const WS = wsResult.value;

const JPEG = Uint8Array.from([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01,
]);

const DRAFT: ReceiptDraftPayload = {
  merchant: "Bodega Central",
  concept: "Bodega Central",
  businessDate: "2026-11-10",
  currency: "PEN",
  totalMinorUnits: 2550,
  totalMismatch: false,
  splits: [
    {
      categoryKey: "food",
      newCategory: null,
      amountMinorUnits: 2550,
      itemCount: 2,
      confidenceAvg: 0.9,
      lowConfidence: false,
    },
  ],
  items: [],
};

const CONFIRM_RESULT: ConfirmReceiptDraftResult = {
  transaction: {
    id: "trx-1",
    workspaceId: "ws-1",
    type: "expense",
    amount: "25.50",
    currency: "PEN",
    businessDate: "2026-11-10",
    timezone: "UTC",
    concept: "Bodega Central",
    accountId: "acc-1",
    destinationAccountId: null,
    categoryId: null,
    status: "confirmed",
    origin: "ticket",
    confirmedAt: "2026-11-10T13:00:00.000Z",
    revisionCount: 0,
    splits: [],
  },
  createdCategories: [
    {
      id: "cat-new",
      key: "cuidado_personal",
      label: "Cuidado personal",
      nature: "essential",
      custom: true,
    },
  ],
};

const SCAN_VIEW: ReceiptScanView = {
  id: "scan-1",
  workspaceId: "ws-1",
  status: "pending",
  originalFilename: "ticket.jpg",
  mimeType: "image/jpeg",
  sizeBytes: JPEG.byteLength,
  transactionId: null,
  error: null,
  createdAt: "2026-11-10T12:00:00.000Z",
  updatedAt: "2026-11-10T12:00:00.000Z",
};

function buildApp(options: {
  authenticated?: boolean;
  uploadResult?: ReturnType<typeof ok<ReceiptScanView>> | ReturnType<typeof err<DomainError>>;
} = {}) {
  const authenticated = options.authenticated ?? true;
  const deps = {
    callerResolver: {
      resolve: vi.fn(async () =>
        authenticated ? { issuer: "test", subject: "user-1" } : null,
      ),
    },
    workspaceContext: {
      resolve: vi.fn(async () => ({
        workspaceId: WS,
        locale: "en",
        timezone: "UTC",
        defaultCurrency: "PEN",
      })),
    },
    uploadReceipt: {
      execute: vi.fn(
        async (_command: UploadReceiptCommand) =>
          options.uploadResult ?? ok(SCAN_VIEW),
      ),
    },
    getReceiptScan: {
      execute: vi.fn(async (workspaceId: WorkspaceId, id: string) =>
        id === "scan-1" ? ok(SCAN_VIEW) : err(new DomainError("RECEIPT_NOT_FOUND", "not found")),
      ),
    },
    getReceiptFile: {
      execute: vi.fn(async (workspaceId: WorkspaceId, id: string) =>
        id === "scan-1"
          ? ok({ bytes: JPEG, mimeType: "image/jpeg", originalFilename: "ticket.jpg" })
          : err(new DomainError("RECEIPT_NOT_FOUND", "not found")),
      ),
    },
    getReceiptDraft: {
      execute: vi.fn(async (workspaceId: WorkspaceId, id: string) =>
        id === "scan-1"
          ? ok(DRAFT)
          : err(new DomainError("RECEIPT_NOT_FOUND", "not found")),
      ),
    },
    confirmReceiptDraft: {
      execute: vi.fn(
        async (
          _command: ConfirmReceiptDraftCommand,
        ): Promise<Result<ConfirmReceiptDraftResult, DomainError>> =>
          ok(CONFIRM_RESULT),
      ),
    },
    rejectReceiptScan: {
      execute: vi.fn(async (workspaceId: WorkspaceId, id: string) =>
        id === "scan-1"
          ? ok({ ...SCAN_VIEW, status: "rejected" })
          : err(new DomainError("RECEIPT_NOT_FOUND", "not found")),
      ),
    },
  };
  const app = new Hono<HonoEnv>();
  registerReceiptRoutes(app, deps);
  app.onError(httpErrorHandler());
  return { app, deps };
}

function uploadRequest(file?: { bytes: Uint8Array; name: string; type: string }) {
  const form = new FormData();
  if (file) {
    form.append("file", new File([file.bytes], file.name, { type: file.type }));
  }
  return {
    method: "POST",
    body: form,
    headers: { "x-dev-user": "t" },
  } satisfies RequestInit;
}

describe("POST /api/v1/receipts (receipt-scan-drafts T3, S1+S9)", () => {
  it("accepts a multipart image and returns 201 with the pending scan", async () => {
    const { app, deps } = buildApp();

    const res = await app.request(
      "/api/v1/receipts",
      uploadRequest({ bytes: JPEG, name: "ticket.jpg", type: "image/jpeg" }),
    );

    expect(res.status).toBe(201);
    expect(await res.json()).toEqual(SCAN_VIEW);
    expect(deps.uploadReceipt.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: WS,
        uploaderSubject: "user-1",
        originalFilename: "ticket.jpg",
      }),
    );
    const [command] = vi.mocked(deps.uploadReceipt.execute).mock.calls[0]!;
    expect(command!.bytes).toBeInstanceOf(Uint8Array);
    expect(command!.bytes).toEqual(JPEG);
  });

  it("rejects a multipart body with no file with 400 INVALID_BODY", async () => {
    const { app, deps } = buildApp();

    const res = await app.request("/api/v1/receipts", uploadRequest());

    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("INVALID_BODY");
    expect(deps.uploadReceipt.execute).not.toHaveBeenCalled();
  });

  it.each([
    ["RECEIPT_TYPE_NOT_ALLOWED"],
    ["RECEIPT_TOO_LARGE"],
    ["RECEIPT_EMPTY"],
  ])("maps use-case error %s to a 400 {code, message} envelope", async (code) => {
    const { app } = buildApp({
      uploadResult: err(new DomainError(code, `${code} detail`)),
    });

    const res = await app.request(
      "/api/v1/receipts",
      uploadRequest({ bytes: JPEG, name: "x.jpg", type: "image/jpeg" }),
    );

    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string; message: string };
    expect(body).toEqual({ code, message: `${code} detail` });
  });

  it("rejects unauthenticated uploads with 401", async () => {
    const { app, deps } = buildApp({ authenticated: false });

    const res = await app.request(
      "/api/v1/receipts",
      uploadRequest({ bytes: JPEG, name: "x.jpg", type: "image/jpeg" }),
    );

    expect(res.status).toBe(401);
    expect(deps.uploadReceipt.execute).not.toHaveBeenCalled();
  });
});

describe("GET /api/v1/receipts/:id (polling)", () => {
  it("returns the scan row for the workspace", async () => {
    const { app } = buildApp();

    const res = await app.request("/api/v1/receipts/scan-1", {
      headers: { "x-dev-user": "t" },
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(SCAN_VIEW);
  });

  it("returns 404 RECEIPT_NOT_FOUND for unknown or foreign scans", async () => {
    const { app } = buildApp();

    const res = await app.request("/api/v1/receipts/nope", {
      headers: { "x-dev-user": "t" },
    });

    expect(res.status).toBe(404);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("RECEIPT_NOT_FOUND");
  });
});

describe("GET /api/v1/receipts/:id/file", () => {
  it("streams the stored bytes with the sniffed content type", async () => {
    const { app } = buildApp();

    const res = await app.request("/api/v1/receipts/scan-1/file", {
      headers: { "x-dev-user": "t" },
    });

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("image/jpeg");
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(JPEG);
  });

  it("returns 404 for a missing file", async () => {
    const { app } = buildApp();

    const res = await app.request("/api/v1/receipts/nope/file", {
      headers: { "x-dev-user": "t" },
    });

    expect(res.status).toBe(404);
  });
});

describe("GET /api/v1/receipts/:id/draft (T6, S2+S7)", () => {
  it("returns the draft payload for the review UI", async () => {
    const { app } = buildApp();

    const res = await app.request("/api/v1/receipts/scan-1/draft", {
      headers: { "x-dev-user": "t" },
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(DRAFT);
  });

  it("maps RECEIPT_NOT_READY to 409 while the scan is not draft_ready", async () => {
    const { app, deps } = buildApp();
    vi.mocked(deps.getReceiptDraft.execute).mockResolvedValueOnce(
      err(new DomainError("RECEIPT_NOT_READY", "still pending")),
    );

    const res = await app.request("/api/v1/receipts/scan-1/draft", {
      headers: { "x-dev-user": "t" },
    });

    expect(res.status).toBe(409);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("RECEIPT_NOT_READY");
  });

  it("returns 404 for a missing scan", async () => {
    const { app } = buildApp();

    const res = await app.request("/api/v1/receipts/nope/draft", {
      headers: { "x-dev-user": "t" },
    });

    expect(res.status).toBe(404);
  });
});

describe("POST /api/v1/receipts/:id/confirm (T6, S2+S4+S7+S10)", () => {
  function confirmBody(overrides: Record<string, unknown> = {}) {
    return {
      accountId: "acc-1",
      type: "expense",
      idempotencyKey: "confirm-scan-1",
      splits: [
        { categoryId: "cat-food", amountMinorUnits: 2000 },
        {
          newCategory: { name: "Cuidado personal", nature: "essential" },
          amountMinorUnits: 550,
        },
      ],
      ...overrides,
    };
  }

  function confirmRequest(body: unknown) {
    return {
      method: "POST",
      headers: { "x-dev-user": "t", "content-type": "application/json" },
      body: JSON.stringify(body),
    } satisfies RequestInit;
  }

  it("returns 201 with the transaction and the created categories", async () => {
    const { app, deps } = buildApp();

    const res = await app.request(
      "/api/v1/receipts/scan-1/confirm",
      confirmRequest(confirmBody()),
    );

    expect(res.status).toBe(201);
    expect(await res.json()).toEqual(CONFIRM_RESULT);
    expect(deps.confirmReceiptDraft.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: WS,
        receiptId: "scan-1",
        accountId: "acc-1",
        type: "expense",
        idempotencyKey: "confirm-scan-1",
        timezone: "UTC",
        defaultCurrency: "PEN",
        actor: "user-1",
        splits: [
          {
            categoryId: "cat-food",
            newCategory: null,
            amountMinorUnits: 2000,
          },
          {
            categoryId: null,
            newCategory: { name: "Cuidado personal", nature: "essential" },
            amountMinorUnits: 550,
          },
        ],
      }),
    );
  });

  it("rejects a confirm without idempotencyKey with IDEMPOTENCY_KEY_REQUIRED", async () => {
    const { app, deps } = buildApp();
    const body = confirmBody();
    delete (body as Record<string, unknown>).idempotencyKey;

    const res = await app.request(
      "/api/v1/receipts/scan-1/confirm",
      confirmRequest(body),
    );

    expect(res.status).toBe(400);
    const parsed = (await res.json()) as { code: string };
    expect(parsed.code).toBe("IDEMPOTENCY_KEY_REQUIRED");
    expect(deps.confirmReceiptDraft.execute).not.toHaveBeenCalled();
  });

  it("rejects a split carrying both categoryId and newCategory with INVALID_BODY", async () => {
    const { app } = buildApp();

    const res = await app.request(
      "/api/v1/receipts/scan-1/confirm",
      confirmRequest(
        confirmBody({
          splits: [
            {
              categoryId: "cat-food",
              newCategory: { name: "X", nature: "essential" },
              amountMinorUnits: 100,
            },
          ],
        }),
      ),
    );

    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("INVALID_BODY");
  });

  it("rejects an empty splits collection with INVALID_BODY", async () => {
    const { app } = buildApp();

    const res = await app.request(
      "/api/v1/receipts/scan-1/confirm",
      confirmRequest(confirmBody({ splits: [] })),
    );

    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("INVALID_BODY");
  });

  it("maps RECEIPT_NOT_READY to 409 when the scan is not draft_ready", async () => {
    const { app, deps } = buildApp();
    vi.mocked(deps.confirmReceiptDraft.execute).mockResolvedValueOnce(
      err(new DomainError("RECEIPT_NOT_READY", "not ready")),
    );

    const res = await app.request(
      "/api/v1/receipts/scan-1/confirm",
      confirmRequest(confirmBody()),
    );

    expect(res.status).toBe(409);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("RECEIPT_NOT_READY");
  });

  it("maps RECEIPT_NOT_FOUND to 404", async () => {
    const { app, deps } = buildApp();
    vi.mocked(deps.confirmReceiptDraft.execute).mockResolvedValueOnce(
      err(new DomainError("RECEIPT_NOT_FOUND", "not found")),
    );

    const res = await app.request(
      "/api/v1/receipts/scan-1/confirm",
      confirmRequest(confirmBody()),
    );

    expect(res.status).toBe(404);
  });
});

describe("POST /api/v1/receipts/:id/reject (T6, S2)", () => {
  it("marks the scan rejected and returns the scan view", async () => {
    const { app } = buildApp();

    const res = await app.request("/api/v1/receipts/scan-1/reject", {
      method: "POST",
      headers: { "x-dev-user": "t" },
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as ReceiptScanView;
    expect(body.status).toBe("rejected");
  });

  it("maps RECEIPT_ALREADY_FINAL to 409 on a terminal scan", async () => {
    const { app, deps } = buildApp();
    vi.mocked(deps.rejectReceiptScan.execute).mockResolvedValueOnce(
      err(new DomainError("RECEIPT_ALREADY_FINAL", "already confirmed")),
    );

    const res = await app.request("/api/v1/receipts/scan-1/reject", {
      method: "POST",
      headers: { "x-dev-user": "t" },
    });

    expect(res.status).toBe(409);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("RECEIPT_ALREADY_FINAL");
  });

  it("returns 404 for a missing scan", async () => {
    const { app } = buildApp();

    const res = await app.request("/api/v1/receipts/nope/reject", {
      method: "POST",
      headers: { "x-dev-user": "t" },
    });

    expect(res.status).toBe(404);
  });
});
