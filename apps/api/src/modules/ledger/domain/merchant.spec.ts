import { describe, expect, it } from "vitest";

import { normalizeMerchant } from "./merchant.js";

describe("normalizeMerchant (reports-monthly T1, S6)", () => {
  it.each([
    ["STARBUCKS AVIACION 123", "starbucks aviacion"],
    ["Bodega S.A.C.", "bodega"],
    ["Mercado   Central ", "mercado central"],
    ["Acme Inc", "acme"],
    ["Foo GmbH", "foo"],
    ["Bar S.A.", "bar"],
    ["Baz S.R.L.", "baz"],
    ["Qux E.I.R.L.", "qux"],
    ["Holdings LLC", "holdings"],
    ["Retail Ltd", "retail"],
    ["7-ELEVEN", "eleven"],
    ["Café  Central", "café central"],
    // Punctuation is removed inside a token (no space inserted), so
    // "bodega-s.a.c." collapses to one token — the SQL backfill behaves
    // identically by deleting non-letters instead of spacing them.
    ["bodega-s.a.c.", "bodegasac"],
  ])("normalizes %j → %j", (raw, expected) => {
    expect(normalizeMerchant(raw)).toBe(expected);
  });

  it.each(["123", "!!!", "   ", "S.A.", "S.A.C."])(
    "returns null for %j (no letters beyond suffixes)",
    (raw) => {
      expect(normalizeMerchant(raw)).toBeNull();
    },
  );

  it.each([null, undefined])("returns null for a %s input", (raw) => {
    expect(normalizeMerchant(raw)).toBeNull();
  });
});
