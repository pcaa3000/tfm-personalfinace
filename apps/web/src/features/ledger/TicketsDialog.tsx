import {
  useInfiniteQuery,
  useMutation,
  useQueryClient,
  type InfiniteData,
} from "@tanstack/react-query";
import {
  Alert,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  IconButton,
  List,
  ListItem,
  ListItemText,
  Stack,
  Typography,
  useMediaQuery,
} from "@mui/material";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { deleteReceiptFile, listReceipts } from "./api";
import { errorMessage } from "./errors";
import { formatInstant } from "./format";
import { EyeIcon, TrashIcon } from "./icons";
import { ManageListItem } from "./ManageListItem";
import { ReceiptImageViewer } from "./ReceiptImageViewer";
import type {
  ReceiptListItemView,
  ReceiptListPageView,
} from "./receipt-draft";

interface Props {
  open: boolean;
  onClose: () => void;
}

const RECEIPTS_PAGE_SIZE = 20;
/**
 * Below MUI's `sm` breakpoint the rows switch to the compact layout
 * (receipt-review-link T7): icon actions and ~3 lines per row so 6+
 * rows fit a mobile viewport. Raw query string, like DESKTOP_QUERY in
 * LedgerPage — also lets specs drive the breakpoint via matchMedia.
 */
const COMPACT_QUERY = "(max-width:599.95px)";

interface RowProps {
  scan: ReceiptListItemView;
  compact: boolean;
  onView: (scan: ReceiptListItemView) => void;
  onDelete: (scan: ReceiptListItemView) => void;
}

/**
 * One receipt row. Compact (mobile) packs the status chip and icon
 * actions on the right of ≤3 text lines; the regular layout keeps the
 * shared ManageListItem shape with text buttons.
 */
function TicketRow({ scan, compact, onView, onDelete }: RowProps) {
  const { t, i18n } = useTranslation();
  const statusChip = (
    <Chip
      size="small"
      variant="outlined"
      label={t(`tickets.status.${scan.status}`, {
        defaultValue: scan.status,
      })}
    />
  );
  const linkedChip = scan.transactionId ? (
    <Chip
      size="small"
      color="success"
      variant="outlined"
      label={t("tickets.linkedMovement")}
      sx={{ ml: 1 }}
    />
  ) : null;
  const expiry = scan.mediaDeletedAt
    ? t("tickets.mediaDeleted")
    : t("tickets.expiresAt", {
        date: formatInstant(scan.expiresAt, i18n.language),
      });

  if (compact) {
    return (
      <ListItem
        disableGutters
        data-testid="manage-row"
        sx={{ display: "flex", alignItems: "center", gap: 1, py: 0.5 }}
      >
        <ListItemText
          sx={{ flex: 1, minWidth: 0, m: 0 }}
          primary={
            <>
              {scan.originalFilename}
              {linkedChip}
            </>
          }
          secondary={`${formatInstant(scan.createdAt, i18n.language)} · ${expiry}`}
        />
        <Stack sx={{ flexShrink: 0, alignItems: "flex-end" }}>
          {statusChip}
          {scan.mediaDeletedAt ? null : (
            <Stack direction="row">
              <IconButton
                size="small"
                aria-label={t("tickets.viewImage")}
                onClick={() => onView(scan)}
              >
                <EyeIcon fontSize="small" />
              </IconButton>
              <IconButton
                size="small"
                color="error"
                aria-label={t("tickets.deleteMedia")}
                onClick={() => onDelete(scan)}
              >
                <TrashIcon fontSize="small" />
              </IconButton>
            </Stack>
          )}
        </Stack>
      </ListItem>
    );
  }

  return (
    <ManageListItem
      primary={
        <>
          {scan.originalFilename}
          {linkedChip}
        </>
      }
      secondary={
        <>
          {formatInstant(scan.createdAt, i18n.language)}
          <br />
          <span>{expiry}</span>
        </>
      }
      actions={
        <>
          {statusChip}
          {scan.mediaDeletedAt ? null : (
            <>
              <Button size="small" onClick={() => onView(scan)}>
                {t("tickets.viewImage")}
              </Button>
              <Button
                size="small"
                color="error"
                onClick={() => onDelete(scan)}
              >
                {t("tickets.deleteMedia")}
              </Button>
            </>
          )}
        </>
      }
    />
  );
}

/**
 * Gestión → Tickets (receipt-review-link T4+T6+T7, S1+S3+S4): every
 * workspace receipt scan, newest first, cursor-paginated behind
 * "Cargar más" — filename, upload date, localized status, an in-app
 * authenticated image viewer (the raw file URL 401s without the auth
 * header, L28) and a linked-movement badge.
 *
 * Retention (receipt-retention-30d T5, S3+S5): each row shows the fixed
 * 30-day expiry of its stored medium and offers early deletion behind a
 * confirmation dialog. Deleting removes only the storage object — the
 * scan row and any linked transaction survive (CA-012) — so the row
 * switches to a "medio eliminado" state in place. Rows already listing
 * `mediaDeletedAt` render that state directly.
 */
export function TicketsDialog({ open, onClose }: Props) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const compact = useMediaQuery(COMPACT_QUERY);
  const [deleteTarget, setDeleteTarget] = useState<ReceiptListItemView | null>(
    null,
  );
  const [viewerScan, setViewerScan] = useState<ReceiptListItemView | null>(
    null,
  );
  const receiptsQuery = useInfiniteQuery({
    queryKey: ["receipts"],
    queryFn: ({ pageParam }) =>
      listReceipts({ limit: RECEIPTS_PAGE_SIZE, cursor: pageParam }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    enabled: open,
  });
  const scans = receiptsQuery.data?.pages.flatMap((page) => page.items) ?? [];

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteReceiptFile(id),
    onSuccess: (_result, id) => {
      // CA-012: only the stored object is gone — patch every cached
      // page in place so the row's deleted state renders without a
      // refetch.
      const stamp = new Date().toISOString();
      queryClient.setQueryData<InfiniteData<ReceiptListPageView>>(
        ["receipts"],
        (data) =>
          data
            ? {
                ...data,
                pages: data.pages.map((page) => ({
                  ...page,
                  items: page.items.map((row) =>
                    row.id === id ? { ...row, mediaDeletedAt: stamp } : row,
                  ),
                })),
              }
            : data,
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
          ) : (
            <>
              {receiptsQuery.isError ? (
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
              ) : null}
              {scans.length === 0 && !receiptsQuery.isError ? (
                <Typography color="text.secondary">
                  {t("tickets.empty")}
                </Typography>
              ) : null}
              {scans.length > 0 ? (
                <List dense={!compact}>
                  {scans.map((scan) => (
                    <TicketRow
                      key={scan.id}
                      scan={scan}
                      compact={compact}
                      onView={setViewerScan}
                      onDelete={openDeleteDialog}
                    />
                  ))}
                </List>
              ) : null}
              {receiptsQuery.hasNextPage ? (
                <Button
                  fullWidth
                  sx={{ mt: 1 }}
                  disabled={receiptsQuery.isFetchingNextPage}
                  onClick={() => void receiptsQuery.fetchNextPage()}
                >
                  {receiptsQuery.isFetchingNextPage
                    ? t("tickets.loading")
                    : t("tickets.loadMore")}
                </Button>
              ) : null}
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Authenticated in-app image viewer (T6, L28). */}
      <ReceiptImageViewer
        scanId={viewerScan?.id ?? null}
        title={viewerScan?.originalFilename}
        onClose={() => setViewerScan(null)}
      />

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
