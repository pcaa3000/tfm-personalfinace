import {
  CurrencyCode,
  DomainError,
  err,
  ok,
  type Result,
} from "../../shared-kernel/index.js";
import type { WorkspaceId } from "../../shared-kernel/index.js";
import type { CurrencyRepositoryPort } from "./ports/currency-repository.port.js";
import type { CurrencyUsagePort } from "./ports/currency-usage.port.js";
import { toCurrencyView, type CurrencyView } from "./currency.view.js";

export interface ReviseCurrencyCommand {
  readonly workspaceId: WorkspaceId;
  readonly currencyId: string;
  readonly code: string;
}

/**
 * Renames a catalog code only while nothing uses it (INV-MON-04): a
 * code in use by accounts or transactions cannot change because the
 * minor-unit exponent may differ (CLP=0 vs default=2) and the stored
 * arithmetic would silently corrupt.
 */
export class ReviseCurrencyUseCase {
  constructor(
    private readonly currencies: CurrencyRepositoryPort,
    private readonly usage: CurrencyUsagePort,
  ) {}

  async execute(
    command: ReviseCurrencyCommand,
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
    const parsed = CurrencyCode.create(command.code);
    if (!parsed.ok) {
      return err(parsed.error);
    }
    if (parsed.value.equals(currency.code)) {
      return err(
        new DomainError(
          "CURRENCY_NO_CHANGES",
          "A revision must change the currency code",
        ),
      );
    }
    if (
      await this.currencies.existsCode(command.workspaceId, parsed.value.code)
    ) {
      return err(
        new DomainError(
          "CURRENCY_CODE_TAKEN",
          `Currency ${parsed.value.code} is already in the workspace catalog`,
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
    const changed = currency.changeCode(parsed.value.code);
    if (!changed.ok) {
      return changed;
    }
    await this.currencies.save(currency);
    return ok(toCurrencyView(currency));
  }
}
