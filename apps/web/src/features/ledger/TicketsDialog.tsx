import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Alert,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  List,
  Typography,
} from "@mui/material";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { deleteReceiptFile, listReceipts } from "./api";
import { errorMessage } from "./errors";
import { formatInstant } from "./format";
import { ManageListItem } from "./ManageListItem";
import { receiptFileUrl } from "./TicketOriginBadge";
import type { ReceiptListItemView } from "./receipt-draft";

interface Props {
  open: boolean;
  onClose: () => void;
}

/**
 * Gestión → Tickets (receipt-review-link T4, S1+S3): every workspace
 * receipt scan, newest first — filename, upload date, localized status
 * and a link to the stored image. Scans confirmed into a movement show
 * the linked-movement badge (the history list has no row-level deep
 * linking, so the badge is informational).
 *
 * Retention (receipt-retention-30d T5, S3+S5): each row shows the fixed
 * 30-day expiry of its stored medium and offers early deletion behind a
 * confirmation dialog. Deleting removes only the storage object — the
 * scan row and any linked transaction survive (CA-012) — so the row
 * switches to a "medio eliminado" state in place. Rows already listing
 * `mediaDeletedAt` render that state directly.
 */
export function TicketsDialog({ open, onClose }: Props) {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const [deleteTarget, setDeleteTarget] = useState<ReceiptListItemView | null>(
    null,
  );
  const receiptsQuery = useQuery({
    queryKey: ["receipts"],
    queryFn: listReceipts,
    enabled: open,
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteReceiptFile(id),
    onSuccess: (_result, id) => {
      // CA-012: only the stored object is gone — patch the cached row in
      // place so its deleted state renders without a refetch.
      queryClient.setQueryData<ReceiptListItemView[]>(["receipts"], (rows) =>
        (rows ?? []).map((row) =>
          row.id === id
            ? { ...row, mediaDeletedAt: new Date().toISOString() }
            : row,
        ),
      );
      setDeleteTarget(null);
    },
  });

  const openDeleteDialog = (scan: ReceiptListItemView) => {
    deleteMutation.reset();
    setDeleteTarget(scan);
  };

  const closeDeleteDialog = () => {
    if (deleteMutation.isPending) return;
    deleteMutation.reset();
    setDeleteTarget(null);
  };

  return (
    <>
      <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
        <DialogTitle>{t("tickets.title")}</DialogTitle>
        <DialogContent sx={{ pb: 3 }}>
          {receiptsQuery.isLoading ? (
            <Typography>{t("tickets.loading")}</Typography>
          ) : receiptsQuery.isError ? (
            <Alert
              severity="error"
              action={
                <Button
                  color="inherit"
                  size="small"
                  onClick={() => void receiptsQuery.refetch()}
                >
                  {t("tickets.retry")}
                </Button>
              }
            >
              {t("tickets.loadError")}
            </Alert>
          ) : (receiptsQuery.data ?? []).length === 0 ? (
            <Typography color="text.secondary">{t("tickets.empty")}</Typography>
          ) : (
            <List dense>
              {(receiptsQuery.data ?? []).map((scan) => (
                <ManageListItem
                  key={scan.id}
                  primary={
                    <>
                      {scan.originalFilename}
                      {scan.transactionId ? (
                        <Chip
                          size="small"
                          color="success"
                          variant="outlined"
                          label={t("tickets.linkedMovement")}
                          sx={{ ml: 1 }}
                        />
                      ) : null}
                    </>
                  }
                  secondary={
                    <>
                      {formatInstant(scan.createdAt, i18n.language)}
                      <br />
                      <span>
                        {scan.mediaDeletedAt
                          ? t("tickets.mediaDeleted")
                          : t("tickets.expiresAt", {
                              date: formatInstant(
                                scan.expiresAt,
                                i18n.language,
                              ),
                            })}
                      </span>
                    </>
                  }
                  actions={
                    <>
                      <Chip
                        size="small"
                        variant="outlined"
                        label={t(`tickets.status.${scan.status}`, {
                          defaultValue: scan.status,
                        })}
                      />
                      {scan.mediaDeletedAt ? null : (
                        <>
                          <Button
                            size="small"
                            component="a"
                            href={receiptFileUrl(scan.id)}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            {t("tickets.viewImage")}
                          </Button>
                          <Button
                            size="small"
                            color="error"
                            onClick={() => openDeleteDialog(scan)}
                          >
                            {t("tickets.deleteMedia")}
                          </Button>
                        </>
                      )}
                    </>
                  }
                />
              ))}
            </List>
          )}
        </DialogContent>
      </Dialog>

      {/* Early media deletion confirm (S3): same inline-confirm pattern
          as VoidTransactionDialog. */}
      <Dialog
        open={deleteTarget !== null}
        onClose={closeDeleteDialog}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle>{t("tickets.deleteTitle")}</DialogTitle>
        <DialogContent>
          {deleteMutation.isError ? (
            <Alert severity="error">
              {errorMessage(deleteMutation.error, t)}
            </Alert>
          ) : null}
          <DialogContentText>{t("tickets.deleteBody")}</DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button
            onClick={closeDeleteDialog}
            disabled={deleteMutation.isPending}
          >
            {t("dialog.cancel")}
          </Button>
          <Button
            color="error"
            variant="contained"
            disabled={deleteMutation.isPending}
            onClick={() =>
              deleteTarget && deleteMutation.mutate(deleteTarget.id)
            }
          >
            {deleteMutation.isPending
              ? t("tickets.deleting")
              : t("tickets.deleteConfirm")}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
