import { describe, expect, it } from "vitest";

import { WorkspaceId } from "../../shared-kernel/index.js";
import { Account } from "../domain/account.js";
import type { AccountRepositoryPort } from "./ports/account-repository.port.js";
import { ArchiveAccountUseCase } from "./archive-account.use-case.js";

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
    const row = this.saved.find((a) => a.id === accountId && a.archivedAt === null);
    return row?.currency.code ?? null;
  }
  async findById(_workspaceId: unknown, accountId: string) {
    return this.saved.find((a) => a.id === accountId) ?? null;
  }
}

const ws = WorkspaceId.create("ws-1");
if (!ws.ok) throw new Error("setup failed");

describe("ArchiveAccountUseCase", () => {
  it("archives an account", async () => {
    const repo = new InMemoryAccounts();
    const created = Account.create({
      id: "acc-1",
      workspaceId: ws.value,
      name: "BCP soles",
      currency: "PEN",
      kind: "bank",
    });
    if (!created.ok) throw new Error("setup failed");
    repo.saved.push(created.value);
    const useCase = new ArchiveAccountUseCase(repo);

    const result = await useCase.execute({
      workspaceId: ws.value,
      accountId: "acc-1",
    });

    expect(result.ok).toBe(true);
    expect(created.value.archivedAt).not.toBeNull();
    await expect(repo.list()).resolves.toHaveLength(0);
  });

  it("returns ACCOUNT_NOT_FOUND for an unknown account", async () => {
    const repo = new InMemoryAccounts();
    const useCase = new ArchiveAccountUseCase(repo);
    const result = await useCase.execute({
      workspaceId: ws.value,
      accountId: "missing",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("ACCOUNT_NOT_FOUND");
    }
  });
});
