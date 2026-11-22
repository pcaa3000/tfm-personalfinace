/**
 * "María" demo account handle (demo-maria-session T4, S1).
 *
 * The demo is an ordinary Supabase sign-in with a fixed email read
 * from `VITE_DEMO_EMAIL`. Simplified model: there is no per-tab sid,
 * no `x-demo-session` header and no sessionStorage state — the app is
 * "demo" only server-side. Read lazily (same pattern as
 * `isAuthConfigured`) so tests can stub the env.
 */

/**
 * Fixed email of the manually provisioned demo account (S1), or null
 * when `VITE_DEMO_EMAIL` is unset or empty — the demo entry stays
 * hidden in that case.
 */
export function demoEmail(): string | null {
  const value = import.meta.env.VITE_DEMO_EMAIL as string | undefined;
  return value ? value : null;
}
