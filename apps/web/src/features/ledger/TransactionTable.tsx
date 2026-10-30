import {
  Button,
  Chip,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
} from "@mui/material";

import type { LedgerRow } from "./types";

interface Props {
  transactions: LedgerRow[];
  categoryLabels: Map<string, string>;
  onEdit: (transaction: LedgerRow) => void;
  onVoid: (transaction: LedgerRow) => void;
  onHistory: (transaction: LedgerRow) => void;
}

export function TransactionTable({
  transactions,
  categoryLabels,
  onEdit,
  onVoid,
  onHistory,
}: Props) {
  if (transactions.length === 0) {
    return <Typography color="text.secondary">No transactions yet.</Typography>;
  }

  return (
    <Table size="small" aria-label="Transactions">
      <TableHead>
        <TableRow>
          <TableCell>Date</TableCell>
          <TableCell>Type</TableCell>
          <TableCell>Concept</TableCell>
          <TableCell>Category</TableCell>
          <TableCell>Status</TableCell>
          <TableCell align="right">Amount</TableCell>
          <TableCell align="right">Actions</TableCell>
        </TableRow>
      </TableHead>
      <TableBody>
        {transactions.map((trx) => {
          const voided = trx.status === "voided";
          const pending = trx.pendingSync === true;
          return (
            <TableRow key={trx.id} sx={voided ? { opacity: 0.5 } : undefined}>
              <TableCell>{trx.businessDate}</TableCell>
              <TableCell>{trx.type}</TableCell>
              <TableCell>{trx.concept}</TableCell>
              <TableCell>
                {trx.categoryId
                  ? (categoryLabels.get(trx.categoryId) ?? trx.categoryId)
                  : "Uncategorized"}
              </TableCell>
              <TableCell>
                {pending ? (
                  <Chip size="small" color="warning" label="Pending sync" />
                ) : (
                  <>
                    {trx.status}
                    {trx.revisionCount > 0 ? ` (${trx.revisionCount})` : ""}
                  </>
                )}
              </TableCell>
              <TableCell align="right">
                {trx.amount} {trx.currency}
              </TableCell>
              <TableCell align="right">
                <Stack direction="row" spacing={1} sx={{ justifyContent: "flex-end" }}>
                  <Button
                    size="small"
                    disabled={voided || pending}
                    onClick={() => onEdit(trx)}
                  >
                    Edit
                  </Button>
                  <Button
                    size="small"
                    color="error"
                    disabled={voided || pending}
                    onClick={() => onVoid(trx)}
                  >
                    Void
                  </Button>
                  <Button
                    size="small"
                    disabled={pending}
                    onClick={() => onHistory(trx)}
                  >
                    History
                  </Button>
                </Stack>
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
