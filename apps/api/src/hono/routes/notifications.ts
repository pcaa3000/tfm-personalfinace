import type { Hono } from "hono";

import type { ListNotificationsUseCase } from "../../modules/notifications/index.js";
import {
  authContext,
  authMiddleware,
  type AuthDeps,
  type HonoEnv,
} from "../middleware/auth.js";

export interface NotificationRouteDeps extends AuthDeps {
  readonly listNotifications: Pick<ListNotificationsUseCase, "execute">;
}

/**
 * Registers `GET /api/v1/notifications` — workspace notifications newest
 * first, written by the worker's ledger-events consumer.
 */
export function registerNotificationRoutes(
  app: Hono<HonoEnv>,
  deps: NotificationRouteDeps,
): void {
  const auth = authMiddleware(deps);

  app.get("/api/v1/notifications", auth, async (c) => {
    const { workspace } = authContext(c);
    return c.json(await deps.listNotifications.execute(workspace.workspaceId));
  });
}
