export type TransactionType = "income" | "expense" | "transfer";

export interface TransactionView {
  id: string;
  workspaceId: string;
  type: TransactionType;
  amount: string;
  currency: string;
  businessDate: string;
  timezone: string;
  concept: string;
  accountId: string | null;
  destinationAccountId: string | null; // non-null only for transfers
  categoryId: string | null;
  status: "confirmed" | "voided";
  origin: "manual" | "ticket" | "voice";
  confirmedAt: string;
  revisionCount: number;
}

/** Table row: a confirmed server transaction or a locally queued one. */
export type LedgerRow = TransactionView & { pendingSync?: true };

export const ACCOUNT_KINDS = [
  "cash",
  "bank",
  "savings",
  "credit_card",
  "virtual",
  "investment",
  "loan",
  "insurance",
] as const;

export type AccountKind = (typeof ACCOUNT_KINDS)[number];

export interface AccountView {
  id: string;
  workspaceId: string;
  name: string;
  currency: string;
  kind: string;
  initialBalance: string;
  archivedAt: string | null;
}

export interface CreateAccountInput {
  name: string;
  currency: string;
  kind: string;
  initialBalance?: string;
}

export interface ReviseAccountInput {
  name?: string;
  kind?: string;
  initialBalance?: string;
}

export interface WorkspaceView {
  workspaceId: string;
  locale: string;
  timezone: string;
  defaultCurrency: string;
}

/** Active currency of the workspace catalog (S12-4). */
export interface CurrencyView {
  id: string;
  workspaceId: string;
  code: string;
  nameEn: string;
  nameEs: string;
  minorUnitExponent: number;
  archivedAt: string | null;
}

/** One row of the ISO 4217 catalog exposed by the API (S12-4, L21). */
export interface IsoCurrencyView {
  code: string;
  nameEn: string;
  nameEs: string;
  minorUnitExponent: number;
}

export interface CategoryView {
  id: string;
  key: string;
  label: string;
  nature: string;
  custom: boolean;
}

export interface CreateCategoryInput {
  label: string;
  nature: string;
}

export interface ReviseCategoryInput {
  label?: string;
  nature?: string;
}

export interface CreateTransactionInput {
  type: TransactionType;
  amount: string;
  currency: string;
  businessDate: string;
  timezone: string;
  concept: string;
  accountId: string;
  destinationAccountId?: string | null;
  categoryId: string | null;
  idempotencyKey: string;
}

export interface ReviseTransactionInput {
  type?: TransactionType;
  amount?: string;
  currency?: string;
  businessDate?: string;
  timezone?: string;
  concept?: string;
  accountId?: string;
  destinationAccountId?: string | null;
  categoryId?: string | null;
}

export interface TransactionRevisionView {
  id: string;
  transactionId: string;
  revisionNumber: number;
  kind: "revision" | "void";
  changes: { field: string; previous: string; next: string }[];
  occurredAt: string;
  actor: string;
}
