import {
  DomainError,
  err,
  ok,
  type Result,
} from "../../shared-kernel/index.js";

/**
 * Quarantine gate (voice-drafts T1, S1): an upload is validated BEFORE
 * it touches storage. The MIME type is decided by magic bytes, never by
 * the client-declared Content-Type or the filename extension — a
 * `.webm` full of bytes that are not EBML never leaves the quarantine
 * boundary.
 */

export const VOICE_MAX_BYTES_DEFAULT = 5 * 1024 * 1024;

/**
 * S1 audio allowlist: `audio/mp3` is an alias of `audio/mpeg` and
 * `audio/m4a` of `audio/mp4` — the sniffer returns the canonical spellings
 * (`audio/mpeg`, `audio/mp4`) but both spellings stay allowed.
 */
export const VOICE_MIME_ALLOWLIST = [
  "audio/webm",
  "audio/ogg",
  "audio/mpeg",
  "audio/mp3",
  "audio/wav",
  "audio/mp4",
  "audio/m4a",
] as const;

export type VoiceMime = (typeof VOICE_MIME_ALLOWLIST)[number];

const EXTENSION_BY_MIME: Record<VoiceMime, string> = {
  "audio/webm": "webm",
  "audio/ogg": "ogg",
  "audio/mpeg": "mp3",
  "audio/mp3": "mp3",
  "audio/wav": "wav",
  "audio/mp4": "m4a",
  "audio/m4a": "m4a",
};

export function extensionForMime(mime: VoiceMime): string {
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

/**
 * ISO-BMFF `ftyp` major brands treated as MP4-family audio. The major
 * brand cannot prove an audio-only track (an `isom` file may carry
 * video) — it proves container family, which is what the quarantine
 * boundary guards: anything else (images, pdf, executables) is rejected.
 */
const MP4_AUDIO_BRANDS = new Set([
  "M4A ",
  "M4B ",
  "mp41",
  "mp42",
  "isom",
  "iso2",
]);

/**
 * Returns the allowlisted MIME for the byte signature, or null when the
 * bytes match none of them. Inspects only the header — no decode, so a
 * hostile payload cannot reach an audio parser at this stage.
 */
export function sniffVoiceMime(bytes: Uint8Array): VoiceMime | null {
  // WebM/Matroska: EBML header 1A 45 DF A3
  if (startsWith(bytes, [0x1a, 0x45, 0xdf, 0xa3])) return "audio/webm";
  // Ogg: "OggS"
  if (startsWith(bytes, [0x4f, 0x67, 0x67, 0x53])) return "audio/ogg";
  // MP3: ID3v2 tag "ID3", or an MPEG audio frame sync (11 sync bits).
  if (startsWith(bytes, [0x49, 0x44, 0x33])) return "audio/mpeg";
  if (
    bytes.byteLength >= 2 &&
    bytes[0] === 0xff &&
    (bytes[1]! & 0xe0) === 0xe0
  ) {
    return "audio/mpeg";
  }
  // WAV: "RIFF" <4-byte size> "WAVE"
  if (
    startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) &&
    ascii(bytes, 8, 4) === "WAVE"
  ) {
    return "audio/wav";
  }
  // M4A/MP4 audio: ISO-BMFF box, "ftyp" at offset 4 with an audio brand.
  if (ascii(bytes, 4, 4) === "ftyp" && MP4_AUDIO_BRANDS.has(ascii(bytes, 8, 4))) {
    return "audio/mp4";
  }
  return null;
}

export interface VoiceUploadValidation {
  readonly mimeType: VoiceMime;
}

/**
 * The full quarantine predicate, in order: empty → oversize → type.
 * The caller supplies the configured `maxBytes` (VOICE_MAX_BYTES).
 */
export function validateVoiceUpload(input: {
  readonly bytes: Uint8Array;
  readonly maxBytes: number;
}): Result<VoiceUploadValidation, DomainError> {
  if (input.bytes.byteLength === 0) {
    return err(new DomainError("VOICE_EMPTY", "The voice note file is empty"));
  }
  if (input.bytes.byteLength > input.maxBytes) {
    return err(
      new DomainError(
        "VOICE_TOO_LARGE",
        `Voice note exceeds the ${input.maxBytes}-byte limit`,
      ),
    );
  }
  const mimeType = sniffVoiceMime(input.bytes);
  if (mimeType === null) {
    return err(
      new DomainError(
        "VOICE_TYPE_NOT_ALLOWED",
        "Voice note must be a WebM, OGG, MP3, WAV or M4A audio",
      ),
    );
  }
  return ok({ mimeType });
}
