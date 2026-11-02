import {
  DomainError,
  WorkspaceId,
  err,
  ok,
  type Result,
} from "../../shared-kernel/index.js";

/** Financial natures a workspace category can declare (RF-041). */
export type CategoryNature =
  | "income"
  | "essential"
  | "discretionary"
  | "obligation"
  | "transfer";

const NATURES: readonly CategoryNature[] = [
  "income",
  "essential",
  "discretionary",
  "obligation",
  "transfer",
];

const KEY_PATTERN = /^[a-z][a-z0-9_]{0,63}$/;
const LABEL_MAX_LENGTH = 120;

export interface CreateCategoryInput {
  readonly id: string;
  readonly workspaceId: WorkspaceId;
  readonly key: string;
  readonly label: string;
  readonly nature: string;
}

export interface CategoryState {
  readonly id: string;
  readonly workspaceId: string;
  readonly key: string;
  readonly label: string;
  readonly nature: string;
  readonly archivedAt: Date | null;
}

export interface CategoryRevision {
  readonly label?: string;
  readonly nature?: string;
}

/**
 * A workspace-owned category. Global catalog entries (workspaceId null)
 * are read-only through this aggregate — only custom categories are
 * created, revised and archived here. Archiving never deletes the row,
 * so historical transactions keep their categoryId (RF-044).
 */
export class Category {
  private constructor(
    readonly id: string,
    readonly workspaceId: WorkspaceId,
    readonly key: string,
    private _label: string,
    private _nature: CategoryNature,
    private _archivedAt: Date | null,
  ) {}

  get label(): string {
    return this._label;
  }
  get nature(): CategoryNature {
    return this._nature;
  }
  get archivedAt(): Date | null {
    return this._archivedAt;
  }

  static createCustom(input: CreateCategoryInput): Result<Category, DomainError> {
    if (!KEY_PATTERN.test(input.key)) {
      return err(
        new DomainError(
          "CATEGORY_KEY_INVALID",
          "Category key must be a lowercase slug (letters, digits, underscores)",
        ),
      );
    }
    const label = input.label.trim();
    if (label.length === 0 || label.length > LABEL_MAX_LENGTH) {
      return err(
        new DomainError(
          "CATEGORY_INVALID_LABEL",
          `Category label must be 1..${LABEL_MAX_LENGTH} characters`,
        ),
      );
    }
    if (!NATURES.includes(input.nature as CategoryNature)) {
      return err(
        new DomainError(
          "CATEGORY_INVALID_NATURE",
          `Category nature must be one of: ${NATURES.join(", ")}`,
        ),
      );
    }
    return ok(
      new Category(
        input.id,
        input.workspaceId,
        input.key,
        label,
        input.nature as CategoryNature,
        null,
      ),
    );
  }

  static reconstitute(state: CategoryState): Result<Category, DomainError> {
    const workspaceId = WorkspaceId.create(state.workspaceId);
    if (!workspaceId.ok) {
      return workspaceId;
    }
    return ok(
      new Category(
        state.id,
        workspaceId.value,
        state.key,
        state.label,
        state.nature as CategoryNature,
        state.archivedAt,
      ),
    );
  }

  /** Slugs a display label into a stable workspace key. */
  static deriveKey(label: string): string {
    return label
      .normalize("NFD")
      .replace(/\p{Diacritic}/gu, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 64);
  }

  revise(revision: CategoryRevision): Result<void, DomainError> {
    const label =
      revision.label !== undefined ? revision.label.trim() : this._label;
    if (label.length === 0 || label.length > LABEL_MAX_LENGTH) {
      return err(
        new DomainError(
          "CATEGORY_INVALID_LABEL",
          `Category label must be 1..${LABEL_MAX_LENGTH} characters`,
        ),
      );
    }
    const nature = revision.nature ?? this._nature;
    if (!NATURES.includes(nature as CategoryNature)) {
      return err(
        new DomainError(
          "CATEGORY_INVALID_NATURE",
          `Category nature must be one of: ${NATURES.join(", ")}`,
        ),
      );
    }
    if (label === this._label && nature === this._nature) {
      return err(
        new DomainError(
          "CATEGORY_NO_CHANGES",
          "Nothing changed for this category",
        ),
      );
    }
    this._label = label;
    this._nature = nature as CategoryNature;
    return ok(undefined);
  }

  archive(): void {
    this._archivedAt ??= new Date();
  }
}
