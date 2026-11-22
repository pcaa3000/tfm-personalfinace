import type { CategoryView } from "../../categorization/index.js";
import {
  DomainError,
  err,
  ok,
  type Result,
} from "../../shared-kernel/index.js";
import type { VoiceExtraction } from "../domain/voice-extraction.js";
import type { VoiceDraftPort } from "../application/ports/voice-draft.port.js";
import {
  normalizeExtraction,
  voiceExtractionSchema,
} from "./voice-extraction.schema.js";

export const GEMINI_VOICE_DEFAULT_BASE_URL =
  "https://generativelanguage.googleapis.com";

interface GeminiPart {
  readonly text?: string;
}

interface GeminiResponseBody {
  readonly candidates?: ReadonlyArray<{
    readonly content?: { readonly parts?: readonly GeminiPart[] };
  }>;
}

export interface GeminiVoiceDraftConfig {
  /** GEMINI_API_KEY — sent as `x-goog-api-key` header (never in the URL). */
  readonly apiKey: string;
  /** GEMINI_MODEL — e.g. `gemini-3.5-flash-lite`. */
  readonly model: string;
  /** Override for gateways/tests; defaults to the Google API host. */
  readonly baseUrl?: string;
  /** Injectable for specs; defaults to global fetch. */
  readonly fetchImpl?: typeof fetch;
  /**
   * Per-request timeout (R4-1): a stalled upstream must fail fast to
   * `failed` instead of leaving the note `pending` indefinitely.
   */
  readonly requestTimeoutMs?: number;
  /** Backoff before the single transport retry (R4-3; 0 in specs). */
  readonly retryDelayMs?: number;
}

const DEFAULT_REQUEST_TIMEOUT_MS = 60_000;
const DEFAULT_RETRY_DELAY_MS = 500;

/**
 * Transient statuses worth ONE bounded retry (R4-3). Deliberate API
 * rejections (400/401/403/404/422) still fail immediately.
 */
const RETRYABLE_STATUSES: ReadonlySet<number> = new Set([
  429, 500, 502, 503, 504,
]);

/**
 * Structured-output schema (Gemini accepts an OpenAPI-3.0 subset). Kept
 * as a literal so the adapter does not need a zod→JSON-schema converter;
 * `voiceExtractionSchema` remains the authoritative validator.
 */
const RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    transcript: { type: "STRING" },
    type: { type: "STRING", enum: ["expense", "income"] },
    concept: { type: "STRING", nullable: true },
    dateHint: { type: "STRING", nullable: true },
    total: { type: "NUMBER", nullable: true },
    items: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          concept: { type: "STRING" },
          amount: { type: "NUMBER" },
          currency: { type: "STRING", nullable: true },
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
        required: ["concept", "amount", "confidence"],
      },
    },
  },
  required: ["transcript", "type", "items"],
} as const;

function buildPrompt(categories: readonly CategoryView[]): string {
  const catalog =
    categories.length > 0
      ? categories
          .map((c) => `- ${c.key} | ${c.label} | ${c.nature}`)
          .join("\n")
      : "(empty catalog — every item must use suggestedCategoryKey: null)";
  return [
    "You are a voice-dictation parser for a personal-finance app. The attached audio is a short spoken note recording an income or an expense. Transcribe it and answer with JSON matching the response schema.",
    "Rules:",
    "- transcript: the verbatim transcription of what was said.",
    "- type: \"expense\" for spending/purchases (\"compré\", \"gasté\", \"pagué\"), \"income\" for money received (\"cobré\", \"me pagaron\", \"vendí\").",
    "- concept: a short general summary of the dictation, empty string if unclear.",
    "- items: one entry per purchased/earned thing {concept, amount, currency, suggestedCategoryKey, suggestedNewCategory, confidence}.",
    "- amount: the item's amount in MAJOR currency units as spoken — interpret natural-language money literally (\"un sol\"=1, \"sol cincuenta\"=1.50, \"70 céntimos\"=0.70, \"cien soles\"=100).",
    "- currency: ISO 4217 code when the dictation named a currency (\"soles\"→PEN, \"dólares\"→USD, \"euros\"→EUR); null when unstated.",
    "- suggestedCategoryKey: the key of the BEST matching workspace category below, or null when none fits.",
    "- suggestedNewCategory: ONLY when no catalog category fits — {name, nature} with nature one of income|essential|discretionary|obligation|transfer; otherwise null.",
    "- confidence: 0..1 certainty of the item extraction AND its classification.",
    "- dateHint: when the dictation names a date, emit it verbatim — an absolute YYYY-MM-DD or the relative phrase heard (\"ayer\", \"el lunes\"); null when unstated. Do NOT guess dates.",
    "- total: the grand total in major units when the dictation states one, else null.",
    "Workspace categories (key | name | nature):",
    catalog,
  ].join("\n");
}

