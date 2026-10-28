import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
} from "@mui/material";

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
  return (
    <Dialog open={transaction !== null} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>Void transaction</DialogTitle>
      <DialogContent>
        {error ? <Alert severity="error">{error}</Alert> : null}
        <DialogContentText>
          Voiding marks the transaction as cancelled without deleting its
          history. This cannot be undone.
        </DialogContentText>
        {transaction ? (
          <DialogContentText sx={{ mt: 1 }}>
            {transaction.businessDate} — {transaction.concept} (
            {transaction.amount} {transaction.currency})
          </DialogContentText>
        ) : null}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={submitting}>
          Cancel
        </Button>
        <Button
          color="error"
          variant="contained"
          disabled={submitting}
          onClick={() => transaction && onConfirm(transaction.id)}
        >
          {submitting ? "Voiding…" : "Void"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
