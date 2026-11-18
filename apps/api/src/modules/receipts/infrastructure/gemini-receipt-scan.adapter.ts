import type { CategoryView } from "../../categorization/index.js";
import {
  DomainError,
  err,
  ok,
  type Result,
} from "../../shared-kernel/index.js";
import type { ReceiptScanExtraction } from "../domain/receipt-scan-extraction.js";
import type { ReceiptScanPort } from "../application/ports/receipt-scan.port.js";
import {
  normalizeExtraction,
  receiptScanExtractionSchema,
} from "./receipt-scan-extraction.schema.js";

export const GEMINI_DEFAULT_BASE_URL =
  "https://generativelanguage.googleapis.com";

export interface GeminiReceiptScanConfig {
  /** GEMINI_API_KEY — sent as `x-goog-api-key` header (never in the URL). */
  readonly apiKey: string;
  /** GEMINI_MODEL — e.g. `gemini-3.5-flash-lite`. */
  readonly model: string;
  /** Override for gateways/tests; defaults to the Google API host. */
  readonly baseUrl?: string;
  /** Injectable for specs; defaults to global fetch. */
  readonly fetchImpl?: typeof fetch;
}

interface GeminiPart {
  readonly text?: string;
}

interface GeminiResponseBody {
  readonly candidates?: ReadonlyArray<{
    readonly content?: { readonly parts?: readonly GeminiPart[] };
  }>;
}

/**
 * Structured-output schema (Gemini accepts an OpenAPI-3.0 subset). Kept
 * as a literal so the adapter does not need a zod→JSON-schema converter;
 * `receiptScanExtractionSchema` remains the authoritative validator.
 */
const RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    merchant: { type: "STRING", nullable: true },
    businessDate: { type: "STRING", nullable: true },
    currency: { type: "STRING", nullable: true },
    totalMinorUnits: { type: "INTEGER", nullable: true },
    items: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          description: { type: "STRING" },
          amountMinorUnits: { type: "INTEGER" },
          suggestedCategoryKey: { type: "STRING", nullable: true },
          suggestedNewCategory: {
            type: "OBJECT",
            nullable: true,
            properties: {
              name: { type: "STRING" },
              nature: {
                type: "STRING",
                enum: [
                  "income",
                  "essential",
                  "discretionary",
                  "obligation",
                  "transfer",
                ],
              },
            },
            required: ["name", "nature"],
          },
          confidence: { type: "NUMBER" },
        },
        required: ["description", "amountMinorUnits", "confidence"],
      },
    },
  },
  required: ["items"],
} as const;

function buildPrompt(categories: readonly CategoryView[]): string {
  const catalog =
    categories.length > 0
      ? categories
          .map((c) => `- ${c.key} | ${c.label} | ${c.nature}`)
          .join("\n")
      : "(empty catalog — every item must use suggestedCategoryKey: null)";
  return [
    "You are a receipt/ticket scanner for a personal-finance app. Extract the purchase data from the image and answer with JSON matching the response schema.",
    "Rules:",
    "- merchant: store/vendor name, empty string if unreadable.",
    "- businessDate: purchase date as YYYY-MM-DD when visible, else null.",
    "- currency: ISO 4217 code when detectable, else null.",
    "- totalMinorUnits: receipt grand total in minor units (cents) when visible, else null.",
    "- items: one entry per purchased line {description, amountMinorUnits, suggestedCategoryKey, suggestedNewCategory, confidence}.",
    "- suggestedCategoryKey: the key of the BEST matching workspace category below, or null when none fits.",
    "- suggestedNewCategory: ONLY when no catalog category fits — {name, nature} with nature one of income|essential|discretionary|obligation|transfer; otherwise null.",
    "- confidence: 0..1 certainty of the item extraction AND its classification.",
    "Workspace categories (key | name | nature):",
    catalog,
  ].join("\n");
}

