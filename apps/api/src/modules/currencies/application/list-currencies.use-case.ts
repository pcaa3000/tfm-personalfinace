import type { WorkspaceId } from "../../shared-kernel/index.js";
import type { CurrencyRepositoryPort } from "./ports/currency-repository.port.js";
import { toCurrencyView, type CurrencyView } from "./currency.view.js";

/** Lists the active currencies of the workspace catalog. */
export class ListCurrenciesUseCase {
  constructor(private readonly currencies: CurrencyRepositoryPort) {}

  async execute(workspaceId: WorkspaceId): Promise<CurrencyView[]> {
    const currencies = await this.currencies.listActive(workspaceId);
    return currencies.map(toCurrencyView);
  }
}
