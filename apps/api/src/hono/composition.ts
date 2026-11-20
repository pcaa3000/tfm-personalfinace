import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  createApp,
  DEFAULT_HTTP_SECURITY,
  type HonoDeps,
  type HttpSecurityConfig,
} from "./app.js";
import { requiredEnv } from "../env.js";
import { createDrizzleDb, type DrizzleDb } from "../drizzle/db.js";
import { DevHeaderCallerResolver } from "../modules/identity-workspace/infrastructure/http/dev-header-caller.resolver.js";
import { JwtCallerResolver } from "../modules/identity-workspace/infrastructure/http/jwt-caller.resolver.js";
import { DrizzleWorkspaceAdapter } from "../modules/identity-workspace/infrastructure/drizzle-workspace.adapter.js";
import { UpdateWorkspacePreferencesUseCase } from "../modules/identity-workspace/application/update-workspace-preferences.use-case.js";
import { DrizzleAccountRepository } from "../modules/accounts/infrastructure/drizzle-account.repository.js";
import { CreateAccountUseCase } from "../modules/accounts/application/create-account.use-case.js";
import { ListAccountsUseCase } from "../modules/accounts/application/list-accounts.use-case.js";
import { ReviseAccountUseCase } from "../modules/accounts/application/revise-account.use-case.js";
import { ArchiveAccountUseCase } from "../modules/accounts/application/archive-account.use-case.js";
import { DrizzleCategoryRepository } from "../modules/categorization/infrastructure/drizzle-category.repository.js";
import { DrizzleCategoryValidationAdapter } from "../modules/categorization/infrastructure/drizzle-category-validation.adapter.js";
import { CreateCategoryUseCase } from "../modules/categorization/application/create-category.use-case.js";
import { ReviseCategoryUseCase } from "../modules/categorization/application/revise-category.use-case.js";
import { ArchiveCategoryUseCase } from "../modules/categorization/application/archive-category.use-case.js";
import { DrizzleCurrencyRepository } from "../modules/currencies/infrastructure/drizzle-currency.repository.js";
import { DrizzleCurrencyUsageAdapter } from "../modules/currencies/infrastructure/drizzle-currency-usage.adapter.js";
import { AddCurrencyUseCase } from "../modules/currencies/application/add-currency.use-case.js";
import { ListCurrenciesUseCase } from "../modules/currencies/application/list-currencies.use-case.js";
import { ListIsoCatalogUseCase } from "../modules/currencies/application/list-iso-catalog.use-case.js";
import { ReviseCurrencyUseCase } from "../modules/currencies/application/revise-currency.use-case.js";
import { ArchiveCurrencyUseCase } from "../modules/currencies/application/archive-currency.use-case.js";
import { CryptoIdGenerator } from "../modules/ledger/infrastructure/crypto-id-generator.adapter.js";
import { DrizzleTransactionRepository } from "../modules/ledger/infrastructure/persistence/drizzle-transaction.repository.js";
import { SystemClock } from "../modules/ledger/infrastructure/system-clock.adapter.js";
import { RecordManualTransactionUseCase } from "../modules/ledger/application/record-manual-transaction.use-case.js";
import { ListTransactionsUseCase } from "../modules/ledger/application/list-transactions.use-case.js";
import { ReviseTransactionUseCase } from "../modules/ledger/application/revise-transaction.use-case.js";
import { VoidTransactionUseCase } from "../modules/ledger/application/void-transaction.use-case.js";
import { ListTransactionRevisionsUseCase } from "../modules/ledger/application/list-transaction-revisions.use-case.js";
import { DrizzleBalanceAdapter } from "../modules/ledger/infrastructure/drizzle-balance.adapter.js";
import { GetWorkspaceBalanceUseCase } from "../modules/ledger/application/get-workspace-balance.use-case.js";
import { DrizzleNotificationRepository } from "../modules/notifications/infrastructure/drizzle-notification.repository.js";
import { ListNotificationsUseCase } from "../modules/notifications/application/list-notifications.use-case.js";
import { DrizzleReceiptScanRepository } from "../modules/receipts/infrastructure/drizzle-receipt-scan.repository.js";
import { DrizzleTransactionDuplicatesAdapter } from "../modules/receipts/infrastructure/drizzle-transaction-duplicates.adapter.js";
import { CryptoFileHasher } from "../modules/receipts/infrastructure/crypto-file-hasher.adapter.js";
import { LocalReceiptStorage } from "../modules/receipts/infrastructure/local-receipt-storage.js";
import { S3ReceiptStorage } from "../modules/receipts/infrastructure/s3-receipt-storage.js";
import { PgBossReceiptScanDispatcher } from "../modules/receipts/infrastructure/pgboss-receipt-scan.dispatcher.js";
import { InlineReceiptScanDispatcher } from "../modules/receipts/infrastructure/inline-receipt-scan.dispatcher.js";
import {
  GeminiReceiptScanAdapter,
  GEMINI_DEFAULT_MODEL,
} from "../modules/receipts/infrastructure/gemini-receipt-scan.adapter.js";
import type { ReceiptScanDispatcher } from "../modules/receipts/application/ports/receipt-scan-dispatcher.port.js";
import type { ReceiptScanPort } from "../modules/receipts/application/ports/receipt-scan.port.js";
import {
  handleReceiptScan,
  type ReceiptScanJobDeps,
} from "../jobs/receipt-scan.js";
import { UploadReceiptUseCase } from "../modules/receipts/application/upload-receipt.use-case.js";
import { GetReceiptScanUseCase } from "../modules/receipts/application/get-receipt-scan.use-case.js";
import { ListReceiptScansUseCase } from "../modules/receipts/application/list-receipt-scans.use-case.js";
import { GetReceiptFileUseCase } from "../modules/receipts/application/get-receipt-file.use-case.js";
import { DeleteReceiptFileUseCase } from "../modules/receipts/application/delete-receipt-file.use-case.js";
import { GetReceiptDraftUseCase } from "../modules/receipts/application/get-receipt-draft.use-case.js";
import { ConfirmReceiptDraftUseCase } from "../modules/receipts/application/confirm-receipt-draft.use-case.js";
import { RejectReceiptScanUseCase } from "../modules/receipts/application/reject-receipt-scan.use-case.js";
import { RetryReceiptScanUseCase } from "../modules/receipts/application/retry-receipt-scan.use-case.js";
import { PurgeReceiptMediaUseCase } from "../modules/receipts/application/purge-receipt-media.use-case.js";
import { RECEIPT_MAX_BYTES_DEFAULT } from "../modules/receipts/domain/receipt-upload.js";

