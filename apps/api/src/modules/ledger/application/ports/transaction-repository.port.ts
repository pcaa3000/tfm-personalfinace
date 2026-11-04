import type { WorkspaceId } from "../../../shared-kernel/index.js";
import type { Transaction, TransactionType } from "../../domain/transaction.js";

export interface TransactionFilter {
  readonly from?: string; // YYYY-MM-DD inclusive
  readonly to?: string; // YYYY-MM-DD inclusive
  readonly type?: TransactionType;
  readonly currency?: string;
  /** "uncategorized" filters the explicit uncategorized state. */
  readonly category?: string;
  /** Case-insensitive substring match on concept. */
  readonly q?: string;
  /** Page size (RF-013); unbounded when omitted. */
  readonly limit?: number;
  /** Rows to skip before the page (RF-013). */
  readonly offset?: number;
}

/** Write-side and query-side access to ledger transactions (ISP). */
export interface TransactionRepositoryPort {
  findByIdempotencyKey(
    workspaceId: WorkspaceId,
    idempotencyKey: string,
  ): Promise<Transaction | null>;

  findById(workspaceId: WorkspaceId, id: string): Promise<Transaction | null>;

  save(transaction: Transaction): Promise<void>;

  list(workspaceId: WorkspaceId, filter: TransactionFilter): Promise<Transaction[]>;
}

export const TRANSACTION_REPOSITORY = Symbol("TRANSACTION_REPOSITORY");