/**
 * Gemini adapter for {@link VoiceDraftPort} (voice-drafts T2, D1, S2):
 * `generateContent` with `responseMimeType: application/json` +
 * `responseSchema`, the audio as base64 `inlineData`, and the workspace
 * catalog embedded in the prompt so transcription, extraction and
 * categorization happen in ONE call (~32 tokens/second of audio).
 *
 * Validation path: response text → JSON.parse → zod safeParse →
 * normalize against the catalog. On ANY parse/validation failure the
 * request is retried ONCE as a corrective multi-turn conversation (the
 * model's bad answer is replayed and the failure explained); a second
 * failure is a VOICE_DRAFT_FAILED error the job marks on the row.
 */
export class GeminiVoiceDraftAdapter implements VoiceDraftPort {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly requestTimeoutMs: number;
  private readonly retryDelayMs: number;

  constructor(private readonly config: GeminiVoiceDraftConfig) {
    this.baseUrl = config.baseUrl ?? GEMINI_VOICE_DEFAULT_BASE_URL;
    this.fetchImpl = config.fetchImpl ?? fetch;
    this.requestTimeoutMs =
      config.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
    this.retryDelayMs = config.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS;
  }

  async processAudio(
    audioBytes: Uint8Array,
    mimeType: string,
    workspaceCategories: readonly CategoryView[],
  ): Promise<Result<VoiceExtraction, DomainError>> {
    const catalogKeys = new Set(workspaceCategories.map((c) => c.key));
    const prompt = buildPrompt(workspaceCategories);
    const audioPart = {
      inlineData: {
        mimeType,
        data: Buffer.from(audioBytes).toString("base64"),
      },
    };
    const contents: Array<{
      role: string;
      parts: Array<Record<string, unknown>>;
    }> = [{ role: "user", parts: [{ text: prompt }, audioPart] }];

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const fetched = await this.request(
        JSON.stringify({
          contents,
          generationConfig: {
            responseMimeType: "application/json",
            responseSchema: RESPONSE_SCHEMA,
          },
        }),
      );
      if (!fetched.ok) return fetched;

      // R3-002: the body read lives inside the Result contract — a
      // 200 with a non-JSON body must err(VOICE_DRAFT_FAILED), never
      // throw past the corrective-retry branch.
      let body: GeminiResponseBody;
      try {
        body = await readBody(fetched.value);
      } catch (cause) {
        return err(
          new DomainError(
            "VOICE_DRAFT_FAILED",
            `Gemini response body was not JSON: ${causeMessage(cause)}`,
          ),
        );
      }

      const text = extractText(body);
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
        "VOICE_DRAFT_FAILED",
        "Gemini output failed validation after one corrective retry",
      ),
    );
  }

  private endpoint(): string {
    return `${this.baseUrl}/v1beta/models/${this.config.model}:generateContent`;
  }

  /**
   * One HTTP call bounded by `requestTimeoutMs` (R4-1) with ONE
   * transport retry after a short backoff (R4-3) — only transient
   * failures retry (network errors, timeouts, 429/5xx); deliberate
   * API rejections fail fast.
   */
  private async request(body: string): Promise<Result<Response, DomainError>> {
    for (const lastAttempt of [false, true]) {
      let response: Response;
      try {
        response = await this.fetchImpl(this.endpoint(), {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-goog-api-key": this.config.apiKey,
          },
          body,
          signal: AbortSignal.timeout(this.requestTimeoutMs),
        });
      } catch (cause) {
        if (!lastAttempt) {
          await sleep(this.retryDelayMs);
          continue;
        }
        return err(
          new DomainError(
            "VOICE_DRAFT_FAILED",
            `Gemini request failed: ${causeMessage(cause)}`,
          ),
        );
      }

      if (response.ok) return ok(response);
      if (RETRYABLE_STATUSES.has(response.status) && !lastAttempt) {
        await sleep(this.retryDelayMs);
        continue;
      }
      return err(
        new DomainError(
          "VOICE_DRAFT_FAILED",
          `Gemini API responded ${response.status}`,
        ),
      );
    }
    return err(
      new DomainError("VOICE_DRAFT_FAILED", "Gemini request failed"),
    );
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
): Result<VoiceExtraction, DomainError> {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return err(
      new DomainError("VOICE_DRAFT_FAILED", "Response was not valid JSON"),
    );
  }
  const parsed = voiceExtractionSchema.safeParse(raw);
  if (!parsed.success) {
    return err(
      new DomainError(
        "VOICE_DRAFT_FAILED",
        `Schema validation failed: ${parsed.error.issues
          .slice(0, 3)
          .map((i) => `${i.path.join(".")}: ${i.message}`)
          .join("; ")}`,
      ),
    );
  }
  return ok(normalizeExtraction(parsed.data, catalogKeys));
}
