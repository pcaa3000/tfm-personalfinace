// Public API of the identity-workspace module.
// Resolves the authenticated identity (issuer+subject) to the single
// financial workspace that authorizes every operation.
export {
  WORKSPACE_CONTEXT,
  type CallerIdentity,
  type WorkspaceContext,
  type WorkspaceContextPort,
} from "./application/workspace-context.port.js";
export {
  callerFromHeaders,
  DEV_USER_HEADER,
} from "./infrastructure/http/dev-caller.js";
