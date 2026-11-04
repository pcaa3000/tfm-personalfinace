import { describe, expect, it } from "vitest";

import { WorkspaceId } from "../../shared-kernel/index.js";
import { WorkspaceCurrency } from "../domain/workspace-currency.js";
import type { CurrencyRepositoryPort } from "./ports/currency-repository.port.js";
import type { CurrencyUsagePort } from "./ports/currency-usage.port.js";
import { ReviseCurrencyUseCase } from "./revise-currency.use-case.js";

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
  async existsCode(_workspaceId: unknown, code: string) {
    return this.rows.some((c) => c.code.code === code);
  }
  async countActive() {
    return this.rows.length;
  }
  async isActive() {
    return true;
  }
}

function usage(accounts: number, transactions: number): CurrencyUsagePort {
  return { usageOf: async () => ({ accounts, transactions }) };
}

const command = { workspaceId: ws, currencyId: "cur-1", code: "EUR" };

describe("ReviseCurrencyUseCase (INV-MON-04)", () => {
  it("changes the code when no account or transaction uses it", async () => {
    const pen = stored("cur-1", "PEN");
    const repo = new InMemoryCurrencies([pen]);
    const useCase = new ReviseCurrencyUseCase(repo, usage(0, 0));

    const result = await useCase.execute(command);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.code).toBe("EUR");
    expect(pen.code.code).toBe("EUR");
    expect(repo.saved).toHaveLength(1);
  });

  it("rejects the change when an account uses the code", async () => {
    const pen = stored("cur-1", "PEN");
    const repo = new InMemoryCurrencies([pen]);
    const useCase = new ReviseCurrencyUseCase(repo, usage(2, 0));

    const result = await useCase.execute(command);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("CURRENCY_IN_USE");
    expect(pen.code.code).toBe("PEN");
    expect(repo.saved).toHaveLength(0);
  });

  it("rejects the change when a transaction uses the code", async () => {
    const pen = stored("cur-1", "PEN");
    const repo = new InMemoryCurrencies([pen]);
    const useCase = new ReviseCurrencyUseCase(repo, usage(0, 1));

    const result = await useCase.execute(command);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("CURRENCY_IN_USE");
  });

  it("rejects an unknown currency", async () => {
    const repo = new InMemoryCurrencies([]);
    const useCase = new ReviseCurrencyUseCase(repo, usage(0, 0));

    const result = await useCase.execute({
      ...command,
      currencyId: "cur-404",
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("CURRENCY_NOT_FOUND");
  });

  it("rejects a target code already present in the workspace", async () => {
    const repo = new InMemoryCurrencies([
      stored("cur-1", "PEN"),
      stored("cur-2", "EUR"),
    ]);
    const useCase = new ReviseCurrencyUseCase(repo, usage(0, 0));

    const result = await useCase.execute(command);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("CURRENCY_CODE_TAKEN");
  });

  it("rejects a target code absent from the ISO table", async () => {
    const repo = new InMemoryCurrencies([stored("cur-1", "PEN")]);
    const useCase = new ReviseCurrencyUseCase(repo, usage(0, 0));

    const result = await useCase.execute({ ...command, code: "CHP" });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("CURRENCY_UNKNOWN_ISO");
  });

  it("rejects a no-op revision", async () => {
    const repo = new InMemoryCurrencies([stored("cur-1", "PEN")]);
    const useCase = new ReviseCurrencyUseCase(repo, usage(0, 0));

    const result = await useCase.execute({ ...command, code: "PEN" });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("CURRENCY_NO_CHANGES");
  });
});
