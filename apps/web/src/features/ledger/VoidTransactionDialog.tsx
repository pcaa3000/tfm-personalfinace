import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
} from "@mui/material";
import { useTranslation } from "react-i18next";

import { formatBusinessDate } from "./format";
import type { TransactionView } from "./types";

interface Props {
  transaction: TransactionView | null;
  submitting: boolean;
  error: string | null;
  onClose: () => void;
  onConfirm: (id: string) => void;
}

export function VoidTransactionDialog({
  transaction,
  submitting,
  error,
  onClose,
  onConfirm,
}: Props) {
  const { t, i18n } = useTranslation();
  return (
    <Dialog open={transaction !== null} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>{t("dialog.voidTitle")}</DialogTitle>
      <DialogContent>
        {error ? <Alert severity="error">{error}</Alert> : null}
        <DialogContentText>{t("dialog.voidBody")}</DialogContentText>
        {transaction ? (
          <DialogContentText sx={{ mt: 1 }}>
            {formatBusinessDate(transaction.businessDate, i18n.language)} —{" "}
            {transaction.concept} ({transaction.amount} {transaction.currency})
          </DialogContentText>
        ) : null}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={submitting}>
          {t("dialog.cancel")}
        </Button>
        <Button
          color="error"
          variant="contained"
          disabled={submitting}
          onClick={() => transaction && onConfirm(transaction.id)}
        >
          {submitting ? t("dialog.voiding") : t("dialog.confirm")}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
