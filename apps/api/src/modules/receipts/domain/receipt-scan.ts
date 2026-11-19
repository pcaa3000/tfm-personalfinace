import {
  DomainError,
  WorkspaceId,
  err,
  ok,
  type Result,
} from "../../shared-kernel/index.js";

/**
 * A receipt image in the scan pipeline (receipt-scan-drafts, S9):
 * `pending` quarantine → `extracted` → `draft_ready` → `confirmed`;
 * `rejected` (user discard) and `failed` (pipeline error) are terminal.
 * T3 only creates `pending` rows; later states arrive with T4–T6.
 */
export const RECEIPT_SCAN_STATUSES = [
  "pending",
  "extracted",
  "draft_ready",
  "confirmed",
  "rejected",
  "failed",
] as const;

export type ReceiptScanStatus = (typeof RECEIPT_SCAN_STATUSES)[number];

/** States the scan never leaves: user-confirmed, user-rejected, pipeline-dead. */
export const RECEIPT_TERMINAL_STATUSES: readonly ReceiptScanStatus[] = [
  "confirmed",
  "rejected",
  "failed",
];

export interface QuarantineScanInput {
  readonly id: string;
  readonly workspaceId: WorkspaceId;
  readonly uploaderSubject: string;
  readonly storageKey: string;
  readonly originalFilename: string;
  readonly mimeType: string;
  readonly sizeBytes: number;
  /** SHA-256 hex of the stored bytes — exact-hash dedup (T13, S12). */
  readonly fileHash: string;
  readonly now: Date;
}

/** Full persisted state used by infrastructure to rebuild the entity. */
export interface ReceiptScanState {
  readonly id: string;
  readonly workspaceId: string;
  readonly uploaderSubject: string;
  readonly storageKey: string;
  readonly originalFilename: string;
  readonly mimeType: string;
  readonly sizeBytes: number;
  readonly status: ReceiptScanStatus;
  readonly extractedPayload: unknown | null;
  readonly draftPayload: unknown | null;
  readonly transactionId: string | null;
  /** Optional: rows written before T13 carry no hash. */
  readonly fileHash?: string | null;
  readonly error: string | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

const FILENAME_MAX_LENGTH = 255;

function nonEmpty(
  value: string,
  field: string,
): Result<string, DomainError> {
  if (value.trim().length === 0) {
    return err(
      new DomainError("RECEIPT_SCAN_INVALID", `${field} must not be empty`),
    );
  }
  return ok(value);
}

export class ReceiptScan {
  private constructor(
    readonly id: string,
    readonly workspaceId: WorkspaceId,
    readonly uploaderSubject: string,
    readonly storageKey: string,
    readonly originalFilename: string,
    readonly mimeType: string,
    readonly sizeBytes: number,
    readonly fileHash: string | null,
    private _status: ReceiptScanStatus,
    private _extractedPayload: unknown | null,
    private _draftPayload: unknown | null,
    private _transactionId: string | null,
    private _error: string | null,
    readonly createdAt: Date,
    private _updatedAt: Date,
  ) {}

  get status(): ReceiptScanStatus {
    return this._status;
  }

  get extractedPayload(): unknown | null {
    return this._extractedPayload;
  }

  get transactionId(): string | null {
    return this._transactionId;
  }

  /** true once the scan reached a state it never leaves (T6). */
  get isTerminal(): boolean {
    return RECEIPT_TERMINAL_STATUSES.includes(this._status);
  }

  get draftPayload(): unknown | null {
    return this._draftPayload;
  }

  get error(): string | null {
    return this._error;
  }

  get updatedAt(): Date {
    return this._updatedAt;
  }

  /**
   * A freshly quarantined upload: validated bytes already stored under
   * `storageKey`; the row starts `pending` until the worker pipeline (T4)
   * extracts it.
   */
  static quarantine(
    input: QuarantineScanInput,
  ): Result<ReceiptScan, DomainError> {
    for (const [value, field] of [
      [input.id, "id"],
      [input.uploaderSubject, "uploaderSubject"],
      [input.storageKey, "storageKey"],
      [input.mimeType, "mimeType"],
      [input.fileHash, "fileHash"],
    ] as const) {
      const check = nonEmpty(value, field);
      if (!check.ok) return check;
    }
    const filename = input.originalFilename.trim();
    if (filename.length === 0) {
      return err(
        new DomainError(
          "RECEIPT_SCAN_INVALID",
          "originalFilename must not be empty",
        ),
      );
    }
    if (filename.length > FILENAME_MAX_LENGTH) {
      return err(
        new DomainError(
          "RECEIPT_SCAN_INVALID",
          `originalFilename exceeds ${FILENAME_MAX_LENGTH} characters`,
        ),
      );
    }
    if (!Number.isInteger(input.sizeBytes) || input.sizeBytes <= 0) {
      return err(
        new DomainError(
          "RECEIPT_SCAN_INVALID",
          "sizeBytes must be a positive integer",
        ),
      );
    }
    return ok(
      new ReceiptScan(
        input.id,
        input.workspaceId,
        input.uploaderSubject,
        input.storageKey,
        filename,
        input.mimeType,
        input.sizeBytes,
        input.fileHash,
        "pending",
        null,
        null,
        null,
        null,
        input.now,
        input.now,
      ),
    );
  }

  /**
   * T4+T5 (S5+S6, D1b): extraction and the categorized draft arrive from a
   * single LLM call, so the row goes pending → draft_ready in one
   * transition, carrying both the raw extraction (evidence) and the
   * grouped draft the user reviews.
   */
  markDraftReady(
    extractedPayload: unknown,
    draftPayload: unknown,
    now: Date,
  ): void {
    this._extractedPayload = extractedPayload;
    this._draftPayload = draftPayload;
    this._error = null;
    this._status = "draft_ready";
    this._updatedAt = now;
  }

  /** Terminal pipeline failure — `error` is surfaced on the polling view. */
  markFailed(message: string, now: Date): void {
    this._status = "failed";
    this._error = message.slice(0, 500);
    this._updatedAt = now;
  }

  /**
   * T6 (S2+S7): the user approved the draft — links the recorded
   * transaction. Callers must gate on `status === "draft_ready"`;
   * replay detection compares the stored key before re-confirming.
   */
  markConfirmed(transactionId: string, now: Date): void {
    this._status = "confirmed";
    this._transactionId = transactionId;
    this._updatedAt = now;
  }

  /**
   * T12 (S11): a terminal `failed` scan returns to `pending` so the
   * re-enqueued job re-runs extraction over the ORIGINAL storageKey —
   * the image is never re-uploaded. Callers gate on `status ===
   * "failed"`.
   */
  resetToPending(now: Date): void {
    this._status = "pending";
    this._error = null;
    this._updatedAt = now;
  }

  /** T6: the user discards the scan; allowed only from non-terminal states. */
  markRejected(now: Date): void {
    this._status = "rejected";
    this._updatedAt = now;
  }

  /** Rebuilds the entity from persisted state without re-validating. */
  static reconstitute(state: ReceiptScanState): ReceiptScan {
    const workspaceId = WorkspaceId.create(state.workspaceId);
    if (!workspaceId.ok) {
      throw workspaceId.error;
    }
    return new ReceiptScan(
      state.id,
      workspaceId.value,
      state.uploaderSubject,
      state.storageKey,
      state.originalFilename,
      state.mimeType,
      state.sizeBytes,
      state.fileHash ?? null,
      state.status,
      state.extractedPayload,
      state.draftPayload,
      state.transactionId,
      state.error,
      state.createdAt,
      state.updatedAt,
    );
  }
}
