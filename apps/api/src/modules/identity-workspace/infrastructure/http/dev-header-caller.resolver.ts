
import type { CallerResolverPort } from "../../application/caller-resolver.port.js";
import type { CallerIdentity } from "../../application/workspace-context.port.js";
import { callerFromHeaders } from "./dev-caller.js";

/** Local development resolver (AUTH_MODE=dev): trusts the x-dev-user header. */
export class DevHeaderCallerResolver implements CallerResolverPort {
  resolve(
    headers: Record<string, string | string[] | undefined>,
  ): Promise<CallerIdentity | null> {
    return Promise.resolve(callerFromHeaders(headers));
  }
}
