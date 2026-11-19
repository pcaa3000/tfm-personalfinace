import {
  DomainError,
  err,
  ok,
  type Result,
} from "../../shared-kernel/index.js";

/**
 * Quarantine gate (receipt-scan-drafts T3, S9 — docs/03 docs/05):
 * an upload is validated BEFORE it touches storage. The MIME type is
 * decided by magic bytes, never by the client-declared Content-Type or
 * the filename extension — a `.jpg` full of bytes that are not a JPEG
 * never leaves the quarantine boundary.
 */

export const RECEIPT_MAX_BYTES_DEFAULT = 5 * 1024 * 1024;

export const RECEIPT_MIME_ALLOWLIST = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
] as const;

export type ReceiptMime = (typeof RECEIPT_MIME_ALLOWLIST)[number];

const EXTENSION_BY_MIME: Record<ReceiptMime, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/heic": "heic",
};

export function extensionForMime(mime: ReceiptMime): string {
  return EXTENSION_BY_MIME[mime];
}

function startsWith(bytes: Uint8Array, signature: readonly number[], offset = 0): boolean {
  if (bytes.byteLength < offset + signature.length) return false;
  return signature.every((b, i) => bytes[offset + i] === b);
}

function ascii(bytes: Uint8Array, offset: number, length: number): string {
  let out = "";
  for (let i = offset; i < offset + length && i < bytes.byteLength; i++) {
    out += String.fromCharCode(bytes[i]!);
  }
  return out;
}

/** HEIC/HEIF brands accepted inside the `ftyp` box. */
const HEIC_BRANDS = new Set([
  "heic",
  "heix",
  "hevc",
  "hevx",
  "mif1",
  "msf1",
  "heim",
  "heis",
  "hevm",
  "hevs",
]);

/**
 * Returns the allowlisted MIME for the byte signature, or null when the
 * bytes match none of them. Inspects only the header — no decode, so a
 * hostile payload cannot reach an image parser at this stage.
 */
export function sniffReceiptMime(bytes: Uint8Array): ReceiptMime | null {
  // JPEG: FF D8 FF
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return "image/jpeg";
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return "image/png";
  }
  // WebP: "RIFF" <4-byte size> "WEBP"
  if (
    startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) &&
    ascii(bytes, 8, 4) === "WEBP"
  ) {
    return "image/webp";
  }
  // HEIC/HEIF: ISO-BMFF box, "ftyp" at offset 4 with a HEIF brand at 8.
  if (ascii(bytes, 4, 4) === "ftyp" && HEIC_BRANDS.has(ascii(bytes, 8, 4))) {
    return "image/heic";
  }
  return null;
}

export interface ReceiptUploadValidation {
  readonly mimeType: ReceiptMime;
}

/**
 * The full quarantine predicate, in order: empty → oversize → type.
 * The caller supplies the configured `maxBytes` (RECEIPT_MAX_BYTES).
 */
export function validateReceiptUpload(input: {
  readonly bytes: Uint8Array;
  readonly maxBytes: number;
}): Result<ReceiptUploadValidation, DomainError> {
  if (input.bytes.byteLength === 0) {
    return err(new DomainError("RECEIPT_EMPTY", "The receipt file is empty"));
  }
  if (input.bytes.byteLength > input.maxBytes) {
    return err(
      new DomainError(
        "RECEIPT_TOO_LARGE",
        `Receipt exceeds the ${input.maxBytes}-byte limit`,
      ),
    );
  }
  const mimeType = sniffReceiptMime(input.bytes);
  if (mimeType === null) {
    return err(
      new DomainError(
        "RECEIPT_TYPE_NOT_ALLOWED",
        "Receipt must be a JPEG, PNG, WebP or HEIC image",
      ),
    );
  }
  return ok({ mimeType });
}
