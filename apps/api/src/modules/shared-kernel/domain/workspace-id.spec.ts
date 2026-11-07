import { describe, expect, it } from "vitest";

import { DomainError } from "./domain-error.js";
import type { Result } from "./result.js";
import { WorkspaceId } from "./workspace-id.js";

function unwrap<T>(result: Result<T, DomainError>): T {
  if (!result.ok) {
    throw result.error;
  }
  return result.value;
}

describe("WorkspaceId.create", () => {
  it("accepts a non-empty id", () => {
    const id = unwrap(WorkspaceId.create("ws-1"));

    expect(id.value).toBe("ws-1");
    expect(id.toString()).toBe("ws-1");
  });

  it.each(["", "   ", "\n\t"])("rejects blank id %j", (raw) => {
    const result = WorkspaceId.create(raw);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBeInstanceOf(DomainError);
      expect(result.error.code).toBe("WORKSPACE_ID_INVALID");
    }
  });
});

describe("WorkspaceId.equals", () => {
  it("compares ids by value", () => {
    const id = unwrap(WorkspaceId.create("ws-1"));
    const same = unwrap(WorkspaceId.create("ws-1"));
    const other = unwrap(WorkspaceId.create("ws-2"));

    expect(id.equals(same)).toBe(true);
    expect(id.equals(other)).toBe(false);
  });
});
