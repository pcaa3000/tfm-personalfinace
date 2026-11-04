import {
  BusinessDate,
  DomainError,
  Money,
  WorkspaceId,
  err,
  ok,
  type Result,
} from "../../shared-kernel/index.js";
import { TransactionRevision, type FieldChange } from "./transaction-revision.js";

export type TransactionType = "income" | "expense" | "transfer";
export type TransactionStatus = "confirmed" | "voided";
export type TransactionOrigin = "manual" | "ticket" | "voice";

/**
 * Explicit category choice. `Sin categorizar` is a visible, filterable
 * state, never an absent value (RF-015).
 */
export type CategoryAssignment =
  | { kind: "categorized"; categoryId: string }
  | { kind: "uncategorized" };

export const UNCATEGORIZED: CategoryAssignment = { kind: "uncategorized" };

export function categorized(categoryId: string): CategoryAssignment {
  return { kind: "categorized", categoryId };
}

function describeCategory(category: CategoryAssignment): string {
  return category.kind === "uncategorized"
    ? "uncategorized"
    : `categorized:${category.categoryId}`;
}

export interface RecordManualInput {
  readonly id: string;
  readonly workspaceId: WorkspaceId;
  readonly idempotencyKey: string;
  readonly type: TransactionType;
  readonly amount: Money;
  readonly businessDate: BusinessDate;
  readonly concept: string;
  /** Account holding the money (source account on transfers); its currency must match the amount's. */
  readonly accountId: string;
  /** Destination account for transfers; required on transfer, forbidden on income/expense (INV-TFR-01). */
  readonly destinationAccountId?: string | null;
  readonly category?: CategoryAssignment;
  readonly originReference?: string;
  readonly confirmedAt: Date;
  readonly confirmedBy: string;
}

/** Full persisted state used by infrastructure to rebuild the aggregate. */
export interface TransactionState {
  readonly id: string;
  readonly workspaceId: WorkspaceId;
  readonly idempotencyKey: string;
  readonly type: TransactionType;
  readonly amount: Money;
  readonly businessDate: BusinessDate;
  readonly concept: string;
  /** Null only for rows recorded before accounts existed. */
  readonly accountId: string | null;
  /** Non-null only for transfer transactions. */
  readonly destinationAccountId?: string | null;
  readonly category: CategoryAssignment;
  readonly status: TransactionStatus;
  readonly origin: TransactionOrigin;
  readonly originReference: string | null;
  readonly confirmedAt: Date;
  readonly confirmedBy: string;
  readonly revisions: TransactionRevision[];
}

export interface ReviseInput {
  readonly type?: TransactionType;
  readonly amount?: Money;
  readonly businessDate?: BusinessDate;
  readonly concept?: string;
  readonly accountId?: string;
  readonly destinationAccountId?: string | null;
  readonly category?: CategoryAssignment;
  readonly revisedAt: Date;
  readonly revisedBy: string;
}

const CONCEPT_MAX_LENGTH = 500;

function validateTransferAccounts(
  type: TransactionType,
  accountId: string | null,
  destinationAccountId: string | null,
): Result<void, DomainError> {
  if (type === "transfer") {
    if (destinationAccountId === null || destinationAccountId.trim().length === 0) {
      return err(
        new DomainError(
          "TRANSFER_DESTINATION_REQUIRED",
          "A transfer requires a destination account (INV-TFR-01)",
        ),
      );
    }
    if (accountId !== null && destinationAccountId === accountId) {
      return err(
        new DomainError(
          "TRANSFER_SAME_ACCOUNT",
          "Transfer source and destination accounts must differ (INV-TFR-02)",
        ),
      );
    }
    return ok(undefined);
  }

  if (destinationAccountId !== null) {
    return err(
      new DomainError(
        "TRANSFER_DESTINATION_FORBIDDEN",
        "Only transfer transactions may specify a destination account",
      ),
    );
  }
  return ok(undefined);
}

/**
 * Ledger aggregate root. Created only in `confirmed` state (INV-TRX-01):
 * drafts and pending-sync items are not transactions. Its workspace
 * ownership is immutable (INV-TRX-05).
 */