/**
 * Composition root (T4): explicit wiring, no DI container.
 * `buildApp` returns the Hono app plus handles to release resources, so the
 * HTTP server (main.ts) and the e2e suites share the exact same wiring.
 */

/**
 * Receipt quarantine config (receipt-scan-drafts T3, D2): `local` writes
 * under `dir` (RECEIPT_STORAGE_DIR); `s3` targets an S3-compatible
 * endpoint (Supabase Storage S3 or MinIO) with SigV4 credentials.
 */
export type ReceiptStorageEnv =
  | { readonly driver: "local"; readonly dir: string }
  | {
      readonly driver: "s3";
      readonly endpoint: string;
      readonly region: string;
      readonly bucket: string;
      readonly accessKeyId: string;
      readonly secretAccessKey: string;
    };

/**
 * Scan dispatcher selection (receipt-scan-drafts T14, S13): `pgboss`
 * keeps the API→queue→worker topology; `inline` runs the same
 * handleReceiptScan pipeline in-process for single-component deploys
 * (Render free tier — no background worker). Inline mode needs the
 * Gemini config at API boot, identical to the worker's fail-fast.
 */
export type ReceiptScanDispatcherEnv =
  | { readonly mode: "pgboss" }
  | {
      readonly mode: "inline";
      readonly gemini: {
        readonly apiKey: string;
        readonly model: string;
      };
      /**
       * Test seam: e2e specs inject a fake ReceiptScanPort instead of
       * the real Gemini adapter. Unset → GeminiReceiptScanAdapter.
       */
      readonly scanner?: ReceiptScanPort;
    };

