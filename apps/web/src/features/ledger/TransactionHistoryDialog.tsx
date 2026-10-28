import { useQuery } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  List,
  ListItem,
  ListItemText,
  Typography,
} from "@mui/material";

import { listTransactionRevisions } from "./api";
import type { TransactionView } from "./types";

interface Props {
  transaction: TransactionView | null;
  onClose: () => void;
}

export function TransactionHistoryDialog({ transaction, onClose }: Props) {
  const revisionsQuery = useQuery({
    queryKey: ["transactions", transaction?.id, "revisions"],
    queryFn: () => listTransactionRevisions(transaction!.id),
    enabled: transaction !== null,
  });

  return (
    <Dialog open={transaction !== null} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Revision history</DialogTitle>
      <DialogContent>
        {revisionsQuery.isLoading ? (
          <Typography>Loading…</Typography>
        ) : revisionsQuery.isError ? (
          <Typography color="error">Could not load revisions.</Typography>
        ) : (revisionsQuery.data ?? []).length === 0 ? (
          <Typography color="text.secondary">
            No revisions recorded yet.
          </Typography>
        ) : (
          <List dense>
            {(revisionsQuery.data ?? []).map((revision) => (
              <ListItem key={revision.id} alignItems="flex-start">
                <ListItemText
                  primary={`#${revision.revisionNumber} ${revision.kind} — ${new Date(revision.occurredAt).toLocaleString()} by ${revision.actor}`}
                  secondary={revision.changes
                    .map(
                      (change) =>
                        `${change.field}: ${change.previous} → ${change.next}`,
                    )
                    .join(" · ")}
                />
              </ListItem>
            ))}
          </List>
        )}
      </DialogContent>
    </Dialog>
  );
}
