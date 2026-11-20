import { describe, expect, it } from "vitest";

import {
  decodeVoiceNoteCursor,
  encodeVoiceNoteCursor,
} from "./voice-note-cursor.js";

describe("voice note cursor codec (voice-drafts T1, S5)", () => {
  it("round-trips a createdAt+id position as an opaque token", () => {
    const cursor = {
      createdAt: new Date("2026-11-10T12:34:56.789Z"),
      id: "note-abc",
    };

    const encoded = encodeVoiceNoteCursor(cursor);

    // Opaque: not the raw id and not the bare ISO instant.
    expect(encoded).not.toContain("note-abc");
    expect(encoded).not.toContain("2026-11-10");
    expect(decodeVoiceNoteCursor(encoded)).toEqual(cursor);
  });

  it.each([
    ["not-base64!!!"],
    // base64url of non-JSON bytes.
    ["aGVsbG8"],
    // JSON but wrong shape.
    [Buffer.from(JSON.stringify("note-abc")).toString("base64url")],
    [Buffer.from(JSON.stringify({ c: 123, i: "note-abc" })).toString(
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
    expect(decodeVoiceNoteCursor(raw)).toBeNull();
  });
});
