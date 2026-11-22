// Public API of the demo module (demo-maria-session T6): ephemeral
// per-session demo workspaces for the "María" QA/prod demo — the L10
// final model restoring the per-sid approach with the >24h orphan
// sweep shared by POST/DELETE /demo/session and db:demo:cleanup.
export {
  DEMO_SESSION,
  type DemoSession,
  type DemoSessionPort,
} from "./application/demo-session.port.js";
export { DrizzleDemoSessionService } from "./infrastructure/drizzle-demo-session.service.js";
