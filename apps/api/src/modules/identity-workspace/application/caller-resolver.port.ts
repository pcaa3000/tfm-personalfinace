import type { CallerIdentity } from "./workspace-context.port.js";

/**
 * Extracts the caller identity from transport headers.
 * Returns null when the request is unauthenticated; the HTTP layer maps
 * that to a generic 401 that never reveals whether an account exists.
 */
export interface CallerResolverPort {
  resolve(
    headers: Record<string, string | string[] | undefined>,
  ): Promise<CallerIdentity | null>;
}

export const CALLER_RESOLVER = Symbol("CALLER_RESOLVER");
