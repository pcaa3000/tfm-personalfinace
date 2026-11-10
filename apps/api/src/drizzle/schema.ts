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
 * Drizzle mirror of the Prisma-managed schema (apps/api/prisma/schema.prisma).
 * Table and column names are EXACT: Prisma @@map names the tables and every
 * field maps 1:1 to a camelCase quoted column. This file only describes the
 * existing tables — it never generates migrations.
 */

export const workspaces = pgTable(
  "identity_workspace_workspaces",
  {
    id: text("id").primaryKey(),
    identityKey: text("identityKey").notNull(),
    kind: text("kind").notNull().default("personal"),
    locale: text("locale").notNull().default("en-US"),
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
