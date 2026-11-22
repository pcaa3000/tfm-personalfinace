import type { ErrorHandler } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";

import { DomainError } from "../../modules/shared-kernel/index.js";
import type { HonoEnv } from "./auth.js";

/**
 * Transport error carrying the exact `{code, message}` envelope the Nest
 * controllers emit. Route handlers convert domain/validation failures into
 * this before throwing.
 */
export class HttpError extends Error {
  constructor(
    readonly status: ContentfulStatusCode,
    readonly body: Record<string, unknown>,
  ) {
    super(
      typeof body.message === "string" ? body.message : `HTTP ${status}`,
    );
    this.name = "HttpError";
  }
}

/**
 * Maps thrown errors to HTTP responses:
 * - {@link HttpError} → its declared status and `{code, message}` body.
 * - {@link DomainError} → the superset of both controllers' rules
 *   (`_NOT_FOUND` → 404, `_TAKEN` → 409, else 400); routes normally convert
 *   DomainErrors themselves, this is the safety net.
 * - anything else → generic 500 envelope.
 */
export function httpErrorHandler(): ErrorHandler<HonoEnv> {
  return (err, c) => {
    if (err instanceof HttpError) {
      return c.json(err.body, err.status);
    }
    if (err instanceof DomainError) {
      const status = err.code.endsWith("_NOT_FOUND")
        ? 404
        : err.code.endsWith("_TAKEN")
          ? 409
          : 400;
      return c.json({ code: err.code, message: err.message }, status);
    }
    // NEW-SEC-12 (S7): unknown exceptions leave a forensic trail; the
    // client still gets the generic envelope that leaks nothing.
    console.error("[api] unhandled error:", err);
    return c.json(
      { code: "INTERNAL_ERROR", message: "Internal server error" },
      500,
    );
  };
}
