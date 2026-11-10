import { describe, expect, it } from "vitest";

import { callerFromHeaders } from "./dev-caller.js";

/**
 * S3 (GAP-SEC-01): the dev resolver has no implicit identity — a missing,
 * blank or oversized x-dev-user header resolves to null → 401, never to a
 * default "dev-user" subject.
 */
describe("callerFromHeaders (dev resolver, fail-closed)", () => {
  it("rejects a missing x-dev-user header", () => {
    expect(callerFromHeaders({})).toBeNull();
  });

  it("rejects a blank header value", () => {
    expect(callerFromHeaders({ "x-dev-user": "   " })).toBeNull();
  });

  it("rejects an oversized subject", () => {
    expect(
      callerFromHeaders({ "x-dev-user": "x".repeat(129) }),
    ).toBeNull();
  });

  it("resolves a valid header to a local caller", () => {
    expect(callerFromHeaders({ "x-dev-user": "alice" })).toEqual({
      issuer: "local",
      subject: "alice",
    });
  });
});
