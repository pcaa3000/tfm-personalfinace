import type { Hono } from "hono";
import { z } from "zod";

import type { CategoryNature } from "../../modules/categorization/index.js";
import {
  decodeVoiceNoteCursor,
  type ConfirmVoiceDraftUseCase,
  type GetVoiceDraftUseCase,
  type GetVoiceFileUseCase,
  type GetVoiceNoteUseCase,
  type ListVoiceNotesUseCase,
  type RejectVoiceNoteUseCase,
  type RetryVoiceNoteUseCase,
  type UploadVoiceNoteUseCase,
  type VoiceNoteCursor,
} from "../../modules/voices/index.js";
import { DomainError } from "../../modules/shared-kernel/index.js";
import {
  authContext,
  authMiddleware,
  type AuthDeps,
  type HonoEnv,
} from "../middleware/auth.js";
import { HttpError } from "../middleware/errors.js";
import { sanitizeZodIssues } from "../middleware/zod-details.js";

/** State-transition conflicts on the note lifecycle (T3). */
const CONFLICT_CODES = new Set(["VOICE_NOT_READY", "VOICE_ALREADY_FINAL"]);

/**
 * S7: "media gone" answers 410 — deliberately distinct from the 404
 * "note not found" so clients can show a deleted-media state instead
 * of an error (same convention as receipts).
 */
const GONE_CODES = new Set(["VOICE_MEDIA_DELETED"]);

/** Same mapping as the other resource routers, plus 409/410 voice codes. */
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

/**
 * Cursor-paginated list (mirrors the receipts contract): `limit` is
 * pinned to 1..100 with default 50 — out-of-range/non-numeric values
 * are rejected (400 INVALID_QUERY), never clamped. `cursor` is an
 * opaque keyset token; a malformed one is rejected (400
 * INVALID_CURSOR), never treated as an empty page.
 */
const listVoicesQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().min(1).max(512).optional(),
});

const CATEGORY_NATURES: readonly CategoryNature[] = [
  "income",
  "essential",
  "discretionary",
  "obligation",
  "transfer",
];

/**
 * Confirm contract (voice-drafts T3, S4): each split is a catalog
 * `categoryId`, an approved `newCategory` proposal, or `null` for the
 * system uncategorized fallback — exactly one per split, same shape
 * as the receipts confirm.
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

const confirmVoiceSchema = z.object({
  accountId: z.string().min(1),
  type: z.enum(["expense", "income"]),
  idempotencyKey: z.string().min(8).max(128).optional(),
  businessDate: z.string().min(10).max(10).optional(),
  currency: z.string().length(3).optional(),
  concept: z.string().min(1).max(500).optional(),
  splits: z.array(confirmSplitSchema).min(1),
});

export interface VoiceRouteDeps extends AuthDeps {
  readonly uploadVoiceNote: Pick<UploadVoiceNoteUseCase, "execute">;
  readonly listVoiceNotes: Pick<ListVoiceNotesUseCase, "execute">;
  readonly getVoiceNote: Pick<GetVoiceNoteUseCase, "execute">;
  readonly getVoiceFile: Pick<GetVoiceFileUseCase, "execute">;
  readonly getVoiceDraft: Pick<GetVoiceDraftUseCase, "execute">;
  readonly confirmVoiceDraft: Pick<ConfirmVoiceDraftUseCase, "execute">;
  readonly rejectVoiceNote: Pick<RejectVoiceNoteUseCase, "execute">;
  readonly retryVoiceNote: Pick<RetryVoiceNoteUseCase, "execute">;
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
 * Registers the voice-note upload + polling surface
 * (voice-drafts T1, S1+S5+S7):
 *   POST /api/v1/voices          multipart `file` field → 201 pending note
 *   GET  /api/v1/voices          workspace note list, newest first
 *        — registered BEFORE /:id
 *   GET  /api/v1/voices/:id      note row for status polling
 *   GET  /api/v1/voices/:id/draft draft payload for review (T3)
 *   POST /api/v1/voices/:id/confirm approve the draft → transaction
 *        with origin "voice" (T3, S4)
 *   POST /api/v1/voices/:id/reject user discard (T3)
 *   POST /api/v1/voices/:id/retry re-queue a failed note without
 *        re-uploading the audio (T3)
 *   GET  /api/v1/voices/:id/file stored bytes (interim for signed URLs)
 * Quarantine codes (VOICE_EMPTY / VOICE_TOO_LARGE /
 * VOICE_TYPE_NOT_ALLOWED) arrive as 400 {code, message} envelopes;
 * VOICE_MEDIA_DELETED arrives as 410.
 */
