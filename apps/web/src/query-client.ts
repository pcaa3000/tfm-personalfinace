import { QueryClient } from "@tanstack/react-query";

/**
 * App-level React Query client. It lives in its own module (not App.tsx)
 * so the auth feature can wipe the cache on signOut (GAP-SEC-08, S6)
 * without importing the App component and creating an import cycle.
 */
export const queryClient = new QueryClient();
