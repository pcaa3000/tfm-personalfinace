import {
  CurrencyCode,
  DomainError,
  WorkspaceId,
  err,
  ok,
  type Result,
} from "../../shared-kernel/index.js";

export interface CreateWorkspaceCurrencyInput {
  readonly id: string;
  readonly workspaceId: WorkspaceId;
  readonly code: string;
}

export interface WorkspaceCurrencyState {
  readonly id: string;
  readonly workspaceId: WorkspaceId;
  readonly code: string;
  readonly archivedAt: Date | null;
}

function validateCode(raw: string): Result<CurrencyCode, DomainError> {
  const code = CurrencyCode.create(raw);
  if (!code.ok) {
    return code;
  }
  if (!CurrencyCode.isKnownIso4217(code.value.code)) {
    return err(
      new DomainError(
        "CURRENCY_UNKNOWN_ISO",
        `Currency code is not in the ISO 4217 table: ${code.value.code}`,
      ),
    );
  }
  return code;
}

/**
 * A workspace catalog entry for an ISO 4217 currency (INV-MON-01).
 * Accounts may only be created in active catalog codes (INV-MON-03);
 * usage and default-currency guards for edits/archive are enforced by
 * the use cases, which see the accounts/transactions the aggregate
 * cannot (INV-MON-02, INV-MON-04).
 */
export class WorkspaceCurrency {
  private constructor(
    readonly id: string,
    readonly workspaceId: WorkspaceId,
    private _code: CurrencyCode,
    private _archivedAt: Date | null,
  ) {}

  static create(
    input: CreateWorkspaceCurrencyInput,
  ): Result<WorkspaceCurrency, DomainError> {
    const code = validateCode(input.code);
    if (!code.ok) {
      return code;
    }
    return ok(
      new WorkspaceCurrency(input.id, input.workspaceId, code.value, null),
    );
  }

  static reconstitute(state: WorkspaceCurrencyState): WorkspaceCurrency {
    const code = CurrencyCode.create(state.code);
    if (!code.ok) {
      throw code.error;
    }
    return new WorkspaceCurrency(
      state.id,
      state.workspaceId,
      code.value,
      state.archivedAt,
    );
  }

  get code(): CurrencyCode {
    return this._code;
  }
  get archivedAt(): Date | null {
    return this._archivedAt;
  }

  /**
   * Renames the code (INV-MON-04). The caller must have verified that no
   * account or transaction uses the current code — renaming a used code
   * would corrupt the arithmetic when the exponents differ.
   */
  changeCode(raw: string): Result<void, DomainError> {
    if (this._archivedAt !== null) {
      return err(
        new DomainError(
          "CURRENCY_ALREADY_ARCHIVED",
          "An archived currency cannot be revised",
        ),
      );
    }
    const code = validateCode(raw);
    if (!code.ok) {
      return code;
    }
    if (code.value.equals(this._code)) {
      return err(
        new DomainError(
          "CURRENCY_NO_CHANGES",
          "A revision must change the currency code",
        ),
      );
    }
    this._code = code.value;
    return ok(undefined);
  }

  archive(): Result<void, DomainError> {
    if (this._archivedAt !== null) {
      return err(
        new DomainError(
          "CURRENCY_ALREADY_ARCHIVED",
          "The currency is already archived",
        ),
      );
    }
    this._archivedAt = new Date();
    return ok(undefined);
  }
}
