import type { MiddlewareHandler } from "hono";

/**
 * GAP-SEC-05 (S5): small in-memory fixed-window limiter for the write API.
 * Keyed by client IP (x-forwarded-for, first hop); a `max` over the window
 * returns the 429 `{code:"RATE_LIMITED"}` envelope. `now` is injectable so
 * specs can travel through windows deterministically. Single-process only —
 * a multi-replica deploy would need a shared store (documented in docs/07).
 */

const WRITE_METHODS = new Set(["POST", "PATCH", "PUT", "DELETE"]);
const MAX_TRACKED_CLIENTS = 10_000;

export interface RateLimitOptions {
  readonly max: number;
  readonly windowMs: number;
  readonly now?: () => number;
}

export function rateLimitMiddleware(
  options: RateLimitOptions,
): MiddlewareHandler {
  const now = options.now ?? (() => Date.now());
  const windows = new Map<string, { count: number; resetAt: number }>();
  return async (c, next) => {
    if (!WRITE_METHODS.has(c.req.method)) {
      return next();
    }
    const key =
      c.req.header("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
    const t = now();
    let entry = windows.get(key);
    if (!entry || t >= entry.resetAt) {
      entry = { count: 0, resetAt: t + options.windowMs };
      windows.set(key, entry);
      // Bound memory: drop expired windows once the map grows large.
      if (windows.size > MAX_TRACKED_CLIENTS) {
        for (const [k, e] of windows) {
          if (t >= e.resetAt) windows.delete(k);
        }
      }
    }
    entry.count += 1;
    if (entry.count > options.max) {
      return c.json(
        { code: "RATE_LIMITED", message: "Too many requests" },
        429,
      );
    }
    return next();
  };
}
