import { describe, expect, it } from "vitest";

import { err, ok } from "./result.js";
import { DomainError } from "./domain-error.js";

describe("Result", () => {
  it("wraps a value in ok", () => {
    const result = ok(42);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBe(42);
    }
  });

  it("wraps an error in err", () => {
    const error = new DomainError("TEST_ERROR", "boom");
    const result = err(error);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe(error);
    }
  });
});
