import { describe, expect, it } from "vitest";

import { WorkspaceId } from "../../shared-kernel/index.js";
import type { Account } from "../domain/account.js";
import type { AccountRepositoryPort } from "./ports/account-repository.port.js";
import { CreateAccountUseCase } from "./create-account.use-case.js";

class InMemoryAccounts implements AccountRepositoryPort {
  saved: Account[] = [];
  async save(account: Account) {
    this.saved.push(account);
  }
  async list() {
    return this.saved;
  }
  async accountCurrency() {
    return null;
  }
}

const ids = { next: () => "acc-generated" };

const ws = WorkspaceId.create("ws-1");
if (!ws.ok) throw new Error("setup failed");

const command = {
  workspaceId: ws.value,
  name: "BCP soles",
  currency: "PEN",
  kind: "bank",
};

describe("CreateAccountUseCase", () => {
  it("creates and saves an account", async () => {
    const repo = new InMemoryAccounts();
    const useCase = new CreateAccountUseCase(repo, ids);

    const result = await useCase.execute(command);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.id).toBe("acc-generated");
      expect(result.value.name).toBe("BCP soles");
      expect(result.value.currency).toBe("PEN");
    }
    expect(repo.saved).toHaveLength(1);
  });

  it("rejects a duplicate name in the same workspace", async () => {
    const repo = new InMemoryAccounts();
    const useCase = new CreateAccountUseCase(repo, ids);
    const first = await useCase.execute(command);
    expect(first.ok).toBe(true);

    const second = await useCase.execute(command);

    expect(second.ok).toBe(false);
    if (!second.ok) {
      expect(second.error.code).toBe("ACCOUNT_NAME_TAKEN");
    }
    expect(repo.saved).toHaveLength(1);
  });

  it("propagates domain validation errors", async () => {
    const repo = new InMemoryAccounts();
    const useCase = new CreateAccountUseCase(repo, ids);

    const result = await useCase.execute({ ...command, kind: "crypto" });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("ACCOUNT_INVALID_KIND");
    }
    expect(repo.saved).toHaveLength(0);
  });
});
