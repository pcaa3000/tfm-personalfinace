import {
  CurrencyCode,
  DomainError,
  WorkspaceId,
  err,
  ok,
  type Result,
} from "../../shared-kernel/index.js";

export type AccountKind = "bank" | "cash" | "wallet";

const NAME_MAX_LENGTH = 64;
const KINDS: readonly AccountKind[] = ["bank", "cash", "wallet"];

export interface CreateAccountInput {
  readonly id: string;
  readonly workspaceId: WorkspaceId;
  readonly name: string;
  readonly currency: string;
  readonly kind: string;
}

export interface AccountState {
  readonly id: string;
  readonly workspaceId: WorkspaceId;
  readonly name: string;
  readonly currency: string;
  readonly kind: AccountKind;
  readonly archivedAt: Date | null;
}

/**
 * An account holds money in exactly one currency ("BCP soles",
 * "Interbank dólares"). Transactions recorded against it must share
 * its currency — multi-currency totals convert at report time
 * (tipo de cambio, INV-DIN-06 preserved).
 */
export class Account {
  private constructor(
    readonly id: string,
    readonly workspaceId: WorkspaceId,
    readonly name: string,
    readonly currency: CurrencyCode,
    readonly kind: AccountKind,
    readonly archivedAt: Date | null,
  ) {}

  static create(input: CreateAccountInput): Result<Account, DomainError> {
    const name = input.name.trim();
    if (name.length === 0 || name.length > NAME_MAX_LENGTH) {
      return err(
        new DomainError(
          "ACCOUNT_INVALID_NAME",
          `Account name must be 1..${NAME_MAX_LENGTH} characters`,
        ),
      );
    }
    const currency = CurrencyCode.create(input.currency);
    if (!currency.ok) {
      return currency;
    }
    if (!KINDS.includes(input.kind as AccountKind)) {
      return err(
        new DomainError(
          "ACCOUNT_INVALID_KIND",
          `Account kind must be one of: ${KINDS.join(", ")}`,
        ),
      );
    }
    return ok(
      new Account(
        input.id,
        input.workspaceId,
        name,
        currency.value,
        input.kind as AccountKind,
        null,
      ),
    );
  }

  static reconstitute(state: AccountState): Account {
    const currency = CurrencyCode.create(state.currency);
    if (!currency.ok) {
      throw currency.error;
    }
    return new Account(
      state.id,
      state.workspaceId,
      state.name,
      currency.value,
      state.kind,
      state.archivedAt,
    );
  }
}
