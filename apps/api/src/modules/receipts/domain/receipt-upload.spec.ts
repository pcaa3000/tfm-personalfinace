import { describe, expect, it } from "vitest";

import {
  RECEIPT_MAX_BYTES_DEFAULT,
  sniffReceiptMime,
  validateReceiptUpload,
} from "./receipt-upload.js";

const enc = new TextEncoder();

/** Minimal valid magic-byte prefixes per allowed type. */
const JPEG = Uint8Array.from([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01,
]);
const PNG = Uint8Array.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00,
]);
const WEBP = Uint8Array.from([
  0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50,
  0x56, 0x50, 0x38, 0x20,
]);
const HEIC = Uint8Array.from([
  0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63,
  0x00, 0x00, 0x00, 0x00,
]);
/** A file renamed to .jpg whose bytes are plain text (quarantine must reject). */
const FAKE_JPEG = enc.encode("this is definitely not a jpeg file");

describe("sniffReceiptMime — magic bytes, not extension (receipt-scan-drafts T3/S9)", () => {
  it.each([
    [JPEG, "image/jpeg"],
    [PNG, "image/png"],
    [WEBP, "image/webp"],
    [HEIC, "image/heic"],
  ])("detects %s as %s from magic bytes", (bytes, expected) => {
    expect(sniffReceiptMime(bytes)).toBe(expected);
  });

  it.each([
    ["plain text renamed to .jpg", FAKE_JPEG],
    ["empty", new Uint8Array(0)],
    ["truncated jpeg signature", Uint8Array.from([0xff, 0xd8])],
    ["RIFF that is not WEBP (e.g. wav)", Uint8Array.from([
      0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x57, 0x41, 0x56, 0x45,
    ])],
    ["ftyp box with non-image brand (mp4)", Uint8Array.from([
      0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x6d, 0x70, 0x34, 0x32,
    ])],
    ["PDF", enc.encode("%PDF-1.7 fake pdf bytes here")],
  ])("returns null for %s", (_label, bytes) => {
    expect(sniffReceiptMime(bytes)).toBeNull();
  });
});

describe("validateReceiptUpload — quarantine gate before storage (T3/S9)", () => {
  const maxBytes = 1024;

  it("accepts a real image and reports the sniffed mime type", () => {
    const result = validateReceiptUpload({ bytes: JPEG, maxBytes });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.mimeType).toBe("image/jpeg");
    }
  });

  it("rejects an empty body with RECEIPT_EMPTY", () => {
    const result = validateReceiptUpload({
      bytes: new Uint8Array(0),
      maxBytes,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("RECEIPT_EMPTY");
    }
  });

  it("rejects bytes over the configured limit with RECEIPT_TOO_LARGE", () => {
    const big = new Uint8Array(maxBytes + 1);
    big.set(JPEG.slice(0, 4), 0);
    const result = validateReceiptUpload({ bytes: big, maxBytes });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("RECEIPT_TOO_LARGE");
    }
  });

  it("accepts a file of exactly maxBytes", () => {
    const exact = new Uint8Array(maxBytes);
    exact.set(JPEG, 0);
    const result = validateReceiptUpload({ bytes: exact, maxBytes });
    expect(result.ok).toBe(true);
  });

  it("rejects a fake .jpg by magic bytes with RECEIPT_TYPE_NOT_ALLOWED", () => {
    const result = validateReceiptUpload({ bytes: FAKE_JPEG, maxBytes });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("RECEIPT_TYPE_NOT_ALLOWED");
    }
  });

  it("default limit is 5 MiB", () => {
    expect(RECEIPT_MAX_BYTES_DEFAULT).toBe(5 * 1024 * 1024);
  });
});