export interface AppEnv {
  readonly databaseUrl: string;
  readonly authMode: "dev" | "oidc";
  readonly oidc?: {
    readonly issuer: string;
    readonly audience: string;
    readonly jwksUri: string;
  };
  readonly security: HttpSecurityConfig;
  readonly receipts: {
    readonly maxBytes: number;
    readonly storage: ReceiptStorageEnv;
    readonly scanDispatcher: ReceiptScanDispatcherEnv;
  };
}

export interface BuiltApp {
  readonly app: ReturnType<typeof createApp>;
  readonly db: DrizzleDb;
  readonly close: () => Promise<void>;
}

export function buildApp(env: AppEnv): BuiltApp {
  const { db, pool } = createDrizzleDb(env.databaseUrl);

  // Persistence (Drizzle) — one adapter instance per port group.
  const transactions = new DrizzleTransactionRepository(db);
  const accounts = new DrizzleAccountRepository(db);
  const currencies = new DrizzleCurrencyRepository(db);
  const currencyUsage = new DrizzleCurrencyUsageAdapter(db);
  const categories = new DrizzleCategoryRepository(db);
  const categoryValidation = new DrizzleCategoryValidationAdapter(db);
  const workspace = new DrizzleWorkspaceAdapter(
    db,
    (tx) => new DrizzleCurrencyRepository(tx),
    (tx) => new DrizzleCategoryRepository(tx),
  );

  const callerResolver =
    env.authMode === "oidc" && env.oidc
      ? new JwtCallerResolver(env.oidc)
      : new DevHeaderCallerResolver();

  const clock = new SystemClock();
  const ids = new CryptoIdGenerator();

  // receipt-scan-drafts D2: storage driver selected via STORAGE_DRIVER.
  const receiptStorage = createReceiptStorage(env.receipts.storage);
  const receiptScans = new DrizzleReceiptScanRepository(db);
  const receiptDispatcher = createReceiptScanDispatcher(
    env.receipts.scanDispatcher,
    {
      databaseUrl: env.databaseUrl,
      scans: receiptScans,
      storage: receiptStorage,
      categories: categoryValidation,
      clock,
    },
  );

  const recordManual = new RecordManualTransactionUseCase(
    transactions,
    accounts,
    categoryValidation,
    clock,
    ids,
  );
  const createCategory = new CreateCategoryUseCase(categories, ids);

  const deps: HonoDeps = {
    callerResolver,
    workspaceContext: workspace,
    // transactions
    recordManual,
    listTransactions: new ListTransactionsUseCase(transactions),
    reviseTransaction: new ReviseTransactionUseCase(
      transactions,
      accounts,
      categoryValidation,
      clock,
    ),
    voidTransaction: new VoidTransactionUseCase(transactions, clock),
    listRevisions: new ListTransactionRevisionsUseCase(transactions),
    // balance aggregate (GET /api/v1/balance)
    getBalance: new GetWorkspaceBalanceUseCase(new DrizzleBalanceAdapter(db)),
    // accounts
    createAccount: new CreateAccountUseCase(accounts, currencies, ids),
    listAccounts: new ListAccountsUseCase(accounts),
    reviseAccount: new ReviseAccountUseCase(accounts),
    archiveAccount: new ArchiveAccountUseCase(accounts),
    // categories
    categoryCatalog: categoryValidation,
    createCategory,
    reviseCategory: new ReviseCategoryUseCase(categories),
    archiveCategory: new ArchiveCategoryUseCase(categories),
    // currencies
    listCurrencies: new ListCurrenciesUseCase(currencies),
    listIsoCatalog: new ListIsoCatalogUseCase(),
    addCurrency: new AddCurrencyUseCase(currencies, ids),
    reviseCurrency: new ReviseCurrencyUseCase(currencies, currencyUsage),
    archiveCurrency: new ArchiveCurrencyUseCase(currencies, currencyUsage),
    // workspace
    updatePreferences: new UpdateWorkspacePreferencesUseCase(workspace),
    // notifications (worker consumer output)
    listNotifications: new ListNotificationsUseCase(
      new DrizzleNotificationRepository(db),
    ),
    // receipts (receipt-scan-drafts T3: upload + quarantine + polling)
    uploadReceipt: new UploadReceiptUseCase(
      receiptStorage,
      receiptScans,
      // T13 (S12): exact-hash dedup index + SHA-256 hasher.
      receiptScans,
      new CryptoFileHasher(),
      receiptDispatcher,
      clock,
      ids,
      { maxBytes: env.receipts.maxBytes },
    ),
    // receipt-review-link T1 (S1): workspace ticket-review list.
    listReceiptScans: new ListReceiptScansUseCase(receiptScans),
    getReceiptScan: new GetReceiptScanUseCase(receiptScans),
    getReceiptFile: new GetReceiptFileUseCase(receiptScans, receiptStorage),
    // receipt-retention-30d T3 (S3): early media deletion.
    deleteReceiptFile: new DeleteReceiptFileUseCase(
      receiptScans,
      receiptStorage,
      clock,
    ),
    // receipt draft review + confirm (receipt-scan-drafts T6);
    // T13 (S12): read-time semantic duplicates over ledger expenses.
    getReceiptDraft: new GetReceiptDraftUseCase(
      receiptScans,
      new DrizzleTransactionDuplicatesAdapter(db),
    ),
    confirmReceiptDraft: new ConfirmReceiptDraftUseCase(
      receiptScans,
      transactions,
      recordManual,
      createCategory,
      categoryValidation,
      categories,
      clock,
    ),
    rejectReceiptScan: new RejectReceiptScanUseCase(receiptScans, clock),
    // retry without re-upload (receipt-scan-drafts T12, S11)
    retryReceiptScan: new RetryReceiptScanUseCase(
      receiptScans,
      receiptDispatcher,
      clock,
    ),
    // receipt-retention-30d T6 (S6): manual media purge by capture
    // age, workspace-scoped (unlike the cron purge in the worker).
    purgeReceiptMedia: new PurgeReceiptMediaUseCase(
      receiptScans,
      receiptStorage,
      clock,
    ),
  };

  return {
    app: createApp(deps, env.security),
    db,
    close: async () => {
      await receiptDispatcher.close();
      await pool.end();
    },
  };
}

