/**
 * Canonical merchant normalization (reports-monthly T1, S6) — the single
 * source of truth applied to every `ledger_transactions.merchant` write
 * (manual entry, revision, receipt confirm) and mirrored by the SQL
 * backfill in migration 0010.
 *
 * Rule: lowercase, then per whitespace-separated token remove every
 * non-letter character (digits, punctuation, symbols — `\p{L}` keeps
 * accented letters like "café"), drop tokens that are a company suffix
 * in their letters-only form ("S.A.C." → `sac`), and re-join with a
 * single space. An empty result becomes `null`.
 */

/** Company suffixes in letters-only form (dots/punctuation already stripped). */
const COMPANY_SUFFIXES: ReadonlySet<string> = new Set([
  "sa", // s.a.
  "sac", // s.a.c.
  "srl",
  "eirl", // e.i.r.l.
  "inc",
  "llc",
  "gmbh",
  "ltd",
]);

export function normalizeMerchant(
  raw: string | null | undefined,
): string | null {
  if (raw === null || raw === undefined) {
    return null;
  }
  const tokens = raw
    .toLowerCase()
    .split(/\s+/)
    .map((token) => token.replace(/[^\p{L}]+/gu, ""))
    .filter((token) => token.length > 0 && !COMPANY_SUFFIXES.has(token));
  return tokens.length === 0 ? null : tokens.join(" ");
}
