import type { Hono } from "hono";
import { z } from "zod";

import type {
  ExportMonthlyReportUseCase,
  GetAntExpensesUseCase,
  GetCashFlowReportUseCase,
  GetExpensesByCategoryUseCase,
  GetMonthlySavingsUseCase,
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
// `month` is required: every monthly report resolves a calendar month
// (closed or provisional); year/month arrive as query strings and are
// coerced to ints.
const reportPeriodQuerySchema = z.object({
  currency: z.string().length(3),
  year: z.coerce.number().int().min(1).max(9999),
  month: z.coerce.number().int().min(1).max(12),
});

/** T10 (S9): the export endpoint adds a required `format` discriminator. */
const reportExportQuerySchema = reportPeriodQuerySchema.extend({
  format: z.enum(["csv", "xlsx"]),
});

/** Report validation failures (period, currency, timezone) are all 400s. */
function toHttpError(error: DomainError): HttpError {
  return new HttpError(400, {
    code: error.code,
    message: error.message,
  });
}

export interface ReportsRouteDeps extends AuthDeps {
  readonly cashFlowReport?: Pick<GetCashFlowReportUseCase, "execute">;
  readonly expensesByCategory?: Pick<
    GetExpensesByCategoryUseCase,
    "execute"
  >;
  readonly antExpenses?: Pick<GetAntExpensesUseCase, "execute">;
  readonly monthlySavings?: Pick<GetMonthlySavingsUseCase, "execute">;
  readonly exportReport?: Pick<ExportMonthlyReportUseCase, "execute">;
}

function parsePeriodQuery(c: {
  req: { query: () => Record<string, string | undefined> };
}) {
  const parsed = reportPeriodQuerySchema.safeParse(c.req.query());
  if (!parsed.success) {
    throw new HttpError(400, {
      code: "INVALID_QUERY",
      message: "Invalid report filters",
      details: sanitizeZodIssues(parsed.error.issues),
    });
  }
  return parsed.data;
}

function parseExportQuery(c: {
  req: { query: () => Record<string, string | undefined> };
}) {
  const parsed = reportExportQuerySchema.safeParse(c.req.query());
  if (!parsed.success) {
    throw new HttpError(400, {
      code: "INVALID_QUERY",
      message: "Invalid report filters",
      details: sanitizeZodIssues(parsed.error.issues),
    });
  }
  return parsed.data;
}

/**
 * Registers the `/api/v1/reports/*` surface (reports-monthly T3–T6):
 * GET /cash-flow (S1), GET /expenses-by-category (S2),
 * GET /ant-expenses (S3) and GET /monthly-savings (S4). All share the
 * same query — `?currency=X&year=Y&month=M` — and the workspace
 * timezone comes from the auth context, never from the client.
 *
 * The deps are optional — like the period-closes/demo routes — so
 * shells built without the reports wiring never mount the endpoints
 * (fail-closed, 404).
 */
export function registerReportsRoutes(
  app: Hono<HonoEnv>,
  deps: ReportsRouteDeps,
): void {
  const cashFlowReport = deps.cashFlowReport;
  const expensesByCategory = deps.expensesByCategory;
  const antExpenses = deps.antExpenses;
  const monthlySavings = deps.monthlySavings;
  if (
    !cashFlowReport ||
    !expensesByCategory ||
    !antExpenses ||
    !monthlySavings
  ) {
    return;
  }
  const auth = authMiddleware(deps);

  app.get("/api/v1/reports/cash-flow", auth, async (c) => {
    const query = parsePeriodQuery(c);
    const { workspace } = authContext(c);
    const result = await cashFlowReport.execute({
      workspaceId: workspace.workspaceId,
      currency: query.currency,
      year: query.year,
      month: query.month,
      timezone: workspace.timezone,
    });
    if (!result.ok) {
      throw toHttpError(result.error);
    }
    return c.json(result.value);
  });

  app.get("/api/v1/reports/expenses-by-category", auth, async (c) => {
    const query = parsePeriodQuery(c);
    const { workspace } = authContext(c);
    const result = await expensesByCategory.execute({
      workspaceId: workspace.workspaceId,
      currency: query.currency,
      year: query.year,
      month: query.month,
      timezone: workspace.timezone,
    });
    if (!result.ok) {
      throw toHttpError(result.error);
    }
    return c.json(result.value);
  });

  app.get("/api/v1/reports/ant-expenses", auth, async (c) => {
    const query = parsePeriodQuery(c);
    const { workspace } = authContext(c);
    const result = await antExpenses.execute({
      workspaceId: workspace.workspaceId,
      currency: query.currency,
      year: query.year,
      month: query.month,
      timezone: workspace.timezone,
    });
    if (!result.ok) {
      throw toHttpError(result.error);
    }
    return c.json(result.value);
  });

  app.get("/api/v1/reports/monthly-savings", auth, async (c) => {
    const query = parsePeriodQuery(c);
    const { workspace } = authContext(c);
    const result = await monthlySavings.execute({
      workspaceId: workspace.workspaceId,
      currency: query.currency,
      year: query.year,
      month: query.month,
      timezone: workspace.timezone,
    });
    if (!result.ok) {
      throw toHttpError(result.error);
    }
    return c.json(result.value);
  });

  // T10 (S9): GET /export streams the four sections as one attachment.
  // The dep stays optional — a shell wired without it keeps the read
  // endpoints mounted and answers 404 here (fail-closed).
  const exportReport = deps.exportReport;
  if (exportReport) {
    app.get("/api/v1/reports/export", auth, async (c) => {
      const query = parseExportQuery(c);
      const { workspace } = authContext(c);
      const result = await exportReport.execute({
        workspaceId: workspace.workspaceId,
        currency: query.currency,
        year: query.year,
        month: query.month,
        timezone: workspace.timezone,
        format: query.format,
      });
      if (!result.ok) {
        throw toHttpError(result.error);
      }
      const file = result.value;
      return c.body(file.body, 200, {
        "Content-Type": file.contentType,
        "Content-Disposition": `attachment; filename="${file.filename}"`,
      });
    });
  }
}
