import type { CallerIdentity } from "../../application/workspace-context.port.js";

/** Dev-only header carrying the caller subject until OIDC auth lands (Corte 4). */
export const DEV_USER_HEADER = "x-dev-user";

const DEV_ISSUER = "local";
const DEFAULT_DEV_SUBJECT = "dev-user";
const MAX_SUBJECT_LENGTH = 128;

export function callerFromHeaders(
  headers: Record<string, string | string[] | undefined>,
): CallerIdentity {
  const raw = headers[DEV_USER_HEADER];
  const value = (Array.isArray(raw) ? raw[0] : raw)?.trim();
  const subject =
    value && value.length <= MAX_SUBJECT_LENGTH ? value : DEFAULT_DEV_SUBJECT;
  return { issuer: DEV_ISSUER, subject };
}