/** HTTP hardening config (S4/S5): env-driven with dev-safe defaults. */
function securityFromProcess(): HttpSecurityConfig {
  const corsOrigins = process.env.CORS_ORIGINS?.split(",")
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);
  return {
    corsOrigins:
      corsOrigins && corsOrigins.length > 0
        ? corsOrigins
        : DEFAULT_HTTP_SECURITY.corsOrigins,
    bodyLimitBytes: DEFAULT_HTTP_SECURITY.bodyLimitBytes,
    rateLimit: {
      max: parsePositiveInt(
        "RATE_LIMIT_MAX",
        process.env.RATE_LIMIT_MAX,
        DEFAULT_HTTP_SECURITY.rateLimit.max,
      ),
      windowMs: parsePositiveInt(
        "RATE_LIMIT_WINDOW_MS",
        process.env.RATE_LIMIT_WINDOW_MS,
        DEFAULT_HTTP_SECURITY.rateLimit.windowMs,
      ),
    },
    // S2 (second OWASP pass): reads get their own limit — same fail-fast
    // parsing so a bad value can never silently disable the limiter.
    rateLimitRead: {
      max: parsePositiveInt(
        "RATE_LIMIT_READ_MAX",
        process.env.RATE_LIMIT_READ_MAX,
        DEFAULT_HTTP_SECURITY.rateLimitRead.max,
      ),
      windowMs: parsePositiveInt(
        "RATE_LIMIT_READ_WINDOW_MS",
        process.env.RATE_LIMIT_READ_WINDOW_MS,
        DEFAULT_HTTP_SECURITY.rateLimitRead.windowMs,
      ),
    },
    // receipt-scan-drafts T3: multipart cap = RECEIPT_MAX_BYTES + slack
    // for boundary/field overhead, so an over-limit file still reaches
    // the quarantine check (typed RECEIPT_TOO_LARGE) instead of a bare
    // 413. A misconfigured value fails fast like the rate limits.
    receiptUploadBodyLimitBytes:
      parsePositiveInt(
        "RECEIPT_MAX_BYTES",
        process.env.RECEIPT_MAX_BYTES,
        RECEIPT_MAX_BYTES_DEFAULT,
      ) +
      256 * 1024,
  };
}

