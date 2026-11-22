import type { CategoryNature } from "../../categorization/index.js";
import type {
  VoiceExtraction,
  VoiceExtractionItem,
  VoiceDraftType,
} from "./voice-extraction.js";

/**
 * S3: below this confidence the LLM suggestion is not trusted — the item
 * is parked in the uncategorized split and flagged for the review UI.
 */
export const VOICE_LOW_CONFIDENCE = 0.6;

const FALLBACK_CONCEPT = "Voice note";

export interface VoiceDraftNewCategory {
  readonly name: string;
  readonly nature: CategoryNature;
}

export interface VoiceDraftSplit {
  /** Catalog key, or null for the uncategorized / new-category splits. */
  readonly categoryKey: string | null;
  /** S4 proposal — resolved by the user at confirm time (T3). */
  readonly newCategory: VoiceDraftNewCategory | null;
  readonly amountMinorUnits: number;
  readonly itemCount: number;
  readonly confidenceAvg: number;
  /** true when the split holds items under VOICE_LOW_CONFIDENCE. */
  readonly lowConfidence: boolean;
}

/**
 * A workspace transaction that may already record this dictation —
 * the same semantic-dedup shape receipts compute (receipt-scan-drafts
 * T13, S12). Read-time only: `GetVoiceDraftUseCase` (T3) fills it via
 * `TransactionDuplicatesPort`; it is NEVER persisted in the payload.
 */
export interface VoiceDraftPossibleDuplicate {
  readonly transactionId: string;
  readonly concept: string;
  /** Absolute amount in minor units. */
  readonly amount: number;
  /** YYYY-MM-DD. */
  readonly occurredOn: string;
}

/**
 * Workspace context the job injects so the domain stays pure and the
 * relative-date invariant stays testable (T2 design decision — S3):
 * the LLM may emit a relative `dateHint` ("ayer", "el lunes"); the
 * domain resolves it deterministically against `today`, the workspace
 * business date the job derives from `clock.now()` + workspace
 * timezone. Nothing here calls `Date.now()` or reads the clock.
 */
export interface VoiceDraftContext {
  /** Business date `YYYY-MM-DD` in the workspace timezone. */
  readonly today: string;
  /** Workspace default currency (ISO 4217). */
  readonly defaultCurrency: string;
}

/**
 * Draft payload persisted on `voices_voice_notes.draft_payload`
 * (T2, S2+S4+S7). `items` keeps the raw extraction as evidence and
 * `transcript` is duplicated here (and on the row's `transcript`
 * column) so the review UI reads one payload.
 */
export interface VoiceDraftPayload {
  readonly transcript: string;
  readonly type: VoiceDraftType;
  readonly concept: string;
  /** Resolved business date — never null (defaults to `context.today`). */
  readonly businessDate: string;
  /** Raw model hint kept as evidence alongside the resolution. */
  readonly dateHint: string | null;
  /** Resolved currency — never null (defaults to workspace default). */
  readonly currency: string;
  /** true when items named >1 currency — the user resolves in review. */
  readonly currencyConflict: boolean;
  /** Total the dictation stated (minor units), null when unstated. */
  readonly totalMinorUnits: number | null;
  /** true when stated total ≠ Σ items — flagged, never autocorrected. */
  readonly totalMismatch: boolean;
  readonly splits: readonly VoiceDraftSplit[];
  readonly items: readonly VoiceExtractionItem[];
  /** T3 read-time semantic dedup — absent in the stored payload. */
  readonly possibleDuplicates?: readonly VoiceDraftPossibleDuplicate[];
}

interface SplitAcc {
  categoryKey: string | null;
  newCategory: VoiceDraftNewCategory | null;
  amountMinorUnits: number;
  itemCount: number;
  confidenceSum: number;
  lowConfidence: boolean;
}

const UNCATEGORIZED = "uncategorized";

function groupKey(item: VoiceExtractionItem): string {
  if (item.confidence < VOICE_LOW_CONFIDENCE) return UNCATEGORIZED;
  if (item.suggestedCategoryKey !== null) return `key:${item.suggestedCategoryKey}`;
  if (item.suggestedNewCategory !== null) {
    return `new:${item.suggestedNewCategory.name.toLowerCase()}`;
  }
  return UNCATEGORIZED;
}

const ISO_DAY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * Real-calendar check for an LLM-supplied `YYYY-MM-DD` — the digit
 * shape alone is not enough (untrusted hints can carry `2026-99-99`).
 * Rollover components fail the round-trip comparison.
 */
