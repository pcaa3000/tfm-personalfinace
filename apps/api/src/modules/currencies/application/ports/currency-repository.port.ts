import type { WorkspaceId } from "../../../shared-kernel/index.js";
import type { WorkspaceCurrency } from "../../domain/workspace-currency.js";

/** Write-side access to the workspace currency catalog. */
export interface CurrencyRepositoryPort {
  save(currency: WorkspaceCurrency): Promise<void>;

  /** Active catalog entries of the workspace. */
  listActive(workspaceId: WorkspaceId): Promise<WorkspaceCurrency[]>;

  /** Active entry owned by the workspace, or null (archived, foreign or unknown). */
  findActiveById(
    workspaceId: WorkspaceId,
    id: string,
  ): Promise<WorkspaceCurrency | null>;

  /** Whether the code is already used by any workspace entry (active or archived). */
  existsCode(workspaceId: WorkspaceId, code: string): Promise<boolean>;

  /** Number of active entries in the workspace catalog. */
  countActive(workspaceId: WorkspaceId): Promise<number>;
}

export const CURRENCY_REPOSITORY = Symbol("CURRENCY_REPOSITORY");
