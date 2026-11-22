/**
 * Deterministic dataset generator for the "María" demo workspace
 * (odd/tasks/demo-maria-seed T1, S1/S2/S3/S5).
 *
 * Pure module — no DB access. Every value comes from a mulberry32 PRNG
 * with a FIXED seed (S5): the only input that varies between runs is the
 * `now` instant used to anchor the rolling 90-day window (S1). Business
 * dates are YYYY-MM-DD strings interpreted in the workspace timezone
 * (America/Lima) by the use case that persists them.
 */

const PRNG_SEED = 0x5eed_0001;
const WINDOW_DAYS = 90;
export const DEMO_TIMEZONE = "America/Lima";
export const DEMO_CURRENCY = "PEN";

export type DemoAccountKey = "bank" | "cash" | "savings" | "credit";

export interface DemoAccountSeed {
  readonly key: DemoAccountKey;
  readonly name: string;
  readonly kind: string;
  /** Major-unit decimal string; Money.create parses it. */
  readonly initialBalance: string;
}

export interface DemoTransactionSeed {
  readonly type: "income" | "expense" | "transfer";
  /** Integer PEN minor units (céntimos). */
  readonly amountMinor: number;
  /** YYYY-MM-DD in the workspace timezone. */
  readonly businessDate: string;
  readonly concept: string;
  readonly accountKey: DemoAccountKey;
  /** Transfers only; always a different key than accountKey. */
  readonly destinationAccountKey?: DemoAccountKey;
  /** Income/expense only; key of a workspace category copy. */
  readonly categoryKey?: string;
}

export interface DemoTransaction extends DemoTransactionSeed {
  readonly idempotencyKey: string;
}

export interface DemoPlan {
  readonly accounts: readonly DemoAccountSeed[];
  readonly transactions: readonly DemoTransaction[];
}

/** PEN accounts with realistic initial balances (S6). */
export const DEMO_ACCOUNTS: readonly DemoAccountSeed[] = [
  {
    key: "bank",
    name: "Banco principal",
    kind: "bank",
    initialBalance: "8000.00",
  },
  { key: "cash", name: "Efectivo", kind: "cash", initialBalance: "300.00" },
  {
    key: "savings",
    name: "Ahorros",
    kind: "savings",
    initialBalance: "12000.00",
  },
  {
    key: "credit",
    name: "Tarjeta de crédito",
    kind: "credit_card",
    initialBalance: "0",
  },
];

/** Classic 32-bit PRNG — deterministic across runs and platforms. */
function mulberry32(seed: number): () => number {
  let state = seed | 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** "YYYY-MM-DD" today in the demo timezone — the window's right edge. */
function timezoneToday(now: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: DEMO_TIMEZONE,
  }).format(now);
}

function parseIso(iso: string): [number, number, number] {
  const [year = 0, month = 0, day = 0] = iso.split("-").map(Number);
  return [year, month, day];
}

