import type { Hono } from "hono";
import { z } from "zod";

import type { CategoryNature } from "../../modules/categorization/index.js";
import type {
  ConfirmReceiptDraftUseCase,
  DeleteReceiptFileUseCase,
  GetReceiptDraftUseCase,
  GetReceiptFileUseCase,
  GetReceiptScanUseCase,
  ListReceiptScansUseCase,
  RejectReceiptScanUseCase,
  RetryReceiptScanUseCase,
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
import { sanitizeZodIssues } from "../middleware/zod-details.js";

/** State-transition conflicts on the scan lifecycle (T6). */
const CONFLICT_CODES = new Set(["RECEIPT_NOT_READY", "RECEIPT_ALREADY_FINAL"]);

/**
 * receipt-retention-30d T3 (S3): "media gone" answers 410 — deliberately
 * distinct from the 404 "scan not found" so the web can show a deleted
 * thumbnail state instead of an error.
 */
const GONE_CODES = new Set(["RECEIPT_MEDIA_DELETED"]);

/** Same mapping as the other resource routers, plus 409/410 receipts codes. */
function toHttpError(error: DomainError): HttpError {
  const status = error.code.endsWith("_NOT_FOUND")
    ? 404
    : CONFLICT_CODES.has(error.code)
      ? 409
      : GONE_CODES.has(error.code)
        ? 410
        : 400;
  return new HttpError(status, {
    code: error.code,
    message: error.message,
  });
}

const CATEGORY_NATURES: readonly CategoryNature[] = [
  "income",
  "essential",
  "discretionary",
  "obligation",
  "transfer",
];

/**
 * Confirm contract (receipt-scan-drafts T6, S4+S7+S10): each split is a
 * catalog `categoryId`, an approved `newCategory` proposal, or `null`
 * for the system uncategorized fallback — exactly one per split.
 */
const confirmSplitSchema = z
  .object({
    categoryId: z.string().min(1).nullable().optional(),
    newCategory: z
      .object({
        name: z.string().min(1).max(120),
        nature: z.enum(CATEGORY_NATURES as [CategoryNature, ...CategoryNature[]]),
      })
      .nullable()
      .optional(),
    amountMinorUnits: z.number().int().positive(),
  })
  .refine((split) => !(split.categoryId && split.newCategory), {
    message: "Provide either categoryId or newCategory, not both",
  });

const confirmReceiptSchema = z.object({
  accountId: z.string().min(1),
  type: z.enum(["expense", "income"]),
  idempotencyKey: z.string().min(8).max(128).optional(),
  businessDate: z.string().min(10).max(10).optional(),
  currency: z.string().length(3).optional(),
  concept: z.string().min(1).max(500).optional(),
  splits: z.array(confirmSplitSchema).min(1),
});

export interface ReceiptRouteDeps extends AuthDeps {
  readonly uploadReceipt: Pick<UploadReceiptUseCase, "execute">;
  readonly listReceiptScans: Pick<ListReceiptScansUseCase, "execute">;
  readonly getReceiptScan: Pick<GetReceiptScanUseCase, "execute">;
  readonly getReceiptFile: Pick<GetReceiptFileUseCase, "execute">;
  readonly deleteReceiptFile: Pick<DeleteReceiptFileUseCase, "execute">;
  readonly getReceiptDraft: Pick<GetReceiptDraftUseCase, "execute">;
  readonly confirmReceiptDraft: Pick<ConfirmReceiptDraftUseCase, "execute">;
  readonly rejectReceiptScan: Pick<RejectReceiptScanUseCase, "execute">;
  readonly retryReceiptScan: Pick<RetryReceiptScanUseCase, "execute">;
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
 *   GET  /api/v1/receipts          workspace scan list, newest first
 *        (receipt-review-link T1, S1) — registered BEFORE /:id
 *   GET  /api/v1/receipts/:id      scan row for status polling
 *   GET  /api/v1/receipts/:id/file stored bytes (interim for signed URLs)
 *   POST /api/v1/receipts/:id/retry re-queue a failed scan without
 *        re-uploading the image (T12, S11)
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

  // receipt-review-link T1 (S1): the exact-path GET must be registered
  // before /:id so "list" is not captured as a scan id.
  app.get("/api/v1/receipts", auth, async (c) => {
    const { workspace } = authContext(c);
    const items = await deps.listReceiptScans.execute(workspace.workspaceId);
    return c.json(items);
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

  app.get("/api/v1/receipts/:id/draft", auth, async (c) => {
    const { workspace } = authContext(c);
    const result = await deps.getReceiptDraft.execute(
      workspace.workspaceId,
      c.req.param("id"),
    );
    if (!result.ok) {
      throw toHttpError(result.error);
    }
    return c.json(result.value);
  });

  app.post("/api/v1/receipts/:id/confirm", auth, async (c) => {
    const parsed = confirmReceiptSchema.safeParse(
      await c.req.json().catch(() => undefined),
    );
    if (!parsed.success) {
      throw new HttpError(400, {
        code: "INVALID_BODY",
        message: "Invalid receipt confirm payload",
        details: sanitizeZodIssues(parsed.error.issues),
      });
    }
    const idempotencyKey = parsed.data.idempotencyKey;
    if (!idempotencyKey) {
      throw new HttpError(400, {
        code: "IDEMPOTENCY_KEY_REQUIRED",
        message: "An idempotencyKey is required to confirm a receipt draft",
      });
    }

    const { caller, workspace } = authContext(c);
    const result = await deps.confirmReceiptDraft.execute({
      workspaceId: workspace.workspaceId,
      receiptId: c.req.param("id"),
      accountId: parsed.data.accountId,
      type: parsed.data.type,
      idempotencyKey,
      ...(parsed.data.businessDate !== undefined
        ? { businessDate: parsed.data.businessDate }
        : {}),
      ...(parsed.data.currency !== undefined
        ? { currency: parsed.data.currency }
        : {}),
      ...(parsed.data.concept !== undefined
        ? { concept: parsed.data.concept }
        : {}),
      timezone: workspace.timezone,
      defaultCurrency: workspace.defaultCurrency,
      splits: parsed.data.splits.map((split) => ({
        categoryId: split.categoryId ?? null,
        newCategory: split.newCategory ?? null,
        amountMinorUnits: split.amountMinorUnits,
      })),
      actor: caller.subject,
    });
    if (!result.ok) {
      throw toHttpError(result.error);
    }
    return c.json(result.value, 201);
  });

  app.post("/api/v1/receipts/:id/reject", auth, async (c) => {
    const { workspace } = authContext(c);
    const result = await deps.rejectReceiptScan.execute(
      workspace.workspaceId,
      c.req.param("id"),
    );
    if (!result.ok) {
      throw toHttpError(result.error);
    }
    return c.json(result.value);
  });

  app.post("/api/v1/receipts/:id/retry", auth, async (c) => {
    const { workspace } = authContext(c);
    const result = await deps.retryReceiptScan.execute(
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

  // receipt-retention-30d T3 (S3, CA-012): early media deletion — 204,
  // idempotent, workspace-scoped; the scan row/transaction survive.
  app.delete("/api/v1/receipts/:id/file", auth, async (c) => {
    const { workspace } = authContext(c);
    const result = await deps.deleteReceiptFile.execute(
      workspace.workspaceId,
      c.req.param("id"),
    );
    if (!result.ok) {
      throw toHttpError(result.error);
    }
    return c.body(null, 204);
  });
}
