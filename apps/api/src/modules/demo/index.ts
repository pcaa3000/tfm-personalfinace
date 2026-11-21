// Public API of the demo module (demo-maria-session T1): ephemeral
// per-session demo workspaces for the "María" QA/prod demo.
export {
  DEMO_SESSION,
  type DemoSession,
  type DemoSessionPort,
} from "./application/demo-session.port.js";
export {
  DEMO_WORKSPACE_KIND,
  DrizzleDemoSessionService,
} from "./infrastructure/drizzle-demo-session.service.js";
