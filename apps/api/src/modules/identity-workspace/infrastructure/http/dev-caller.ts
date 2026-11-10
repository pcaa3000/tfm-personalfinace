import type { CallerIdentity } from "../../application/workspace-context.port.js";

/** Dev-only header carrying the caller subject until OIDC auth lands (Corte 4). */
export const DEV_USER_HEADER = "x-dev-user";

const DEV_ISSUER = "local";
const MAX_SUBJECT_LENGTH = 128;

/**
 * GAP-SEC-01 (S3): fail-closed — there is no implicit dev identity. A
 * missing, blank or oversized x-dev-user resolves to null → 401.
 */
export function callerFromHeaders(
  headers: Record<string, string | string[] | undefined>,
): CallerIdentity | null {
  const raw = headers[DEV_USER_HEADER];
  const value = (Array.isArray(raw) ? raw[0] : raw)?.trim();
  if (!value || value.length > MAX_SUBJECT_LENGTH) {
    return null;
  }
  return { issuer: DEV_ISSUER, subject: value };
}
