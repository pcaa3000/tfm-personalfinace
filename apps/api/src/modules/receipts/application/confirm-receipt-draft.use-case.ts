import {
  Category,
  CreateCategoryUseCase,
  type CategoryCatalogPort,
  type CategoryNature,
  type CategoryView,
  type SystemCategoryPort,
} from "../../categorization/index.js";
import {
  type Clock,
  type RecordManualTransactionCommand,
  type RecordManualTransactionUseCase,
  type TransactionRepositoryPort,
  type TransactionSplitCommand,
  toTransactionView,
  type TransactionView,
} from "../../ledger/index.js";
import {
  DomainError,
  Money,
  WorkspaceId,
  err,
  ok,
  type Result,
} from "../../shared-kernel/index.js";
import type { ReceiptDraftPayload } from "../domain/receipt-draft.js";
import type { ReceiptScanRepositoryPort } from "./ports/receipt-scan-repository.port.js";

/**
 * One reviewed split line: a catalog category, an approved new-category
 * proposal (S10 — creation happens ONLY here, on user approval), or
 * `null` for the system uncategorized fallback.
 */
export interface ConfirmReceiptSplitInput {
  readonly categoryId: string | null;
  readonly newCategory: {
    readonly name: string;
    readonly nature: CategoryNature;
  } | null;
  /** Integer minor units of the transaction currency; must be > 0. */
  readonly amountMinorUnits: number;
}

export interface ConfirmReceiptDraftCommand {
  readonly workspaceId: WorkspaceId;
  readonly receiptId: string;
  readonly accountId: string;
  readonly type: "expense" | "income";
  readonly idempotencyKey: string;
  /** Optional edits overriding the draft extraction. */
  readonly businessDate?: string;
  readonly currency?: string;
  readonly concept?: string;
  /** Workspace context supplied by the route (never client input). */
  readonly timezone: string;
  readonly defaultCurrency: string;
  readonly splits: readonly ConfirmReceiptSplitInput[];
  readonly actor: string;
}

export interface ConfirmReceiptDraftResult {
  readonly transaction: TransactionView;
  /** Categories actually created by THIS confirm (S10) — empty on replay. */
  readonly createdCategories: readonly CategoryView[];
}

/**
 * Draft approval (receipt-scan-drafts T6, S2+S4+S7+S10):
 * the confirmed splits ARE the transaction — its amount is derived as
 * their exact sum, so INV-TRX-SPLIT-01 holds by construction whatever
 * the user edits. Each `newCategory` is created through
 * {@link CreateCategoryUseCase} and the split re-pointed to the new id;
 * a key collision reuses the existing workspace category (race-tolerant
 * re-check through the catalog). `null` splits map to the protected
 * system `uncategorized` row. The transaction is recorded with
 * `origin: "ticket"` and the receipt id as `originReference`; replaying
 * with the same idempotencyKey returns the stored transaction without
 * duplicating categories or re-marking the scan.
 */
export class ConfirmReceiptDraftUseCase {
  constructor(
    private readonly scans: ReceiptScanRepositoryPort,
    private readonly transactions: Pick<TransactionRepositoryPort, "findById">,
    private readonly recordManual: Pick<RecordManualTransactionUseCase, "execute">,
    private readonly createCategory: Pick<CreateCategoryUseCase, "execute">,
    private readonly catalog: CategoryCatalogPort,
    private readonly systemCategories: SystemCategoryPort,
    private readonly clock: Clock,
  ) {}

