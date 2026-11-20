import { Chip } from "@mui/material";
import { useTranslation } from "react-i18next";

/** Inline URL of a stored scan image (`GET /receipts/:id/file`). */
export function receiptFileUrl(scanId: string): string {
  return `/api/v1/receipts/${scanId}/file`;
}

interface Props {
  /** Scan id behind `origin === "ticket"`; may be absent on old rows. */
  originReference: string | null | undefined;
}

/**
 * "ticket" origin badge for movement rows (receipt-review-link T3, S2).
 * With an `originReference` it links straight to the stored scan image
 * in a new tab; without one it degrades to a plain non-linked badge —
 * pinned degradation for scans predating the field.
 */
export function TicketOriginBadge({ originReference }: Props) {
  const { t } = useTranslation();
  if (originReference) {
    return (
      <Chip
        size="small"
        variant="outlined"
        component="a"
        href={receiptFileUrl(originReference)}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={t("table.viewTicket")}
        clickable
        label={t("table.ticketBadge")}
      />
    );
  }
  return (
    <Chip size="small" variant="outlined" label={t("table.ticketBadge")} />
  );
}
