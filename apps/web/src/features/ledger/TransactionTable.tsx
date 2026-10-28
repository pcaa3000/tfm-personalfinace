import {
  Button,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
} from "@mui/material";

import type { TransactionView } from "./types";

interface Props {
  transactions: TransactionView[];
  categoryLabels: Map<string, string>;
  onEdit: (transaction: TransactionView) => void;
  onVoid: (transaction: TransactionView) => void;
  onHistory: (transaction: TransactionView) => void;
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
                {trx.status}
                {trx.revisionCount > 0 ? ` (${trx.revisionCount})` : ""}
              </TableCell>
              <TableCell align="right">
                {trx.amount} {trx.currency}
              </TableCell>
              <TableCell align="right">
                <Stack direction="row" spacing={1} sx={{ justifyContent: "flex-end" }}>
                  <Button
                    size="small"
                    disabled={voided}
                    onClick={() => onEdit(trx)}
                  >
                    Edit
                  </Button>
                  <Button
                    size="small"
                    color="error"
                    disabled={voided}
                    onClick={() => onVoid(trx)}
                  >
                    Void
                  </Button>
                  <Button size="small" onClick={() => onHistory(trx)}>
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
