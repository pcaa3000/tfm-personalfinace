import type { Hono } from "hono";
import { z } from "zod";

import type { CategoryNature } from "../../modules/categorization/index.js";
import {
  decodeReceiptScanCursor,
  type ConfirmReceiptDraftUseCase,
  type DeleteReceiptFileUseCase,
  type GetReceiptDraftUseCase,
  type GetReceiptFileUseCase,
  type GetReceiptScanUseCase,
  type ListReceiptScansUseCase,
  type PurgeReceiptMediaUseCase,
  type ReceiptScanCursor,
  type RejectReceiptScanUseCase,
  type RetryReceiptScanUseCase,
  type UploadReceiptUseCase,
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

/**
 * receipt-review-link T5 (S4): cursor-paginated list. `limit` is
 * pinned to 1..100 with default 50 — out-of-range/non-numeric values
 * are rejected (400 INVALID_QUERY), never clamped. `cursor` is an
 * opaque keyset token; a malformed one is rejected (400
 * INVALID_CURSOR), never treated as an empty page.
 */
const listReceiptsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().min(1).max(512).optional(),
});

/**
 * receipt-retention-30d T6 (S6): manual media purge — the only valid
 * windows are 7/15/30 days by capture age. Any other value (or a
 * missing/malformed body) is rejected 400 INVALID_PURGE_WINDOW —
 * pinned code for the web contract.
 */
const purgeMediaSchema = z.object({
  olderThanDays: z.union([z.literal(7), z.literal(15), z.literal(30)]),
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
  /**
   * demo-maria-session T2 (S7): the configured DEMO_SUBJECT. Upload and
   * retry — the only paths that dispatch a paid-provider scan job —
   * refuse this subject with a controlled 403.
   */
  readonly demoSubject?: string;
  readonly listReceiptScans: Pick<ListReceiptScansUseCase, "execute">;
  readonly getReceiptScan: Pick<GetReceiptScanUseCase, "execute">;
  readonly getReceiptFile: Pick<GetReceiptFileUseCase, "execute">;
  readonly deleteReceiptFile: Pick<DeleteReceiptFileUseCase, "execute">;
  readonly getReceiptDraft: Pick<GetReceiptDraftUseCase, "execute">;
  readonly confirmReceiptDraft: Pick<ConfirmReceiptDraftUseCase, "execute">;
  readonly rejectReceiptScan: Pick<RejectReceiptScanUseCase, "execute">;
  readonly retryReceiptScan: Pick<RetryReceiptScanUseCase, "execute">;
  readonly purgeReceiptMedia: Pick<PurgeReceiptMediaUseCase, "execute">;
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

  // demo-maria-session T2 (S7): a controlled 403 for the demo subject —
  // a scan row is never created, so no job ever reaches Gemini (worker
  // or inline dispatcher alike).
  const assertNotDemoSubject = (subject: string): void => {
    if (deps.demoSubject !== undefined && subject === deps.demoSubject) {
      throw new HttpError(403, {
        code: "DEMO_PROVIDER_FORBIDDEN",
        message: "Demo sessions cannot invoke paid providers",
      });
    }
  };

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
    assertNotDemoSubject(caller.subject);
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
  // before /:id so "list" is not captured as a scan id. T5 (S4):
  // {items, nextCursor} keyset page — breaking change vs the bare array.
  app.get("/api/v1/receipts", auth, async (c) => {
    const parsed = listReceiptsQuerySchema.safeParse(c.req.query());
    if (!parsed.success) {
      throw new HttpError(400, {
        code: "INVALID_QUERY",
        message: "Invalid receipt list query",
        details: sanitizeZodIssues(parsed.error.issues),
      });
    }
    let after: ReceiptScanCursor | undefined;
    if (parsed.data.cursor !== undefined) {
      const decoded = decodeReceiptScanCursor(parsed.data.cursor);
      if (!decoded) {
        throw new HttpError(400, {
          code: "INVALID_CURSOR",
          message: "Invalid receipts cursor",
        });
      }
      after = decoded;
    }

    const { workspace } = authContext(c);
    const page = await deps.listReceiptScans.execute(
      workspace.workspaceId,
      after === undefined
        ? { limit: parsed.data.limit }
        : { limit: parsed.data.limit, after },
    );
    return c.json(page);
  });

  // receipt-retention-30d T6 (S6): manual mass purge by capture age.
  // Registered BEFORE /:id so "purge-media" is never captured as a
  // scan id. Returns {deleted: n} — actual storage deletions.
  app.post("/api/v1/receipts/purge-media", auth, async (c) => {
    const parsed = purgeMediaSchema.safeParse(
      await c.req.json().catch(() => undefined),
    );
    if (!parsed.success) {
      throw new HttpError(400, {
        code: "INVALID_PURGE_WINDOW",
        message: "olderThanDays must be one of 7, 15 or 30",
        details: sanitizeZodIssues(parsed.error.issues),
      });
    }
    const { workspace } = authContext(c);
    const deleted = await deps.purgeReceiptMedia.execute(
      workspace.workspaceId,
      parsed.data.olderThanDays,
    );
    return c.json({ deleted });
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
    const { caller, workspace } = authContext(c);
    assertNotDemoSubject(caller.subject);
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
