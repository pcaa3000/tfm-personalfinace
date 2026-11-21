/**
 * Per-tab demo session handle (demo-maria-session T3, S2+S3).
 *
 * The "María" demo is a real Supabase sign-in with a fixed email
 * (`DEMO_EMAIL`). Right after signing in, the client POSTs
 * `/api/v1/demo/session` with the bearer and the API materializes an
 * ephemeral seeded workspace `oidc|<sub>|<sid>`; the returned sid is
 * stored here and sent as `x-demo-session` on every API call.
 *
 * The sid lives in sessionStorage (per-tab, per browser session):
 * closing the tab discards it, and a new demo sign-in always receives
 * a fresh workspace — nothing a visitor changes persists across demo
 * sessions. Sign-out clears the sid together with the client caches.
 */

/** Fixed email of the manually provisioned demo account (S1). */
export const DEMO_EMAIL =
  (import.meta.env.VITE_DEMO_EMAIL as string | undefined) ??
  "mariademo@example.com";

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
