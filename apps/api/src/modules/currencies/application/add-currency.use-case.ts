import {
  CurrencyCode,
  DomainError,
  err,
  ok,
  type Result,
} from "../../shared-kernel/index.js";
import type { WorkspaceId } from "../../shared-kernel/index.js";
import type { IdGenerator } from "../../ledger/index.js";
import { WorkspaceCurrency } from "../domain/workspace-currency.js";
import type { CurrencyRepositoryPort } from "./ports/currency-repository.port.js";
import { toCurrencyView, type CurrencyView } from "./currency.view.js";

export interface AddCurrencyCommand {
  readonly workspaceId: WorkspaceId;
  readonly code: string;
}

/**
 * Adds an ISO 4217 code to the workspace currency catalog (INV-MON-01).
 * Codes absent from the ISO table are rejected — custom non-ISO
 * currencies are out of the MVP (L20).
 */
export class AddCurrencyUseCase {
  constructor(
    private readonly currencies: CurrencyRepositoryPort,
    private readonly ids: IdGenerator,
  ) {}

  async execute(
    command: AddCurrencyCommand,
  ): Promise<Result<CurrencyView, DomainError>> {
    const parsed = CurrencyCode.create(command.code);
    if (!parsed.ok) {
      return err(parsed.error);
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
    const currency = WorkspaceCurrency.create({
      id: this.ids.next(),
      workspaceId: command.workspaceId,
      code: parsed.value.code,
    });
    if (!currency.ok) {
      return currency;
    }
    await this.currencies.save(currency.value);
    return ok(toCurrencyView(currency.value));
  }
}
