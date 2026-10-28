import { Module } from "@nestjs/common";
import { PrismaClient } from "@prisma/client";

import { WORKSPACE_CONTEXT } from "../modules/identity-workspace/index.js";
import { DeterministicWorkspaceAdapter } from "../modules/identity-workspace/infrastructure/deterministic-workspace.adapter.js";
import { PrismaCategoryValidationAdapter } from "../modules/categorization/infrastructure/prisma-category-validation.adapter.js";
import {
  CATEGORY_VALIDATION,
  CLOCK,
  ID_GENERATOR,
  TRANSACTION_REPOSITORY,
} from "../modules/ledger/index.js";
import { ListTransactionsUseCase } from "../modules/ledger/application/list-transactions.use-case.js";
import { RecordManualTransactionUseCase } from "../modules/ledger/application/record-manual-transaction.use-case.js";
import { CryptoIdGenerator } from "../modules/ledger/infrastructure/crypto-id-generator.adapter.js";
import { TransactionsController } from "../modules/ledger/infrastructure/http/transactions.controller.js";
import { PrismaTransactionRepository } from "../modules/ledger/infrastructure/persistence/prisma-transaction.repository.js";
import { SystemClock } from "../modules/ledger/infrastructure/system-clock.adapter.js";
import { HealthController } from "./health.controller.js";
import { PrismaService } from "./prisma.service.js";

@Module({
  controllers: [HealthController, TransactionsController],
  providers: [
    PrismaService,
    { provide: PrismaClient, useExisting: PrismaService },
    {
      provide: WORKSPACE_CONTEXT,
      useClass: DeterministicWorkspaceAdapter,
    },
    {
      provide: TRANSACTION_REPOSITORY,
      useClass: PrismaTransactionRepository,
    },
    {
      provide: CATEGORY_VALIDATION,
      useClass: PrismaCategoryValidationAdapter,
    },
    { provide: CLOCK, useClass: SystemClock },
    { provide: ID_GENERATOR, useClass: CryptoIdGenerator },
    {
      provide: RecordManualTransactionUseCase,
      useFactory: (
        transactions: PrismaTransactionRepository,
        categories: PrismaCategoryValidationAdapter,
        clock: SystemClock,
        ids: CryptoIdGenerator,
      ) => new RecordManualTransactionUseCase(transactions, categories, clock, ids),
      inject: [TRANSACTION_REPOSITORY, CATEGORY_VALIDATION, CLOCK, ID_GENERATOR],
    },
    {
      provide: ListTransactionsUseCase,
      useFactory: (transactions: PrismaTransactionRepository) =>
        new ListTransactionsUseCase(transactions),
      inject: [TRANSACTION_REPOSITORY],
    },
  ],
})
export class AppModule {}
