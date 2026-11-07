import {
  CurrencyCode,
  DomainError,
  Money,
  WorkspaceId,
  err,
  ok,
  type Result,
} from "../../shared-kernel/index.js";

export type AccountKind =
  | "cash"
  | "bank"
  | "savings"
  | "credit_card"
  | "virtual"
  | "investment"
  | "loan"
  | "insurance";

const NAME_MAX_LENGTH = 64;
const KINDS: readonly AccountKind[] = [
  "cash",
  "bank",
  "savings",
  "credit_card",
  "virtual",
  "investment",
  "loan",
  "insurance",
];

export interface CreateAccountInput {
  readonly id: string;
  readonly workspaceId: WorkspaceId;
  readonly name: string;
  readonly currency: string;
  readonly kind: string;
  readonly initialBalance?: Money;
}

export interface ReviseAccountInput {
  readonly name?: string;
  readonly kind?: string;
  readonly initialBalance?: Money;
}

export interface AccountState {
  readonly id: string;
  readonly workspaceId: WorkspaceId;
  readonly name: string;
  readonly currency: string;
  readonly kind: AccountKind;
  readonly initialBalance: Money;
  readonly archivedAt: Date | null;
}

function validateName(name: string): Result<string, DomainError> {
  const trimmed = name.trim();
  if (trimmed.length === 0 || trimmed.length > NAME_MAX_LENGTH) {
    return err(
      new DomainError(
        "ACCOUNT_INVALID_NAME",
        `Account name must be 1..${NAME_MAX_LENGTH} characters`,
      ),
    );
  }
  return ok(trimmed);
}

function validateKind(kind: string): Result<AccountKind, DomainError> {
  if (!KINDS.includes(kind as AccountKind)) {
    return err(
      new DomainError(
        "ACCOUNT_INVALID_KIND",
        `Account kind must be one of: ${KINDS.join(", ")}`,
      ),
    );
  }
  return ok(kind as AccountKind);
}

function validateBalance(
  balance: Money,
  currency: CurrencyCode,
): Result<Money, DomainError> {
  if (!balance.currency.equals(currency)) {
    return err(
      new DomainError(
        "ACCOUNT_CURRENCY_MISMATCH",
        `Initial balance currency ${balance.currency.code} does not match account currency ${currency.code}`,
      ),
    );
  }
  if (balance.minorUnits < 0n) {
    return err(
      new DomainError(
        "ACCOUNT_NEGATIVE_INITIAL_BALANCE",
        "Initial balance cannot be negative (INV-CTA-04)",
      ),
    );
  }
  return ok(balance);
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
    private _name: string,
    readonly currency: CurrencyCode,
    private _kind: AccountKind,
    private _initialBalance: Money,
    private _archivedAt: Date | null,
  ) {}

  static create(input: CreateAccountInput): Result<Account, DomainError> {
    const name = validateName(input.name);
    if (!name.ok) {
      return name;
    }
    const currency = CurrencyCode.create(input.currency);
    if (!currency.ok) {
      return currency;
    }
    const kind = validateKind(input.kind);
    if (!kind.ok) {
      return kind;
    }
    const balance = input.initialBalance ?? Money.zero(currency.value);
    const validBalance = validateBalance(balance, currency.value);
    if (!validBalance.ok) {
      return validBalance;
    }
    return ok(
      new Account(
        input.id,
        input.workspaceId,
        name.value,
        currency.value,
        kind.value,
        validBalance.value,
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
      state.initialBalance,
      state.archivedAt,
    );
  }

  get name(): string {
    return this._name;
  }
  get kind(): AccountKind {
    return this._kind;
  }
  get initialBalance(): Money {
    return this._initialBalance;
  }
  get archivedAt(): Date | null {
    return this._archivedAt;
  }

  revise(input: ReviseAccountInput): Result<void, DomainError> {
    if (this._archivedAt !== null) {
      return err(
        new DomainError(
          "ACCOUNT_ALREADY_ARCHIVED",
          "An archived account cannot be revised",
        ),
      );
    }

    let name: string | undefined;
    if (input.name !== undefined) {
      const valid = validateName(input.name);
      if (!valid.ok) {
        return valid;
      }
      name = valid.value;
    }
    let kind: AccountKind | undefined;
    if (input.kind !== undefined) {
      const valid = validateKind(input.kind);
      if (!valid.ok) {
        return valid;
      }
      kind = valid.value;
    }
    let balance: Money | undefined;
    if (input.initialBalance !== undefined) {
      const valid = validateBalance(input.initialBalance, this.currency);
      if (!valid.ok) {
        return valid;
      }
      balance = valid.value;
    }

    const unchanged =
      (name === undefined || name === this._name) &&
      (kind === undefined || kind === this._kind) &&
      (balance === undefined || balance.equals(this._initialBalance));
    if (unchanged) {
      return err(
        new DomainError(
          "ACCOUNT_NO_CHANGES",
          "A revision must change at least one field",
        ),
      );
    }

    if (name !== undefined) this._name = name;
    if (kind !== undefined) this._kind = kind;
    if (balance !== undefined) this._initialBalance = balance;
    return ok(undefined);
  }

  archive(): Result<void, DomainError> {
    if (this._archivedAt !== null) {
      return err(
        new DomainError(
          "ACCOUNT_ALREADY_ARCHIVED",
          "The account is already archived",
        ),
      );
    }
    this._archivedAt = new Date();
    return ok(undefined);
  }

  unarchive(): Result<void, DomainError> {
    if (this._archivedAt === null) {
      return err(
        new DomainError(
          "ACCOUNT_NOT_ARCHIVED",
          "The account is not archived",
        ),
      );
    }
    this._archivedAt = null;
    return ok(undefined);
  }
}
