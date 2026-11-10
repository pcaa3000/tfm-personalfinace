import type { z } from "zod";

/** Client-safe projection of a zod issue (GAP-SEC-04). */
export interface SanitizedIssue {
  readonly path: string;
  readonly code: string;
  readonly message: string;
}

/**
 * S7: 400 envelopes expose `{path, code, message}` only — never parser
 * internals like the rejected input value or the expected type.
 */
export function sanitizeZodIssues(
  issues: readonly z.core.$ZodIssue[],
): SanitizedIssue[] {
  return issues.map((issue) => ({
    path: issue.path.map(String).join("."),
    code: issue.code,
    message: issue.message,
  }));
}