function shiftDay(iso: string, deltaDays: number): string {
  const [year, month, day] = parseIso(iso);
  const shifted = new Date(Date.UTC(year, month - 1, day + deltaDays));
  return shifted.toISOString().slice(0, 10);
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

function isoOf(year: number, month: number, day: number): string {
  return `${year}-${pad2(month)}-${pad2(day)}`;
}



interface YearMonth {
  readonly year: number;
  readonly month: number;
}

function monthsInWindow(start: string, end: string): YearMonth[] {
  const months: YearMonth[] = [];
  const [startYear, startMonth] = parseIso(start);
  const [endYear, endMonth] = parseIso(end);
  let year = startYear;
  let month = startMonth;
  while (year < endYear || (year === endYear && month <= endMonth)) {
    months.push({ year, month });
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
  }
  return months;
}

function weekdayOf(iso: string): number {
  const [year, month, day] = parseIso(iso);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

const FREELANCE_CONCEPTS = [
  "Proyecto freelance",
  "Venta de producto",
  "Consultoría",
  "Trabajo ocasional",
];

const GROCERY_CONCEPTS = [
  "Supermercado",
  "Mercado",
  "Frutas y verduras",
  "Bodega",
];

const TRANSPORT_CONCEPTS = [
  "Pasaje bus",
  "Pasaje combi",
  "Mototaxi",
  "Taxi",
];

const RESTAURANT_CONCEPTS = [
  "Almuerzo menú",
  "Cena restaurante",
  "Café con amigas",
  "Pollería",
  "Cevichería",
];

const LEISURE_CONCEPTS = [
  "Cine",
  "Salida con amigos",
  "Show local",
  "Parque de diversiones",
];

const SHOPPING_CONCEPTS = [
  "Ropa",
  "Zapatillas",
  "Regalo familiar",
  "Artículos del hogar",
];

const HEALTH_CONCEPTS = ["Farmacia", "Consulta médica", "Análisis clínicos"];

const EDUCATION_CONCEPTS = ["Curso online", "Libro", "Taller"];

/**
 * Fixed monthly bills — same concept and amount every month (S2). Each
 * entry fires on `dayOfMonth` whenever that day falls inside the window.
 * `credit` charges subscriptions to the card, like a real household.
 */
const FIXED_MONTHLY: readonly {
  readonly dayOfMonth: number;
  readonly concept: string;
  readonly amountMinor: number;
  readonly categoryKey: string;
  readonly accountKey: DemoAccountKey;
}[] = [
  {
    dayOfMonth: 5,
    concept: "Alquiler",
    amountMinor: 120_000,
    categoryKey: "home",
    accountKey: "bank",
  },
  {
    dayOfMonth: 8,
    concept: "Netflix",
    amountMinor: 4_490,
    categoryKey: "services",
    accountKey: "credit",
  },
  {
    dayOfMonth: 10,
    concept: "Gimnasio",
    amountMinor: 9_000,
    categoryKey: "health",
    accountKey: "bank",
  },
  {
    dayOfMonth: 12,
    concept: "Internet hogar",
    amountMinor: 9_900,
    categoryKey: "services",
    accountKey: "bank",
  },
  {
    dayOfMonth: 15,
    concept: "Spotify",
    amountMinor: 2_190,
    categoryKey: "services",
    accountKey: "credit",
  },
  {
    dayOfMonth: 18,
    concept: "Plan celular",
    amountMinor: 5_990,
    categoryKey: "services",
    accountKey: "bank",
  },
  {
    dayOfMonth: 25,
    concept: "Arbitrios municipales",
    amountMinor: 3_200,
    categoryKey: "taxes",
    accountKey: "bank",
  },
];

const SALARY_MINOR = 450_000; // S/ 4,500 on the 1st of each month.
const PAYDAY_SAVINGS_MINOR = 50_000; // S/ 500 moved to "Ahorros" on payday.

/**
 * demo-maria-session T2 (S3): the rolling maintenance window — the
 * current calendar month and the two before it, in the demo timezone.
 */
export interface DemoWindowMonth {
  /** "YYYY-MM" — matches `businessDate.slice(0, 7)`. */
  readonly key: string;
  /** "YYYY-MM-01" inclusive. */
  readonly start: string;
  /** First day of the next month, exclusive. */
  readonly end: string;
}

/** Window months ordered as the spec lists them: current, -1, -2. */
export function demoWindowMonths(
  now: Date = new Date(),
): readonly DemoWindowMonth[] {
  const [year, month] = parseIso(timezoneToday(now));
  const months: DemoWindowMonth[] = [];
  for (let back = 0; back <= 2; back += 1) {
    const first = new Date(Date.UTC(year, month - 1 - back, 1));
    const next = new Date(Date.UTC(year, month - back, 1));
    months.push({
      key: first.toISOString().slice(0, 7),
      start: first.toISOString().slice(0, 10),
      end: next.toISOString().slice(0, 10),
    });
  }
  return months;
}

/** "YYYY-MM-01" of the oldest window month — the purge cutoff (S3). */
export function demoWindowStart(now: Date = new Date()): string {
  const months = demoWindowMonths(now);
  return months[months.length - 1]!.start;
}

export interface BuildDemoPlanOptions {
  /**
   * demo-maria-session T2 (S3): restrict the plan to these "YYYY-MM"
   * months. Filtering happens AFTER the deterministic ordering and
   * idempotency-key assignment, so a filtered month carries exactly the
   * rows the full `db:seed:demo` plan produces for it.
   */
  readonly months?: readonly string[];
}

export function buildDemoPlan(
  now: Date = new Date(),
  options: BuildDemoPlanOptions = {},
): DemoPlan {
  const rand = mulberry32(PRNG_SEED);
  const randInt = (min: number, max: number): number =>
    min + Math.floor(rand() * (max - min + 1));
  /** Random multiple of `step` inside [min, max] — keeps PEN amounts tidy. */
  const randStep = (min: number, max: number, step: number): number =>
    min + randInt(0, Math.floor((max - min) / step)) * step;
  const pick = <T>(options: readonly T[]): T =>
    options[randInt(0, options.length - 1)] as T;

  const end = timezoneToday(now);
  const start = shiftDay(end, -(WINDOW_DAYS - 1));
  const inWindow = (iso: string): boolean => iso >= start && iso <= end;
  const randomDate = (): string => shiftDay(end, -randInt(0, WINDOW_DAYS - 1));

  const months = monthsInWindow(start, end);
  const seeds: DemoTransactionSeed[] = [];
  const salaryDates: string[] = [];

  // ── Income (S3: fixed salary + variable freelance) ──────────────
  for (const { year, month } of months) {
    const payday = isoOf(year, month, 1);
    if (inWindow(payday)) {
      salaryDates.push(payday);
      seeds.push({
        type: "income",
        amountMinor: SALARY_MINOR,
        businessDate: payday,
        concept: "Sueldo mensual",
        accountKey: "bank",
        categoryKey: "salary",
      });
    }
  }

  // 1–3 freelance/ventas income per month on average (S3 variable part).
  const freelanceCount = randInt(7, 9);
  for (let i = 0; i < freelanceCount; i += 1) {
    seeds.push({
      type: "income",
      amountMinor: randStep(20_000, 80_000, 500), // S/ 200–800
      businessDate: randomDate(),
      concept: pick(FREELANCE_CONCEPTS),
      accountKey: rand() < 0.8 ? "bank" : "cash",
      categoryKey: "other_income",
    });
  }

  // ── Fixed monthly expenses ──────────────────────────────────────
  for (const { year, month } of months) {
    for (const bill of FIXED_MONTHLY) {
      const iso = isoOf(year, month, bill.dayOfMonth);
      if (inWindow(iso)) {
        seeds.push({
          type: "expense",
          amountMinor: bill.amountMinor,
          businessDate: iso,
          concept: bill.concept,
          accountKey: bill.accountKey,
          categoryKey: bill.categoryKey,
        });
      }
    }
    // Utilities vary a little month to month (S3 variable flavour).
    const utilities = isoOf(year, month, 20);
    if (inWindow(utilities)) {
      seeds.push({
        type: "expense",
        amountMinor: randStep(8_000, 14_000, 100), // S/ 80–140
        businessDate: utilities,
        concept: "Luz y agua",
        accountKey: "bank",
        categoryKey: "services",
      });
    }
  }

  // ── Variable expenses ───────────────────────────────────────────
  // Groceries 2–3 times per week.
  const weeks = Math.ceil(WINDOW_DAYS / 7);
  for (let week = 0; week < weeks; week += 1) {
    const trips = randInt(2, 3);
    for (let trip = 0; trip < trips; trip += 1) {
      const offset = randInt(0, 6);
      const iso = shiftDay(end, -(week * 7 + offset));
      if (!inWindow(iso)) continue;
      seeds.push({
        type: "expense",
        amountMinor: randStep(3_500, 18_000, 50), // S/ 35–180
        businessDate: iso,
        concept: pick(GROCERY_CONCEPTS),
        accountKey: rand() < 0.6 ? "cash" : "bank",
        categoryKey: "food",
      });
    }
  }

  // "Gasto hormiga": near-daily small transport fares (S/ 5–20).
  for (let offset = 0; offset < WINDOW_DAYS; offset += 1) {
    const iso = shiftDay(end, -offset);
    const weekday = weekdayOf(iso);
    const probability = weekday === 0 || weekday === 6 ? 0.25 : 0.7;
    if (rand() >= probability) continue;
    seeds.push({
      type: "expense",
      amountMinor: randStep(500, 2_000, 50),
      businessDate: iso,
      concept: pick(TRANSPORT_CONCEPTS),
      accountKey: rand() < 0.9 ? "cash" : "bank",
      categoryKey: "transport",
    });
  }

  const variableExpenses: readonly {
    readonly count: number;
    readonly minMinor: number;
    readonly maxMinor: number;
    readonly step: number;
    readonly concepts: readonly string[];
    readonly categoryKey: string;
    readonly accounts: readonly DemoAccountKey[];
  }[] = [
    {
      // 3–5 per month.
      count: randInt(10, 14),
      minMinor: 2_500,
      maxMinor: 9_000,
      step: 50,
      concepts: RESTAURANT_CONCEPTS,
      categoryKey: "restaurants",
      accounts: ["bank", "cash", "credit"],
    },
    {
      count: randInt(5, 7),
      minMinor: 1_800,
      maxMinor: 8_000,
      step: 50,
      concepts: LEISURE_CONCEPTS,
      categoryKey: "leisure",
      accounts: ["cash", "bank", "credit"],
    },
    {
      count: randInt(5, 7),
      minMinor: 6_000,
      maxMinor: 30_000,
      step: 100,
      concepts: SHOPPING_CONCEPTS,
      categoryKey: "shopping",
      accounts: ["credit", "bank"],
    },
    {
      count: randInt(2, 4),
      minMinor: 1_500,
      maxMinor: 8_000,
      step: 50,
      concepts: HEALTH_CONCEPTS,
      categoryKey: "health",
      accounts: ["cash", "bank"],
    },
    {
      count: randInt(2, 3),
      minMinor: 6_000,
      maxMinor: 15_000,
      step: 100,
      concepts: EDUCATION_CONCEPTS,
      categoryKey: "education",
      accounts: ["bank", "credit"],
    },
  ];
  for (const group of variableExpenses) {
    for (let i = 0; i < group.count; i += 1) {
      seeds.push({
        type: "expense",
        amountMinor: randStep(group.minMinor, group.maxMinor, group.step),
        businessDate: randomDate(),
        concept: pick(group.concepts),
        accountKey: pick(group.accounts),
        categoryKey: group.categoryKey,
      });
    }
  }

  // ── Transfers (same currency, different accounts — INV-TFR) ─────
  // Payday: S/ 500 bank → savings for every salary inside the window.
  for (const payday of salaryDates) {
    seeds.push({
      type: "transfer",
      amountMinor: PAYDAY_SAVINGS_MINOR,
      businessDate: payday,
      concept: "Ahorro mensual",
      accountKey: "bank",
      destinationAccountKey: "savings",
    });
  }
  // ATM withdrawals 1–2 per month, bank → cash.
  for (let month = 0; month < months.length; month += 1) {
    const withdrawals = randInt(1, 2);
    for (let i = 0; i < withdrawals; i += 1) {
      seeds.push({
        type: "transfer",
        amountMinor: randStep(20_000, 60_000, 1_000), // S/ 200–600
        businessDate: randomDate(),
        concept: "Retiro cajero",
        accountKey: "bank",
        destinationAccountKey: "cash",
      });
    }
  }
  // Occasional card payment, bank → credit_card.
  seeds.push({
    type: "transfer",
    amountMinor: randStep(20_000, 50_000, 1_000),
    businessDate: randomDate(),
    concept: "Pago tarjeta de crédito",
    accountKey: "bank",
    destinationAccountKey: "credit",
  });

  // Deterministic order + idempotency keys (S5): sort by business date,
  // then assign the stable `demo-maria-<seq>` sequence.
  const ordered = [...seeds].sort((a, b) =>
    a.businessDate === b.businessDate
      ? a.concept.localeCompare(b.concept)
      : a.businessDate.localeCompare(b.businessDate),
  );
  const transactions = ordered.map((seed, index) => ({
    ...seed,
    idempotencyKey: `demo-maria-${pad2(index + 1).padStart(4, "0")}`,
  }));

  const filtered = options.months
    ? transactions.filter((transaction) =>
        options.months!.includes(transaction.businessDate.slice(0, 7)),
      )
    : transactions;

  return { accounts: DEMO_ACCOUNTS, transactions: filtered };
}
