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
import { useTranslation } from "react-i18next";

import { listTransactionRevisions } from "./api";
import { formatInstant } from "./format";
import type { TransactionView } from "./types";

interface Props {
  transaction: TransactionView | null;
  onClose: () => void;
}

export function TransactionHistoryDialog({ transaction, onClose }: Props) {
  const { t, i18n } = useTranslation();
  const revisionsQuery = useQuery({
    queryKey: ["transactions", transaction?.id, "revisions"],
    queryFn: () => listTransactionRevisions(transaction!.id),
    enabled: transaction !== null,
  });

  return (
    <Dialog open={transaction !== null} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>{t("dialog.historyTitle")}</DialogTitle>
      <DialogContent>
        {revisionsQuery.isLoading ? (
          <Typography>{t("dialog.loading")}</Typography>
        ) : revisionsQuery.isError ? (
          <Typography color="error">{t("dialog.revisionsError")}</Typography>
        ) : (revisionsQuery.data ?? []).length === 0 ? (
          <Typography color="text.secondary">
            {t("dialog.noRevisions")}
          </Typography>
        ) : (
          <List dense>
            {(revisionsQuery.data ?? []).map((revision) => (
              <ListItem key={revision.id} alignItems="flex-start">
                <ListItemText
                  primary={`#${revision.revisionNumber} ${t(
                    revision.kind === "void"
                      ? "dialog.kindVoid"
                      : "dialog.kindRevision",
                  )} — ${formatInstant(revision.occurredAt, i18n.language)} — ${revision.actor}`}
                  secondary={revision.changes
                    .map(
                      (change) =>
                        `${t(`fields.${change.field}`, { defaultValue: change.field })}: ${change.previous} → ${change.next}`,
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
