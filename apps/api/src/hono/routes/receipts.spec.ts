import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";

import {
  DomainError,
  WorkspaceId,
  err,
  ok,
  type Result,
} from "../../modules/shared-kernel/index.js";
import {
  CryptoFileHasher,
  UploadReceiptUseCase,
  encodeReceiptScanCursor,
  type ConfirmReceiptDraftCommand,
  type ConfirmReceiptDraftResult,
  type ReceiptDraftPayload,
  type ReceiptFileHashPort,
  type ReceiptScan,
  type ReceiptScanDispatcher,
  type ReceiptScanListItem,
  type ReceiptScanListPage,
  type ReceiptScanRepositoryPort,
  type ReceiptScanView,
  type ReceiptStoragePort,
  type UploadReceiptCommand,
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
    originReference: "scan-1",
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

/** receipt-review-link T1 (S1): the trimmed list-item view. */
const LIST_ITEM: ReceiptScanListItem = {
  id: "scan-1",
  status: "pending",
  originalFilename: "ticket.jpg",
  fileMimeType: "image/jpeg",
  createdAt: "2026-11-10T12:00:00.000Z",
  transactionId: null,
  expiresAt: "2026-12-10T12:00:00.000Z",
  mediaDeletedAt: null,
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
  expiresAt: "2026-12-10T12:00:00.000Z",
  mediaDeletedAt: null,
};

function buildApp(options: {
  authenticated?: boolean;
  subject?: string;
  /** demo-maria-session T2 (S7): the wired DEMO_SUBJECT. */
  demoSubject?: string;
  uploadResult?: ReturnType<typeof ok<ReceiptScanView>> | ReturnType<typeof err<DomainError>>;
  /** T13: inject the real use case (dedup specs) instead of the mock. */
  uploadReceipt?: Pick<UploadReceiptUseCase, "execute">;
} = {}) {
  const authenticated = options.authenticated ?? true;
  const deps = {
    callerResolver: {
      resolve: vi.fn(async () =>
        authenticated
          ? { issuer: "test", subject: options.subject ?? "user-1" }
          : null,
      ),
    },
    ...(options.demoSubject === undefined
      ? {}
      : { demoSubject: options.demoSubject }),
    workspaceContext: {
      resolve: vi.fn(async () => ({
        workspaceId: WS,
        timezone: "UTC",
        defaultCurrency: "PEN",
      })),
    },
    uploadReceipt: options.uploadReceipt ?? {
      execute: vi.fn(
        async (_command: UploadReceiptCommand) =>
          options.uploadResult ?? ok(SCAN_VIEW),
      ),
    },
    listReceiptScans: {
      execute: vi.fn(
        async (_workspaceId: WorkspaceId): Promise<ReceiptScanListPage> => ({
          items: [LIST_ITEM],
          nextCursor: null,
        }),
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
    deleteReceiptFile: {
      execute: vi.fn(async (workspaceId: WorkspaceId, id: string) =>
        id === "scan-1"
          ? ok({ ...SCAN_VIEW, mediaDeletedAt: "2026-11-20T12:00:00.000Z" })
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
    retryReceiptScan: {
      execute: vi.fn(async (workspaceId: WorkspaceId, id: string) =>
        id === "scan-1"
          ? ok({ ...SCAN_VIEW, status: "pending" })
          : err(new DomainError("RECEIPT_NOT_FOUND", "not found")),
      ),
    },
    purgeReceiptMedia: {
      execute: vi.fn(async (_workspaceId: WorkspaceId, _days: number) => 2),
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

/**
 * T13 (S12): the dedup behavior lives in the real use case — this app
 * wires it with in-memory fakes so the route spec exercises the actual
 * SHA-256 + lookup path instead of a mocked execute.
 */
function buildDedupApp() {
  const storedById = new Map<string, ReceiptScan>();
  const storedByHash = new Map<string, ReceiptScan>();
  const storage: ReceiptStoragePort = {
    save: vi.fn(async (key: string) => key),
    open: vi.fn(async () => null),
    delete: vi.fn(async () => undefined),
  };
  const scans: ReceiptScanRepositoryPort = {
    save: vi.fn(async (scan: ReceiptScan) => {
      storedById.set(scan.id, scan);
      if (scan.fileHash) {
        storedByHash.set(`${scan.workspaceId.value}:${scan.fileHash}`, scan);
      }
    }),
    findById: vi.fn(async (workspaceId: WorkspaceId, id: string) => {
      const scan = storedById.get(id) ?? null;
      return scan && scan.workspaceId.value === workspaceId.value
        ? scan
        : null;
    }),
  };
  const fileHashes: ReceiptFileHashPort = {
    findByFileHash: vi.fn(
      async (workspaceId: WorkspaceId, fileHash: string) =>
        storedByHash.get(`${workspaceId.value}:${fileHash}`) ?? null,
    ),
  };
  const dispatcher: ReceiptScanDispatcher = {
    enqueueScan: vi.fn(async () => undefined),
  };
  let nextId = 0;
  const { app } = buildApp({
    uploadReceipt: new UploadReceiptUseCase(
      storage,
      scans,
      fileHashes,
      new CryptoFileHasher(),
      dispatcher,
      { now: () => new Date("2026-11-10T12:00:00.000Z") },
      { next: () => `scan-${++nextId}` },
      { maxBytes: 1024 },
    ),
  });
  return { app, storage, scans, dispatcher, storedById };
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

  it("duplicate upload of the same bytes returns the same scan id without storing again (T13, S12)", async () => {
    const { app, storage, scans, dispatcher, storedById } = buildDedupApp();

    const first = await app.request(
      "/api/v1/receipts",
      uploadRequest({ bytes: JPEG, name: "a.jpg", type: "image/jpeg" }),
    );
    const second = await app.request(
      "/api/v1/receipts",
      uploadRequest({ bytes: JPEG, name: "b.jpg", type: "image/jpeg" }),
    );

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    const firstBody = (await first.json()) as { id: string };
    const secondBody = (await second.json()) as { id: string };
    expect(secondBody.id).toBe(firstBody.id);

    // Idempotent: exactly one stored object, one row, one job.
    expect(storage.save).toHaveBeenCalledTimes(1);
    expect(scans.save).toHaveBeenCalledTimes(1);
    expect(dispatcher.enqueueScan).toHaveBeenCalledTimes(1);
    expect(storedById.size).toBe(1);

    // Different bytes → a brand-new scan.
    const third = await app.request(
      "/api/v1/receipts",
      uploadRequest({
        bytes: Uint8Array.from([...JPEG, 0xaa]),
        name: "c.jpg",
        type: "image/jpeg",
      }),
    );
    expect(third.status).toBe(201);
    const thirdBody = (await third.json()) as { id: string };
    expect(thirdBody.id).not.toBe(firstBody.id);
    expect(storage.save).toHaveBeenCalledTimes(2);
  });
});

describe("GET /api/v1/receipts (receipt-review-link T1, S1; T5, S4)", () => {
  it("returns a {items, nextCursor} page with the default limit 50", async () => {
    const { app, deps } = buildApp();

    const res = await app.request("/api/v1/receipts", {
      headers: { "x-dev-user": "t" },
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      items: [LIST_ITEM],
      nextCursor: null,
    });
    expect(deps.listReceiptScans.execute).toHaveBeenCalledWith(WS, {
      limit: 50,
    });
  });

  it("forwards ?limit and a decoded ?cursor to the use case", async () => {
    const { app, deps } = buildApp();
    const cursor = encodeReceiptScanCursor({
      createdAt: new Date("2026-11-10T12:00:00.000Z"),
      id: "scan-1",
    });
    vi.mocked(deps.listReceiptScans.execute).mockResolvedValueOnce({
      items: [],
      nextCursor: null,
    });

    const res = await app.request(
      `/api/v1/receipts?limit=2&cursor=${encodeURIComponent(cursor)}`,
      { headers: { "x-dev-user": "t" } },
    );

    expect(res.status).toBe(200);
    expect(deps.listReceiptScans.execute).toHaveBeenCalledWith(WS, {
      limit: 2,
      after: {
        createdAt: new Date("2026-11-10T12:00:00.000Z"),
        id: "scan-1",
      },
    });
    expect(await res.json()).toEqual({ items: [], nextCursor: null });
  });

  it("echoes the use-case nextCursor so a client can walk pages (T5, S4)", async () => {
    const { app, deps } = buildApp();
    const nextCursor = encodeReceiptScanCursor({
      createdAt: new Date("2026-11-10T12:00:00.000Z"),
      id: "scan-1",
    });
    vi.mocked(deps.listReceiptScans.execute).mockResolvedValueOnce({
      items: [LIST_ITEM],
      nextCursor,
    });

    const res = await app.request("/api/v1/receipts?limit=1", {
      headers: { "x-dev-user": "t" },
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      items: [LIST_ITEM],
      nextCursor,
    });
  });

  it.each([["limit=0"], ["limit=101"], ["limit=abc"], ["limit=1.5"]])(
    "rejects an invalid limit with 400 INVALID_QUERY (%s — pinned, not clamped)",
    async (query) => {
      const { app, deps } = buildApp();

      const res = await app.request(`/api/v1/receipts?${query}`, {
        headers: { "x-dev-user": "t" },
      });

      expect(res.status).toBe(400);
      const body = (await res.json()) as { code: string };
      expect(body.code).toBe("INVALID_QUERY");
      expect(deps.listReceiptScans.execute).not.toHaveBeenCalled();
    },
  );

  it("rejects a malformed cursor with 400 INVALID_CURSOR (pinned, not silently empty)", async () => {
    const { app, deps } = buildApp();

    const res = await app.request("/api/v1/receipts?cursor=not-a-cursor", {
      headers: { "x-dev-user": "t" },
    });

    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("INVALID_CURSOR");
    expect(deps.listReceiptScans.execute).not.toHaveBeenCalled();
  });

  it("rejects unauthenticated requests with 401", async () => {
    const { app, deps } = buildApp({ authenticated: false });

    const res = await app.request("/api/v1/receipts", {
      headers: { "x-dev-user": "t" },
    });

    expect(res.status).toBe(401);
    expect(deps.listReceiptScans.execute).not.toHaveBeenCalled();
  });

  it("does not shadow GET /api/v1/receipts/:id", async () => {
    const { app } = buildApp();

    const res = await app.request("/api/v1/receipts/scan-1", {
      headers: { "x-dev-user": "t" },
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(SCAN_VIEW);
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

  it("maps RECEIPT_MEDIA_DELETED to 410 — media gone is distinct from 404 scan-not-found", async () => {
    const { app, deps } = buildApp();
    vi.mocked(deps.getReceiptFile.execute).mockResolvedValueOnce(
      err(new DomainError("RECEIPT_MEDIA_DELETED", "media deleted")),
    );

    const res = await app.request("/api/v1/receipts/scan-1/file", {
      headers: { "x-dev-user": "t" },
    });

    expect(res.status).toBe(410);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("RECEIPT_MEDIA_DELETED");
  });
});

describe("DELETE /api/v1/receipts/:id/file (receipt-retention-30d T3, S3, CA-012)", () => {
  it("deletes the stored medium and returns 204 — idempotent on repeat", async () => {
    const { app, deps } = buildApp();

    const first = await app.request("/api/v1/receipts/scan-1/file", {
      method: "DELETE",
      headers: { "x-dev-user": "t" },
    });
    const second = await app.request("/api/v1/receipts/scan-1/file", {
      method: "DELETE",
      headers: { "x-dev-user": "t" },
    });

    expect(first.status).toBe(204);
    expect(second.status).toBe(204);
    expect(await first.text()).toBe("");
    expect(deps.deleteReceiptFile.execute).toHaveBeenCalledWith(
      WS,
      "scan-1",
    );
    expect(deps.deleteReceiptFile.execute).toHaveBeenCalledTimes(2);
  });

  it("returns 404 for a missing or foreign scan", async () => {
    const { app } = buildApp();

    const res = await app.request("/api/v1/receipts/nope/file", {
      method: "DELETE",
      headers: { "x-dev-user": "t" },
    });

    expect(res.status).toBe(404);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("RECEIPT_NOT_FOUND");
  });

  it("rejects unauthenticated deletes with 401", async () => {
    const { app, deps } = buildApp({ authenticated: false });

    const res = await app.request("/api/v1/receipts/scan-1/file", {
      method: "DELETE",
      headers: { "x-dev-user": "t" },
    });

    expect(res.status).toBe(401);
    expect(deps.deleteReceiptFile.execute).not.toHaveBeenCalled();
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

describe("POST /api/v1/receipts/purge-media (receipt-retention-30d T6, S6)", () => {
  function purgeRequest(body: unknown) {
    return {
      method: "POST",
      headers: { "x-dev-user": "t", "content-type": "application/json" },
      body: typeof body === "string" ? body : JSON.stringify(body),
    } satisfies RequestInit;
  }

  it.each([[7], [15], [30]])(
    "purges media older than %d days and returns {deleted: n}",
    async (olderThanDays) => {
      const { app, deps } = buildApp();

      const res = await app.request(
        "/api/v1/receipts/purge-media",
        purgeRequest({ olderThanDays }),
      );

      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ deleted: 2 });
      expect(deps.purgeReceiptMedia.execute).toHaveBeenCalledWith(
        WS,
        olderThanDays,
      );
    },
  );

  it("returns {deleted: 0} when nothing qualifies", async () => {
    const { app, deps } = buildApp();
    vi.mocked(deps.purgeReceiptMedia.execute).mockResolvedValueOnce(0);

    const res = await app.request(
      "/api/v1/receipts/purge-media",
      purgeRequest({ olderThanDays: 30 }),
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ deleted: 0 });
  });

  // Pinned error code for the web contract: INVALID_PURGE_WINDOW.
  it.each([[10], [0], [45], ["30"], [null], [{}], [[]], [undefined]])(
    "rejects olderThanDays=%j with 400 INVALID_PURGE_WINDOW (pinned)",
    async (olderThanDays) => {
      const { app, deps } = buildApp();
      const body =
        olderThanDays === undefined ? {} : { olderThanDays };

      const res = await app.request(
        "/api/v1/receipts/purge-media",
        purgeRequest(body),
      );

      expect(res.status).toBe(400);
      const parsed = (await res.json()) as { code: string };
      expect(parsed.code).toBe("INVALID_PURGE_WINDOW");
      expect(deps.purgeReceiptMedia.execute).not.toHaveBeenCalled();
    },
  );

  it("rejects a non-JSON body with 400 INVALID_PURGE_WINDOW", async () => {
    const { app, deps } = buildApp();

    const res = await app.request(
      "/api/v1/receipts/purge-media",
      purgeRequest("not json{"),
    );

    expect(res.status).toBe(400);
    const parsed = (await res.json()) as { code: string };
    expect(parsed.code).toBe("INVALID_PURGE_WINDOW");
    expect(deps.purgeReceiptMedia.execute).not.toHaveBeenCalled();
  });

  it("rejects unauthenticated purges with 401", async () => {
    const { app, deps } = buildApp({ authenticated: false });

    const res = await app.request(
      "/api/v1/receipts/purge-media",
      purgeRequest({ olderThanDays: 7 }),
    );

    expect(res.status).toBe(401);
    expect(deps.purgeReceiptMedia.execute).not.toHaveBeenCalled();
  });

  it("is registered before /:id so \"purge-media\" is never captured as a scan id", async () => {
    const { app, deps } = buildApp();

    const res = await app.request(
      "/api/v1/receipts/purge-media",
      purgeRequest({ olderThanDays: 15 }),
    );

    expect(res.status).toBe(200);
    expect(deps.purgeReceiptMedia.execute).toHaveBeenCalledTimes(1);
    // No :id route saw the request.
    expect(deps.getReceiptScan.execute).not.toHaveBeenCalled();
    expect(deps.rejectReceiptScan.execute).not.toHaveBeenCalled();
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

describe("POST /api/v1/receipts/:id/retry (T12, S11)", () => {
  it("re-queues a failed scan and returns the pending scan view", async () => {
    const { app, deps } = buildApp();

    const res = await app.request("/api/v1/receipts/scan-1/retry", {
      method: "POST",
      headers: { "x-dev-user": "t" },
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as ReceiptScanView;
    expect(body.status).toBe("pending");
    expect(deps.retryReceiptScan.execute).toHaveBeenCalledWith(WS, "scan-1");
  });

  it("maps RECEIPT_ALREADY_FINAL to 409 on a user-final scan", async () => {
    const { app, deps } = buildApp();
    vi.mocked(deps.retryReceiptScan.execute).mockResolvedValueOnce(
      err(new DomainError("RECEIPT_ALREADY_FINAL", "already confirmed")),
    );

    const res = await app.request("/api/v1/receipts/scan-1/retry", {
      method: "POST",
      headers: { "x-dev-user": "t" },
    });

    expect(res.status).toBe(409);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("RECEIPT_ALREADY_FINAL");
  });

  it("returns 404 for a missing scan", async () => {
    const { app } = buildApp();

    const res = await app.request("/api/v1/receipts/nope/retry", {
      method: "POST",
      headers: { "x-dev-user": "t" },
    });

    expect(res.status).toBe(404);
  });
});

/**
 * demo-maria-session T2 (S7): the demo subject must never reach the
 * paid extraction provider. The cheapest correct gate is at the route:
 * the ONLY paths that dispatch a scan job to the Gemini adapter (upload
 * and retry) answer a controlled 403 for DEMO_SUBJECT before the use
 * case runs, in both pgboss and inline dispatcher modes.
 */
describe("demo subject provider gate (demo-maria-session T2, S7)", () => {
  const DEMO_SUBJECT = "demo-maria";

  it("rejects receipt uploads for the demo subject with 403 — no scan is ever queued", async () => {
    const { app, deps } = buildApp({
      subject: DEMO_SUBJECT,
      demoSubject: DEMO_SUBJECT,
    });

    const res = await app.request(
      "/api/v1/receipts",
      uploadRequest({ bytes: JPEG, name: "ticket.jpg", type: "image/jpeg" }),
    );

    expect(res.status).toBe(403);
    expect((await res.json()) as { code: string }).toEqual({
      code: "DEMO_PROVIDER_FORBIDDEN",
      message: "Demo sessions cannot invoke paid providers",
    });
    expect(deps.uploadReceipt.execute).not.toHaveBeenCalled();
  });

  it("rejects scan retries for the demo subject with 403 — the job is never re-dispatched", async () => {
    const { app, deps } = buildApp({
      subject: DEMO_SUBJECT,
      demoSubject: DEMO_SUBJECT,
    });

    const res = await app.request("/api/v1/receipts/scan-1/retry", {
      method: "POST",
      headers: { "x-dev-user": "t" },
    });

    expect(res.status).toBe(403);
    expect((await res.json()) as { code: string }).toEqual({
      code: "DEMO_PROVIDER_FORBIDDEN",
      message: "Demo sessions cannot invoke paid providers",
    });
    expect(deps.retryReceiptScan.execute).not.toHaveBeenCalled();
  });

  it("does not affect non-demo uploads when a demo subject is configured", async () => {
    const { app, deps } = buildApp({
      subject: "user-1",
      demoSubject: DEMO_SUBJECT,
    });

    const res = await app.request(
      "/api/v1/receipts",
      uploadRequest({ bytes: JPEG, name: "ticket.jpg", type: "image/jpeg" }),
    );

    expect(res.status).toBe(201);
    expect(deps.uploadReceipt.execute).toHaveBeenCalledTimes(1);
  });
});
