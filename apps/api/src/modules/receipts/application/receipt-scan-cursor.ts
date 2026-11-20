/**
 * Opaque keyset cursor for `GET /api/v1/receipts` (receipt-review-link
 * T5, S4): the position of the last item of a page — its
 * (`createdAt`, `id`) pair — serialized as base64url JSON
 * `{"c": "<ISO createdAt>", "i": "<id>"}`. Seek pagination over
 * `ORDER BY createdAt DESC, id DESC`, so concurrent inserts never
 * shift a client's next page the way OFFSET would. The token is
 * opaque to clients; only the API encodes/decodes it.
 */
export interface ReceiptScanCursor {
  readonly createdAt: Date;
  readonly id: string;
}

/** Hard bound so an abusive token never reaches the JSON parse. */
const CURSOR_MAX_LENGTH = 512;

export function encodeReceiptScanCursor(cursor: ReceiptScanCursor): string {
  return Buffer.from(
    JSON.stringify({ c: cursor.createdAt.toISOString(), i: cursor.id }),
  ).toString("base64url");
}

/** `null` for ANY malformed token — the route pins this to 400. */
export function decodeReceiptScanCursor(
  raw: string,
): ReceiptScanCursor | null {
  if (raw.length === 0 || raw.length > CURSOR_MAX_LENGTH) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const { c, i } = parsed as { c?: unknown; i?: unknown };
  if (typeof c !== "string" || typeof i !== "string" || i.length === 0) {
    return null;
  }
  const createdAt = new Date(c);
  if (Number.isNaN(createdAt.getTime())) return null;
  return { createdAt, id: i };
}
