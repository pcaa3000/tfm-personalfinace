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
  CALLER_RESOLVER,
  type CallerResolverPort,
} from "./application/caller-resolver.port.js";
