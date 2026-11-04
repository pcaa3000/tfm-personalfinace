import { describe, expect, it } from "vitest";

import { WorkspaceId } from "../../shared-kernel/index.js";
import type { WorkspaceCurrency } from "../domain/workspace-currency.js";
import type { CurrencyRepositoryPort } from "./ports/currency-repository.port.js";
import { AddCurrencyUseCase } from "./add-currency.use-case.js";

class InMemoryCurrencies implements CurrencyRepositoryPort {
  saved: WorkspaceCurrency[] = [];

  async save(currency: WorkspaceCurrency) {
    this.saved.push(currency);
  }
  async listActive() {
    return this.saved.filter((c) => c.archivedAt === null);
  }
  async findActiveById(_workspaceId: unknown, id: string) {
    return this.saved.find((c) => c.id === id && c.archivedAt === null) ?? null;
  }
  async existsCode(_workspaceId: unknown, code: string) {
    return this.saved.some((c) => c.code.code === code);
  }
  async countActive() {
    return this.saved.filter((c) => c.archivedAt === null).length;
  }
  async isActive(_workspaceId: unknown, code: string) {
    return this.saved.some((c) => c.code.code === code && c.archivedAt === null);
  }
}

const ids = { next: () => "cur-generated" };

const wsResult = WorkspaceId.create("ws-1");
if (!wsResult.ok) throw new Error("setup failed");
const ws = wsResult.value;

describe("AddCurrencyUseCase (INV-MON-01)", () => {
  it("adds a known ISO currency to the workspace catalog", async () => {
    const repo = new InMemoryCurrencies();
    const useCase = new AddCurrencyUseCase(repo, ids);

    const result = await useCase.execute({ workspaceId: ws, code: "USD" });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.id).toBe("cur-generated");
    expect(result.value.code).toBe("USD");
    expect(result.value.nameEn).toBe("US Dollar");
    expect(result.value.nameEs).toBe("Dólar estadounidense");
    expect(result.value.minorUnitExponent).toBe(2);
    expect(repo.saved).toHaveLength(1);
  });

  it("rejects a code absent from the ISO table (e.g. CHP)", async () => {
    const repo = new InMemoryCurrencies();
    const useCase = new AddCurrencyUseCase(repo, ids);

    const result = await useCase.execute({ workspaceId: ws, code: "CHP" });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("CURRENCY_UNKNOWN_ISO");
    expect(repo.saved).toHaveLength(0);
  });

  it("rejects a malformed code", async () => {
    const repo = new InMemoryCurrencies();
    const useCase = new AddCurrencyUseCase(repo, ids);

    const result = await useCase.execute({ workspaceId: ws, code: "US1" });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("CURRENCY_INVALID_CODE");
    expect(repo.saved).toHaveLength(0);
  });

  it("rejects a code already present in the workspace", async () => {
    const repo = new InMemoryCurrencies();
    const useCase = new AddCurrencyUseCase(repo, ids);
    await useCase.execute({ workspaceId: ws, code: "USD" });

    const result = await useCase.execute({ workspaceId: ws, code: "USD" });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("CURRENCY_CODE_TAKEN");
    expect(repo.saved).toHaveLength(1);
  });
});
