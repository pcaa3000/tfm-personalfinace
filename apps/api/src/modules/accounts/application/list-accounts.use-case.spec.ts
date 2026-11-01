import { describe, expect, it } from "vitest";

import { WorkspaceId } from "../../shared-kernel/index.js";
import { Account } from "../domain/account.js";
import { ListAccountsUseCase } from "./list-accounts.use-case.js";
import type { AccountRepositoryPort } from "./ports/account-repository.port.js";

const wsResult = WorkspaceId.create("ws-1");
if (!wsResult.ok) throw new Error("setup failed");
const ws = wsResult.value;

describe("ListAccountsUseCase", () => {
  it("lists workspace accounts mapped to AccountView", async () => {
    const account = Account.create({
      id: "acc-1",
      workspaceId: ws,
      name: "BCP soles",
      currency: "PEN",
      kind: "bank",
    });
    if (!account.ok) throw new Error("setup failed");

    const repo: AccountRepositoryPort = {
      save: async () => {},
      list: async (workspaceId) =>
        workspaceId.equals(ws) ? [account.value] : [],
      accountCurrency: async () => null,
    };
    const useCase = new ListAccountsUseCase(repo);

    const views = await useCase.execute(ws);

    expect(views).toEqual([
      {
        id: "acc-1",
        workspaceId: "ws-1",
        name: "BCP soles",
        currency: "PEN",
        kind: "bank",
      },
    ]);
  });
});
