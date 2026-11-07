import type { Hono } from "hono";
import { z } from "zod";

import type { ArchiveAccountUseCase } from "../../modules/accounts/application/archive-account.use-case.js";
import type { CreateAccountUseCase } from "../../modules/accounts/application/create-account.use-case.js";
import type { ListAccountsUseCase } from "../../modules/accounts/application/list-accounts.use-case.js";
import type { ReviseAccountUseCase } from "../../modules/accounts/application/revise-account.use-case.js";
import { DomainError } from "../../modules/shared-kernel/index.js";
import {
  authContext,
  authMiddleware,
  type AuthDeps,
  type HonoEnv,
} from "../middleware/auth.js";
import { HttpError } from "../middleware/errors.js";

// Zod schemas are copied verbatim from the Nest AccountsController so
// validation envelopes (INVALID_BODY + details) stay identical.
const KINDS = [
  "cash",
  "bank",
  "savings",
  "credit_card",
  "virtual",
  "investment",
  "loan",
  "insurance",
] as const;

const createAccountSchema = z.object({
  name: z.string().min(1).max(64),
  currency: z.string().length(3),
  kind: z.enum(KINDS).default("bank"),
  initialBalance: z.string().min(1).max(48).optional(),
});

const reviseAccountSchema = z
  .object({
    name: z.string().min(1).max(64).optional(),
    kind: z.enum(KINDS).optional(),
    initialBalance: z.string().min(1).max(48).optional(),
  })
  .refine(
    (data) =>
      data.name !== undefined ||
      data.kind !== undefined ||
      data.initialBalance !== undefined,
  );

/** Same mapping as the Nest AccountsController.toHttpError. */
function toHttpError(error: DomainError): HttpError {
  const notFound = error.code.endsWith("_NOT_FOUND");
  const conflict = error.code.endsWith("_TAKEN");
  return new HttpError(
    notFound ? 404 : conflict ? 409 : 400,
    { code: error.code, message: error.message },
  );
}

export interface AccountRouteDeps extends AuthDeps {
  readonly createAccount: Pick<CreateAccountUseCase, "execute">;
  readonly listAccounts: Pick<ListAccountsUseCase, "execute">;
  readonly reviseAccount: Pick<ReviseAccountUseCase, "execute">;
  readonly archiveAccount: Pick<ArchiveAccountUseCase, "execute">;
}

/**
 * Registers the `/api/v1/accounts` surface. Paths, methods, status codes
 * (POST → 201, PATCH/GET → 200) and `{code, message}` envelopes mirror
 * AccountsController.
 */
export function registerAccountRoutes(
  app: Hono<HonoEnv>,
  deps: AccountRouteDeps,
): void {
  const auth = authMiddleware(deps);

  app.get("/api/v1/accounts", auth, async (c) => {
    const { workspace } = authContext(c);
    return c.json(await deps.listAccounts.execute(workspace.workspaceId));
  });

  app.post("/api/v1/accounts", auth, async (c) => {
    const parsed = createAccountSchema.safeParse(
      await c.req.json().catch(() => undefined),
    );
    if (!parsed.success) {
      throw new HttpError(400, {
        code: "INVALID_BODY",
        message: "Invalid account payload",
        details: parsed.error.issues,
      });
    }
    const { workspace } = authContext(c);
    const result = await deps.createAccount.execute({
      workspaceId: workspace.workspaceId,
      name: parsed.data.name,
      currency: parsed.data.currency,
      kind: parsed.data.kind,
      ...(parsed.data.initialBalance !== undefined
        ? { initialBalance: parsed.data.initialBalance }
        : {}),
    });
    if (!result.ok) {
      throw toHttpError(result.error);
    }
    return c.json(result.value, 201);
  });

  app.patch("/api/v1/accounts/:id", auth, async (c) => {
    const parsed = reviseAccountSchema.safeParse(
      await c.req.json().catch(() => undefined),
    );
    if (!parsed.success) {
      throw new HttpError(400, {
        code: "INVALID_BODY",
        message: "Invalid account revision payload",
        details: parsed.error.issues,
      });
    }
    const { workspace } = authContext(c);
    const result = await deps.reviseAccount.execute({
      workspaceId: workspace.workspaceId,
      accountId: c.req.param("id"),
      ...(parsed.data.name !== undefined ? { name: parsed.data.name } : {}),
      ...(parsed.data.kind !== undefined ? { kind: parsed.data.kind } : {}),
      ...(parsed.data.initialBalance !== undefined
        ? { initialBalance: parsed.data.initialBalance }
        : {}),
    });
    if (!result.ok) {
      throw toHttpError(result.error);
    }
    return c.json(result.value);
  });

  app.post("/api/v1/accounts/:id/archive", auth, async (c) => {
    const { workspace } = authContext(c);
    const result = await deps.archiveAccount.execute({
      workspaceId: workspace.workspaceId,
      accountId: c.req.param("id"),
    });
    if (!result.ok) {
      throw toHttpError(result.error);
    }
    return c.json(result.value, 201);
  });
}
