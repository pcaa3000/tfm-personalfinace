import {
  BusinessDate,
  DomainError,
  Money,
  WorkspaceId,
  err,
  ok,
  type Result,
} from "../../shared-kernel/index.js";
import { normalizeMerchant } from "./merchant.js";
import { TransactionRevision, type FieldChange } from "./transaction-revision.js";
import { TransactionSplit } from "./transaction-split.js";

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

/**
 * Audit-friendly serialization of a split collection, e.g.
 * `cat-food=20.00+cat-home=5.50` or `none` when empty.
 */
function describeSplits(splits: readonly TransactionSplit[]): string {
  if (splits.length === 0) {
    return "none";
  }
  return splits
    .map((s) => `${s.categoryId}=${s.amount.toDecimalString()}`)
    .join("+");
}

/**
 * INV-TRX-SPLIT-01: when splits exist, each one must share the transaction
 * currency and their amounts must sum exactly to the transaction amount in
 * integer minor units — no rounding drift. Per-split positivity and a
 * non-empty categoryId are enforced by {@link TransactionSplit.create};
 * category existence is validated at use-case level, not here.
 */
function validateSplits(
  splits: readonly TransactionSplit[],
  amount: Money,
): Result<void, DomainError> {
  let sum = 0n;
  for (const split of splits) {
    if (!split.amount.currency.equals(amount.currency)) {
      return err(
        new DomainError(
          "TRANSACTION_SPLIT_CURRENCY_MISMATCH",
          "Split currency must match the transaction currency (INV-TRX-SPLIT-01)",
        ),
      );
    }
    if (!split.amount.isPositive()) {
      return err(
        new DomainError(
          "TRANSACTION_SPLIT_AMOUNT_NOT_POSITIVE",
          "Split amount must be greater than zero (INV-TRX-SPLIT-01)",
        ),
      );
    }
    sum += split.amount.minorUnits;
  }
  if (sum !== amount.minorUnits) {
    return err(
      new DomainError(
        "TRANSACTION_SPLITS_SUM_MISMATCH",
        "Split amounts must sum exactly to the transaction amount (INV-TRX-SPLIT-01)",
      ),
    );
  }
  return ok(undefined);
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
  /** Optional category-level breakdown; when non-empty it must satisfy INV-TRX-SPLIT-01. */
  readonly splits?: readonly TransactionSplit[];
  /**
   * Optional explicit merchant override (reports-monthly S6): the receipt
   * confirm passes `draftPayload.merchant` here. Normalized with the same
   * rule as the concept-derived value; null/undefined falls back to
   * `normalizeMerchant(concept)`. Ignored on transfers (always null).
   */
  readonly merchant?: string | null;
  /** Entry channel; defaults to "manual" (receipt confirm passes "ticket", T6). */
  readonly origin?: TransactionOrigin;
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
  /** Persisted normalized merchant; absent only for rows predating the column. */
  readonly merchant?: string | null;
  /** Persisted split collection; absent only for rows predating splits. */
  readonly splits?: readonly TransactionSplit[];
}

export interface ReviseInput {
  readonly type?: TransactionType;
  readonly amount?: Money;
  readonly businessDate?: BusinessDate;
  readonly concept?: string;
  readonly accountId?: string;
  readonly destinationAccountId?: string | null;
  readonly category?: CategoryAssignment;
  /** When provided, replaces the whole split collection (`[]` clears it). */
  readonly splits?: readonly TransactionSplit[];
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
    private _merchant: string | null,
    private _accountId: string | null,
    private _destinationAccountId: string | null,
    private _category: CategoryAssignment,
    private _status: TransactionStatus,
    readonly origin: TransactionOrigin,
    readonly originReference: string | null,
    readonly confirmedAt: Date,
    readonly confirmedBy: string,
    private _revisions: TransactionRevision[],
    private _splits: TransactionSplit[],
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

    // S6: transfers never carry a merchant; otherwise an explicit
    // override (e.g. the receipt draft merchant) wins over the
    // concept-derived value — both go through the same normalization.
    const merchant =
      input.type === "transfer"
        ? null
        : normalizeMerchant(input.merchant ?? concept);

    const splits = input.splits ?? [];
    if (input.type === "transfer" && splits.length > 0) {
      return err(
        new DomainError(
          "TRANSFER_SPLITS_FORBIDDEN",
          "Transfers cannot carry category splits",
        ),
      );
    }
    if (splits.length > 0) {
      const splitCheck = validateSplits(splits, input.amount);
      if (!splitCheck.ok) {
        return splitCheck;
      }
    }

    return ok(
      new Transaction(
        input.id,
        input.workspaceId,
        input.idempotencyKey,
        input.type,
        input.amount,
        input.businessDate,
        concept,
        merchant,
        input.accountId,
        destinationAccountId,
        category,
        "confirmed",
        input.origin ?? "manual",
        input.originReference ?? null,
        input.confirmedAt,
        input.confirmedBy,
        [],
        [...splits],
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
      state.merchant ?? null,
      state.accountId,
      state.destinationAccountId ?? null,
      state.category,
      state.status,
      state.origin,
      state.originReference,
      state.confirmedAt,
      state.confirmedBy,
      [...state.revisions],
      [...(state.splits ?? [])],
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
  /** Normalized merchant for reporting (S6); null on transfers. */
  get merchant(): string | null {
    return this._merchant;
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
  get splits(): readonly TransactionSplit[] {
    return this._splits;
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

    const effectiveAmount = input.amount ?? this._amount;
    const nextSplits = input.splits;
    // INV-TRX-SPLIT-01 is checked against the *effective* post-revision
    // state: an amount change alone must not strand a stored split
    // collection that no longer sums to it (T8a lesson).
    const effectiveSplits = nextSplits ?? this._splits;
    if (effectiveType === "transfer" && effectiveSplits.length > 0) {
      return err(
        new DomainError(
          "TRANSFER_SPLITS_FORBIDDEN",
          "Transfers cannot carry category splits",
        ),
      );
    }
    if (effectiveSplits.length > 0) {
      const splitCheck = validateSplits(effectiveSplits, effectiveAmount);
      if (!splitCheck.ok) {
        return splitCheck;
      }
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
    if (
      nextSplits !== undefined &&
      describeSplits(nextSplits) !== describeSplits(this._splits)
    ) {
      changes.push({
        field: "splits",
        previous: describeSplits(this._splits),
        next: describeSplits(nextSplits),
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
    if (nextSplits !== undefined) this._splits = [...nextSplits];
    // Merchant is a derived reporting cache, not an audited user edit:
    // it is recomputed from the effective post-revision state so it
    // follows a concept change (and is dropped when the transaction
    // becomes a transfer) without adding noise to the revision changes.
    this._merchant =
      effectiveType === "transfer" ? null : normalizeMerchant(this._concept);

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