/**
 * Positive-int env parse (R3-rate-limit-env-unvalidated): an explicit
 * misconfiguration must fail fast at boot — NaN or non-positive values
 * would silently disable the limiter or make windows never expire.
 */
function parsePositiveInt(
  name: string,
  raw: string | undefined,
  fallback: number,
): number {
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || !Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer, got ${JSON.stringify(raw)}`);
  }
  return value;
}

/**
 * Convenience env builder for main.ts; e2e helpers pass explicit values.
 * GAP-SEC-01 (S3): AUTH_MODE fails closed — anything other than the
 * explicit "dev" or "oidc" throws at boot. NEW-SEC-13 (S8): DATABASE_URL
 * is required, no localhost fallback. S1 (second OWASP pass): the dev
 * auth mode is dev-only — under NODE_ENV=production it refuses to boot,
 * so a misconfigured deploy can never serve the implicit dev identity.
 */
export function envFromProcess(): AppEnv {
  const databaseUrl = requiredEnv("DATABASE_URL");
  const security = securityFromProcess();
  const receipts = receiptsFromProcess();
  const authMode = process.env.AUTH_MODE;
  if (authMode === "oidc") {
    const required = (name: string): string => {
      const value = process.env[name];
      if (!value) {
        throw new Error(`AUTH_MODE=oidc requires ${name} to be set`);
      }
      return value;
    };
    return {
      databaseUrl,
      authMode: "oidc",
      security,
      receipts,
      oidc: {
        issuer: required("OIDC_ISSUER"),
        audience: required("OIDC_AUDIENCE"),
        jwksUri: required("OIDC_JWKS_URI"),
      },
    };
  }
  if (authMode === "dev") {
    if (process.env.NODE_ENV === "production") {
      throw new Error(
        "AUTH_MODE=dev is forbidden when NODE_ENV=production",
      );
    }
    return { databaseUrl, authMode: "dev", security, receipts };
  }
  throw new Error(
    `AUTH_MODE must be "dev" or "oidc"; got ${
      authMode === undefined ? "unset" : JSON.stringify(authMode)
    }`,
  );
}

/**
 * Receipt storage + quarantine config (receipt-scan-drafts T3, D2).
 * `STORAGE_DRIVER` fails closed like AUTH_MODE; `local` needs no config
 * in dev (RECEIPT_STORAGE_DIR defaults to the repo-local
 * apps/api/s3/tickets, gitignored) while `s3` fails fast when any of its
 * settings is missing — a half-configured object store must never
 * silently downgrade.
 */
/**
 * Default local receipt dir = `<api package root>/s3/tickets` (L18).
 * Resolved by walking up from this module to the nearest package.json —
 * correct from `src/hono` (tsx dev) and `dist/src/hono` (built worker),
 * independent of the process cwd (R4-STORAGE-CWD).
 */
function defaultLocalReceiptDir(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 8 && !existsSync(join(dir, "package.json")); i += 1) {
    dir = dirname(dir);
  }
  return join(dir, "s3", "tickets");
}

function receiptsFromProcess(): AppEnv["receipts"] {
  return {
    maxBytes: parsePositiveInt(
      "RECEIPT_MAX_BYTES",
      process.env.RECEIPT_MAX_BYTES,
      RECEIPT_MAX_BYTES_DEFAULT,
    ),
    storage: receiptStorageFromProcess(),
    scanDispatcher: receiptScanDispatcherFromProcess(),
  };
}

/**
 * Dispatcher env parsing (receipt-scan-drafts T14, S13): Render free
 * tier runs ONE web service — `inline` processes the scan in-process
 * and therefore requires GEMINI_API_KEY at API boot (fail-fast, same
 * policy the worker applies); in `pgboss` mode the key stays
 * worker-only and the API must NOT require it. Fails closed on any
 * other value, like STORAGE_DRIVER.
 */
function receiptScanDispatcherFromProcess(): ReceiptScanDispatcherEnv {
  const mode = process.env.RECEIPT_SCAN_DISPATCHER ?? "pgboss";
  if (mode === "pgboss") {
    return { mode: "pgboss" };
  }
  if (mode === "inline") {
    return {
      mode: "inline",
      gemini: {
        apiKey: requiredEnv("GEMINI_API_KEY"),
        model: process.env.GEMINI_MODEL ?? GEMINI_DEFAULT_MODEL,
      },
    };
  }
  throw new Error(
    `RECEIPT_SCAN_DISPATCHER must be "inline" or "pgboss"; got ${JSON.stringify(mode)}`,
  );
}

/**
 * Builds the dispatcher for the parsed mode (receipt-scan-drafts T14,
 * S13). `inline` wires the EXACT same job deps the worker builds
 * (worker.ts) — shared scans repo, storage, category catalog and clock
 * instances — and reuses `handleReceiptScan` verbatim; nothing is
 * duplicated. The scan runs fire-and-forget: if the process dies
 * mid-scan the row stays `pending` and T12's retry is the recovery.
 */
function createReceiptScanDispatcher(
  config: ReceiptScanDispatcherEnv,
  context: { readonly databaseUrl: string } & Omit<
    ReceiptScanJobDeps,
    "scanner"
  >,
): ReceiptScanDispatcher & { close(): Promise<void> } {
  if (config.mode === "pgboss") {
    return new PgBossReceiptScanDispatcher(context.databaseUrl);
  }
  const deps: ReceiptScanJobDeps = {
    scans: context.scans,
    storage: context.storage,
    categories: context.categories,
    scanner:
      config.scanner ??
      new GeminiReceiptScanAdapter({
        apiKey: config.gemini.apiKey,
        model: config.gemini.model,
      }),
    clock: context.clock,
  };
  return new InlineReceiptScanDispatcher((job) =>
    handleReceiptScan(deps, job),
  );
}

/**
 * Storage-driver env parsing (receipt-scan-drafts T3+T4, D2) — shared by
 * the HTTP composition root and the standalone worker, which needs the
 * same driver to read quarantined bytes.
 */
export function receiptStorageFromProcess(): ReceiptStorageEnv {
  const driver = process.env.STORAGE_DRIVER ?? "local";
  if (driver === "local") {
    return {
      driver: "local",
      dir:
        process.env.RECEIPT_STORAGE_DIR ??
        defaultLocalReceiptDir(),
    };
  }
  if (driver === "s3") {
    return {
      driver: "s3",
      endpoint: requiredEnv("S3_ENDPOINT"),
      region: requiredEnv("S3_REGION"),
      bucket: requiredEnv("RECEIPT_S3_BUCKET"),
      accessKeyId: requiredEnv("S3_ACCESS_KEY_ID"),
      secretAccessKey: requiredEnv("S3_SECRET_ACCESS_KEY"),
    };
  }
  throw new Error(
    `STORAGE_DRIVER must be "local" or "s3"; got ${JSON.stringify(driver)}`,
  );
}

/** Builds the storage adapter for a parsed {@link ReceiptStorageEnv}. */
export function createReceiptStorage(
  config: ReceiptStorageEnv,
): LocalReceiptStorage | S3ReceiptStorage {
  return config.driver === "s3"
    ? new S3ReceiptStorage(config)
    : new LocalReceiptStorage(config.dir);
}
