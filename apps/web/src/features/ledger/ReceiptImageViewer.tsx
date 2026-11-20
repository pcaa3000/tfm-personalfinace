import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Typography,
} from "@mui/material";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { ApiError, getReceiptFile } from "./api";
import { errorMessage } from "./errors";

interface Props {
  /** Scan whose stored file is shown; `null` keeps the dialog closed. */
  scanId: string | null;
  /** Dialog title — usually the scan's original filename. */
  title?: string | undefined;
  onClose: () => void;
}

interface ViewerState {
  url: string | null;
  error: unknown;
  loading: boolean;
}

const IDLE: ViewerState = { url: null, error: null, loading: false };

/**
 * In-app viewer for a stored receipt image (receipt-review-link T6,
 * L28). The raw `/api/v1/receipts/:id/file` URL cannot be linked — it
 * needs the Authorization header — so the file is fetched through the
 * authenticated api client as a Blob and shown via an object URL,
 * which is revoked when the dialog closes or the component unmounts.
 * "Abrir en pestaña" exposes that local blob URL, never the API path.
 * A 410 (media deleted early or purged) renders the localized
 * "medio eliminado" copy; other failures go through `errorMessage`.
 */
export function ReceiptImageViewer({ scanId, title, onClose }: Props) {
  const { t } = useTranslation();
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<ViewerState>(IDLE);

  useEffect(() => {
    if (!scanId) {
      setState(IDLE);
      return;
    }
    let cancelled = false;
    let objectUrl: string | null = null;
    setState({ url: null, error: null, loading: true });
    getReceiptFile(scanId)
      .then((blob) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setState({ url: objectUrl, error: null, loading: false });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setState({ url: null, error, loading: false });
      });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [scanId, attempt]);

  const heading = title ?? t("tickets.viewerTitle");
  const mediaGone =
    state.error instanceof ApiError && state.error.status === 410;

  return (
    <Dialog open={scanId !== null} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>{heading}</DialogTitle>
      <DialogContent>
        {state.loading ? (
          <Typography>{t("tickets.loading")}</Typography>
        ) : state.error !== null ? (
          <Alert
            severity="error"
            action={
              <Button
                color="inherit"
                size="small"
                onClick={() => setAttempt((n) => n + 1)}
              >
                {t("tickets.retry")}
              </Button>
            }
          >
            {mediaGone
              ? t("tickets.imageDeleted")
              : errorMessage(state.error, t)}
          </Alert>
        ) : state.url ? (
          <Box
            component="img"
            src={state.url}
            alt={heading}
            sx={{ display: "block", maxWidth: "100%" }}
          />
        ) : null}
      </DialogContent>
      <DialogActions>
        {state.url ? (
          <Button
            component="a"
            href={state.url}
            target="_blank"
            rel="noopener noreferrer"
          >
            {t("tickets.openInTab")}
          </Button>
        ) : null}
        <Button onClick={onClose}>{t("tickets.closeViewer")}</Button>
      </DialogActions>
    </Dialog>
  );
}
