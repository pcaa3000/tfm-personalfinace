import type { Hono } from "hono";

import type { GetWorkspaceBalanceUseCase } from "../../modules/ledger/application/get-workspace-balance.use-case.js";
import {
  authContext,
  authMiddleware,
  type AuthDeps,
  type HonoEnv,
} from "../middleware/auth.js";

export interface BalanceRouteDeps extends AuthDeps {
  readonly getBalance: Pick<GetWorkspaceBalanceUseCase, "execute">;
}

/**
 * Registers `GET /api/v1/balance` — the dedicated per-currency aggregate
 * for the balance strip, replacing the "download the whole ledger"
 * workaround the web used before.
 */
export function registerBalanceRoutes(
  app: Hono<HonoEnv>,
  deps: BalanceRouteDeps,
): void {
  const auth = authMiddleware(deps);

  app.get("/api/v1/balance", auth, async (c) => {
    const { workspace } = authContext(c);
    return c.json(await deps.getBalance.execute(workspace.workspaceId));
  });
}
