import {
  CurrencyCode,
  DomainError,
  err,
  ok,
  type Result,
} from "../../shared-kernel/index.js";
import type { WorkspaceId } from "../../shared-kernel/index.js";
import type { WorkspaceContext } from "./workspace-context.port.js";

/** Preference fields the workspace owner can change (RF-003, RF-004). */
export interface WorkspacePreferencesPatch {
  readonly defaultCurrency?: string;
  readonly locale?: string;
  readonly timezone?: string;
}

/** Persisted workspace preferences writable by the user. */
export interface WorkspaceSettingsPort {
  updatePreferences(
    workspaceId: WorkspaceId,
    patch: WorkspacePreferencesPatch,
  ): Promise<WorkspaceContext>;
}

export const WORKSPACE_SETTINGS = Symbol("WORKSPACE_SETTINGS");

/**
 * Changes workspace preferences — input aids for new transactions
 * (currency), display conventions (locale) and business-day boundaries
 * (timezone). Never rewrites historical transaction data (RF-004,
 * INV-DIN-06).
 */
export class UpdateWorkspacePreferencesUseCase {
  constructor(private readonly settings: WorkspaceSettingsPort) {}

  async execute(
    workspaceId: WorkspaceId,
    patch: WorkspacePreferencesPatch,
  ): Promise<Result<WorkspaceContext, DomainError>> {
    const normalized: {
      defaultCurrency?: string;
      locale?: string;
      timezone?: string;
    } = {};

    if (patch.defaultCurrency !== undefined) {
      const code = CurrencyCode.create(patch.defaultCurrency);
      if (!code.ok) {
        return err(code.error);
      }
      normalized.defaultCurrency = code.value.code;
    }

    if (patch.timezone !== undefined) {
      try {
        new Intl.DateTimeFormat("en-US", { timeZone: patch.timezone });
        normalized.timezone = patch.timezone;
      } catch {
        return err(
          new DomainError(
            "TIMEZONE_INVALID",
            `Not a valid IANA timezone: ${JSON.stringify(patch.timezone)}`,
          ),
        );
      }
    }

    if (patch.locale !== undefined) {
      try {
        new Intl.Locale(patch.locale);
        normalized.locale = patch.locale;
      } catch {
        return err(
          new DomainError(
            "LOCALE_INVALID",
            `Not a valid locale: ${JSON.stringify(patch.locale)}`,
          ),
        );
      }
    }

    if (Object.keys(normalized).length === 0) {
      return err(
        new DomainError(
          "WORKSPACE_NO_CHANGES",
          "No workspace preferences to update",
        ),
      );
    }

    return ok(
      await this.settings.updatePreferences(workspaceId, normalized),
    );
  }
}
