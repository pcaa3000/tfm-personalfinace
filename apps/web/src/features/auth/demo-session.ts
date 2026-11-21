/**
 * Client-side demo session flag (demo-maria-login T2, S3).
 *
 * While set, the API client identifies every call as
 * `x-dev-user: demo-maria` (the `local|demo-maria` workspace) and the
 * auth context exposes a pseudo-session so the app shell works without
 * a Supabase session. The flag lives in localStorage so the demo
 * survives reloads; signOut clears it together with the client caches.
 * The demo workspace is re-seeded server-side on every demo sign-in,
 * so whatever a visitor changes is discarded on the next entry.
 */

/** Subject the API dev mode maps to the seeded demo workspace. */
export const DEMO_SUBJECT = "demo-maria";

const STORAGE_KEY = "demo-session";
const FLAG_VALUE = "1";

function storage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

export function isDemoSession(): boolean {
  return storage()?.getItem(STORAGE_KEY) === FLAG_VALUE;
}

export function startDemoSession(): void {
  storage()?.setItem(STORAGE_KEY, FLAG_VALUE);
}

export function endDemoSession(): void {
  storage()?.removeItem(STORAGE_KEY);
}
