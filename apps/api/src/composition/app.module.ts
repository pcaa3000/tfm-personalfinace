import { Module } from "@nestjs/common";
import { PrismaClient } from "@prisma/client";

import {
  CALLER_RESOLVER,
  WORKSPACE_CONTEXT,
} from "../modules/identity-workspace/index.js";
import {
  UpdateWorkspacePreferencesUseCase,
  WORKSPACE_SETTINGS,
} from "../modules/identity-workspace/application/update-workspace-preferences.use-case.js";
import { DeterministicWorkspaceAdapter } from "../modules/identity-workspace/infrastructure/deterministic-workspace.adapter.js";
import { WorkspaceController } from "../modules/identity-workspace/infrastructure/http/workspace.controller.js";
import { DevHeaderCallerResolver } from "../modules/identity-workspace/infrastructure/http/dev-header-caller.resolver.js";
import { JwtCallerResolver } from "../modules/identity-workspace/infrastructure/http/jwt-caller.resolver.js";
import { ACCOUNT_REPOSITORY } from "../modules/accounts/index.js";
import { ArchiveAccountUseCase } from "../modules/accounts/application/archive-account.use-case.js";
import { CreateAccountUseCase } from "../modules/accounts/application/create-account.use-case.js";
import { ListAccountsUseCase } from "../modules/accounts/application/list-accounts.use-case.js";
import { ReviseAccountUseCase } from "../modules/accounts/application/revise-account.use-case.js";
import { AccountsController } from "../modules/accounts/infrastructure/http/accounts.controller.js";
import { PrismaAccountRepository } from "../modules/accounts/infrastructure/prisma-account.repository.js";
import { CATEGORY_CATALOG, CATEGORY_REPOSITORY } from "../modules/categorization/index.js";
import { ArchiveCategoryUseCase } from "../modules/categorization/application/archive-category.use-case.js";
import { CreateCategoryUseCase } from "../modules/categorization/application/create-category.use-case.js";
import { ReviseCategoryUseCase } from "../modules/categorization/application/revise-category.use-case.js";
import { CategoriesController } from "../modules/categorization/infrastructure/http/categories.controller.js";
import { PrismaCategoryRepository } from "../modules/categorization/infrastructure/prisma-category.repository.js";
import { PrismaCategoryValidationAdapter } from "../modules/categorization/infrastructure/prisma-category-validation.adapter.js";
import { ACCOUNT_VALIDATION } from "../modules/ledger/application/ports/account-validation.port.js";
import {
  CATEGORY_VALIDATION,
  CLOCK,
  ID_GENERATOR,
  TRANSACTION_REPOSITORY,
} from "../modules/ledger/index.js";
import { ListTransactionRevisionsUseCase } from "../modules/ledger/application/list-transaction-revisions.use-case.js";
import { ListTransactionsUseCase } from "../modules/ledger/application/list-transactions.use-case.js";
import { RecordManualTransactionUseCase } from "../modules/ledger/application/record-manual-transaction.use-case.js";
import { ReviseTransactionUseCase } from "../modules/ledger/application/revise-transaction.use-case.js";
import { VoidTransactionUseCase } from "../modules/ledger/application/void-transaction.use-case.js";
import { CryptoIdGenerator } from "../modules/ledger/infrastructure/crypto-id-generator.adapter.js";
import { TransactionsController } from "../modules/ledger/infrastructure/http/transactions.controller.js";
import { PrismaTransactionRepository } from "../modules/ledger/infrastructure/persistence/prisma-transaction.repository.js";
import { SystemClock } from "../modules/ledger/infrastructure/system-clock.adapter.js";
import { HealthController } from "./health.controller.js";
import { PrismaService } from "./prisma.service.js";

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`AUTH_MODE=oidc requires ${name} to be set`);
  }
  return value;
}

