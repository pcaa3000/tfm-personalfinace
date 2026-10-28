import type { WorkspaceId } from "../../shared-kernel/index.js";
import type {
  TransactionFilter,
  TransactionRepositoryPort,
} from "./ports/transaction-repository.port.js";
import { toTransactionView, type TransactionView } from "./transaction.view.js";

export class ListTransactionsUseCase {
  constructor(private readonly transactions: TransactionRepositoryPort) {}

  async execute(
    workspaceId: WorkspaceId,
    filter: TransactionFilter,
  ): Promise<TransactionView[]> {
    const transactions = await this.transactions.list(workspaceId, filter);
    return transactions.map(toTransactionView);
  }
}
