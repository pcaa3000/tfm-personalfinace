import {
  DomainError,
  WorkspaceId,
  err,
  ok,
  type Result,
} from "../../shared-kernel/index.js";
import type { Clock } from "./ports/clock.port.js";
import type { TransactionRepositoryPort } from "./ports/transaction-repository.port.js";
import { toTransactionView, type TransactionView } from "./transaction.view.js";

export interface VoidTransactionCommand {
  readonly workspaceId: WorkspaceId;
  readonly transactionId: string;
  readonly actor: string;
}

export class VoidTransactionUseCase {
  constructor(
    private readonly transactions: TransactionRepositoryPort,
    private readonly clock: Clock,
  ) {}

  async execute(
    command: VoidTransactionCommand,
  ): Promise<Result<TransactionView, DomainError>> {
    const transaction = await this.transactions.findById(
      command.workspaceId,
      command.transactionId,
    );
    if (!transaction) {
      return err(
        new DomainError(
          "TRANSACTION_NOT_FOUND",
          `Transaction not found: ${command.transactionId}`,
        ),
      );
    }

    // Idempotent replay: voiding an already-voided transaction returns the
    // current state without appending a second revision.
    if (transaction.status === "voided") {
      return ok(toTransactionView(transaction));
    }

    const revision = transaction.void({
      voidedAt: this.clock.now(),
      voidedBy: command.actor,
    });
    if (!revision.ok) {
      return revision;
    }

    await this.transactions.save(transaction);
    return ok(toTransactionView(transaction));
  }
}