/**
 * Gemini adapter for {@link ReceiptScanPort} (receipt-scan-drafts T4+T5,
 * D1): `generateContent` with `responseMimeType: application/json` +
 * `responseSchema`, the image as base64 `inlineData`, and the workspace
 * catalog embedded in the prompt so extraction and categorization happen
 * in one call (D1b — marginal cost ~0).
 *
 * Validation path: response text → JSON.parse → zod safeParse →
 * normalize against the catalog. On ANY parse/validation failure the
 * request is retried ONCE as a corrective multi-turn conversation (the
 * model's bad answer is replayed and the failure explained); a second
 * failure is a RECEIPT_SCAN_FAILED error the job marks on the row.
 */
export class GeminiReceiptScanAdapter implements ReceiptScanPort {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly config: GeminiReceiptScanConfig) {
    this.baseUrl = config.baseUrl ?? GEMINI_DEFAULT_BASE_URL;
    this.fetchImpl = config.fetchImpl ?? fetch;
  }

  async scan(
    imageBytes: Uint8Array,
    mimeType: string,
    workspaceCategories: readonly CategoryView[],
  ): Promise<Result<ReceiptScanExtraction, DomainError>> {
    const catalogKeys = new Set(workspaceCategories.map((c) => c.key));
    const prompt = buildPrompt(workspaceCategories);
    const imagePart = {
      inlineData: {
        mimeType,
        data: Buffer.from(imageBytes).toString("base64"),
      },
    };
    const contents: Array<{
      role: string;
      parts: Array<Record<string, unknown>>;
    }> = [{ role: "user", parts: [{ text: prompt }, imagePart] }];

    for (let attempt = 0; attempt < 2; attempt += 1) {
      let response: Response;
      try {
        response = await this.fetchImpl(this.endpoint(), {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-goog-api-key": this.config.apiKey,
          },
          body: JSON.stringify({
            contents,
            generationConfig: {
              responseMimeType: "application/json",
              responseSchema: RESPONSE_SCHEMA,
            },
          }),
        });
      } catch (cause) {
        return err(
          new DomainError(
            "RECEIPT_SCAN_FAILED",
            `Gemini request failed: ${causeMessage(cause)}`,
          ),
        );
      }

      if (!response.ok) {
        return err(
          new DomainError(
            "RECEIPT_SCAN_FAILED",
            `Gemini API responded ${response.status}`,
          ),
        );
      }

      const text = extractText(await readBody(response));
      const failure = validateText(text, catalogKeys);
      if (failure.ok) {
        return failure;
      }
      if (attempt === 0) {
        // Corrective retry: replay the bad model answer, then explain
        // what failed validation so the model can fix its JSON.
        contents.push(
          { role: "model", parts: [{ text }] },
          {
            role: "user",
            parts: [
              {
                text: `The previous response failed validation: ${failure.error.message}. Return ONLY corrected JSON matching the response schema.`,
              },
            ],
          },
        );
      }
    }
    return err(
      new DomainError(
        "RECEIPT_SCAN_FAILED",
        "Gemini output failed validation after one corrective retry",
      ),
    );
  }

  private endpoint(): string {
    return `${this.baseUrl}/v1beta/models/${this.config.model}:generateContent`;
  }
}

function causeMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

async function readBody(response: Response): Promise<GeminiResponseBody> {
  return (await response.json()) as GeminiResponseBody;
}

function extractText(body: GeminiResponseBody): string {
  const parts = body.candidates?.[0]?.content?.parts ?? [];
  return parts.map((p) => p.text ?? "").join("");
}

function validateText(
  text: string,
  catalogKeys: ReadonlySet<string>,
): Result<ReceiptScanExtraction, DomainError> {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return err(
      new DomainError("RECEIPT_SCAN_FAILED", "Response was not valid JSON"),
    );
  }
  const parsed = receiptScanExtractionSchema.safeParse(raw);
  if (!parsed.success) {
    return err(
      new DomainError(
        "RECEIPT_SCAN_FAILED",
        `Schema validation failed: ${parsed.error.issues
          .slice(0, 3)
          .map((i) => `${i.path.join(".")}: ${i.message}`)
          .join("; ")}`,
      ),
    );
  }
  return ok(normalizeExtraction(parsed.data, catalogKeys));
}
