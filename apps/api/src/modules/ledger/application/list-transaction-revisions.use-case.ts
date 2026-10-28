import {
  DomainError,
  WorkspaceId,
  err,
  ok,
  type Result,
} from "../../shared-kernel/index.js";
import type { TransactionRepositoryPort } from "./ports/transaction-repository.port.js";
import {
  toTransactionRevisionView,
  type TransactionRevisionView,
} from "./transaction-revision.view.js";

export class ListTransactionRevisionsUseCase {
  constructor(private readonly transactions: TransactionRepositoryPort) {}

  async execute(
    workspaceId: WorkspaceId,
    transactionId: string,
  ): Promise<Result<TransactionRevisionView[], DomainError>> {
    const transaction = await this.transactions.findById(
      workspaceId,
      transactionId,
    );
    if (!transaction) {
      return err(
        new DomainError(
          "TRANSACTION_NOT_FOUND",
          `Transaction not found: ${transactionId}`,
        ),
      );
    }
    return ok(transaction.revisions.map(toTransactionRevisionView));
  }
}
