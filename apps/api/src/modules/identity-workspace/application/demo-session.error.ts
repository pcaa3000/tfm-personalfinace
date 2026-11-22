/**
 * demo-maria-session T6 (S5): fail-closed demo workspace resolution.
 * Thrown by {@link DemoSessionWorkspaceResolver} when the demo subject
 * lacks a valid `x-demo-session` sid — the HTTP layer maps it to a 403
 * that never falls back to the shared `issuer|subject` workspace.
 */
export class DemoSessionError extends Error {
  constructor(
    readonly code: "DEMO_SESSION_REQUIRED" | "DEMO_SESSION_INVALID",
    message: string,
  ) {
    super(message);
    this.name = "DemoSessionError";
  }
}
