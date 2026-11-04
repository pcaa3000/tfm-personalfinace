import { describe, expect, it } from "vitest";

import { WorkspaceId } from "../../shared-kernel/index.js";
import { WorkspaceCurrency } from "../domain/workspace-currency.js";
import type { CurrencyRepositoryPort } from "./ports/currency-repository.port.js";
import type { CurrencyUsagePort } from "./ports/currency-usage.port.js";
import { ArchiveCurrencyUseCase } from "./archive-currency.use-case.js";

const wsResult = WorkspaceId.create("ws-1");
if (!wsResult.ok) throw new Error("setup failed");
const ws = wsResult.value;

function stored(id: string, code: string): WorkspaceCurrency {
  const created = WorkspaceCurrency.create({ id, workspaceId: ws, code });
  if (!created.ok) throw new Error("setup failed");
  return created.value;
}

class InMemoryCurrencies implements CurrencyRepositoryPort {
  saved: WorkspaceCurrency[] = [];

  constructor(private readonly rows: WorkspaceCurrency[]) {}

  async save(currency: WorkspaceCurrency) {
    this.saved.push(currency);
  }
  async listActive() {
    return this.rows;
  }
  async findActiveById(_workspaceId: unknown, id: string) {
    return this.rows.find((c) => c.id === id && c.archivedAt === null) ?? null;
  }
  async existsCode() {
    return false;
  }
  async countActive() {
    return this.rows.filter((c) => c.archivedAt === null).length;
  }
  async isActive() {
    return true;
  }
}

function usage(accounts: number, transactions: number): CurrencyUsagePort {
  return { usageOf: async () => ({ accounts, transactions }) };
}

const command = {
  workspaceId: ws,
  currencyId: "cur-1",
  defaultCurrency: "PEN",
};

describe("ArchiveCurrencyUseCase (INV-MON-02)", () => {
  it("archives a non-default unused currency while others stay active", async () => {
    const usd = stored("cur-2", "USD");
    const repo = new InMemoryCurrencies([stored("cur-1", "PEN"), usd]);
    const useCase = new ArchiveCurrencyUseCase(repo, usage(0, 0));

    const result = await useCase.execute({
      ...command,
      currencyId: "cur-2",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.archivedAt).not.toBeNull();
    expect(usd.archivedAt).toBeInstanceOf(Date);
    expect(repo.saved).toHaveLength(1);
  });

  it("rejects archiving the workspace default currency", async () => {
    const repo = new InMemoryCurrencies([
      stored("cur-1", "PEN"),
      stored("cur-2", "USD"),
    ]);
    const useCase = new ArchiveCurrencyUseCase(repo, usage(0, 0));

    const result = await useCase.execute(command);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("CURRENCY_IS_DEFAULT");
  });

  it("rejects archiving when an account uses the code", async () => {
    const usd = stored("cur-2", "USD");
    const repo = new InMemoryCurrencies([stored("cur-1", "PEN"), usd]);
    const useCase = new ArchiveCurrencyUseCase(repo, usage(1, 0));

    const result = await useCase.execute({
      ...command,
      currencyId: "cur-2",
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("CURRENCY_IN_USE");
    expect(usd.archivedAt).toBeNull();
  });

  it("rejects archiving when a transaction uses the code", async () => {
    const repo = new InMemoryCurrencies([
      stored("cur-1", "PEN"),
      stored("cur-2", "USD"),
    ]);
    const useCase = new ArchiveCurrencyUseCase(repo, usage(0, 3));

    const result = await useCase.execute({
      ...command,
      currencyId: "cur-2",
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("CURRENCY_IN_USE");
  });

  it("rejects archiving the last active currency", async () => {
    const repo = new InMemoryCurrencies([stored("cur-1", "USD")]);
    const useCase = new ArchiveCurrencyUseCase(repo, usage(0, 0));

    const result = await useCase.execute(command);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("CURRENCY_LAST_ACTIVE");
  });

  it("rejects an unknown or archived currency", async () => {
    const repo = new InMemoryCurrencies([]);
    const useCase = new ArchiveCurrencyUseCase(repo, usage(0, 0));

    const result = await useCase.execute({
      ...command,
      currencyId: "cur-404",
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("CURRENCY_NOT_FOUND");
  });
});
