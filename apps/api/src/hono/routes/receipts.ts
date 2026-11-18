import type { Hono } from "hono";

import type {
  GetReceiptFileUseCase,
  GetReceiptScanUseCase,
  UploadReceiptUseCase,
} from "../../modules/receipts/index.js";
import { DomainError } from "../../modules/shared-kernel/index.js";
import {
  authContext,
  authMiddleware,
  type AuthDeps,
  type HonoEnv,
} from "../middleware/auth.js";
import { HttpError } from "../middleware/errors.js";

/** Same mapping as the other resource routers. */
function toHttpError(error: DomainError): HttpError {
  const notFound = error.code.endsWith("_NOT_FOUND");
  return new HttpError(notFound ? 404 : 400, {
    code: error.code,
    message: error.message,
  });
}

export interface ReceiptRouteDeps extends AuthDeps {
  readonly uploadReceipt: Pick<UploadReceiptUseCase, "execute">;
  readonly getReceiptScan: Pick<GetReceiptScanUseCase, "execute">;
  readonly getReceiptFile: Pick<GetReceiptFileUseCase, "execute">;
}

/** True for the multipart field shapes Hono yields (File, or File-like). */
function isUploadedFile(value: unknown): value is File {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as File).arrayBuffer === "function" &&
    typeof (value as File).size === "number"
  );
}

/**
 * Registers the receipt-scan upload + polling surface
 * (receipt-scan-drafts T3, S1+S9):
 *   POST /api/v1/receipts          multipart `file` field → 201 pending scan
 *   GET  /api/v1/receipts/:id      scan row for status polling
 *   GET  /api/v1/receipts/:id/file stored bytes (interim for signed URLs)
 * Quarantine codes (RECEIPT_EMPTY / RECEIPT_TOO_LARGE /
 * RECEIPT_TYPE_NOT_ALLOWED) arrive as 400 {code, message} envelopes.
 */
export function registerReceiptRoutes(
  app: Hono<HonoEnv>,
  deps: ReceiptRouteDeps,
): void {
  const auth = authMiddleware(deps);

  app.post("/api/v1/receipts", auth, async (c) => {
    const body = await c.req.parseBody().catch(() => null);
    const file = body?.["file"];
    if (!isUploadedFile(file)) {
      throw new HttpError(400, {
        code: "INVALID_BODY",
        message: "Expected a multipart 'file' image field",
      });
    }

    const { caller, workspace } = authContext(c);
    const result = await deps.uploadReceipt.execute({
      workspaceId: workspace.workspaceId,
      uploaderSubject: caller.subject,
      originalFilename: file.name ?? "receipt",
      bytes: new Uint8Array(await file.arrayBuffer()),
    });
    if (!result.ok) {
      throw toHttpError(result.error);
    }
    return c.json(result.value, 201);
  });

  app.get("/api/v1/receipts/:id", auth, async (c) => {
    const { workspace } = authContext(c);
    const result = await deps.getReceiptScan.execute(
      workspace.workspaceId,
      c.req.param("id"),
    );
    if (!result.ok) {
      throw toHttpError(result.error);
    }
    return c.json(result.value);
  });

  app.get("/api/v1/receipts/:id/file", auth, async (c) => {
    const { workspace } = authContext(c);
    const result = await deps.getReceiptFile.execute(
      workspace.workspaceId,
      c.req.param("id"),
    );
    if (!result.ok) {
      throw toHttpError(result.error);
    }
    c.header("content-type", result.value.mimeType);
    c.header(
      "content-disposition",
      `inline; filename="${result.value.originalFilename.replace(/["\\]/g, "_")}"`,
    );
    return c.body(result.value.bytes as unknown as ArrayBuffer);
  });
}
