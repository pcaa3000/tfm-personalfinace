import type { TFunction } from "i18next";

import { ApiError } from "./api";

/**
 * Maps an API rejection to a localized message by error code.
 * Unknown codes and non-API failures fall back to a generic message —
 * raw server messages are never shown to the user.
 */
export function errorMessage(error: unknown, t: TFunction): string {
  if (error instanceof ApiError) {
    return t(`errors.${error.code}`, {
      defaultValue: t("errors.GENERIC"),
    });
  }
  return t("errors.GENERIC");
}