export class Transaction {
  private constructor(
    readonly id: string,
    readonly workspaceId: WorkspaceId,
    readonly idempotencyKey: string,
    private _type: TransactionType,
    private _amount: Money,
    private _businessDate: BusinessDate,
    private _concept: string,
    private _accountId: string | null,
    private _destinationAccountId: string | null,
    private _category: CategoryAssignment,
    private _status: TransactionStatus,
    readonly origin: TransactionOrigin,
    readonly originReference: string | null,
    readonly confirmedAt: Date,
    readonly confirmedBy: string,
    private _revisions: TransactionRevision[],
  ) {}

  static recordManual(input: RecordManualInput): Result<Transaction, DomainError> {
    if (!input.amount.isPositive()) {
      return err(
        new DomainError(
          "TRANSACTION_AMOUNT_NOT_POSITIVE",
          "Transaction amount must be greater than zero (INV-DIN-01)",
        ),
      );
    }

    const concept = input.concept.trim();
    if (concept.length === 0 || concept.length > CONCEPT_MAX_LENGTH) {
      return err(
        new DomainError(
          "TRANSACTION_INVALID_CONCEPT",
          `Concept must be 1..${CONCEPT_MAX_LENGTH} characters`,
        ),
      );
    }

    const destinationAccountId = input.destinationAccountId ?? null;
    const transferCheck = validateTransferAccounts(
      input.type,
      input.accountId,
      destinationAccountId,
    );
    if (!transferCheck.ok) {
      return transferCheck;
    }

    const category =
      input.type === "transfer"
        ? UNCATEGORIZED
        : (input.category ?? UNCATEGORIZED);

    return ok(
      new Transaction(
        input.id,
        input.workspaceId,
        input.idempotencyKey,
        input.type,
        input.amount,
        input.businessDate,
        concept,
        input.accountId,
        destinationAccountId,
        category,
        "confirmed",
        "manual",
        input.originReference ?? null,
        input.confirmedAt,
        input.confirmedBy,
        [],
      ),
    );
  }

  /** Rebuilds the aggregate from persisted state without re-validating. */
  static reconstitute(state: TransactionState): Transaction {
    return new Transaction(
      state.id,
      state.workspaceId,
      state.idempotencyKey,
      state.type,
      state.amount,
      state.businessDate,
      state.concept,
      state.accountId,
      state.destinationAccountId ?? null,
      state.category,
      state.status,
      state.origin,
      state.originReference,
      state.confirmedAt,
      state.confirmedBy,
      [...state.revisions],
    );
  }

  get type(): TransactionType {
    return this._type;
  }
  get amount(): Money {
    return this._amount;
  }
  get businessDate(): BusinessDate {
    return this._businessDate;
  }
  get concept(): string {
    return this._concept;
  }
  get accountId(): string | null {
    return this._accountId;
  }
  get destinationAccountId(): string | null {
    return this._destinationAccountId;
  }
  get category(): CategoryAssignment {
    return this._category;
  }
  get status(): TransactionStatus {
    return this._status;
  }
  get revisions(): readonly TransactionRevision[] {
    return this._revisions;
  }

