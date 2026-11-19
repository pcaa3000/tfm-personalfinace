import type { CategoryView } from "./types";

/**
 * Client-side mirror of `Category.deriveKey` (apps/api categorization
 * domain): slug a display label into the stable workspace key. Used by
 * the inline create flow to map a CATEGORY_KEY_TAKEN conflict back to
 * the category that already holds the key (create-or-reuse, S8).
 */
export function deriveCategoryKey(label: string): string {
  return label
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 64);
}

/** The existing category a failed create collided with; null if absent. */
export function findReusableCategory(
  label: string,
  categories: CategoryView[],
): CategoryView | null {
  const key = deriveCategoryKey(label.trim());
  if (!key) return null;
  return categories.find((c) => c.key === key) ?? null;
}
