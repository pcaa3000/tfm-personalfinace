import type { Hono } from "hono";
import { z } from "zod";

import type {
  ClosePeriodUseCase,
  ListPeriodClosesUseCase,
} from "../../modules/reports/index.js";
import { DomainError } from "../../modules/shared-kernel/index.js";
import {
  authContext,
  authMiddleware,
  type AuthDeps,
  type HonoEnv,
} from "../middleware/auth.js";
import { HttpError } from "../middleware/errors.js";
import { sanitizeZodIssues } from "../middleware/zod-details.js";

// Zod schemas at the top, same convention as the other route files.
// `integrityConfirmed` is a literal: the monthly close is a user
// declaration of ledger completeness (S5) — anything else is a 400.
const closePeriodSchema = z.object({
  currency: z.string().length(3),
  year: z.number().int().min(1).max(9999),
  month: z.number().int().min(1).max(12),
  integrityConfirmed: z.literal(true),
});

const listPeriodClosesSchema = z.object({
  currency: z.string().length(3).optional(),
});

function toHttpError(error: DomainError): HttpError {
  if (error.code === "PERIOD_ALREADY_CLOSED") {
    return new HttpError(409, {
      code: error.code,
      message: error.message,
    });
  }
  return new HttpError(400, {
    code: error.code,
    message: error.message,
  });
}

export interface PeriodClosesRouteDeps extends AuthDeps {
  readonly closePeriod?: Pick<ClosePeriodUseCase, "execute">;
  readonly listPeriodCloses?: Pick<ListPeriodClosesUseCase, "execute">;
}

/**
 * Registers the `/api/v1/period-closes` surface (reports-monthly T2, S5):
 * POST declares the minimal monthly close; GET lists the latest close per
 * period (stale flag visible) for the report endpoints.
 *
 * The deps are optional — like the demo routes — so shells built without
 * the reports wiring never mount the endpoints (fail-closed, 404).
 */
export function registerPeriodClosesRoutes(
  app: Hono<HonoEnv>,
  deps: PeriodClosesRouteDeps,
): void {
  const closePeriod = deps.closePeriod;
  const listPeriodCloses = deps.listPeriodCloses;
  if (!closePeriod || !listPeriodCloses) {
    return;
  }
  const auth = authMiddleware(deps);

  app.post("/api/v1/period-closes", auth, async (c) => {
    const parsed = closePeriodSchema.safeParse(
      await c.req.json().catch(() => undefined),
    );
    if (!parsed.success) {
      throw new HttpError(400, {
        code: "INVALID_BODY",
        message: "Invalid period close payload",
        details: sanitizeZodIssues(parsed.error.issues),
      });
    }

    const { caller, workspace } = authContext(c);
    const result = await closePeriod.execute({
      workspaceId: workspace.workspaceId,
      currency: parsed.data.currency,
      year: parsed.data.year,
      month: parsed.data.month,
      // The workspace timezone is server-resolved; the client never sends it.
      timezone: workspace.timezone,
      integrityConfirmed: parsed.data.integrityConfirmed,
      actor: caller.subject,
    });
    if (!result.ok) {
      throw toHttpError(result.error);
    }
    return c.json(result.value, 201);
  });

  app.get("/api/v1/period-closes", auth, async (c) => {
    const parsed = listPeriodClosesSchema.safeParse(c.req.query());
    if (!parsed.success) {
      throw new HttpError(400, {
        code: "INVALID_QUERY",
        message: "Invalid period close filters",
        details: sanitizeZodIssues(parsed.error.issues),
      });
    }

    const { workspace } = authContext(c);
    return c.json(
      await listPeriodCloses.execute(
        workspace.workspaceId,
        parsed.data.currency,
      ),
    );
  });
}
