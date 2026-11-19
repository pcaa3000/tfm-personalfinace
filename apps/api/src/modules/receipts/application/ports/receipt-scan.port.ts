import type { CategoryView } from "../../../categorization/index.js";
import type {
  DomainError,
  Result,
} from "../../../shared-kernel/index.js";
import type { ReceiptScanExtraction } from "../../domain/receipt-scan-extraction.js";

/**
 * Vision+LLM port (receipt-scan-drafts T4+T5, D1/D1b, S3+S5+S9): a single
 * call extracts the receipt line items AND classifies each against the
 * workspace catalog — categorization in the same request keeps the LLM
 * cost at extraction cost. Implementations (Gemini today; OpenAI-
 * compatible or local adapters later) must validate the model output
 * against the zod schema and demote `suggestedCategoryKey` values absent
 * from `workspaceCategories` to null.
 */
export interface ReceiptScanPort {
  scan(
    imageBytes: Uint8Array,
    mimeType: string,
    workspaceCategories: readonly CategoryView[],
  ): Promise<Result<ReceiptScanExtraction, DomainError>>;
}

export const RECEIPT_SCANNER = Symbol("RECEIPT_SCANNER");
