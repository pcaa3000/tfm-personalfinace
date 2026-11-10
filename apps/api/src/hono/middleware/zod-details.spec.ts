import { describe, expect, it } from "vitest";
import { z } from "zod";

import { sanitizeZodIssues } from "./zod-details.js";

/**
 * S7 (GAP-SEC-04): 400 envelopes expose a sanitized projection of zod
 * issues — {path, code, message} only, never parser internals like the
 * rejected input or the expected type.
 */
describe("sanitizeZodIssues", () => {
  const parsed = z
    .object({ name: z.string(), amount: z.string().max(4) })
    .safeParse({ name: 42, amount: "123456" });

  it("maps each issue to {path, code, message}", () => {
    if (parsed.success) throw new Error("expected parse failure");
    const details = sanitizeZodIssues(parsed.error.issues);
    expect(details).toHaveLength(2);
    for (const detail of details) {
      expect(Object.keys(detail).sort()).toEqual([
        "code",
        "message",
        "path",
      ]);
      expect(typeof detail.code).toBe("string");
      expect(typeof detail.message).toBe("string");
    }
    expect(details[0]!.path).toBe("name");
  });

  it("leaks no rejected input values", () => {
    if (parsed.success) throw new Error("expected parse failure");
    const details = sanitizeZodIssues(parsed.error.issues);
    expect(JSON.stringify(details)).not.toContain("42");
  });
});
