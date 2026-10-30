import type { Account } from "../domain/account.js";

export interface AccountView {
  readonly id: string;
  readonly workspaceId: string;
  readonly name: string;
  readonly currency: string;
  readonly kind: string;
}

export function toAccountView(account: Account): AccountView {
  return {
    id: account.id,
    workspaceId: account.workspaceId.value,
    name: account.name,
    currency: account.currency.code,
    kind: account.kind,
  };
}
