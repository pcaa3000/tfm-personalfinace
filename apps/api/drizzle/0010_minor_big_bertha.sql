ALTER TABLE "ledger_transactions" ADD COLUMN "merchant" text;--> statement-breakpoint
-- Backfill (reports-monthly T1, S6): SQL mirror of normalizeMerchant() in
-- src/modules/ledger/domain/merchant.ts — lowercase, delete every
-- non-letter non-whitespace character (same as the JS per-token strip:
-- deleting punctuation inside a token never introduces a space), drop
-- company-suffix words in their letters-only form, collapse whitespace,
-- and NULL the empty result. [[:alpha:]] matches Unicode letters under
-- the UTF-8 database encoding, equivalent to the JS \p{L} class.
UPDATE "ledger_transactions"
SET "merchant" = NULLIF(
  btrim(
    regexp_replace(
      regexp_replace(
        regexp_replace(lower("concept"), '[^[:alpha:][:space:]]', '', 'g'),
        '\m(sa|sac|srl|eirl|inc|llc|gmbh|ltd)\M', '', 'g'
      ),
      '\s+', ' ', 'g'
    )
  ),
  ''
)
WHERE "type" <> 'transfer';