function isRealIsoDay(isoDate: string): boolean {
  const match = ISO_DAY_PATTERN.exec(isoDate);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

/** Pure UTC calendar-day shift — businessDate strings are TZ-free. */
function shiftIsoDay(isoDate: string, days: number): string {
  const day = new Date(`${isoDate}T00:00:00Z`);
  day.setUTCDate(day.getUTCDate() + days);
  return day.toISOString().slice(0, 10);
}

/** UTC weekday of an ISO day (0 = Sunday). */
function dayOfWeek(isoDate: string): number {
  return new Date(`${isoDate}T00:00:00Z`).getUTCDay();
}

const WEEKDAYS: Readonly<Record<string, number>> = {
  domingo: 0,
  sunday: 0,
  lunes: 1,
  monday: 1,
  martes: 2,
  tuesday: 2,
  ["miércoles"]: 3,
  miercoles: 3,
  wednesday: 3,
  jueves: 4,
  thursday: 4,
  viernes: 5,
  friday: 5,
  ["sábado"]: 6,
  sabado: 6,
  saturday: 6,
};

const RELATIVE_EXACT: Readonly<Record<string, number>> = {
  hoy: 0,
  today: 0,
  ayer: -1,
  yesterday: -1,
  anteayer: -2,
  antier: -2,
  "antes de ayer": -2,
  "day before yesterday": -2,
};

// Digit count is bounded — an unbounded `\d+` lets a hostile hint
// overflow Date arithmetic (review R1-1). 999,999 days ≈ 2,740 years
// stays far inside the representable range.
const DAYS_AGO_PATTERN =
  /^(?:hace\s+(\d{1,6})\s+d[ií]as?|(\d{1,6})\s+days?\s+ago)$/i;

/**
 * Resolves the model's raw `dateHint` against the workspace business
 * date (S3). Accepted shapes, all deterministic:
 *  - `YYYY-MM-DD`                       → verbatim
 *  - hoy/today, ayer/yesterday,
 *    anteayer/antier/antes de ayer      → today ± N
 *  - "hace N días" / "N days ago"       → today − N
 *  - weekday name (es/en, optionally
 *    "el lunes" / "on monday")          → most recent occurrence
 *                                         ≤ today (inclusive: naming
 *                                         today's weekday → today)
 * Anything else → `today` (the same default as an absent hint — the
 * draft never guesses a wrong date, the user corrects in review).
 */
export function resolveVoiceBusinessDate(
  dateHint: string | null,
  today: string,
): string {
  if (dateHint === null) return today;
  const hint = dateHint.trim().toLowerCase();
  if (hint.length === 0) return today;
  if (isRealIsoDay(hint)) return hint;

  const stripped = hint.replace(/^(?:el|la|on|the)\s+/, "");
  // Object.hasOwn — plain-object indexing lets inherited keys like
  // "constructor"/"__proto__" reach shiftIsoDay and throw (R1-1).
  const exact = Object.hasOwn(RELATIVE_EXACT, stripped)
    ? RELATIVE_EXACT[stripped]
    : undefined;
  if (exact !== undefined) return shiftIsoDay(today, exact);

  const ago = DAYS_AGO_PATTERN.exec(stripped);
  if (ago) {
    const n = Number(ago[1] ?? ago[2]);
    return shiftIsoDay(today, -n);
  }

  const weekday = Object.hasOwn(WEEKDAYS, stripped)
    ? WEEKDAYS[stripped]
    : undefined;
  if (weekday !== undefined) {
    const back = (dayOfWeek(today) - weekday + 7) % 7;
    return shiftIsoDay(today, -back);
  }

  return today;
}

/**
 * Groups the extracted items into category splits (S4): one split per
 * effective category — catalog key, `new:<name>` proposal, or the
 * shared uncategorized bucket. Pure function: no I/O, deterministic
 * order (first-seen) so the stored payload is stable.
 */
export function buildVoiceDraft(
  extraction: VoiceExtraction,
  context: VoiceDraftContext,
): VoiceDraftPayload {
  const groups = new Map<string, SplitAcc>();
  for (const item of extraction.items) {
    const key = groupKey(item);
    let acc = groups.get(key);
    if (!acc) {
      acc = {
        categoryKey:
          item.confidence >= VOICE_LOW_CONFIDENCE
            ? item.suggestedCategoryKey
            : null,
        newCategory:
          item.confidence >= VOICE_LOW_CONFIDENCE &&
          item.suggestedCategoryKey === null
            ? item.suggestedNewCategory
            : null,
        amountMinorUnits: 0,
        itemCount: 0,
        confidenceSum: 0,
        lowConfidence: false,
      };
      groups.set(key, acc);
    }
    acc.amountMinorUnits += item.amountMinorUnits;
    acc.itemCount += 1;
    acc.confidenceSum += item.confidence;
    if (item.confidence < VOICE_LOW_CONFIDENCE) acc.lowConfidence = true;
  }

  const splits: VoiceDraftSplit[] = [...groups.values()].map((acc) => ({
    categoryKey: acc.categoryKey,
    newCategory: acc.newCategory,
    amountMinorUnits: acc.amountMinorUnits,
    itemCount: acc.itemCount,
    confidenceAvg:
      acc.itemCount > 0
        ? Math.round((acc.confidenceSum / acc.itemCount) * 1000) / 1000
        : 0,
    lowConfidence: acc.lowConfidence,
  }));

  // S3: currency omitted → workspace default. A uniform stated
  // currency wins; conflicting stated currencies fall back to the
  // workspace default flagged — never silently merged.
  const stated = new Set(
    extraction.items
      .map((item) => item.currency)
      .filter((c): c is string => c !== null),
  );
  const currencyConflict = stated.size > 1;
  const currency =
    stated.size === 1 ? [...stated][0]! : context.defaultCurrency;

  const concept = extraction.concept.trim();
  const firstItem = extraction.items[0]?.concept.trim();
  const itemsSum = extraction.items.reduce(
    (sum, item) => sum + item.amountMinorUnits,
    0,
  );

  return {
    transcript: extraction.transcript,
    type: extraction.type,
    concept:
      concept.length > 0
        ? concept
        : firstItem && firstItem.length > 0
          ? firstItem
          : FALLBACK_CONCEPT,
    businessDate: resolveVoiceBusinessDate(
      extraction.dateHint,
      context.today,
    ),
    dateHint: extraction.dateHint,
    currency,
    currencyConflict,
    totalMinorUnits: extraction.totalMinorUnits,
    totalMismatch:
      extraction.totalMinorUnits !== null &&
      extraction.totalMinorUnits !== itemsSum,
    splits,
    items: extraction.items,
  };
}
