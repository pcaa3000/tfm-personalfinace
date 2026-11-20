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

import { ApiError, getVoiceFile } from "./api";
import { errorMessage } from "./errors";

interface Props {
  /** Note whose stored audio is played; `null` keeps the dialog closed. */
  noteId: string | null;
  /** Dialog title — usually the note's original filename. */
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
 * In-app player for a stored voice-note audio (voice-drafts T4). The
 * raw `/api/v1/voices/:id/file` URL cannot be linked — it needs the
 * Authorization header — so the file is fetched through the
 * authenticated api client as a Blob and played via an object URL,
 * revoked when the dialog closes or the component unmounts. A 410
 * (media deleted early or purged, S7 retention) renders the localized
 * "medio eliminado" copy; other failures go through `errorMessage`.
 */
export function VoiceAudioViewer({ noteId, title, onClose }: Props) {
  const { t } = useTranslation();
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<ViewerState>(IDLE);

  useEffect(() => {
    if (!noteId) {
      setState(IDLE);
      return;
    }
    let cancelled = false;
    let objectUrl: string | null = null;
    setState({ url: null, error: null, loading: true });
    getVoiceFile(noteId)
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
  }, [noteId, attempt]);

  const heading = title ?? t("voice.viewerTitle");
  const mediaGone =
    state.error instanceof ApiError && state.error.status === 410;

  return (
    <Dialog open={noteId !== null} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>{heading}</DialogTitle>
      <DialogContent>
        {state.loading ? (
          <Typography>{t("voice.loading")}</Typography>
        ) : state.error !== null ? (
          <Alert
            severity="error"
            action={
              <Button
                color="inherit"
                size="small"
                onClick={() => setAttempt((n) => n + 1)}
              >
                {t("voice.retry")}
              </Button>
            }
          >
            {mediaGone
              ? t("voice.audioDeleted")
              : errorMessage(state.error, t)}
          </Alert>
        ) : state.url ? (
          <Box
            component="audio"
            controls
            data-testid="voice-audio"
            src={state.url}
            sx={{ display: "block", width: "100%" }}
          />
        ) : null}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t("voice.closeViewer")}</Button>
      </DialogActions>
    </Dialog>
  );
}
