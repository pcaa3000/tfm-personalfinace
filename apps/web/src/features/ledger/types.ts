export interface TransactionView {
  id: string;
  workspaceId: string;
  type: "income" | "expense";
  amount: string;
  currency: string;
  businessDate: string;
  timezone: string;
  concept: string;
  categoryId: string | null;
  status: "confirmed" | "voided";
  origin: "manual" | "ticket" | "voice";
  confirmedAt: string;
  revisionCount: number;
}

export interface CategoryView {
  id: string;
  key: string;
  label: string;
  nature: string;
}

export interface CreateTransactionInput {
  type: "income" | "expense";
  amount: string;
  currency: string;
  businessDate: string;
  timezone: string;
  concept: string;
  categoryId: string | null;
  idempotencyKey: string;
}