  async execute(
    command: ConfirmReceiptDraftCommand,
  ): Promise<Result<ConfirmReceiptDraftResult, DomainError>> {
    const scan = await this.scans.findById(
      command.workspaceId,
      command.receiptId,
    );
    if (!scan) {
      return err(
        new DomainError(
          "RECEIPT_NOT_FOUND",
          `Receipt scan not found: ${command.receiptId}`,
        ),
      );
    }

    // Idempotent replay: a confirmed scan returns its linked transaction
    // when the caller repeats the same key — anything else conflicts.
    if (scan.status === "confirmed") {
      const stored =
        scan.transactionId === null
          ? null
          : await this.transactions.findById(
              command.workspaceId,
              scan.transactionId,
            );
      if (stored && stored.idempotencyKey === command.idempotencyKey) {
        return ok({
          transaction: toTransactionView(stored),
          createdCategories: [],
        });
      }
      return err(this.notReady(command.receiptId, scan.status));
    }
    if (scan.status !== "draft_ready") {
      return err(this.notReady(command.receiptId, scan.status));
    }
    if (command.splits.length === 0) {
      return err(
        new DomainError(
          "RECEIPT_SPLITS_REQUIRED",
          "A receipt confirm requires at least one split",
        ),
      );
    }

    const draft = scan.draftPayload as ReceiptDraftPayload | null;
    if (draft === null || !Array.isArray(draft.splits)) {
      return err(
        new DomainError(
          "RECEIPT_DRAFT_INVALID",
          `Receipt scan ${command.receiptId} is draft_ready but carries no draft payload`,
        ),
      );
    }

    // Resolve each split's effective categoryId: explicit, new-category
    // approval (create-or-reuse), or the system uncategorized fallback.
    const createdCategories: CategoryView[] = [];
    let uncategorizedId: string | null = null;
    const splits: TransactionSplitCommand[] = [];
    for (const split of command.splits) {
      let categoryId: string;
      if (split.categoryId !== null) {
        categoryId = split.categoryId;
      } else if (split.newCategory !== null) {
        const resolved = await this.resolveNewCategory(
          command.workspaceId,
          split.newCategory,
          createdCategories,
        );
        if (!resolved.ok) {
          return resolved;
        }
        categoryId = resolved.value;
      } else {
        uncategorizedId ??= (
          await this.systemCategories.ensureUncategorized()
        ).id;
        categoryId = uncategorizedId;
      }
      splits.push({ categoryId, amount: split.amountMinorUnits });
    }

    const currency = command.currency ?? draft.currency ?? command.defaultCurrency;
    const amountMinor = splits.reduce(
      (sum, split) => sum + BigInt(split.amount),
      0n,
    );
    const amount = Money.fromMinorUnits(amountMinor, currency);
    if (!amount.ok) {
      return amount;
    }
    const businessDate =
      command.businessDate ??
      draft.businessDate ??
      isoDateIn(this.clock.now(), command.timezone);
    const concept = command.concept ?? draft.concept;
    // Header category only disambiguates a single explicit split; a
    // mixed or uncategorized breakdown stays header-uncategorized —
    // the splits carry the detail.
    const headerCategoryId =
      command.splits.length === 1 && command.splits[0]!.categoryId !== null
        ? splits[0]!.categoryId
        : null;

    const record: RecordManualTransactionCommand = {
      workspaceId: command.workspaceId,
      idempotencyKey: command.idempotencyKey,
      type: command.type,
      amount: amount.value.toDecimalString(),
      currency,
      businessDate,
      timezone: command.timezone,
      concept,
      // S6: the extracted merchant wins over the concept-derived value;
      // null delegates to the concept fallback inside the aggregate.
      merchant: draft.merchant,
      accountId: command.accountId,
      categoryId: headerCategoryId,
      splits,
      origin: "ticket",
      originReference: scan.id,
      actor: command.actor,
    };
    const transaction = await this.recordManual.execute(record);
    if (!transaction.ok) {
      return transaction;
    }

    scan.markConfirmed(transaction.value.id, this.clock.now());
    await this.scans.save(scan);
    return ok({ transaction: transaction.value, createdCategories });
  }

  private notReady(receiptId: string, status: string): DomainError {
    return new DomainError(
      "RECEIPT_NOT_READY",
      `Receipt scan ${receiptId} cannot be confirmed (status: ${status})`,
    );
  }

  /**
   * S10: creates the approved category through the shared use case (its
   * key/label/nature invariants included); when the derived key is
   * already taken in this workspace the existing category is reused —
   * the catalog re-read also makes a concurrent create race-tolerant.
   */
  private async resolveNewCategory(
    workspaceId: WorkspaceId,
    proposal: { name: string; nature: CategoryNature },
    createdCategories: CategoryView[],
  ): Promise<Result<string, DomainError>> {
    const key = Category.deriveKey(proposal.name);
    const created = await this.createCategory.execute({
      workspaceId,
      key,
      label: proposal.name,
      nature: proposal.nature,
    });
    if (created.ok) {
      createdCategories.push(created.value);
      return ok(created.value.id);
    }
    if (created.error.code !== "CATEGORY_KEY_TAKEN") {
      return err(created.error);
    }
    const existing = (await this.catalog.listForWorkspace(workspaceId)).find(
      (category) => category.key === key && category.custom,
    );
    if (!existing) {
      // The key is reserved by a row the catalog hides (e.g. archived) —
      // surface the original conflict honestly.
      return err(created.error);
    }
    return ok(existing.id);
  }
}

/** YYYY-MM-DD in the given IANA timezone; falls back to the UTC date. */
function isoDateIn(date: Date, timezone: string): string {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(date);
  } catch {
    return date.toISOString().slice(0, 10);
  }
}
