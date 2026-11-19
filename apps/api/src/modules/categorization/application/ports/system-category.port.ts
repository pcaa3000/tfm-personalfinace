import type { CategoryView } from "../category-catalog.port.js";

/**
 * Access to the protected system category: the global `uncategorized`
 * fallback the ledger needs when a split carries no category
 * (receipt-scan-drafts T6 — the confirm payload allows `null` →
 * uncategorized, and INV-TRX-SPLIT-01 still requires a real categoryId).
 */
export interface SystemCategoryPort {
  /**
   * Returns the global `uncategorized` row, provisioning it when absent.
   * Idempotent and race-safe: the row is global (workspaceId NULL),
   * read-only through the catalog, and never copied into workspaces.
   */
  ensureUncategorized(): Promise<CategoryView>;
}

export const SYSTEM_CATEGORY = Symbol("SYSTEM_CATEGORY");
