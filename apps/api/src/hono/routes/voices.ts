import type { Hono } from "hono";
import { z } from "zod";

import {
  decodeVoiceNoteCursor,
  type GetVoiceFileUseCase,
  type GetVoiceNoteUseCase,
  type ListVoiceNotesUseCase,
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

/**
 * S7: "media gone" answers 410 — deliberately distinct from the 404
 * "note not found" so clients can show a deleted-media state instead
 * of an error (same convention as receipts).
 */
const GONE_CODES = new Set(["VOICE_MEDIA_DELETED"]);

/** Same mapping as the other resource routers, plus the 410 media code. */
function toHttpError(error: DomainError): HttpError {
  const status = error.code.endsWith("_NOT_FOUND")
    ? 404
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

export interface VoiceRouteDeps extends AuthDeps {
  readonly uploadVoiceNote: Pick<UploadVoiceNoteUseCase, "execute">;
  readonly listVoiceNotes: Pick<ListVoiceNotesUseCase, "execute">;
  readonly getVoiceNote: Pick<GetVoiceNoteUseCase, "execute">;
  readonly getVoiceFile: Pick<GetVoiceFileUseCase, "execute">;
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
