import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import { CryptoFileHasher } from "./crypto-file-hasher.adapter.js";

describe("CryptoFileHasher (T13, S12)", () => {
  it("returns the lowercase SHA-256 hex of the exact bytes", () => {
    const hasher = new CryptoFileHasher();
    const bytes = new TextEncoder().encode("voucher-bytes");

    const expected = createHash("sha256").update(bytes).digest("hex");

    expect(hasher.sha256Hex(bytes)).toBe(expected);
    expect(hasher.sha256Hex(bytes)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is content-derived: same bytes same hash, one flipped bit differs", () => {
    const hasher = new CryptoFileHasher();
    const a = Uint8Array.from([0xff, 0xd8, 0xff, 0x00]);
    const b = Uint8Array.from([0xff, 0xd8, 0xff, 0x01]);

    expect(hasher.sha256Hex(a)).toBe(hasher.sha256Hex(Uint8Array.from(a)));
    expect(hasher.sha256Hex(a)).not.toBe(hasher.sha256Hex(b));
  });
});
