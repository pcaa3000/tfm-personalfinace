import { createApp, type HonoDeps } from "./app.js";
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

/**
 * Composition root (T4): explicit wiring, no DI container.
 * `buildApp` returns the Hono app plus handles to release resources, so the
 * HTTP server (main.ts) and the e2e suites share the exact same wiring.
 */

export interface AppEnv {
  readonly databaseUrl: string;
  readonly authMode: "dev" | "oidc";
  readonly oidc?: {
    readonly issuer: string;
    readonly audience: string;
    readonly jwksUri: string;
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

  const deps: HonoDeps = {
    callerResolver,
    workspaceContext: workspace,
    // transactions
    recordManual: new RecordManualTransactionUseCase(
      transactions,
      accounts,
      categoryValidation,
      clock,
      ids,
    ),
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
    createCategory: new CreateCategoryUseCase(categories, ids),
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
  };

  return {
    app: createApp(deps),
    db,
    close: async () => {
      await pool.end();
    },
  };
}

/** Convenience env builder for main.ts; e2e helpers pass explicit values. */
export function envFromProcess(): AppEnv {
  const databaseUrl =
    process.env.DATABASE_URL ??
    "postgresql://tfm:tfm-local-dev@localhost:5432/personal_finance";
  if (process.env.AUTH_MODE === "oidc") {
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
      oidc: {
        issuer: required("OIDC_ISSUER"),
        audience: required("OIDC_AUDIENCE"),
        jwksUri: required("OIDC_JWKS_URI"),
      },
    };
  }
  return { databaseUrl, authMode: "dev" };
}
