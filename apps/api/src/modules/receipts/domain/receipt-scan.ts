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

export interface QuarantineScanInput {
  readonly id: string;
  readonly workspaceId: WorkspaceId;
  readonly uploaderSubject: string;
  readonly storageKey: string;
  readonly originalFilename: string;
  readonly mimeType: string;
  readonly sizeBytes: number;
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
    private _status: ReceiptScanStatus,
    readonly extractedPayload: unknown | null,
    readonly draftPayload: unknown | null,
    readonly transactionId: string | null,
    readonly error: string | null,
    readonly createdAt: Date,
    private _updatedAt: Date,
  ) {}

  get status(): ReceiptScanStatus {
    return this._status;
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
