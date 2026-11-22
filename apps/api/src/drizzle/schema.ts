import { sql } from "drizzle-orm";
import {
  bigint,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

/**
 * Source of truth for the physical schema; `pnpm db:generate` emits SQL
 * migrations under apps/api/drizzle from changes made here.
 */

export const workspaces = pgTable(
  "identity_workspace_workspaces",
  {
    id: text("id").primaryKey(),
    identityKey: text("identityKey").notNull(),
    kind: text("kind").notNull().default("personal"),
    timezone: text("timezone").notNull().default("UTC"),
    defaultCurrency: text("defaultCurrency").notNull().default("USD"),
    createdAt: timestamp("createdAt", { mode: "date", precision: 3 })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("identity_workspace_workspaces_identityKey_key").on(
      table.identityKey,
    ),
  ],
);

export const categories = pgTable(
  "categorization_categories",
  {
    id: text("id").primaryKey(),
    key: text("key").notNull(),
    label: text("label").notNull(),
    nature: text("nature").notNull(),
    workspaceId: text("workspaceId"),
    archivedAt: timestamp("archivedAt", { mode: "date", precision: 3 }),
  },
  (table) => [
    uniqueIndex("categorization_categories_key_workspaceId_key").on(
      table.key,
      table.workspaceId,
    ),
  ],
);

export const currencies = pgTable(
  "currencies_currencies",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspaceId").notNull(),
    code: text("code").notNull(),
    archivedAt: timestamp("archivedAt", { mode: "date", precision: 3 }),
    createdAt: timestamp("createdAt", { mode: "date", precision: 3 })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updatedAt", { mode: "date", precision: 3 })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("currencies_currencies_workspaceId_code_key").on(
      table.workspaceId,
      table.code,
    ),
    index("currencies_currencies_workspaceId_idx").on(table.workspaceId),
  ],
);

export const accounts = pgTable(
  "accounts_accounts",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspaceId").notNull(),
    name: text("name").notNull(),
    currency: text("currency").notNull(),
    kind: text("kind").notNull().default("bank"),
    initialBalanceMinor: bigint("initialBalanceMinor", {
      mode: "bigint",
    })
      .notNull()
      .default(sql`0`),
    archivedAt: timestamp("archivedAt", { mode: "date", precision: 3 }),
    createdAt: timestamp("createdAt", { mode: "date", precision: 3 })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("accounts_accounts_workspaceId_name_key").on(
      table.workspaceId,
      table.name,
    ),
    index("accounts_accounts_workspaceId_idx").on(table.workspaceId),
  ],
);

export const ledgerTransactions = pgTable(
  "ledger_transactions",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspaceId").notNull(),
    idempotencyKey: text("idempotencyKey").notNull(),
    type: text("type").notNull(),
    amountMinor: bigint("amountMinor", { mode: "bigint" }).notNull(),
    currency: text("currency").notNull(),
    businessDate: date("businessDate", { mode: "date" }).notNull(),
    timezone: text("timezone").notNull(),
    concept: text("concept").notNull(),
    accountId: text("accountId"),
    destinationAccountId: text("destinationAccountId"),
    categoryId: text("categoryId"),
    status: text("status").notNull().default("confirmed"),
    origin: text("origin").notNull().default("manual"),
    originRef: text("originRef"),
    confirmedAt: timestamp("confirmedAt", { mode: "date", precision: 3 }).notNull(),
    confirmedBy: text("confirmedBy").notNull(),
    createdAt: timestamp("createdAt", { mode: "date", precision: 3 })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("ledger_transactions_workspaceId_idempotencyKey_key").on(
      table.workspaceId,
      table.idempotencyKey,
    ),
    index("ledger_transactions_workspaceId_businessDate_idx").on(
      table.workspaceId,
      table.businessDate,
    ),
    foreignKey({
      name: "ledger_transactions_accountId_fkey",
      columns: [table.accountId],
      foreignColumns: [accounts.id],
    }).onDelete("set null").onUpdate("cascade"),
    foreignKey({
      name: "ledger_transactions_destinationAccountId_fkey",
      columns: [table.destinationAccountId],
      foreignColumns: [accounts.id],
    }).onDelete("set null").onUpdate("cascade"),
  ],
);

