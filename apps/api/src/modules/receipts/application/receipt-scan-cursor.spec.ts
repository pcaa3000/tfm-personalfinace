import { describe, expect, it } from "vitest";

import {
  decodeReceiptScanCursor,
  encodeReceiptScanCursor,
} from "./receipt-scan-cursor.js";

describe("receipt scan cursor codec (receipt-review-link T5, S4)", () => {
  it("round-trips a createdAt+id position as an opaque token", () => {
    const cursor = {
      createdAt: new Date("2026-11-10T12:34:56.789Z"),
      id: "scan-abc",
    };

    const encoded = encodeReceiptScanCursor(cursor);

    // Opaque: not the raw id and not the bare ISO instant.
    expect(encoded).not.toContain("scan-abc");
    expect(encoded).not.toContain("2026-11-10");
    expect(decodeReceiptScanCursor(encoded)).toEqual(cursor);
  });

  it.each([
    ["not-base64!!!"],
    // base64url of non-JSON bytes.
    ["aGVsbG8"],
    // JSON but wrong shape.
    [Buffer.from(JSON.stringify("scan-abc")).toString("base64url")],
    [Buffer.from(JSON.stringify({ c: 123, i: "scan-abc" })).toString(
      "base64url",
    )],
    [Buffer.from(JSON.stringify({ c: "not-a-date", i: "x" })).toString(
      "base64url",
    )],
    // Missing id.
    [Buffer.from(JSON.stringify({ c: "2026-11-10T12:00:00.000Z" })).toString(
      "base64url",
    )],
    [""],
  ])("returns null for the malformed token %j", (raw) => {
    expect(decodeReceiptScanCursor(raw)).toBeNull();
  });
});
