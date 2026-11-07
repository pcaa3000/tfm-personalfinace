import type { Hono } from "hono";
import { z } from "zod";

import type { ArchiveCategoryUseCase } from "../../modules/categorization/application/archive-category.use-case.js";
import type { CreateCategoryUseCase } from "../../modules/categorization/application/create-category.use-case.js";
import type { ReviseCategoryUseCase } from "../../modules/categorization/application/revise-category.use-case.js";
import type { CategoryCatalogPort } from "../../modules/categorization/index.js";
import { DomainError } from "../../modules/shared-kernel/index.js";
import {
  authContext,
  authMiddleware,
  type AuthDeps,
  type HonoEnv,
} from "../middleware/auth.js";
import { HttpError } from "../middleware/errors.js";

// Zod schemas are copied verbatim from the Nest CategoriesController so
// validation envelopes (INVALID_BODY + details) stay identical.
const NATURES = [
  "income",
  "essential",
  "discretionary",
  "obligation",
  "transfer",
] as const;

const createCategorySchema = z.object({
  key: z.string().min(1).max(64).optional(),
  label: z.string().min(1).max(120),
  nature: z.enum(NATURES),
});

const reviseCategorySchema = z
  .object({
    label: z.string().min(1).max(120).optional(),
    nature: z.enum(NATURES).optional(),
  })
  .refine((data) => data.label !== undefined || data.nature !== undefined);

/** Same mapping as the Nest CategoriesController.toHttpError. */
function toHttpError(error: DomainError): HttpError {
  const notFound = error.code.endsWith("_NOT_FOUND");
  const conflict = error.code.endsWith("_TAKEN");
  return new HttpError(
    notFound ? 404 : conflict ? 409 : 400,
    { code: error.code, message: error.message },
  );
}

export interface CategoryRouteDeps extends AuthDeps {
  readonly categoryCatalog: Pick<CategoryCatalogPort, "listForWorkspace">;
  readonly createCategory: Pick<CreateCategoryUseCase, "execute">;
  readonly reviseCategory: Pick<ReviseCategoryUseCase, "execute">;
  readonly archiveCategory: Pick<ArchiveCategoryUseCase, "execute">;
}

/**
 * Registers the `/api/v1/categories` surface. Paths, methods, status codes
 * (POST → 201, PATCH/GET → 200) and `{code, message}` envelopes mirror
 * CategoriesController.
 */
export function registerCategoryRoutes(
  app: Hono<HonoEnv>,
  deps: CategoryRouteDeps,
): void {
  const auth = authMiddleware(deps);

  app.get("/api/v1/categories", auth, async (c) => {
    const { workspace } = authContext(c);
    return c.json(
      await deps.categoryCatalog.listForWorkspace(workspace.workspaceId),
    );
  });

  app.post("/api/v1/categories", auth, async (c) => {
    const parsed = createCategorySchema.safeParse(
      await c.req.json().catch(() => undefined),
    );
    if (!parsed.success) {
      throw new HttpError(400, {
        code: "INVALID_BODY",
        message: "Invalid category payload",
        details: parsed.error.issues,
      });
    }

    const { workspace } = authContext(c);
    const result = await deps.createCategory.execute({
      workspaceId: workspace.workspaceId,
      ...(parsed.data.key !== undefined ? { key: parsed.data.key } : {}),
      label: parsed.data.label,
      nature: parsed.data.nature,
    });
    if (!result.ok) {
      throw toHttpError(result.error);
    }
    return c.json(result.value, 201);
  });

  app.patch("/api/v1/categories/:id", auth, async (c) => {
    const parsed = reviseCategorySchema.safeParse(
      await c.req.json().catch(() => undefined),
    );
    if (!parsed.success) {
      throw new HttpError(400, {
        code: "INVALID_BODY",
        message: "Invalid category revision payload",
        details: parsed.error.issues,
      });
    }

    const { workspace } = authContext(c);
    const result = await deps.reviseCategory.execute({
      workspaceId: workspace.workspaceId,
      categoryId: c.req.param("id"),
      ...(parsed.data.label !== undefined
        ? { label: parsed.data.label }
        : {}),
      ...(parsed.data.nature !== undefined
        ? { nature: parsed.data.nature }
        : {}),
    });
    if (!result.ok) {
      throw toHttpError(result.error);
    }
    return c.json(result.value);
  });

  app.post("/api/v1/categories/:id/archive", auth, async (c) => {
    const { workspace } = authContext(c);
    const result = await deps.archiveCategory.execute({
      workspaceId: workspace.workspaceId,
      categoryId: c.req.param("id"),
    });
    if (!result.ok) {
      throw toHttpError(result.error);
    }
    return c.json(result.value, 201);
  });
}