export const ledgerTransactionRevisions = pgTable(
  "ledger_transaction_revisions",
  {
    id: text("id").primaryKey(),
    transactionId: text("transactionId").notNull(),
    revisionNumber: integer("revisionNumber").notNull(),
    kind: text("kind").notNull(),
    changes: jsonb("changes").notNull(),
    occurredAt: timestamp("occurredAt", { mode: "date", precision: 3 }).notNull(),
    actor: text("actor").notNull(),
  },
  (table) => [
    uniqueIndex("ledger_transaction_revisions_transactionId_revisionNumber_key").on(
      table.transactionId,
      table.revisionNumber,
    ),
    foreignKey({
      name: "ledger_transaction_revisions_transactionId_fkey",
      columns: [table.transactionId],
      foreignColumns: [ledgerTransactions.id],
    }).onDelete("cascade").onUpdate("cascade"),
  ],
);

/**
 * Category-level breakdown of a transaction (receipt-scan-drafts T1, S4).
 * INV-TRX-SPLIT-01 is enforced by the domain aggregate; `position` keeps
 * the collection's order stable across save/load.
 */
export const ledgerTransactionSplits = pgTable(
  "ledger_transaction_splits",
  {
    id: text("id").primaryKey(),
    transactionId: text("transactionId").notNull(),
    categoryId: text("categoryId").notNull(),
    amountMinor: bigint("amountMinor", { mode: "bigint" }).notNull(),
    position: integer("position").notNull(),
  },
  (table) => [
    uniqueIndex("ledger_transaction_splits_transactionId_position_key").on(
      table.transactionId,
      table.position,
    ),
    index("ledger_transaction_splits_transactionId_idx").on(
      table.transactionId,
    ),
    foreignKey({
      name: "ledger_transaction_splits_transactionId_fkey",
      columns: [table.transactionId],
      foreignColumns: [ledgerTransactions.id],
    }).onDelete("cascade").onUpdate("cascade"),
    foreignKey({
      name: "ledger_transaction_splits_categoryId_fkey",
      columns: [table.categoryId],
      foreignColumns: [categories.id],
    }).onDelete("restrict").onUpdate("cascade"),
  ],
);

/**
 * Quarantined receipt uploads (receipt-scan-drafts T3, S9). The object
 * lives in storage under `storageKey`; the row tracks the async pipeline
 * status (`pending` → `extracted` → `draft_ready` → `confirmed`, or
 * `rejected`/`failed`) and carries the extraction/draft payloads plus
 * the confirmed transaction once the user approves the draft (T6).
 */
export const receiptScans = pgTable(
  "receipts_receipt_scans",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspaceId").notNull(),
    uploaderSubject: text("uploaderSubject").notNull(),
    storageKey: text("storageKey").notNull(),
    originalFilename: text("originalFilename").notNull(),
    mimeType: text("mimeType").notNull(),
    sizeBytes: integer("sizeBytes").notNull(),
    status: text("status").notNull().default("pending"),
    extractedPayload: jsonb("extractedPayload"),
    draftPayload: jsonb("draftPayload"),
    transactionId: text("transactionId"),
    // receipt-scan-drafts T13 (S12): SHA-256 hex of the uploaded bytes —
    // exact-hash dedup at upload time. Nullable: rows created before T13
    // have no hash and never collide (NULLs don't match in unique indexes).
    fileHash: text("fileHash"),
    error: text("error"),
    // receipt-retention-30d T1 (S1+S2): fixed 30-day media retention —
    // persisted at creation (createdAt + 30d) and backfilled for legacy
    // rows by migration 0007; never extended by configuration.
    expiresAt: timestamp("expiresAt", { mode: "date", precision: 3 })
      .notNull(),
    // Early/purged media deletion (S3+S4): the storage object is gone;
    // the scan row and its transaction survive (CA-012).
    mediaDeletedAt: timestamp("mediaDeletedAt", { mode: "date", precision: 3 }),
    createdAt: timestamp("createdAt", { mode: "date", precision: 3 })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updatedAt", { mode: "date", precision: 3 })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("receipts_receipt_scans_workspaceId_idx").on(table.workspaceId),
    uniqueIndex("receipts_receipt_scans_workspaceId_fileHash_key").on(
      table.workspaceId,
      table.fileHash,
    ),
    foreignKey({
      name: "receipts_receipt_scans_transactionId_fkey",
      columns: [table.transactionId],
      foreignColumns: [ledgerTransactions.id],
    }).onDelete("set null").onUpdate("cascade"),
  ],
);

