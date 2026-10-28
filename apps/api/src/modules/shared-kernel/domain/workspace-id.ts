import { DomainError } from "./domain-error.js";
import { err, ok, type Result } from "./result.js";

/**
 * Identifier of the financial workspace that authorizes every operation.
 * Immutable once a resource belongs to it (RN-015).
 */
export class WorkspaceId {
  private constructor(readonly value: string) {}

  static create(raw: string): Result<WorkspaceId, DomainError> {
    if (raw.trim().length === 0) {
      return err(
        new DomainError("WORKSPACE_ID_INVALID", "Workspace id must not be empty"),
      );
    }
    return ok(new WorkspaceId(raw));
  }

  equals(other: WorkspaceId): boolean {
    return this.value === other.value;
  }

  toString(): string {
    return this.value;
  }
}
