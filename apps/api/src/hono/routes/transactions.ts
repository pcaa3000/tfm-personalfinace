import type { Hono } from "hono";
import { z } from "zod";

import type {
  ListTransactionRevisionsUseCase,
  ListTransactionsUseCase,
  RecordManualTransactionUseCase,
  ReviseTransactionUseCase,
  TransactionFilter,
  VoidTransactionUseCase,
} from "../../modules/ledger/index.js";
import { DomainError } from "../../modules/shared-kernel/index.js";
import {
  authContext,
  authMiddleware,
  type AuthDeps,
  type HonoEnv,
} from "../middleware/auth.js";
import { HttpError } from "../middleware/errors.js";
import { sanitizeZodIssues } from "../middleware/zod-details.js";

// Zod schemas are copied verbatim from the Nest TransactionsController so
// validation envelopes (INVALID_BODY / INVALID_QUERY + details) stay identical.
const createTransactionSchema = z.object({
  type: z.enum(["income", "expense", "transfer"]),
  amount: z.string().min(1).max(48),
  currency: z.string().length(3),
  businessDate: z.string().min(10).max(10),
  timezone: z.string().min(1).max(64),
  concept: z.string().min(1).max(500),
  accountId: z.string().min(1),
  destinationAccountId: z.string().min(1).nullable().optional(),
  categoryId: z.string().nullable().optional(),
  idempotencyKey: z.string().min(8).max(128).optional(),
});

const reviseTransactionSchema = z.object({
  type: z.enum(["income", "expense", "transfer"]).optional(),
  amount: z.string().min(1).max(48).optional(),
  currency: z.string().length(3).optional(),
  businessDate: z.string().min(10).max(10).optional(),
  timezone: z.string().min(1).max(64).optional(),
  concept: z.string().min(1).max(500).optional(),
  accountId: z.string().min(1).optional(),
  destinationAccountId: z.string().min(1).nullable().optional(),
  categoryId: z.string().nullable().optional(),
});

