import type { WorkspaceId } from "../../shared-kernel/index.js";
import { toBalanceItemView, type BalanceItemView } from "./balance.view.js";
import type { BalanceQueryPort } from "./ports/balance-query.port.js";

/**
 * Per-currency totals feeding the "Balance general por moneda" strip
 * (S12-5): saldo actual = saldos iniciales de cuentas activas + ingresos
 * − gastos confirmados; transfers count net 0. Currencies are never
 * summed together (RN-005) — each item is a separate currency.
 */
export class GetWorkspaceBalanceUseCase {
  constructor(private readonly balanceQuery: BalanceQueryPort) {}

  async execute(workspaceId: WorkspaceId): Promise<BalanceItemView[]> {
    const rows = await this.balanceQuery.sumByCurrency(workspaceId);
    return [...rows]
      .sort((a, b) => a.currency.localeCompare(b.currency))
      .map(toBalanceItemView);
  }
}