export function registerVoiceRoutes(
  app: Hono<HonoEnv>,
  deps: VoiceRouteDeps,
): void {
  const auth = authMiddleware(deps);

  app.post("/api/v1/voices", auth, async (c) => {
    const body = await c.req.parseBody().catch(() => null);
    const file = body?.["file"];
    if (!isUploadedFile(file)) {
      throw new HttpError(400, {
        code: "INVALID_BODY",
        message: "Expected a multipart 'file' audio field",
      });
    }

    const { caller, workspace } = authContext(c);
    const result = await deps.uploadVoiceNote.execute({
      workspaceId: workspace.workspaceId,
      uploaderSubject: caller.subject,
      originalFilename: file.name ?? "voice-note",
      bytes: new Uint8Array(await file.arrayBuffer()),
    });
    if (!result.ok) {
      throw toHttpError(result.error);
    }
    return c.json(result.value, 201);
  });

  // The exact-path GET must be registered before /:id so "list" is not
  // captured as a note id. {items, nextCursor} keyset page — same
  // contract as GET /api/v1/receipts.
  app.get("/api/v1/voices", auth, async (c) => {
    const parsed = listVoicesQuerySchema.safeParse(c.req.query());
    if (!parsed.success) {
      throw new HttpError(400, {
        code: "INVALID_QUERY",
        message: "Invalid voice notes list query",
        details: sanitizeZodIssues(parsed.error.issues),
      });
    }
    let after: VoiceNoteCursor | undefined;
    if (parsed.data.cursor !== undefined) {
      const decoded = decodeVoiceNoteCursor(parsed.data.cursor);
      if (!decoded) {
        throw new HttpError(400, {
          code: "INVALID_CURSOR",
          message: "Invalid voices cursor",
        });
      }
      after = decoded;
    }

    const { workspace } = authContext(c);
    const page = await deps.listVoiceNotes.execute(
      workspace.workspaceId,
      after === undefined
        ? { limit: parsed.data.limit }
        : { limit: parsed.data.limit, after },
    );
    return c.json(page);
  });

  app.get("/api/v1/voices/:id", auth, async (c) => {
    const { workspace } = authContext(c);
    const result = await deps.getVoiceNote.execute(
      workspace.workspaceId,
      c.req.param("id"),
    );
    if (!result.ok) {
      throw toHttpError(result.error);
    }
    return c.json(result.value);
  });

  app.get("/api/v1/voices/:id/draft", auth, async (c) => {
    const { workspace } = authContext(c);
    const result = await deps.getVoiceDraft.execute(
      workspace.workspaceId,
      c.req.param("id"),
    );
    if (!result.ok) {
      throw toHttpError(result.error);
    }
    return c.json(result.value);
  });

  app.post("/api/v1/voices/:id/confirm", auth, async (c) => {
    const parsed = confirmVoiceSchema.safeParse(
      await c.req.json().catch(() => undefined),
    );
    if (!parsed.success) {
      throw new HttpError(400, {
        code: "INVALID_BODY",
        message: "Invalid voice confirm payload",
        details: sanitizeZodIssues(parsed.error.issues),
      });
    }
    const idempotencyKey = parsed.data.idempotencyKey;
    if (!idempotencyKey) {
      throw new HttpError(400, {
        code: "IDEMPOTENCY_KEY_REQUIRED",
        message: "An idempotencyKey is required to confirm a voice draft",
      });
    }

    const { caller, workspace } = authContext(c);
    const result = await deps.confirmVoiceDraft.execute({
      workspaceId: workspace.workspaceId,
      voiceNoteId: c.req.param("id"),
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

  app.post("/api/v1/voices/:id/reject", auth, async (c) => {
    const { workspace } = authContext(c);
    const result = await deps.rejectVoiceNote.execute(
      workspace.workspaceId,
      c.req.param("id"),
    );
    if (!result.ok) {
      throw toHttpError(result.error);
    }
    return c.json(result.value);
  });

  app.post("/api/v1/voices/:id/retry", auth, async (c) => {
    const { workspace } = authContext(c);
    const result = await deps.retryVoiceNote.execute(
      workspace.workspaceId,
      c.req.param("id"),
    );
    if (!result.ok) {
      throw toHttpError(result.error);
    }
    return c.json(result.value);
  });

  app.get("/api/v1/voices/:id/file", auth, async (c) => {
    const { workspace } = authContext(c);
    const result = await deps.getVoiceFile.execute(
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
