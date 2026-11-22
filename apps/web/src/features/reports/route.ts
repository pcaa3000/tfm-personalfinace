import { useSyncExternalStore } from "react";

/**
 * Minimal hash routing (reports-monthly T7, S7): the app has no router
 * dependency, so the two top-level views switch on `location.hash` —
 * `#/` (or empty) renders the ledger, `#/reports` renders the reports
 * page. Kept dependency-free so `LedgerPage` can import it without a
 * module cycle (ReportsPage imports ledger chrome).
 */
export type AppRoute = "panel" | "reports";

const REPORTS_HASH = "#/reports";

export function currentAppRoute(): AppRoute {
  if (typeof window === "undefined") return "panel";
  return window.location.hash === REPORTS_HASH ? "reports" : "panel";
}

export function navigateToReports(): void {
  window.location.hash = "/reports";
}

export function navigateToPanel(): void {
  window.location.hash = "/";
}

function subscribeHash(onChange: () => void): () => void {
  window.addEventListener("hashchange", onChange);
  return () => window.removeEventListener("hashchange", onChange);
}

/** Reactive current route — re-renders on `hashchange`. */
export function useAppRoute(): AppRoute {
  return useSyncExternalStore(subscribeHash, currentAppRoute);
}
