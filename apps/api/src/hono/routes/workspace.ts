import type { Hono } from "hono";
import { z } from "zod";

import type { UpdateWorkspacePreferencesUseCase } from "../../modules/identity-workspace/application/update-workspace-preferences.use-case.js";
import type { WorkspaceContext } from "../../modules/identity-workspace/index.js";
import { DomainError } from "../../modules/shared-kernel/index.js";
import {
  authContext,
  authMiddleware,
  type AuthDeps,
  type HonoEnv,
} from "../middleware/auth.js";
import { HttpError } from "../middleware/errors.js";

// Zod schema is copied verbatim from the Nest WorkspaceController so
// validation envelopes (INVALID_BODY + details) stay identical.
const updateSchema = z
  .object({
    defaultCurrency: z.string().length(3).optional(),
    locale: z.string().min(2).max(35).optional(),
    timezone: z.string().min(1).max(64).optional(),
  })
  .refine(
    (data) =>
      data.defaultCurrency !== undefined ||
      data.locale !== undefined ||
      data.timezone !== undefined,
  );

/** Same mapping as the Nest WorkspaceController: 404 on _NOT_FOUND, else 400. */
function toHttpError(error: DomainError): HttpError {
  return new HttpError(error.code.endsWith("_NOT_FOUND") ? 404 : 400, {
    code: error.code,
    message: error.message,
  });
}

/** Same projected shape the Nest WorkspaceController returns. */
function toWorkspaceView(context: WorkspaceContext) {
  return {
    workspaceId: context.workspaceId.value,
    locale: context.locale,
    timezone: context.timezone,
    defaultCurrency: context.defaultCurrency,
  };
}

export interface WorkspaceRouteDeps extends AuthDeps {
  readonly updatePreferences: Pick<
    UpdateWorkspacePreferencesUseCase,
    "execute"
  >;
}

/**
 * Registers the `/api/v1/workspace` surface. GET/PATCH → 200 and the
 * `{workspaceId, locale, timezone, defaultCurrency}` projection mirror
 * WorkspaceController.
 */
export function registerWorkspaceRoutes(
  app: Hono<HonoEnv>,
  deps: WorkspaceRouteDeps,
): void {
  const auth = authMiddleware(deps);

  app.get("/api/v1/workspace", auth, (c) => {
    const { workspace } = authContext(c);
    return c.json(toWorkspaceView(workspace));
  });

  app.patch("/api/v1/workspace", auth, async (c) => {
    const parsed = updateSchema.safeParse(
      await c.req.json().catch(() => undefined),
    );
    if (!parsed.success) {
      throw new HttpError(400, {
        code: "INVALID_BODY",
        message: "Invalid workspace payload",
        details: parsed.error.issues,
      });
    }

    const { workspace } = authContext(c);
    const result = await deps.updatePreferences.execute(
      workspace.workspaceId,
      {
        ...(parsed.data.defaultCurrency !== undefined
          ? { defaultCurrency: parsed.data.defaultCurrency }
          : {}),
        ...(parsed.data.locale !== undefined
          ? { locale: parsed.data.locale }
          : {}),
        ...(parsed.data.timezone !== undefined
          ? { timezone: parsed.data.timezone }
          : {}),
      },
    );
    if (!result.ok) {
      throw toHttpError(result.error);
    }
    return c.json(toWorkspaceView(result.value));
  });
}
