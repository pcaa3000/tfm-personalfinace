import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect } from "react";

import { syncPendingTransactions } from "./sync";

export const PENDING_QUERY_KEY = ["pending-transactions"] as const;

/**
 * Drains the offline outbox on mount, whenever the browser comes back
 * online, and after each successful drain refreshes the ledger queries.
 */
export function usePendingSync(): void {
  const queryClient = useQueryClient();

  const sync = useCallback(async () => {
    const result = await syncPendingTransactions();
    if (result.synced > 0) {
      await queryClient.invalidateQueries({ queryKey: ["transactions"] });
    }
    if (result.synced > 0 || result.dropped > 0 || result.remaining > 0) {
      await queryClient.invalidateQueries({ queryKey: PENDING_QUERY_KEY });
    }
  }, [queryClient]);

  useEffect(() => {
    void sync();
    const onOnline = () => {
      void sync();
    };
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, [sync]);
}