/**
 * Quarantined voice-note uploads (voice-drafts T1, S5) — the sibling
 * mirror of `receipts_receipt_scans`. The object lives in storage under
 * `storageKey`; the row tracks the async pipeline status (`pending` →
 * `draft_ready` → `confirmed`, or `rejected`/`failed`) and carries the
 * extraction/draft payloads, the persisted transcript (S7 — same
 * sensitivity as the audio) and the confirmed transaction once the
 * user approves the draft (T3).
 */
export const voiceNotes = pgTable(
  "voices_voice_notes",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspaceId").notNull(),
    uploaderSubject: text("uploaderSubject").notNull(),
    storageKey: text("storageKey").notNull(),
    originalFilename: text("originalFilename").notNull(),
    mimeType: text("mimeType").notNull(),
    sizeBytes: integer("sizeBytes").notNull(),
    status: text("status").notNull().default("pending"),
    extractedPayload: jsonb("extractedPayload"),
    draftPayload: jsonb("draftPayload"),
    // S7: the LLM transcript — same 30-day retention as the audio.
    transcript: text("transcript"),
    transactionId: text("transactionId"),
    // S5: SHA-256 hex of the uploaded bytes — exact-hash dedup at
    // upload time, same mechanics as the receipts scans table.
    fileHash: text("fileHash"),
    error: text("error"),
    // S7: fixed 30-day media retention — persisted at creation
    // (createdAt + 30d) from day one; never extended by configuration.
    expiresAt: timestamp("expiresAt", { mode: "date", precision: 3 })
      .notNull(),
    // Early/purged media deletion (S7): the storage object is gone;
    // the note row and its transaction survive.
    mediaDeletedAt: timestamp("mediaDeletedAt", { mode: "date", precision: 3 }),
    createdAt: timestamp("createdAt", { mode: "date", precision: 3 })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updatedAt", { mode: "date", precision: 3 })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("voices_voice_notes_workspaceId_idx").on(table.workspaceId),
    uniqueIndex("voices_voice_notes_workspaceId_fileHash_key").on(
      table.workspaceId,
      table.fileHash,
    ),
    foreignKey({
      name: "voices_voice_notes_transactionId_fkey",
      columns: [table.transactionId],
      foreignColumns: [ledgerTransactions.id],
    }).onDelete("set null").onUpdate("cascade"),
  ],
);

/**
 * Provider-consent records (voice-drafts T5, S6 — docs/05 RF-070 +
 * revocación): ONE row per (workspace, subject, provider) keeps the
 * latest decision with both instants — `grantedAt`/`revokedAt` are
 * nullable because an explicit refusal has no grant and an active
 * consent has no revoke. The record is never deleted on revoke.
 */
export const voiceConsents = pgTable(
  "voices_voice_consents",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspaceId").notNull(),
    subject: text("subject").notNull(),
    provider: text("provider").notNull(),
    grantedAt: timestamp("grantedAt", { mode: "date", precision: 3 }),
    revokedAt: timestamp("revokedAt", { mode: "date", precision: 3 }),
    createdAt: timestamp("createdAt", { mode: "date", precision: 3 })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updatedAt", { mode: "date", precision: 3 })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex(
      "voices_voice_consents_workspaceId_subject_provider_key",
    ).on(table.workspaceId, table.subject, table.provider),
  ],
);

/**
 * Transactional outbox (worker-pgboss-outbox S1): domain events are
 * inserted in the SAME transaction as the business write; a separate
 * worker drains pending rows (`processedAt IS NULL`) into pg-boss.
 */
export const outboxEvents = pgTable(
  "jobs_outbox_events",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspaceId").notNull(),
    type: text("type").notNull(),
    payload: jsonb("payload").notNull(),
    occurredAt: timestamp("occurredAt", { mode: "date", precision: 3 })
      .notNull()
      .defaultNow(),
    processedAt: timestamp("processedAt", { mode: "date", precision: 3 }),
  },
  (table) => [
    index("jobs_outbox_events_workspaceId_idx").on(table.workspaceId),
    index("jobs_outbox_events_pending_idx").on(table.processedAt),
  ],
);

/** Consumer output of the ledger-events queue (S2/S3). */
export const notifications = pgTable(
  "notifications_notifications",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspaceId").notNull(),
    kind: text("kind").notNull(),
    title: text("title").notNull(),
    body: text("body").notNull(),
    createdAt: timestamp("createdAt", { mode: "date", precision: 3 })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("notifications_notifications_workspaceId_idx").on(
      table.workspaceId,
    ),
  ],
);