@Module({
  controllers: [
    HealthController,
    TransactionsController,
    CategoriesController,
    AccountsController,
    WorkspaceController,
  ],
  providers: [
    PrismaService,
    { provide: PrismaClient, useExisting: PrismaService },
    {
      provide: CALLER_RESOLVER,
      useFactory: () =>
        process.env.AUTH_MODE === "oidc"
          ? new JwtCallerResolver({
              issuer: requiredEnv("OIDC_ISSUER"),
              audience: requiredEnv("OIDC_AUDIENCE"),
              jwksUri: requiredEnv("OIDC_JWKS_URI"),
            })
          : new DevHeaderCallerResolver(),
    },
    {
      provide: WORKSPACE_CONTEXT,
      useClass: DeterministicWorkspaceAdapter,
    },
    {
      provide: WORKSPACE_SETTINGS,
      useClass: DeterministicWorkspaceAdapter,
    },
    {
      provide: UpdateWorkspacePreferencesUseCase,
      useFactory: (settings: DeterministicWorkspaceAdapter) =>
        new UpdateWorkspacePreferencesUseCase(settings),
      inject: [WORKSPACE_SETTINGS],
    },
    {
      provide: TRANSACTION_REPOSITORY,
      useClass: PrismaTransactionRepository,
    },
    {
      provide: ACCOUNT_REPOSITORY,
      useClass: PrismaAccountRepository,
    },
    {
      provide: ACCOUNT_VALIDATION,
      useClass: PrismaAccountRepository,
    },
    {
      provide: CATEGORY_VALIDATION,
      useClass: PrismaCategoryValidationAdapter,
    },
    {
      provide: CATEGORY_CATALOG,
      useClass: PrismaCategoryValidationAdapter,
    },
    {
      provide: CATEGORY_REPOSITORY,
      useClass: PrismaCategoryRepository,
    },
    {
      provide: CreateCategoryUseCase,
      useFactory: (
        categories: PrismaCategoryRepository,
        ids: CryptoIdGenerator,
      ) => new CreateCategoryUseCase(categories, ids),
      inject: [CATEGORY_REPOSITORY, ID_GENERATOR],
    },
    {
      provide: ReviseCategoryUseCase,
      useFactory: (categories: PrismaCategoryRepository) =>
        new ReviseCategoryUseCase(categories),
      inject: [CATEGORY_REPOSITORY],
    },
    {
      provide: ArchiveCategoryUseCase,
      useFactory: (categories: PrismaCategoryRepository) =>
        new ArchiveCategoryUseCase(categories),
      inject: [CATEGORY_REPOSITORY],
    },
    { provide: CLOCK, useClass: SystemClock },
    { provide: ID_GENERATOR, useClass: CryptoIdGenerator },
    {
      provide: RecordManualTransactionUseCase,
      useFactory: (
        transactions: PrismaTransactionRepository,
        accounts: PrismaAccountRepository,
        categories: PrismaCategoryValidationAdapter,
        clock: SystemClock,
        ids: CryptoIdGenerator,
      ) =>
        new RecordManualTransactionUseCase(
          transactions,
          accounts,
          categories,
          clock,
          ids,
        ),
      inject: [
        TRANSACTION_REPOSITORY,
        ACCOUNT_VALIDATION,
        CATEGORY_VALIDATION,
        CLOCK,
        ID_GENERATOR,
      ],
    },
    {
      provide: CreateAccountUseCase,
      useFactory: (
        accounts: PrismaAccountRepository,
        ids: CryptoIdGenerator,
      ) => new CreateAccountUseCase(accounts, ids),
      inject: [ACCOUNT_REPOSITORY, ID_GENERATOR],
    },
    {
      provide: ListAccountsUseCase,
      useFactory: (accounts: PrismaAccountRepository) =>
        new ListAccountsUseCase(accounts),
      inject: [ACCOUNT_REPOSITORY],
    },
    {
      provide: ReviseAccountUseCase,
      useFactory: (accounts: PrismaAccountRepository) =>
        new ReviseAccountUseCase(accounts),
      inject: [ACCOUNT_REPOSITORY],
    },
    {
      provide: ArchiveAccountUseCase,
      useFactory: (accounts: PrismaAccountRepository) =>
        new ArchiveAccountUseCase(accounts),
      inject: [ACCOUNT_REPOSITORY],
    },
    {
      provide: ListTransactionsUseCase,
      useFactory: (transactions: PrismaTransactionRepository) =>
        new ListTransactionsUseCase(transactions),
      inject: [TRANSACTION_REPOSITORY],
    },
    {
      provide: ReviseTransactionUseCase,
      useFactory: (
        transactions: PrismaTransactionRepository,
        accounts: PrismaAccountRepository,
        categories: PrismaCategoryValidationAdapter,
        clock: SystemClock,
      ) => new ReviseTransactionUseCase(transactions, accounts, categories, clock),
      inject: [
        TRANSACTION_REPOSITORY,
        ACCOUNT_VALIDATION,
        CATEGORY_VALIDATION,
        CLOCK,
      ],
    },
    {
      provide: VoidTransactionUseCase,
      useFactory: (
        transactions: PrismaTransactionRepository,
        clock: SystemClock,
      ) => new VoidTransactionUseCase(transactions, clock),
      inject: [TRANSACTION_REPOSITORY, CLOCK],
    },
    {
      provide: ListTransactionRevisionsUseCase,
      useFactory: (transactions: PrismaTransactionRepository) =>
        new ListTransactionRevisionsUseCase(transactions),
      inject: [TRANSACTION_REPOSITORY],
    },
  ],
})
export class AppModule {}
