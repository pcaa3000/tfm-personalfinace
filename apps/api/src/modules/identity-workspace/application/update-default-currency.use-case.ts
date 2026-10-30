import {
  CurrencyCode,
  DomainError,
  err,
  ok,
  type Result,
} from "../../shared-kernel/index.js";
import type { WorkspaceId } from "../../shared-kernel/index.js";
import type { WorkspaceContext } from "./workspace-context.port.js";

/** Persisted workspace preferences writable by the user. */
export interface WorkspaceSettingsPort {
  updateDefaultCurrency(
    workspaceId: WorkspaceId,
    currency: string,
  ): Promise<WorkspaceContext>;
}

export const WORKSPACE_SETTINGS = Symbol("WORKSPACE_SETTINGS");

/**
 * Changes the workspace default currency — an input aid for new
 * transactions, never a retroactive conversion (INV-DIN-06).
 */
export class UpdateDefaultCurrencyUseCase {
  constructor(private readonly settings: WorkspaceSettingsPort) {}

  async execute(
    workspaceId: WorkspaceId,
    currency: string,
  ): Promise<Result<WorkspaceContext, DomainError>> {
    const code = CurrencyCode.create(currency);
    if (!code.ok) {
      return err(code.error);
    }
    return ok(
      await this.settings.updateDefaultCurrency(
        workspaceId,
        code.value.code,
      ),
    );
  }
}
