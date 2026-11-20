import { Chip } from "@mui/material";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { ReceiptImageViewer } from "./ReceiptImageViewer";

interface Props {
  /** Scan id behind `origin === "ticket"`; may be absent on old rows. */
  originReference: string | null | undefined;
}

/**
 * "ticket" origin badge for movement rows (receipt-review-link T3, S2).
 * With an `originReference` it opens the authenticated in-app image
 * viewer (T6, L28) — the raw `/receipts/:id/file` URL 401s without the
 * Authorization header, so no link to it may be rendered. Without a
 * reference it degrades to a plain non-clickable badge — pinned
 * degradation for scans predating the field.
 */
export function TicketOriginBadge({ originReference }: Props) {
  const { t } = useTranslation();
  const [viewerOpen, setViewerOpen] = useState(false);
  if (!originReference) {
    return (
      <Chip size="small" variant="outlined" label={t("table.ticketBadge")} />
    );
  }
  const scanId = originReference;
  return (
    <>
      <Chip
        size="small"
        variant="outlined"
        component="button"
        onClick={() => setViewerOpen(true)}
        aria-label={t("table.viewTicket")}
        clickable
        label={t("table.ticketBadge")}
      />
      <ReceiptImageViewer
        scanId={viewerOpen ? scanId : null}
        onClose={() => setViewerOpen(false)}
      />
    </>
  );
}
