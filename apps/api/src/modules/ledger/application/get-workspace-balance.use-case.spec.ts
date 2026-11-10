import { describe, expect, it } from "vitest";

import { WorkspaceId } from "../../shared-kernel/index.js";
import { GetWorkspaceBalanceUseCase } from "./get-workspace-balance.use-case.js";
import type {
  BalanceQueryPort,
  CurrencyTotals,
} from "./ports/balance-query.port.js";

const WS = (() => {
  const result = WorkspaceId.create("ws-balance-spec");
  if (!result.ok) {
    throw result.error;
  }
  return result.value;
})();

class FakeBalanceQuery implements BalanceQueryPort {
  rows: CurrencyTotals[] = [];

  async sumByCurrency(): Promise<CurrencyTotals[]> {
    return this.rows;
  }
}

describe("GetWorkspaceBalanceUseCase", () => {
  it("maps minor-unit totals to decimal strings with net and balance", async () => {
    const query = new FakeBalanceQuery();
    query.rows = [
      {
        currency: "USD",
        initialBalanceMinor: 120000n,
        incomeMinor: 85000n,
        expenseMinor: 6598n,
      },
      {
        currency: "PEN",
        initialBalanceMinor: 520000n,
        incomeMinor: 450000n,
        expenseMinor: 56575n,
      },
    ];
    const useCase = new GetWorkspaceBalanceUseCase(query);

    const items = await useCase.execute(WS);

    expect(items).toEqual([
      {
        currency: "PEN",
        initialBalance: "5200.00",
        income: "4500.00",
        expenses: "565.75",
        net: "3934.25",
        balance: "9134.25",
      },
      {
        currency: "USD",
        initialBalance: "1200.00",
        income: "850.00",
        expenses: "65.98",
        net: "784.02",
        balance: "1984.02",
      },
    ]);
  });

  it("honors non-2 minor unit exponents (JPY has 0)", async () => {
    const query = new FakeBalanceQuery();
    query.rows = [
      {
        currency: "JPY",
        initialBalanceMinor: 0n,
        incomeMinor: 1500n,
        expenseMinor: 0n,
      },
    ];
    const useCase = new GetWorkspaceBalanceUseCase(query);

    const items = await useCase.execute(WS);

    expect(items[0]?.income).toBe("1500");
    expect(items[0]?.balance).toBe("1500");
  });

  it("returns an empty list when the workspace has no activity", async () => {
    const query = new FakeBalanceQuery();
    const useCase = new GetWorkspaceBalanceUseCase(query);

    expect(await useCase.execute(WS)).toEqual([]);
  });
});
