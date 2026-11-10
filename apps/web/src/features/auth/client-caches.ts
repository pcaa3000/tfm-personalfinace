import { queryClient } from "../../query-client";
import { clearPendingTransactions } from "../ledger/offline/queue";

/**
 * GAP-SEC-08 (S6): wipes every client-side trace of the outgoing
 * identity — the Dexie outbox of queued transactions and the whole
 * React Query cache — so on a shared browser nothing of identity A can
 * leak into identity B's session.
 */
export async function clearClientCaches(): Promise<void> {
  queryClient.clear();
  await clearPendingTransactions();
}
