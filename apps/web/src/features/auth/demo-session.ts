/**
 * "María" demo account + per-tab demo session handle
 * (demo-maria-session T8, S1–S3; L10 restored per-sid model).
 *
 * The demo is a real Supabase sign-in with a fixed email read from
 * `VITE_DEMO_EMAIL` (env-gated: empty → the demo entry stays hidden).
 * Right after signing in, the client POSTs `/api/v1/demo/session`
 * with the bearer and the API materializes an ephemeral seeded
 * workspace for that session; the returned sid is stored here and
 * sent as `x-demo-session` on every API call.
 *
 * The sid lives in sessionStorage (per-tab, per browser session):
 * closing the tab discards it, and a new demo sign-in always receives
 * a fresh workspace — nothing a visitor changes persists across demo
 * sessions. Sign-out asks the API to delete the session workspace
 * (best-effort) and then clears the sid together with the client
 * caches.
 */

/**
 * Fixed email of the manually provisioned demo account (S1), or null
 * when `VITE_DEMO_EMAIL` is unset or empty — the demo entry stays
 * hidden in that case. Read lazily (same pattern as
 * `isAuthConfigured`) so tests can stub the env.
 */
export function demoEmail(): string | null {
  const value = import.meta.env.VITE_DEMO_EMAIL as string | undefined;
  return value ? value : null;
}

const STORAGE_KEY = "demo-sid";

function storage(): Storage | null {
  try {
    return globalThis.sessionStorage ?? null;
  } catch {
    return null;
  }
}

/** The per-tab demo session id, or null when no demo is active. */
export function getDemoSessionId(): string | null {
  return storage()?.getItem(STORAGE_KEY) ?? null;
}

export function setDemoSessionId(sid: string): void {
  storage()?.setItem(STORAGE_KEY, sid);
}

export function clearDemoSessionId(): void {
  storage()?.removeItem(STORAGE_KEY);
}
