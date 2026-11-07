import type { Hono } from "hono";
import { z } from "zod";

import type { AddCurrencyUseCase } from "../../modules/currencies/application/add-currency.use-case.js";
import type { ArchiveCurrencyUseCase } from "../../modules/currencies/application/archive-currency.use-case.js";
import type { ListCurrenciesUseCase } from "../../modules/currencies/application/list-currencies.use-case.js";
import type { ListIsoCatalogUseCase } from "../../modules/currencies/application/list-iso-catalog.use-case.js";
import type { ReviseCurrencyUseCase } from "../../modules/currencies/application/revise-currency.use-case.js";
import { DomainError } from "../../modules/shared-kernel/index.js";
import {
  authContext,
  authMiddleware,
  type AuthDeps,
  type HonoEnv,
} from "../middleware/auth.js";
import { HttpError } from "../middleware/errors.js";

// Zod schemas are copied verbatim from the Nest CurrenciesController so
// validation envelopes (INVALID_BODY + details) stay identical.
const currencyCodeSchema = z.object({
  code: z.string().length(3),
});

const CONFLICT_CODES = new Set([
  "CURRENCY_CODE_TAKEN",
  "CURRENCY_IN_USE",
  "CURRENCY_IS_DEFAULT",
  "CURRENCY_LAST_ACTIVE",
]);

/** Same mapping as the Nest CurrenciesController.toHttpError. */
function toHttpError(error: DomainError): HttpError {
  const notFound = error.code.endsWith("_NOT_FOUND");
  const conflict =
    error.code.endsWith("_TAKEN") || CONFLICT_CODES.has(error.code);
  return new HttpError(
    notFound ? 404 : conflict ? 409 : 400,
    { code: error.code, message: error.message },
  );
}

export interface CurrencyRouteDeps extends AuthDeps {
  readonly listCurrencies: Pick<ListCurrenciesUseCase, "execute">;
  readonly listIsoCatalog: Pick<ListIsoCatalogUseCase, "execute">;
  readonly addCurrency: Pick<AddCurrencyUseCase, "execute">;
  readonly reviseCurrency: Pick<ReviseCurrencyUseCase, "execute">;
  readonly archiveCurrency: Pick<ArchiveCurrencyUseCase, "execute">;
}

/**
 * Registers the `/api/v1/currencies` surface. Paths, methods, status codes
 * (POST → 201, PATCH/GET → 200) and `{code, message}` envelopes mirror
 * CurrenciesController, including the ISO 4217 catalog route (L21).
 */
export function registerCurrencyRoutes(
  app: Hono<HonoEnv>,
  deps: CurrencyRouteDeps,
): void {
  const auth = authMiddleware(deps);

  app.get("/api/v1/currencies", auth, async (c) => {
    const { workspace } = authContext(c);
    return c.json(await deps.listCurrencies.execute(workspace.workspaceId));
  });

  app.get("/api/v1/currencies/catalog", auth, (c) =>
    c.json(deps.listIsoCatalog.execute()),
  );

  app.post("/api/v1/currencies", auth, async (c) => {
    const parsed = currencyCodeSchema.safeParse(
      await c.req.json().catch(() => undefined),
    );
    if (!parsed.success) {
      throw new HttpError(400, {
        code: "INVALID_BODY",
        message: "Invalid currency payload",
        details: parsed.error.issues,
      });
    }

    const { workspace } = authContext(c);
    const result = await deps.addCurrency.execute({
      workspaceId: workspace.workspaceId,
      code: parsed.data.code,
    });
    if (!result.ok) {
      throw toHttpError(result.error);
    }
    return c.json(result.value, 201);
  });

  app.patch("/api/v1/currencies/:id", auth, async (c) => {
    const parsed = currencyCodeSchema.safeParse(
      await c.req.json().catch(() => undefined),
    );
    if (!parsed.success) {
      throw new HttpError(400, {
        code: "INVALID_BODY",
        message: "Invalid currency revision payload",
        details: parsed.error.issues,
      });
    }

    const { workspace } = authContext(c);
    const result = await deps.reviseCurrency.execute({
      workspaceId: workspace.workspaceId,
      currencyId: c.req.param("id"),
      code: parsed.data.code,
    });
    if (!result.ok) {
      throw toHttpError(result.error);
    }
    return c.json(result.value);
  });

  app.post("/api/v1/currencies/:id/archive", auth, async (c) => {
    const { workspace } = authContext(c);
    const result = await deps.archiveCurrency.execute({
      workspaceId: workspace.workspaceId,
      currencyId: c.req.param("id"),
      defaultCurrency: workspace.defaultCurrency,
    });
    if (!result.ok) {
      throw toHttpError(result.error);
    }
    return c.json(result.value, 201);
  });
}
