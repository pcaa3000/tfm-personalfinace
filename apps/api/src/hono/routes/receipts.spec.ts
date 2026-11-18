import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";

import { DomainError, WorkspaceId, err, ok } from "../../modules/shared-kernel/index.js";
import type {
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
