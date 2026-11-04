import {
  DomainError,
  err,
  ok,
  type Result,
} from "../../shared-kernel/index.js";
import type { WorkspaceId } from "../../shared-kernel/index.js";
import type { CurrencyRepositoryPort } from "./ports/currency-repository.port.js";
import type { CurrencyUsagePort } from "./ports/currency-usage.port.js";
import { toCurrencyView, type CurrencyView } from "./currency.view.js";

export interface ArchiveCurrencyCommand {
  readonly workspaceId: WorkspaceId;
  readonly currencyId: string;
  /** Server-resolved workspace default currency (never client input). */
  readonly defaultCurrency: string;
}

/**
 * Archives a catalog entry (INV-MON-02). Blocked when the code is the
 * workspace default, is used by any account or transaction, or is the
 * last active currency of the workspace.
 */
export class ArchiveCurrencyUseCase {
  constructor(
    private readonly currencies: CurrencyRepositoryPort,
    private readonly usage: CurrencyUsagePort,
  ) {}

  async execute(
    command: ArchiveCurrencyCommand,
  ): Promise<Result<CurrencyView, DomainError>> {
    const currency = await this.currencies.findActiveById(
      command.workspaceId,
      command.currencyId,
    );
    if (!currency) {
      return err(
        new DomainError("CURRENCY_NOT_FOUND", "Currency not found"),
      );
    }
    if (currency.code.code === command.defaultCurrency) {
      return err(
        new DomainError(
          "CURRENCY_IS_DEFAULT",
          `Currency ${currency.code.code} is the workspace default currency`,
        ),
      );
    }
    const usage = await this.usage.usageOf(
      command.workspaceId,
      currency.code.code,
    );
    if (usage.accounts > 0 || usage.transactions > 0) {
      return err(
        new DomainError(
          "CURRENCY_IN_USE",
          `Currency ${currency.code.code} is used by ${usage.accounts} account(s) and ${usage.transactions} transaction(s)`,
        ),
      );
    }
    if ((await this.currencies.countActive(command.workspaceId)) <= 1) {
      return err(
        new DomainError(
          "CURRENCY_LAST_ACTIVE",
          "The workspace must keep at least one active currency",
        ),
      );
    }
    const archived = currency.archive();
    if (!archived.ok) {
      return archived;
    }
    await this.currencies.save(currency);
    return ok(toCurrencyView(currency));
  }
}