const listTransactionsSchema = z.object({
  from: z.string().optional(),
  to: z.string().optional(),
  type: z.enum(["income", "expense", "transfer"]).optional(),
  currency: z.string().length(3).optional(),
  category: z.string().optional(),
  q: z.string().min(1).max(100).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

/** Same mapping as the Nest TransactionsController.toHttpError. */
function toHttpError(error: DomainError): HttpError {
  const notFound = error.code.endsWith("_NOT_FOUND");
  return new HttpError(notFound ? 404 : 400, {
    code: error.code,
    message: error.message,
  });
}

export interface TransactionRouteDeps extends AuthDeps {
  readonly recordManual: Pick<RecordManualTransactionUseCase, "execute">;
  readonly listTransactions: Pick<ListTransactionsUseCase, "execute">;
  readonly reviseTransaction: Pick<ReviseTransactionUseCase, "execute">;
  readonly voidTransaction: Pick<VoidTransactionUseCase, "execute">;
  readonly listRevisions: Pick<ListTransactionRevisionsUseCase, "execute">;
}

/**
 * Registers the `/api/v1/transactions` surface. Paths, methods, status codes
 * (POST → 201, PATCH/GET → 200) and `{code, message}` envelopes mirror
 * TransactionsController.
 */
export function registerTransactionRoutes(
  app: Hono<HonoEnv>,
  deps: TransactionRouteDeps,
): void {
  const auth = authMiddleware(deps);

  app.post("/api/v1/transactions", auth, async (c) => {
    const parsed = createTransactionSchema.safeParse(
      await c.req.json().catch(() => undefined),
    );
    if (!parsed.success) {
      throw new HttpError(400, {
        code: "INVALID_BODY",
        message: "Invalid transaction payload",
        details: sanitizeZodIssues(parsed.error.issues),
      });
    }

    const idempotencyKey = parsed.data.idempotencyKey;
    if (!idempotencyKey) {
      throw new HttpError(400, {
        code: "IDEMPOTENCY_KEY_REQUIRED",
        message: "An idempotencyKey is required to create a transaction",
      });
    }

    const { caller, workspace } = authContext(c);
    const result = await deps.recordManual.execute({
      workspaceId: workspace.workspaceId,
      idempotencyKey,
      type: parsed.data.type,
      amount: parsed.data.amount,
      currency: parsed.data.currency,
      businessDate: parsed.data.businessDate,
      timezone: parsed.data.timezone,
      concept: parsed.data.concept,
      accountId: parsed.data.accountId,
      destinationAccountId: parsed.data.destinationAccountId ?? null,
      categoryId: parsed.data.categoryId ?? null,
      actor: caller.subject,
    });
    if (!result.ok) {
      throw toHttpError(result.error);
    }
    return c.json(result.value, 201);
  });

  app.get("/api/v1/transactions", auth, async (c) => {
    const parsed = listTransactionsSchema.safeParse(c.req.query());
    if (!parsed.success) {
      throw new HttpError(400, {
        code: "INVALID_QUERY",
        message: "Invalid list filters",
        details: sanitizeZodIssues(parsed.error.issues),
      });
    }

    const { workspace } = authContext(c);
    const filter: TransactionFilter = {};
    if (parsed.data.from) Object.assign(filter, { from: parsed.data.from });
    if (parsed.data.to) Object.assign(filter, { to: parsed.data.to });
    if (parsed.data.type) Object.assign(filter, { type: parsed.data.type });
    if (parsed.data.currency)
      Object.assign(filter, { currency: parsed.data.currency });
    if (parsed.data.category)
      Object.assign(filter, { category: parsed.data.category });
    if (parsed.data.q) Object.assign(filter, { q: parsed.data.q });
    if (parsed.data.limit !== undefined)
      Object.assign(filter, { limit: parsed.data.limit });
    if (parsed.data.offset !== undefined)
      Object.assign(filter, { offset: parsed.data.offset });

    return c.json(
      await deps.listTransactions.execute(workspace.workspaceId, filter),
    );
  });

  app.patch("/api/v1/transactions/:id", auth, async (c) => {
    const parsed = reviseTransactionSchema.safeParse(
      await c.req.json().catch(() => undefined),
    );
    if (!parsed.success) {
      throw new HttpError(400, {
        code: "INVALID_BODY",
        message: "Invalid revision payload",
        details: sanitizeZodIssues(parsed.error.issues),
      });
    }

    const { caller, workspace } = authContext(c);
    const result = await deps.reviseTransaction.execute({
      workspaceId: workspace.workspaceId,
      transactionId: c.req.param("id"),
      ...(parsed.data.type !== undefined ? { type: parsed.data.type } : {}),
      ...(parsed.data.amount !== undefined
        ? { amount: parsed.data.amount }
        : {}),
      ...(parsed.data.currency !== undefined
        ? { currency: parsed.data.currency }
        : {}),
      ...(parsed.data.businessDate !== undefined
        ? { businessDate: parsed.data.businessDate }
        : {}),
      ...(parsed.data.timezone !== undefined
        ? { timezone: parsed.data.timezone }
        : {}),
      ...(parsed.data.concept !== undefined
        ? { concept: parsed.data.concept }
        : {}),
      ...(parsed.data.accountId !== undefined
        ? { accountId: parsed.data.accountId }
        : {}),
      ...(parsed.data.destinationAccountId !== undefined
        ? { destinationAccountId: parsed.data.destinationAccountId }
        : {}),
      ...(parsed.data.categoryId !== undefined
        ? { categoryId: parsed.data.categoryId }
        : {}),
      actor: caller.subject,
    });
    if (!result.ok) {
      throw toHttpError(result.error);
    }
    return c.json(result.value);
  });

  app.post("/api/v1/transactions/:id/void", auth, async (c) => {
    const { caller, workspace } = authContext(c);
    const result = await deps.voidTransaction.execute({
      workspaceId: workspace.workspaceId,
      transactionId: c.req.param("id"),
      actor: caller.subject,
    });
    if (!result.ok) {
      throw toHttpError(result.error);
    }
    return c.json(result.value, 201);
  });

  app.get("/api/v1/transactions/:id/revisions", auth, async (c) => {
    const { workspace } = authContext(c);
    const result = await deps.listRevisions.execute(
      workspace.workspaceId,
      c.req.param("id"),
    );
    if (!result.ok) {
      throw toHttpError(result.error);
    }
    return c.json(result.value);
  });
}
