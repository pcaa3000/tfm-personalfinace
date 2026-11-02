export interface TransactionView {
  id: string;
  workspaceId: string;
  type: "income" | "expense";
  amount: string;
  currency: string;
  businessDate: string;
  timezone: string;
  concept: string;
  accountId: string | null;
  categoryId: string | null;
  status: "confirmed" | "voided";
  origin: "manual" | "ticket" | "voice";
  confirmedAt: string;
  revisionCount: number;
}

/** Table row: a confirmed server transaction or a locally queued one. */
export type LedgerRow = TransactionView & { pendingSync?: true };

export interface AccountView {
  id: string;
  workspaceId: string;
  name: string;
  currency: string;
  kind: string;
}
export interface CreateAccountInput {
  name: string;
  currency: string;
  kind: string;
}
export interface WorkspaceView {
  workspaceId: string;
  locale: string;
  timezone: string;
  defaultCurrency: string;
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
  type: "income" | "expense";
  amount: string;
  currency: string;
  businessDate: string;
  timezone: string;
  concept: string;
  accountId: string;
  categoryId: string | null;
  idempotencyKey: string;
}

export interface ReviseTransactionInput {
  type?: "income" | "expense";
  amount?: string;
  currency?: string;
  businessDate?: string;
  timezone?: string;
  concept?: string;
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
