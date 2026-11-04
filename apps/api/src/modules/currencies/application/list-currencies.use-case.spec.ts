import { describe, expect, it } from "vitest";

import { WorkspaceId } from "../../shared-kernel/index.js";
import { WorkspaceCurrency } from "../domain/workspace-currency.js";
import type { CurrencyRepositoryPort } from "./ports/currency-repository.port.js";
import { ListCurrenciesUseCase } from "./list-currencies.use-case.js";

const wsResult = WorkspaceId.create("ws-1");
if (!wsResult.ok) throw new Error("setup failed");
const ws = wsResult.value;

function stored(id: string, code: string): WorkspaceCurrency {
  const created = WorkspaceCurrency.create({ id, workspaceId: ws, code });
  if (!created.ok) throw new Error("setup failed");
  return created.value;
}

class InMemoryCurrencies implements CurrencyRepositoryPort {
  constructor(private readonly rows: WorkspaceCurrency[]) {}

  async save() {}
  async listActive() {
    return this.rows.filter((c) => c.archivedAt === null);
  }
  async findActiveById() {
    return null;
  }
  async existsCode() {
    return false;
  }
  async countActive() {
    return this.rows.length;
  }
  async isActive() {
    return false;
  }
}

describe("ListCurrenciesUseCase", () => {
  it("lists the active workspace currencies with localizable names", async () => {
    const repo = new InMemoryCurrencies([
      stored("cur-1", "PEN"),
      stored("cur-2", "EUR"),
    ]);
    const useCase = new ListCurrenciesUseCase(repo);

    const views = await useCase.execute(ws);

    expect(views.map((c) => c.code)).toEqual(["PEN", "EUR"]);
    expect(views[0]?.nameEn).toBe("Sol");
    expect(views[0]?.nameEs).toBe("Sol");
    expect(views[1]?.nameEn).toBe("Euro");
    expect(views[1]?.nameEs).toBe("Euro");
  });

  it("hides archived currencies", async () => {
    const archived = stored("cur-2", "USD");
    archived.archive();
    const repo = new InMemoryCurrencies([stored("cur-1", "PEN"), archived]);
    const useCase = new ListCurrenciesUseCase(repo);

    const views = await useCase.execute(ws);

    expect(views.map((c) => c.code)).toEqual(["PEN"]);
  });
});
