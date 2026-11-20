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
import type { VoiceDraftPayload } from "../domain/voice-draft.js";
import type { VoiceNoteRepositoryPort } from "./ports/voice-note-repository.port.js";

/**
 * One reviewed split line: a catalog category, an approved new-category
 * proposal (S4 — creation happens ONLY here, on user approval), or
 * `null` for the system uncategorized fallback. Same shape as the
 * receipt confirm split.
 */
export interface ConfirmVoiceSplitInput {
  readonly categoryId: string | null;
  readonly newCategory: {
    readonly name: string;
    readonly nature: CategoryNature;
  } | null;
  /** Integer minor units of the transaction currency; must be > 0. */
  readonly amountMinorUnits: number;
}

export interface ConfirmVoiceDraftCommand {
  readonly workspaceId: WorkspaceId;
  readonly voiceNoteId: string;
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
  readonly splits: readonly ConfirmVoiceSplitInput[];
  readonly actor: string;
}

export interface ConfirmVoiceDraftResult {
  readonly transaction: TransactionView;
  /** Categories actually created by THIS confirm (S4) — empty on replay. */
  readonly createdCategories: readonly CategoryView[];
}

/**
 * Draft approval (voice-drafts T3, S2+S4+S5): the confirmed splits ARE
 * the transaction — its amount is derived as their exact sum, so
 * INV-TRX-SPLIT-01 holds by construction whatever the user edits. Each
 * `newCategory` is created through {@link CreateCategoryUseCase} and
 * the split re-pointed to the new id; a key collision reuses the
 * existing workspace category (race-tolerant re-check through the
 * catalog) — the exact mechanism the receipts confirm applies. `null`
 * splits map to the protected system `uncategorized` row. The
 * transaction is recorded with `origin: "voice"` and the note id as
 * `originReference`; replaying with the same idempotencyKey returns
 * the stored transaction without duplicating categories or re-marking
 * the note.
 */
export class ConfirmVoiceDraftUseCase {
  constructor(
    private readonly notes: VoiceNoteRepositoryPort,
    private readonly transactions: Pick<TransactionRepositoryPort, "findById">,
    private readonly recordManual: Pick<RecordManualTransactionUseCase, "execute">,
    private readonly createCategory: Pick<CreateCategoryUseCase, "execute">,
    private readonly catalog: CategoryCatalogPort,
    private readonly systemCategories: SystemCategoryPort,
    private readonly clock: Clock,
  ) {}

  async execute(
    command: ConfirmVoiceDraftCommand,
  ): Promise<Result<ConfirmVoiceDraftResult, DomainError>> {
    const note = await this.notes.findById(
      command.workspaceId,
      command.voiceNoteId,
    );
    if (!note) {
      return err(
        new DomainError(
          "VOICE_NOT_FOUND",
          `Voice note not found: ${command.voiceNoteId}`,
        ),
      );
    }

    // Idempotent replay: a confirmed note returns its linked transaction
    // when the caller repeats the same key — anything else conflicts.
    if (note.status === "confirmed") {
      const stored =
        note.transactionId === null
          ? null
          : await this.transactions.findById(
              command.workspaceId,
              note.transactionId,
            );
      if (stored && stored.idempotencyKey === command.idempotencyKey) {
        return ok({
          transaction: toTransactionView(stored),
          createdCategories: [],
        });
      }
      return err(this.notReady(command.voiceNoteId, note.status));
    }
    if (note.status !== "draft_ready") {
      return err(this.notReady(command.voiceNoteId, note.status));
    }
    if (command.splits.length === 0) {
      return err(
        new DomainError(
          "VOICE_SPLITS_REQUIRED",
          "A voice confirm requires at least one split",
        ),
      );
    }

    const draft = note.draftPayload as VoiceDraftPayload | null;
    if (draft === null || !Array.isArray(draft.splits)) {
      return err(
        new DomainError(
          "VOICE_DRAFT_INVALID",
          `Voice note ${command.voiceNoteId} is draft_ready but carries no draft payload`,
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

    const currency =
      command.currency ?? draft.currency ?? command.defaultCurrency;
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
      accountId: command.accountId,
      categoryId: headerCategoryId,
      splits,
      origin: "voice",
      originReference: note.id,
      actor: command.actor,
    };
    const transaction = await this.recordManual.execute(record);
    if (!transaction.ok) {
      return transaction;
    }

    note.markConfirmed(transaction.value.id, this.clock.now());
    await this.notes.save(note);
    return ok({ transaction: transaction.value, createdCategories });
  }

  private notReady(voiceNoteId: string, status: string): DomainError {
    return new DomainError(
      "VOICE_NOT_READY",
      `Voice note ${voiceNoteId} cannot be confirmed (status: ${status})`,
    );
  }

  /**
   * S4: creates the approved category through the shared use case (its
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