  revise(input: ReviseInput): Result<TransactionRevision, DomainError> {
    if (this._status === "voided") {
      return err(
        new DomainError(
          "TRANSACTION_ALREADY_VOIDED",
          "A voided transaction cannot be revised",
        ),
      );
    }

    const nextConcept = input.concept !== undefined ? input.concept.trim() : null;
    if (nextConcept !== null && (nextConcept.length === 0 || nextConcept.length > CONCEPT_MAX_LENGTH)) {
      return err(
        new DomainError(
          "TRANSACTION_INVALID_CONCEPT",
          `Concept must be 1..${CONCEPT_MAX_LENGTH} characters`,
        ),
      );
    }
    if (input.amount !== undefined && !input.amount.isPositive()) {
      return err(
        new DomainError(
          "TRANSACTION_AMOUNT_NOT_POSITIVE",
          "Transaction amount must be greater than zero (INV-DIN-01)",
        ),
      );
    }

    const effectiveType = input.type ?? this._type;
    const effectiveAccountId = input.accountId ?? this._accountId;
    const effectiveDestinationAccountId =
      input.destinationAccountId !== undefined
        ? input.destinationAccountId
        : this._destinationAccountId;

    const transferCheck = validateTransferAccounts(
      effectiveType,
      effectiveAccountId,
      effectiveDestinationAccountId,
    );
    if (!transferCheck.ok) {
      return transferCheck;
    }

    const nextCategory =
      effectiveType === "transfer" ? UNCATEGORIZED : input.category;

    const changes: FieldChange[] = [];
    if (input.type !== undefined && input.type !== this._type) {
      changes.push({ field: "type", previous: this._type, next: input.type });
    }
    if (input.amount !== undefined && !input.amount.equals(this._amount)) {
      changes.push({
        field: "amount",
        previous: this._amount.toDecimalString(),
        next: input.amount.toDecimalString(),
      });
      if (!input.amount.currency.equals(this._amount.currency)) {
        changes.push({
          field: "currency",
          previous: this._amount.currency.code,
          next: input.amount.currency.code,
        });
      }
    }
    if (input.businessDate !== undefined && !input.businessDate.equals(this._businessDate)) {
      changes.push({
        field: "businessDate",
        previous: this._businessDate.toString(),
        next: input.businessDate.toString(),
      });
    }
    if (nextConcept !== null && nextConcept !== this._concept) {
      changes.push({ field: "concept", previous: this._concept, next: nextConcept });
    }
    if (input.accountId !== undefined && input.accountId !== this._accountId) {
      changes.push({
        field: "accountId",
        previous: this._accountId ?? "none",
        next: input.accountId,
      });
    }
    if (
      input.destinationAccountId !== undefined &&
      input.destinationAccountId !== this._destinationAccountId
    ) {
      changes.push({
        field: "destinationAccountId",
        previous: this._destinationAccountId ?? "none",
        next: input.destinationAccountId ?? "none",
      });
    }
    if (
      nextCategory !== undefined &&
      describeCategory(nextCategory) !== describeCategory(this._category)
    ) {
      changes.push({
        field: "category",
        previous: describeCategory(this._category),
        next: describeCategory(nextCategory),
      });
    }

    if (changes.length === 0) {
      return err(
        new DomainError(
          "TRANSACTION_NO_CHANGES",
          "A revision must change at least one field",
        ),
      );
    }

    const revision = this.appendRevision("revision", changes, input.revisedAt, input.revisedBy);
    if (input.type !== undefined) this._type = input.type;
    if (input.amount !== undefined) this._amount = input.amount;
    if (input.businessDate !== undefined) this._businessDate = input.businessDate;
    if (nextConcept !== null) this._concept = nextConcept;
    if (input.accountId !== undefined) this._accountId = input.accountId;
    if (input.destinationAccountId !== undefined) {
      this._destinationAccountId = input.destinationAccountId;
    }
    if (nextCategory !== undefined) this._category = nextCategory;

    return ok(revision);
  }

  void(input: { voidedAt: Date; voidedBy: string }): Result<TransactionRevision, DomainError> {
    if (this._status === "voided") {
      return err(
        new DomainError(
          "TRANSACTION_ALREADY_VOIDED",
          "The transaction is already voided",
        ),
      );
    }

    const revision = this.appendRevision(
      "void",
      [{ field: "status", previous: "confirmed", next: "voided" }],
      input.voidedAt,
      input.voidedBy,
    );
    this._status = "voided";

    return ok(revision);
  }

  private appendRevision(
    kind: "revision" | "void",
    changes: FieldChange[],
    occurredAt: Date,
    actor: string,
  ): TransactionRevision {
    const revision = new TransactionRevision(
      `${this.id}-rev-${this._revisions.length + 1}`,
      this.id,
      this._revisions.length + 1,
      kind,
      changes,
      occurredAt,
      actor,
    );
    this._revisions.push(revision);
    return revision;
  }
}
