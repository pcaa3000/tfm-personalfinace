import type { TFunction } from "i18next";

import type { CategoryView } from "./types";

/** Stable catalog key → localized label; custom categories keep their label. */
export function categoryLabel(
  category: CategoryView,
  t: TFunction,
): string {
  return t(`categories.${category.key}`, { defaultValue: category.label });
}
