import { useQuery } from "@tanstack/react-query";
import {
  Alert,
  Button,
  Chip,
  Dialog,
  DialogContent,
  DialogTitle,
  List,
  Typography,
} from "@mui/material";
import { useTranslation } from "react-i18next";

import { listReceipts } from "./api";
import { formatInstant } from "./format";
import { ManageListItem } from "./ManageListItem";
import { receiptFileUrl } from "./TicketOriginBadge";

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
 */
export function TicketsDialog({ open, onClose }: Props) {
  const { t, i18n } = useTranslation();
  const receiptsQuery = useQuery({
    queryKey: ["receipts"],
    queryFn: listReceipts,
    enabled: open,
  });

  return (
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
                secondary={formatInstant(scan.createdAt, i18n.language)}
                actions={
                  <>
                    <Chip
                      size="small"
                      variant="outlined"
                      label={t(`tickets.status.${scan.status}`, {
                        defaultValue: scan.status,
                      })}
                    />
                    <Button
                      size="small"
                      component="a"
                      href={receiptFileUrl(scan.id)}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {t("tickets.viewImage")}
                    </Button>
                  </>
                }
              />
            ))}
          </List>
        )}
      </DialogContent>
    </Dialog>
  );
}
