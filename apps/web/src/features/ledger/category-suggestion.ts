import type { CategoryView } from "./types";

/** Shorter tokens are too noisy for keyword matching ("y", "de", "pan"). */
const MIN_TOKEN_LENGTH = 4;

function normalize(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function tokens(text: string): string[] {
  const normalized = normalize(text);
  return normalized ? normalized.split(" ") : [];
}

/** Category keywords: label + catalog key tokens long enough to matter. */
function keywordsOf(category: CategoryView): string[] {
  const raw = `${category.label} ${category.key.replaceAll(/[_-]+/g, " ")}`;
  return tokens(raw).filter((token) => token.length >= MIN_TOKEN_LENGTH);
}

/**
 * D1b system-one suggestion for manual capture: normalizes the concept
 * and matches its tokens (≥4 chars) against category keywords from the
 * localized label and the catalog key. A token matches a keyword when
 * either prefixes the other ("restaurante" ↔ "restaurantes"). The
 * category with the longest matching keyword wins; ties keep catalog
 * order. Returns null when nothing matches — the caller never auto-sets,
 * it only offers the suggestion for the user to accept.
 */
export function suggestCategoryForConcept(
  concept: string,
  categories: CategoryView[],
): CategoryView | null {
  const conceptTokens = tokens(concept).filter(
    (token) => token.length >= MIN_TOKEN_LENGTH,
  );
  if (conceptTokens.length === 0) return null;

  let best: CategoryView | null = null;
  let bestScore = 0;
  for (const category of categories) {
    let score = 0;
    for (const keyword of keywordsOf(category)) {
      const hit = conceptTokens.some(
        (token) => keyword.startsWith(token) || token.startsWith(keyword),
      );
      if (hit && keyword.length > score) score = keyword.length;
    }
    if (score > bestScore) {
      best = category;
      bestScore = score;
    }
  }
  return best;
}
