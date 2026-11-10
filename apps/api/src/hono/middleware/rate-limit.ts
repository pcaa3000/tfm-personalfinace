import type { Context, MiddlewareHandler } from "hono";
import { getConnInfo } from "@hono/node-server/conninfo";

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
  /** Test hook: override how the client key is resolved. */
  readonly clientKey?: (c: Context) => string;
}

/**
 * Client key: first `x-forwarded-for` hop when behind a proxy, else the
 * connection remote address, else "unknown". Falling back to the socket
 * address avoids collapsing every direct (unproxied) client into one
 * shared "unknown" bucket that would 429 all of them globally (R4-002).
 */
function defaultClientKey(c: Context): string {
  const forwarded = c.req.header("x-forwarded-for")?.split(",")[0]?.trim();
  if (forwarded) return forwarded;
  try {
    return getConnInfo(c).remote.address ?? "unknown";
  } catch {
    return "unknown";
  }
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
    const key = (options.clientKey ?? defaultClientKey)(c);
    const t = now();
    let entry = windows.get(key);
    if (!entry || t >= entry.resetAt) {
      entry = { count: 0, resetAt: t + options.windowMs };
      windows.set(key, entry);
      // Bound memory (R4-001): sweep expired windows once the map grows
      // large; if none expired (rotating fresh keys), evict the oldest
      // so a header-rotation flood cannot grow the map without bound.
      if (windows.size > MAX_TRACKED_CLIENTS) {
        let oldest: string | undefined;
        let oldestReset = Number.POSITIVE_INFINITY;
        for (const [k, e] of windows) {
          if (t >= e.resetAt) {
            windows.delete(k);
          } else if (e.resetAt < oldestReset) {
            oldestReset = e.resetAt;
            oldest = k;
          }
        }
        if (windows.size > MAX_TRACKED_CLIENTS && oldest !== undefined) {
          windows.delete(oldest);
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
