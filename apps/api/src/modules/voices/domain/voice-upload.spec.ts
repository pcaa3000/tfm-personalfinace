import { describe, expect, it } from "vitest";

import {
  extensionForMime,
  sniffVoiceMime,
  validateVoiceUpload,
  VOICE_MAX_BYTES_DEFAULT,
  VOICE_MIME_ALLOWLIST,
} from "./voice-upload.js";

const enc = new TextEncoder();

/** Minimal valid magic-byte prefixes per allowed audio type. */
const WEBM = Uint8Array.from([
  0x1a, 0x45, 0xdf, 0xa3, 0x93, 0x42, 0x82, 0x88, 0x6d, 0x61, 0x74, 0x72,
]);
const OGG = Uint8Array.from([
  0x4f, 0x67, 0x67, 0x53, 0x00, 0x02, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
]);
const MP3_ID3 = Uint8Array.from([
  0x49, 0x44, 0x33, 0x04, 0x00, 0x00, 0x00, 0x00, 0x00, 0x21, 0x54, 0x53,
]);
const MP3_FRAME = Uint8Array.from([
  0xff, 0xfb, 0x90, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
]);
const WAV = Uint8Array.from([
  0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x57, 0x41, 0x56, 0x45,
  0x66, 0x6d, 0x74, 0x20,
]);
const M4A = Uint8Array.from([
  0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x4d, 0x34, 0x41, 0x20,
  0x00, 0x00, 0x00, 0x00,
]);
/** A file renamed to .webm whose bytes are plain text. */
const FAKE_WEBM = enc.encode("this is definitely not a webm file");

describe("sniffVoiceMime — magic bytes, not extension (voice-drafts T1, S1)", () => {
  it.each([
    [WEBM, "audio/webm"],
    [OGG, "audio/ogg"],
    [MP3_ID3, "audio/mpeg"],
    [MP3_FRAME, "audio/mpeg"],
    [WAV, "audio/wav"],
    [M4A, "audio/mp4"],
  ])("detects %s as %s from magic bytes", (bytes, expected) => {
    expect(sniffVoiceMime(bytes)).toBe(expected);
  });

  it.each([
    ["plain text renamed to .webm", FAKE_WEBM],
    ["empty", new Uint8Array(0)],
    ["truncated EBML signature", Uint8Array.from([0x1a, 0x45, 0xdf])],
    ["RIFF that is not WAVE (e.g. webp)", Uint8Array.from([
      0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50,
    ])],
    ["ftyp box with an image brand (heic)", Uint8Array.from([
      0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63,
    ])],
    ["JPEG", Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10])],
    ["PDF", enc.encode("%PDF-1.7 fake pdf bytes here")],
  ])("returns null for %s", (_label, bytes) => {
    expect(sniffVoiceMime(bytes)).toBeNull();
  });
});

describe("validateVoiceUpload — quarantine gate before storage (T1, S1)", () => {
  const maxBytes = 1024;

  it("the allowlist covers the spec audio types", () => {
    expect(VOICE_MIME_ALLOWLIST).toEqual([
      "audio/webm",
      "audio/ogg",
      "audio/mpeg",
      "audio/mp3",
      "audio/wav",
      "audio/mp4",
      "audio/m4a",
    ]);
  });

  it("accepts a real audio file and reports the sniffed mime type", () => {
    const result = validateVoiceUpload({ bytes: WEBM, maxBytes });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.mimeType).toBe("audio/webm");
    }
  });

  it("rejects an empty body with VOICE_EMPTY", () => {
    const result = validateVoiceUpload({
      bytes: new Uint8Array(0),
      maxBytes,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("VOICE_EMPTY");
    }
  });

  it("rejects bytes over the configured limit with VOICE_TOO_LARGE", () => {
    const big = new Uint8Array(maxBytes + 1);
    big.set(WEBM.slice(0, 4), 0);
    const result = validateVoiceUpload({ bytes: big, maxBytes });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("VOICE_TOO_LARGE");
    }
  });

  it("accepts a file of exactly maxBytes", () => {
    const exact = new Uint8Array(maxBytes);
    exact.set(WEBM, 0);
    const result = validateVoiceUpload({ bytes: exact, maxBytes });
    expect(result.ok).toBe(true);
  });

  it("rejects a fake .webm by magic bytes with VOICE_TYPE_NOT_ALLOWED", () => {
    const result = validateVoiceUpload({ bytes: FAKE_WEBM, maxBytes });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("VOICE_TYPE_NOT_ALLOWED");
    }
  });

  it("default limit is 5 MiB (S1)", () => {
    expect(VOICE_MAX_BYTES_DEFAULT).toBe(5 * 1024 * 1024);
  });

  it("the storage-key extension follows the sniffed mime", () => {
    expect(extensionForMime("audio/webm")).toBe("webm");
    expect(extensionForMime("audio/ogg")).toBe("ogg");
    expect(extensionForMime("audio/mpeg")).toBe("mp3");
    expect(extensionForMime("audio/mp3")).toBe("mp3");
    expect(extensionForMime("audio/wav")).toBe("wav");
    expect(extensionForMime("audio/mp4")).toBe("m4a");
    expect(extensionForMime("audio/m4a")).toBe("m4a");
  });
});
