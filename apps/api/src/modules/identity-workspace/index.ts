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
export { DemoSessionError } from "./application/demo-session.error.js";
// demo-maria-session T1 (S5): fail-closed demo workspace resolver and
// the dev/oidc caller resolvers it composes with in the HTTP layer.
export { DemoSessionWorkspaceResolver } from "./infrastructure/demo-session-workspace.resolver.js";
export { DevHeaderCallerResolver } from "./infrastructure/http/dev-header-caller.resolver.js";
export {
  WORKSPACE_CATALOG_PROVISIONER,
  type WorkspaceCatalogProvisionerPort,
} from "./application/workspace-catalog-provisioner.port.js";
export {
  CATEGORY_SEED_PROVISIONER,
  type CategoryCatalogProvisionerPort,
} from "./application/category-catalog-provisioner.port.js";
