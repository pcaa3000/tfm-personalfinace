import { describe, expect, it } from "vitest";

import { WorkspaceId } from "../../shared-kernel/index.js";
import { Account } from "../domain/account.js";
import type { AccountRepositoryPort } from "./ports/account-repository.port.js";
import { ReviseAccountUseCase } from "./revise-account.use-case.js";

class InMemoryAccounts implements AccountRepositoryPort {
  saved: Account[] = [];
  async save(account: Account) {
    const idx = this.saved.findIndex((a) => a.id === account.id);
    if (idx >= 0) this.saved[idx] = account;
    else this.saved.push(account);
  }
  async list() {
    return this.saved.filter((a) => a.archivedAt === null);
  }
  async accountCurrency(_workspaceId: unknown, accountId: string) {
    return this.saved.find((a) => a.id === accountId)?.currency.code ?? null;
  }
  async findById(_workspaceId: unknown, accountId: string) {
    return this.saved.find((a) => a.id === accountId) ?? null;
  }
}

const ws = WorkspaceId.create("ws-1");
if (!ws.ok) throw new Error("setup failed");
const wsId = ws.value;

function seedAccount(repo: InMemoryAccounts, name: string, kind = "bank"): Account {
  const created = Account.create({
    id: `acc-${name}`,
    workspaceId: wsId,
    name,
    currency: "PEN",
    kind,
  });
  if (!created.ok) throw new Error("setup failed");
  repo.saved.push(created.value);
  return created.value;
}

describe("ReviseAccountUseCase", () => {
  it("revises name, kind and initial balance", async () => {
    const repo = new InMemoryAccounts();
    const account = seedAccount(repo, "BCP soles");
    const useCase = new ReviseAccountUseCase(repo);

    const result = await useCase.execute({
      workspaceId: wsId,
      accountId: account.id,
      name: "BCP principal",
      kind: "savings",
      initialBalance: "500.00",
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.name).toBe("BCP principal");
      expect(result.value.kind).toBe("savings");
      expect(result.value.initialBalance).toBe("500.00");
    }
  });

  it("returns ACCOUNT_NOT_FOUND for an unknown account", async () => {
    const repo = new InMemoryAccounts();
    const useCase = new ReviseAccountUseCase(repo);
    const result = await useCase.execute({
      workspaceId: wsId,
      accountId: "missing",
      name: "x",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("ACCOUNT_NOT_FOUND");
    }
  });

  it("returns ACCOUNT_NAME_TAKEN when renaming to an existing name", async () => {
    const repo = new InMemoryAccounts();
    seedAccount(repo, "BCP soles");
    const other = seedAccount(repo, "Interbank");
    const useCase = new ReviseAccountUseCase(repo);

    const result = await useCase.execute({
      workspaceId: wsId,
      accountId: other.id,
      name: "BCP soles",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("ACCOUNT_NAME_TAKEN");
    }
  });

  it("propagates a negative initial balance error", async () => {
    const repo = new InMemoryAccounts();
    const account = seedAccount(repo, "BCP soles");
    const useCase = new ReviseAccountUseCase(repo);
    const result = await useCase.execute({
      workspaceId: wsId,
      accountId: account.id,
      initialBalance: "-10.00",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("ACCOUNT_NEGATIVE_INITIAL_BALANCE");
    }
  });
});
