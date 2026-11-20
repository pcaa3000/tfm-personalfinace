import { Chip } from "@mui/material";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { VoiceAudioViewer } from "./VoiceAudioViewer";

interface Props {
  /** Note id behind `origin === "voice"`; may be absent on old rows. */
  originReference: string | null | undefined;
}

/**
 * "voice" origin badge for movement rows (voice-drafts T4). With an
 * `originReference` it opens the authenticated in-app audio player —
 * the raw `/voices/:id/file` URL 401s without the Authorization
 * header, so no link to it may be rendered. Without a reference it
 * degrades to a plain non-clickable badge.
 */
export function VoiceOriginBadge({ originReference }: Props) {
  const { t } = useTranslation();
  const [playerOpen, setPlayerOpen] = useState(false);
  if (!originReference) {
    return (
      <Chip size="small" variant="outlined" label={t("table.voiceBadge")} />
    );
  }
  const noteId = originReference;
  return (
    <>
      <Chip
        size="small"
        variant="outlined"
        component="button"
        onClick={() => setPlayerOpen(true)}
        aria-label={t("table.playVoice")}
        clickable
        label={t("table.voiceBadge")}
      />
      <VoiceAudioViewer
        noteId={playerOpen ? noteId : null}
        onClose={() => setPlayerOpen(false)}
      />
    </>
  );
}
