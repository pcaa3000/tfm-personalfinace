import { useEffect } from "react";
import type { Session } from "@supabase/supabase-js";

// T1 (S1): 10 minutes without user activity triggers an automatic signOut.
const INACTIVITY_TIMEOUT_MS = 10 * 60 * 1000;

// T1 (S2): any of these events counts as activity and resets the timer.
const ACTIVITY_EVENTS = [
  "mousemove",
  "mousedown",
  "keydown",
  "touchstart",
  "scroll",
] as const;

/**
 * Signs the user out after INACTIVITY_TIMEOUT_MS without activity.
 * Only armed while a session exists (S3): login, bypass and
 * misconfigured states attach no listeners and run no timer.
 * Cleanup removes listeners and the pending timeout on unmount or
 * when the session/signOut identity changes.
 */
export function useInactivityLogout(
  session: Session | null,
  signOut: () => Promise<void>,
): void {
  useEffect(() => {
    if (!session) return;

    let timeoutId: ReturnType<typeof setTimeout>;

    const resetTimer = () => {
      clearTimeout(timeoutId);
      // S4: reuse the context signOut so the logout path (outbox and
      // query-cache wipe, error handling) is identical to a manual one.
      timeoutId = setTimeout(() => void signOut(), INACTIVITY_TIMEOUT_MS);
    };

    resetTimer();
    for (const event of ACTIVITY_EVENTS) {
      window.addEventListener(event, resetTimer);
    }

    return () => {
      clearTimeout(timeoutId);
      for (const event of ACTIVITY_EVENTS) {
        window.removeEventListener(event, resetTimer);
      }
    };
  }, [session, signOut]);
}
